// Leaflet map and rendering
import { state } from './state.js';
import { getColor, formatYear, formatPopulation, getPopulationForYear, getCityRadius, getCityColor, pointInGeometry, getCentroid, getVisualCenter, findRiverNearPoint } from './utils.js';
import { showPolityInfo, showCompoundInfo, hideInfo, pinInfoPanel } from './info-panel.js';
import { updateLeaderboard } from './leaderboard.js';
import { terrainState } from './terrain.js';
import { recordMapZoom } from './perf.js';

const TAG_PERF = 'color: #0bf; font-weight: bold';
const NORMAL_PERF = 'color: inherit';

// Binary search: find rightmost index where fromYears[i] <= year
function upperBound(fromYears, year) {
    let lo = 0, hi = fromYears.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (fromYears[mid] <= year) lo = mid + 1;
        else hi = mid;
    }
    return lo; // all entries [0..lo-1] have FromYear <= year
}

// Get visible polities using temporal index (binary search + ToYear check)
// Falls back to linear scan if index isn't built yet
function getVisiblePolities(year) {
    const idx = state.polityIndex;
    if (!idx) {
        // Fallback: linear scan (before index is built)
        return state.allPolities.filter(f => {
            const name = f.properties.Name;
            if (name.startsWith('(') && name.endsWith(')')) return false;
            return year >= f.properties.FromYear && year <= f.properties.ToYear;
        });
    }

    const cutoff = upperBound(idx.fromYears, year);
    const result = [];
    for (let i = 0; i < cutoff; i++) {
        if (idx.sorted[i].properties.ToYear >= year) {
            result.push(idx.sorted[i]);
        }
    }
    return result;
}

// City hit detection layer
let cityHitLayer = null;

// Track currently hovered polity layer for reset
let hoveredPolityLayer = null;

// Highlight the polity at given coordinates
function highlightPolityAt(lon, lat) {
    if (!state.polityLayer) return null;

    let foundLayer = null;
    state.polityLayer.eachLayer(layer => {
        if (foundLayer) return;
        if (pointInGeometry(lon, lat, layer.feature.geometry)) {
            layer.setStyle({ weight: 3, fillOpacity: 0.7 });
            foundLayer = layer;
        }
    });
    hoveredPolityLayer = foundLayer;
    return foundLayer;
}

// Reset the currently hovered polity
function resetHoveredPolity() {
    if (hoveredPolityLayer && state.polityLayer) {
        // Don't reset if this is the selected polity (from city/river click)
        if (hoveredPolityLayer !== state.selectedPolityLayer) {
            state.polityLayer.resetStyle(hoveredPolityLayer);
        }
        hoveredPolityLayer = null;
    }
}

// Status-based opacity for cities
const statusOpacity = {
    recorded: 0.9,
    interpolated: 0.75,
    estimated: 0.6,
    projected: 0.45,
    prehistoric: 0.35
};

// Calculate zoom-based scale factor for city markers
// At zoom 3: 1.0x, at zoom 12: ~2.0x
function getZoomScale(zoom) {
    return 1 + (zoom - 3) * 0.11;
}

// Get current city outline weight from settings
function getCityOutlineWeight() {
    const weights = { none: 0, thin: 0.5, normal: 1, bold: 2, heavy: 3 };
    return weights[terrainState.cityOutline] || 1;
}

// Get current city outline color from settings
function getCityOutlineColor(fillColor) {
    switch (terrainState.cityOutlineColor) {
        case 'light': return 'rgb(200, 200, 200)';
        case 'dark': return 'rgb(60, 60, 60)';
        case 'white': return 'rgb(255, 255, 255)';
        case 'black': return 'rgb(0, 0, 0)';
        case 'match': return fillColor || 'rgb(200, 200, 200)';
        default: return 'rgb(200, 200, 200)';
    }
}

