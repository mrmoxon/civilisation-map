// Leaflet map and rendering
import { state } from './state.js';
import { getColor, formatYear, formatPopulation, getPopulationForYear, getCityRadius, getCityColor, pointInGeometry, getCentroid, getVisualCenter, findRiverNearPoint } from './utils.js';
import { showPolityInfo, showCompoundInfo, hideInfo, pinInfoPanel } from './info-panel.js';
import { updateLeaderboard } from './leaderboard.js';
import { terrainState } from './terrain.js';

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

export function initMap() {
    state.map = L.map('map', {
        center: [30, 40],
        zoom: 3,
        minZoom: 2,
        maxZoom: 12,
        zoomControl: false
    });

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

    // Store base layer reference for terrain module to manage (satellite default)
    state.baseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar',
        maxZoom: 18
    }).addTo(state.map);

    // Update city marker sizes on zoom change
    state.map.on('zoomend', () => {
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
    });

    // Note: Click handler for unpin is set up in app.js to avoid circular dependency
}

export function updateMap(year) {
    state.currentYear = year;
    const yearText = formatYear(year);
    document.getElementById('year-display').textContent = yearText;
    const yearMini = document.getElementById('year-display-mini');
    if (yearMini) yearMini.textContent = yearText;

    // Get all visible polities for this year
    // Filter out parenthetical entries (composite/aggregate representations like "(Roman Empire)")
    // These are duplicates of the actual polities and cause color flickering
    const visiblePolities = state.allPolities.filter(f => {
        const from = f.properties.FromYear;
        const to = f.properties.ToYear;
        const name = f.properties.Name;
        // Skip parenthetical entries - they are composite representations
        if (name.startsWith('(') && name.endsWith(')')) return false;
        return year >= from && year <= to;
    });

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
                        // If a city or river click already handled this event, don't override
                        if (e.originalEvent._cityHandled || e.originalEvent._riverHandled) {
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

    // Update leaderboard
    updateLeaderboard(visiblePolities, year);

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

            const fillColor = getCityColor(city, visiblePolities);
            const borderColor = 'rgb(200, 200, 200)'; // Light border like strong coastline style
            const opacity = statusOpacity[popData.status] || 0.5;

            // Visual marker
            const marker = L.circleMarker([coords[1], coords[0]], {
                pane: 'cityPane',
                radius: radius,
                fillColor: fillColor,
                color: borderColor,
                weight: 1,
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
                    weight: 1,
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
                            layer.cityData.visualMarker.setStyle({
                                weight: 1,
                                color: 'rgb(200, 200, 200)',
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
                    color: '#4da6ff',
                    fillOpacity: Math.min(1, opacity + 0.3)
                });

                hitMarker.closeTooltip();
                hitMarker.unbindTooltip();

                // Reset previously selected polity layer
                if (state.selectedPolityLayer) {
                    state.polityLayer.resetStyle(state.selectedPolityLayer);
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

    document.getElementById('city-count').textContent = cityCount;
    document.getElementById('total-population').textContent = formatPopulation(totalPop);

    // Update civilization name labels
    updateCivLabels(visiblePolities);

    // Ensure proper layer ordering (rivers above polities, cities on top)
    if (window.bringDataLayersToFront) {
        window.bringDataLayersToFront();
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
        const visiblePolities = state.allPolities.filter(f => {
            const name = f.properties.Name;
            if (name.startsWith('(') && name.endsWith(')')) return false;
            const from = f.properties.FromYear;
            const to = f.properties.ToYear;
            return year >= from && year <= to;
        });

        cityHitLayer.eachLayer(layer => {
            if (layer.cityData && layer.cityData.city === state.selectedCity) {
                const popData = layer.cityData.popData;
                const opacity = statusOpacity[popData.status] || 0.5;
                layer.cityData.visualMarker.setStyle({
                    weight: 1,
                    color: 'rgb(200, 200, 200)',
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