export function initMap() {
    state.map = L.map('map', {
        center: [30, 40],
        zoom: 3,
        minZoom: 2,
        maxZoom: 12,
        zoomControl: false
    });

    // Canvas renderer for polity layer only (faster than SVG for many polygons,
    // but can't be used globally as it blocks mouse events on lower panes)
    state.polityRenderer = L.canvas({ pane: 'polityPane' });

    // Create custom panes with specific z-indexes for proper layer ordering
    // Order (bottom to top): polities < rivers < riverHits < cities < cityHits < civNames
    state.map.createPane('polityPane');
    state.map.getPane('polityPane').style.zIndex = 401;

    state.map.createPane('riverPane');
    state.map.getPane('riverPane').style.zIndex = 410;

    state.map.createPane('riverHitPane');
    state.map.getPane('riverHitPane').style.zIndex = 420;

    state.map.createPane('cityPane');
    state.map.getPane('cityPane').style.zIndex = 450;

    state.map.createPane('cityHitPane');
    state.map.getPane('cityHitPane').style.zIndex = 460;

    state.map.createPane('civNamePane');
    state.map.getPane('civNamePane').style.zIndex = 470;

    state.map.createPane('diagnosticPane');
    state.map.getPane('diagnosticPane').style.zIndex = 480;

    // Store base layer reference for terrain module to manage (satellite default)
    state.baseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar',
        maxZoom: 18
    }).addTo(state.map);

    // Update city marker sizes on zoom change
    state.map.on('zoomend', () => {
        const t0 = performance.now();
        if (!state.cityLayer || !window.cityHitLayer) return;

        const zoomScale = getZoomScale(state.map.getZoom());

        // Update visual markers
        state.cityLayer.eachLayer(marker => {
            if (marker.baseRadius) {
                marker.setRadius(marker.baseRadius * zoomScale);
            }
        });

        // Update hit detection markers
        window.cityHitLayer.eachLayer(hitMarker => {
            if (hitMarker.cityData && hitMarker.cityData.baseHitRadius) {
                hitMarker.setRadius(hitMarker.cityData.baseHitRadius * zoomScale);
            }
        });

        recordMapZoom(performance.now() - t0);
    });

    // Note: Click handler for unpin is set up in app.js to avoid circular dependency
}

export function updateMap(year) {
    const _t = {};
    _t.start = performance.now();

    state.currentYear = year;
    const yearText = formatYear(year);
    document.getElementById('year-display').textContent = yearText;
    const yearMini = document.getElementById('year-display-mini');
    if (yearMini) yearMini.textContent = yearText;

    // Get all visible polities for this year using temporal index (binary search)
    _t.filter = performance.now();
    const visiblePolities = getVisiblePolities(year);
    _t.filterDone = performance.now();

    // Update polities layer
    if (state.polityLayer) {
        state.map.removeLayer(state.polityLayer);
        state.polityLayer = null;
        state.selectedPolityLayer = null; // Clear stale reference
    }

    if (state.showPolities) {
        document.getElementById('polity-count').textContent = visiblePolities.length;

        state.polityLayer = L.geoJSON({
            type: 'FeatureCollection',
            features: visiblePolities
        }, {
            pane: 'polityPane',
            renderer: state.polityRenderer,
            style: feature => ({
                fillColor: getColor(feature.properties.Name),
                weight: 1,
                opacity: 0.8,
                color: '#fff',
                fillOpacity: 0.5
            }),
            onEachFeature: (feature, layer) => {
                layer.on({
                    mouseover: e => {
                        e.target.setStyle({ weight: 3, fillOpacity: 0.7 });
                        if (state.infoPanelPinned) return;
                        // Don't override if a higher priority element is being hovered
                        if (state.hoverPriority) return;
                        showPolityInfo(feature.properties, feature.geometry);
                    },
                    mouseout: e => {
                        // Only reset style if this layer is NOT the selected one
                        if (state.selectedPolityLayer !== e.target) {
                            state.polityLayer.resetStyle(e.target);
                        }
                        if (state.infoPanelPinned) return;
                        hideInfo();
                    },
                    click: e => {
                        // If a city, river, or ocean click already handled this event, don't override
                        if (e.originalEvent._cityHandled || e.originalEvent._riverHandled || e.originalEvent._oceanHandled) {
                            L.DomEvent.stopPropagation(e);
                            return;
                        }

                        // Mark event as handled so map click doesn't override
                        e.originalEvent._polityHandled = true;

                        // Reset previously selected city
                        if (state.selectedCity && window.cityHitLayer) {
                            window.cityHitLayer.eachLayer(layer => {
                                if (layer.cityData && layer.cityData.city === state.selectedCity) {
                                    const oldOpacity = 0.5;
                                    layer.cityData.visualMarker.setStyle({
                                        weight: 1,
                                        color: layer.cityData.visualMarker.options.color,
                                        fillOpacity: oldOpacity
                                    });
                                }
                            });
                            state.selectedCity = null;
                        }

                        // Reset previously selected river
                        if (state.selectedRiverSystem && state.selectedRiverSystem.length > 0 && terrainState.riversLayer) {
                            terrainState.riversLayer.eachLayer(visibleLayer => {
                                if (state.selectedRiverSystem.includes(visibleLayer.feature)) {
                                    terrainState.riversLayer.resetStyle(visibleLayer);
                                }
                            });
                            state.selectedRiver = null;
                            state.selectedRiverSystem = null;
                        }

                        // Reset previously selected polity layer
                        if (state.selectedPolityLayer && state.selectedPolityLayer !== e.target) {
                            state.polityLayer.resetStyle(state.selectedPolityLayer);
                        }

                        // Reset previously selected ocean
                        if (window.resetOceanSelection) {
                            window.resetOceanSelection();
                        }

                        // Set new selected layer and apply highlight
                        state.selectedPolityLayer = e.target;
                        e.target.setStyle({ weight: 3, fillOpacity: 0.7 });

                        state.infoPanelPinned = false;
                        showPolityInfo(feature.properties, feature.geometry, e.latlng.lng, e.latlng.lat);
                        pinInfoPanel();
                        L.DomEvent.stopPropagation(e);
                    }
                });
            }
        }).addTo(state.map);
    } else {
        document.getElementById('polity-count').textContent = '0';
    }
    _t.polityDone = performance.now();

    // Vertex diagnostic overlay — only build once (precomputed for 1 CE)
    if (state.vertexDiagnosticLayer && !state.vertexDiagnostic) {
        state.map.removeLayer(state.vertexDiagnosticLayer);
        state.vertexDiagnosticLayer = null;
    }
    if (state.vertexDiagnostic && !state.vertexDiagnosticLayer && terrainState.vertexDiagnostic && state.showPolities) {
        const diagData = terrainState.vertexDiagnostic;
        state.vertexDiagnosticLayer = L.layerGroup();
        let inlandCount = 0, coastalCount = 0;
        for (const f of visiblePolities) {
            const name = f.properties.Name;
            const classifications = diagData[name];
            if (!classifications) continue;
            const geom = f.geometry;
            const rings = [];
            if (geom.type === 'Polygon') {
                rings.push(...geom.coordinates);
            } else if (geom.type === 'MultiPolygon') {
                for (const poly of geom.coordinates) rings.push(...poly);
            }
            for (let r = 0; r < rings.length && r < classifications.length; r++) {
                const ring = rings[r];
                const cls = classifications[r];
                for (let i = 0; i < ring.length && i < cls.length; i++) {
                    const coastal = cls[i];
                    const fillColor = coastal ? '#00aaff' : '#00ff00';
                    const strokeColor = coastal ? '#0044aa' : '#006600';
                    if (coastal) coastalCount++; else inlandCount++;
                    L.marker([ring[i][1], ring[i][0]], {
                        interactive: false,
                        pane: 'diagnosticPane',
                        icon: L.divIcon({
                            className: '',
                            iconSize: [8, 8],
                            iconAnchor: [4, 4],
                            html: `<div style="width:8px;height:8px;border-radius:50%;background:${fillColor};border:1px solid ${strokeColor};opacity:0.9"></div>`
                        })
                    }).addTo(state.vertexDiagnosticLayer);
                }
            }
        }
        state.vertexDiagnosticLayer.addTo(state.map);
        console.log(`[diagnostic] ${inlandCount} inland (green) + ${coastalCount} coastal (blue) = ${inlandCount + coastalCount} vertices`);
    }

    // Snap ghost overlay — shows where blue vertices snap to on the coastline
    if (state.snapGhostLayer && !state.snapGhost) {
        state.map.removeLayer(state.snapGhostLayer);
        state.snapGhostLayer = null;
    }
    if (state.snapGhost && !state.snapGhostLayer && terrainState.snapGhost && terrainState.vertexDiagnostic && state.showPolities) {
        const diagData = terrainState.vertexDiagnostic;
        const ghostData = terrainState.snapGhost;
        state.snapGhostLayer = L.layerGroup();
        let lineCount = 0;
        for (const f of visiblePolities) {
            const name = f.properties.Name;
            const classifications = diagData[name];
            const ghosts = ghostData[name];
            if (!classifications || !ghosts) continue;
            const geom = f.geometry;
            const rings = [];
            if (geom.type === 'Polygon') {
                rings.push(...geom.coordinates);
            } else if (geom.type === 'MultiPolygon') {
                for (const poly of geom.coordinates) rings.push(...poly);
            }
            for (let r = 0; r < rings.length && r < classifications.length && r < ghosts.length; r++) {
                const ring = rings[r];
                const cls = classifications[r];
                const ghostRing = ghosts[r];
                for (let i = 0; i < ring.length && i < cls.length && i < ghostRing.length; i++) {
                    if (!cls[i] || !ghostRing[i]) continue; // green or no snap target
                    const origLat = ring[i][1], origLon = ring[i][0];
                    const snapLon = ghostRing[i][0], snapLat = ghostRing[i][1];
                    // Connector line: original → snapped
                    L.polyline([[origLat, origLon], [snapLat, snapLon]], {
                        color: '#ff6600',
                        weight: 1.5,
                        opacity: 0.7,
                        dashArray: '4,3',
                        interactive: false,
                        pane: 'diagnosticPane'
                    }).addTo(state.snapGhostLayer);
                    // Snapped position dot (cyan)
                    L.marker([snapLat, snapLon], {
                        interactive: false,
                        pane: 'diagnosticPane',
                        icon: L.divIcon({
                            className: '',
                            iconSize: [6, 6],
                            iconAnchor: [3, 3],
                            html: '<div style="width:6px;height:6px;border-radius:50%;background:#00ffdd;border:1px solid #009988;opacity:0.9"></div>'
                        })
                    }).addTo(state.snapGhostLayer);
                    lineCount++;
                }
            }
        }
        state.snapGhostLayer.addTo(state.map);
        console.log(`[diagnostic] Snap ghost: ${lineCount} connector lines`);
    }

    // Coastline walk overlay — shows walked coastline polylines
    if (state.coastlineWalkLayer && !state.coastlineWalk) {
        state.map.removeLayer(state.coastlineWalkLayer);
        state.coastlineWalkLayer = null;
    }
    if (state.coastlineWalk && !state.coastlineWalkLayer && terrainState.walkedBorders && state.showPolities) {
        const walkData = terrainState.walkedBorders;
        state.coastlineWalkLayer = L.layerGroup();
        let polylineCount = 0, dotCount = 0;
        const showGhostDots = state.snapGhost; // walk-ghost mode shows green original dots

        for (const f of visiblePolities) {
            const name = f.properties.Name;
            const rings = walkData[name];
            if (!rings) continue;

            for (const segments of rings) {
                for (const seg of segments) {
                    if (seg.t === 'w' && seg.c.length >= 2) {
                        // Walked coastline polyline
                        const latLngs = seg.c.map(c => [c[1], c[0]]);
                        L.polyline(latLngs, {
                            color: '#00ddff',
                            weight: 2,
                            opacity: 0.8,
                            interactive: false,
                            pane: 'diagnosticPane'
                        }).addTo(state.coastlineWalkLayer);
                        polylineCount++;

                        // Small dots at each intermediate vertex (skip first and last which are snap endpoints)
                        for (let k = 1; k < seg.c.length - 1; k++) {
                            L.circleMarker([seg.c[k][1], seg.c[k][0]], {
                                radius: 1.5,
                                fillColor: '#00ddff',
                                color: '#009dbb',
                                weight: 0.5,
                                fillOpacity: 0.7,
                                interactive: false,
                                pane: 'diagnosticPane'
                            }).addTo(state.coastlineWalkLayer);
                            dotCount++;
                        }
                    } else if (seg.t === 'o' && showGhostDots) {
                        // Original vertex — small green dot (only in walk-ghost mode)
                        for (const c of seg.c) {
                            L.circleMarker([c[1], c[0]], {
                                radius: 2,
                                fillColor: '#00ff00',
                                color: '#006600',
                                weight: 0.5,
                                fillOpacity: 0.6,
                                interactive: false,
                                pane: 'diagnosticPane'
                            }).addTo(state.coastlineWalkLayer);
                        }
                    }
                }
            }
        }
        state.coastlineWalkLayer.addTo(state.map);
        console.log(`[diagnostic] Coastline walk: ${polylineCount} polylines, ${dotCount} intermediate dots`);
    }

    // Continuous coastline walk overlay — independent polylines per coastline feature
    if (state.coastlineWalkContinuousLayer && !state.coastlineWalkContinuous) {
        state.map.removeLayer(state.coastlineWalkContinuousLayer);
        state.coastlineWalkContinuousLayer = null;
    }
    if (state.coastlineWalkContinuous && !state.coastlineWalkContinuousLayer && terrainState.walkedBordersContinuous && state.showPolities) {
        const walkData = terrainState.walkedBordersContinuous;
        state.coastlineWalkContinuousLayer = L.layerGroup();
        let ringCount = 0;

        for (const f of visiblePolities) {
            const name = f.properties.Name;
            const rings = walkData[name];
            if (!rings) continue;

            for (const ringPolylines of rings) {
                if (!ringPolylines) continue;
                for (const coords of ringPolylines) {
                    if (!coords || coords.length < 2) continue;
                    const latLngs = coords.map(c => [c[1], c[0]]);
                    L.polyline(latLngs, {
                        color: '#00ffaa',
                        weight: 2,
                        opacity: 0.8,
                        interactive: false,
                        pane: 'diagnosticPane'
                    }).addTo(state.coastlineWalkContinuousLayer);
                    ringCount++;
                }
            }
        }
        state.coastlineWalkContinuousLayer.addTo(state.map);
        console.log(`[diagnostic] Continuous walk: ${ringCount} rings`);
    }

    // Update leaderboard
    updateLeaderboard(visiblePolities, year);
    _t.leaderboardDone = performance.now();

    // Update cities
    if (state.cityLayer) {
        state.map.removeLayer(state.cityLayer);
        state.cityLayer = null;
    }
    if (cityHitLayer) {
        state.map.removeLayer(cityHitLayer);
        cityHitLayer = null;
        window.cityHitLayer = null;
    }

    let totalPop = 0;
    let cityCount = 0;

    // Determine hit detection radius based on sensitivity setting
    const sensitivityRadii = {
        standard: 12,
        insensitive: 6,
        off: 0
    };
    const hitRadius = sensitivityRadii[terrainState.citySensitivity] || 12;
    const hoverEnabled = terrainState.citySensitivity !== 'off';

    if (state.showCities) {
        state.cityLayer = L.layerGroup();
        cityHitLayer = L.layerGroup();

        const currentZoom = state.map.getZoom();
        const zoomScale = getZoomScale(currentZoom);

        for (const city of state.allCities) {
            const popData = getPopulationForYear(city, year);
            if (!popData) continue;

            const pop = popData.pop;
            const coords = city.geometry.coordinates;
            const baseRadius = getCityRadius(pop);
            const radius = baseRadius * zoomScale;

            const fillColor = getCityColor(city, visiblePolities, terrainState.cityLightness);
            const outlineWeight = getCityOutlineWeight();
            const borderColor = getCityOutlineColor(fillColor);

            const opacity = statusOpacity[popData.status] || 0.5;

            // Visual marker
            const marker = L.circleMarker([coords[1], coords[0]], {
                pane: 'cityPane',
                radius: radius,
                fillColor: fillColor,
                color: borderColor,
                weight: outlineWeight,
                opacity: 0.9,
                fillOpacity: opacity,
                interactive: false // Visual only
            });

            // Store base radius for zoom updates
            marker.baseRadius = baseRadius;

            // Hit detection marker (larger, invisible)
            const effectiveHitRadius = Math.max(hitRadius, baseRadius + 4) * zoomScale;
            const hitMarker = L.circleMarker([coords[1], coords[0]], {
                pane: 'cityHitPane',
                radius: effectiveHitRadius,
                fillColor: 'transparent',
                color: 'transparent',
                weight: 0,
                fillOpacity: 0,
                interactive: true
            });

            // Store reference to city and visual marker
            hitMarker.cityData = { city, popData, visualMarker: marker, baseHitRadius: Math.max(hitRadius, baseRadius + 4) };

            hitMarker.on('mouseover', () => {
                if (!hoverEnabled) return;
                // Skip if this city is already selected
                if (state.selectedCity === city) return;

                // Highlight visual marker
                marker.setStyle({
                    weight: 2,
                    color: '#fff',
                    fillOpacity: Math.min(1, opacity + 0.2)
                });

                // Highlight underlying territory
                highlightPolityAt(coords[0], coords[1]);

                // Show info panel on hover if enabled
                if (terrainState.cityHover === 'on' && !state.infoPanelPinned) {
                    state.hoverPriority = 'city';
                    showCompoundInfo({
                        city: city,
                        coords: coords,
                        river: null,
                        isHover: true
                    });
                }
            });

            hitMarker.on('mouseout', () => {
                if (!hoverEnabled) return;
                // Don't reset if this city is selected
                if (state.selectedCity === city) return;

                // Always reset visual style for non-selected cities
                marker.setStyle({
                    weight: outlineWeight,
                    color: borderColor,
                    fillOpacity: opacity
                });

                // Reset territory highlight
                resetHoveredPolity();

                // Only hide info panel if not pinned
                if (state.infoPanelPinned) return;
                state.hoverPriority = null;
                hideInfo();
            });

            hitMarker.on('click', (e) => {
                // Mark event as handled so territory click doesn't override
                e.originalEvent._cityHandled = true;

                // Reset previously selected city visual
                if (state.selectedCity && state.selectedCity !== city) {
                    // Find and reset the old city's marker
                    cityHitLayer.eachLayer(layer => {
                        if (layer.cityData && layer.cityData.city === state.selectedCity) {
                            const oldPopData = layer.cityData.popData;
                            const oldOpacity = statusOpacity[oldPopData.status] || 0.5;
                            const oldFillColor = layer.cityData.visualMarker.options.fillColor;
                            layer.cityData.visualMarker.setStyle({
                                weight: getCityOutlineWeight(),
                                color: getCityOutlineColor(oldFillColor),
                                fillOpacity: oldOpacity
                            });
                        }
                    });
                }

                state.infoPanelPinned = false;
                state.selectedCity = city;
                state.selectedCoords = coords;

                // Highlight the selected city
                marker.setStyle({
                    weight: 3,
                    color: '#2D2D2D',
                    fillOpacity: Math.min(1, opacity + 0.3)
                });

                hitMarker.closeTooltip();
                hitMarker.unbindTooltip();

                // Reset previously selected polity layer
                if (state.selectedPolityLayer) {
                    state.polityLayer.resetStyle(state.selectedPolityLayer);
                }

                // Reset previously selected ocean
                if (window.resetOceanSelection) {
                    window.resetOceanSelection();
                }

                // Highlight the territory containing this city
                const polityLayer = highlightPolityAt(coords[0], coords[1]);
                if (polityLayer) {
                    state.selectedPolityLayer = polityLayer;
                }

                // Reset any previously selected river first (always)
                if (state.selectedRiverSystem && state.selectedRiverSystem.length > 0 && terrainState.riversLayer) {
                    terrainState.riversLayer.eachLayer(visibleLayer => {
                        if (state.selectedRiverSystem.includes(visibleLayer.feature)) {
                            terrainState.riversLayer.resetStyle(visibleLayer);
                        }
                    });
                    state.selectedRiver = null;
                    state.selectedRiverSystem = null;
                }

                // Find any river near this city
                const riverData = findRiverNearPoint(
                    coords[0], coords[1],
                    terrainState.allRiversData,
                    terrainState.rivernumIndex,
                    terrainState.riverDetailLevel
                );

                // If there's a river, highlight it too
                if (riverData && terrainState.riversLayer) {
                    // Highlight the new river
                    terrainState.riversLayer.eachLayer(visibleLayer => {
                        if (riverData.connectedFeatures.includes(visibleLayer.feature)) {
                            visibleLayer.setStyle({
                                weight: visibleLayer.options.weight * 2.5,
                                opacity: 1,
                                color: '#4fc3f7'
                            });
                        }
                    });

                    state.selectedRiver = riverData.river;
                    state.selectedRiverSystem = riverData.connectedFeatures;
                }

                // Show compound info (city + territory + river if present)
                showCompoundInfo({
                    city: city,
                    coords: coords,
                    river: riverData ? riverData.river : null,
                    connectedFeatures: riverData ? riverData.connectedFeatures : null
                });
                pinInfoPanel();
                L.DomEvent.stopPropagation(e);
            });

            state.cityLayer.addLayer(marker);
            cityHitLayer.addLayer(hitMarker);
            totalPop += pop;
            cityCount++;
        }

        state.cityLayer.addTo(state.map);
        cityHitLayer.addTo(state.map);
        window.cityHitLayer = cityHitLayer; // Expose for bringDataLayersToFront
    }

    _t.cityDone = performance.now();

    document.getElementById('city-count').textContent = cityCount;
    document.getElementById('total-population').textContent = formatPopulation(totalPop);

    // Update civilization name labels
    updateCivLabels(visiblePolities);
    _t.labelsDone = performance.now();

    // Ensure proper layer ordering (rivers above polities, cities on top)
    if (window.bringDataLayersToFront) {
        window.bringDataLayersToFront();
    }
    _t.end = performance.now();

    // Log breakdown for first 3 calls, then every 20th
    if (!updateMap._callCount) updateMap._callCount = 0;
    updateMap._callCount++;
    if (updateMap._callCount <= 3 || updateMap._callCount % 20 === 0) {
        const f = ms => ms < 1 ? '<1ms' : ms.toFixed(1) + 'ms';
        console.log(
            `%c[perf]%c updateMap #${updateMap._callCount} (${visiblePolities.length} pol, ${cityCount} cities): filter ${f(_t.filterDone - _t.filter)} | polities ${f(_t.polityDone - _t.filterDone)} | leaderboard ${f(_t.leaderboardDone - _t.polityDone)} | cities ${f(_t.cityDone - _t.leaderboardDone)} | labels ${f(_t.labelsDone - _t.cityDone)} | total ${f(_t.end - _t.start)}`,
            TAG_PERF, NORMAL_PERF
        );
    }

    return visiblePolities;
}

// Update civilization name labels on the map
function updateCivLabels(visiblePolities) {
    // Remove existing labels
    if (state.civNamesLayer) {
        state.map.removeLayer(state.civNamesLayer);
        state.civNamesLayer = null;
    }

    if (!state.showCivNames) return;

    const zoom = state.map.getZoom();
    if (zoom < 3) return; // Too zoomed out

    // Aggregate polities by name (combine multi-part territories)
    const aggregated = {};
    for (const p of visiblePolities) {
        const name = p.properties.Name;
        if (!aggregated[name]) {
            aggregated[name] = {
                name,
                area: p.properties.Area || 0,
                geometry: p.geometry
            };
        } else {
            aggregated[name].area += p.properties.Area || 0;
            // Keep the geometry with larger area for centroid calculation
            if ((p.properties.Area || 0) > (aggregated[name].geometry.Area || 0)) {
                aggregated[name].geometry = p.geometry;
            }
        }
    }

    // Sort by area
    let polities = Object.values(aggregated).sort((a, b) => b.area - a.area);

    // Density-based filtering
    const density = terrainState.labelDensity || 'major';

    if (density === 'major') {
        // Current behavior: heavy zoom-based filtering
        if (zoom < 4) polities = polities.slice(0, 5);
        else if (zoom < 5) polities = polities.slice(0, 15);
        else if (zoom < 6) polities = polities.slice(0, 30);
        else if (zoom < 7) polities = polities.slice(0, 50);
        // zoom >= 7: show all
    } else if (density === 'balanced') {
        // Moderate filtering: show more at each zoom level
        if (zoom < 4) polities = polities.slice(0, 15);
        else if (zoom < 5) polities = polities.slice(0, 40);
        else if (zoom < 6) polities = polities.slice(0, 80);
        // zoom >= 6: show all
    }
    // density === 'crowded': show all (no filtering)

    // Calculate font size based on zoom (subtle scaling: 9px at zoom 3 to 14px at zoom 10+)
    const fontSize = Math.max(9, Math.min(14, 6 + zoom));

    // Choose positioning algorithm
    const positionAlgo = terrainState.labelPosition || 'visual';
    const getCenter = positionAlgo === 'visual' ? getVisualCenter : getCentroid;

    // Create label layer
    state.civNamesLayer = L.layerGroup();

    for (const p of polities) {
        const center = getCenter(p.geometry);
        if (!center) continue;

        const marker = L.marker([center.lat, center.lng], {
            pane: 'civNamePane',
            icon: L.divIcon({
                className: 'polity-label',
                html: `<span style="font-size:${fontSize}px">${p.name}</span>`,
                iconSize: null
            }),
            interactive: false
        });

        state.civNamesLayer.addLayer(marker);
    }

    state.civNamesLayer.addTo(state.map);
}

// Update city layer (called when sensitivity changes)
export function updateCityLayer() {
    // Re-run updateMap to rebuild city layer with new settings
    updateMap(state.currentYear);
}

// Reset city selection highlighting (called when info panel is closed)
export function resetCitySelection() {
    if (state.selectedCity && cityHitLayer) {
        const year = state.currentYear;
        const visiblePolities = getVisiblePolities(year);

        cityHitLayer.eachLayer(layer => {
            if (layer.cityData && layer.cityData.city === state.selectedCity) {
                const popData = layer.cityData.popData;
                const opacity = statusOpacity[popData.status] || 0.5;
                const fillColor = layer.cityData.visualMarker.options.fillColor;
                layer.cityData.visualMarker.setStyle({
                    weight: getCityOutlineWeight(),
                    color: getCityOutlineColor(fillColor),
                    fillOpacity: opacity
                });
            }
        });
    }
}

// Expose globally for cross-module access
window.updateCityLayer = updateCityLayer;
window.resetCitySelection = resetCitySelection;
window.highlightPolityAt = highlightPolityAt;
window.resetHoveredPolity = resetHoveredPolity;
