// Terrain visualization module
// Elevation, hillshade, rivers, coastlines layers
import { state } from './state.js';
import { showCompoundInfo, pinInfoPanel, hideInfo, showPointInfo, unpinInfoPanel, renderInfoPanel } from './info-panel.js';
import { findCityAtPoint, pointInGeometry } from './utils.js';

// Base map definitions (all without political labels/borders)
const baseMaps = {
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        options: { subdomains: 'abcd', maxZoom: 20 },
        attribution: '&copy; OSM &copy; CARTO'
    },
    light: {
        url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        options: { subdomains: 'abcd', maxZoom: 20 },
        attribution: '&copy; OSM &copy; CARTO'
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: { maxZoom: 18 },
        attribution: '&copy; Esri, Maxar, Earthstar'
    },
    physical: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
        options: { maxZoom: 8 },
        attribution: '&copy; Esri, US National Park Service'
    },
    terrain: {
        url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}{r}.png',
        options: { maxZoom: 18 },
        attribution: '&copy; Stadia Maps &copy; Stamen Design'
    },
    toner: {
        url: 'https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png',
        options: { maxZoom: 18 },
        attribution: '&copy; Stadia Maps &copy; Stamen Design'
    },
    topo: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        options: { subdomains: 'abc', maxZoom: 17 },
        attribution: '&copy; OpenTopoMap'
    },
    black: {
        url: '', // No tiles - pure black background
        options: { maxZoom: 20 },
        attribution: ''
    }
};

// Color ramps (normalized 0-1 -> RGB)
const colorRamps = {
    terrain: [
        [0.0, [26, 71, 42]],      // Dark green (lowlands)
        [0.15, [45, 90, 39]],     // Forest green
        [0.3, [139, 115, 85]],    // Tan (hills)
        [0.5, [160, 82, 45]],     // Sienna (mountains)
        [0.7, [180, 160, 140]],   // Light brown
        [0.85, [220, 220, 220]],  // Light grey (high)
        [1.0, [255, 255, 255]]    // White (peaks)
    ],
    heat: [
        [0.0, [0, 0, 80]],        // Dark blue
        [0.25, [65, 105, 225]],   // Royal blue
        [0.5, [255, 215, 0]],     // Gold
        [0.75, [255, 69, 0]],     // Red-orange
        [1.0, [255, 255, 255]]    // White
    ],
    earth: [
        [0.0, [34, 139, 34]],     // Forest green
        [0.3, [154, 205, 50]],    // Yellow-green
        [0.5, [218, 165, 32]],    // Goldenrod
        [0.7, [139, 69, 19]],     // Saddle brown
        [1.0, [255, 255, 255]]    // White
    ],
    mono: [
        [0.0, [26, 26, 46]],      // Dark
        [0.33, [74, 74, 106]],
        [0.66, [138, 138, 170]],
        [1.0, [255, 255, 255]]
    ],
    volcanic: [
        [0.0, [13, 13, 13]],      // Near black
        [0.25, [74, 28, 28]],     // Dark red
        [0.5, [139, 0, 0]],       // Dark red
        [0.75, [255, 69, 0]],     // Red-orange
        [1.0, [255, 215, 0]]      // Gold
    ]
};

// Terrain state
export const terrainState = {
    currentBasemap: 'satellite',
    elevationLayer: null,
    hillshadeLayer: null,
    riversLayer: null,
    riversHitLayer: null,
    coastlinesLayer: null,
    labelsLayer: null,

    // Default layers ON: elevation, rivers, coastlines
    showElevation: true,
    showHillshade: false,
    showRivers: true,
    showCoastlines: true,
    showLabels: false,

    currentRamp: 'terrain',
    maxHeight: 3500,
    terrainOpacity: 0.5,
    terrainIntensity: 2.0,

    allRiversData: null,
    marineData: null,
    oceansLayer: null,
    showOceans: false,
    oceanFill: true,
    oceanOpacity: 0.4,
    oceanLineWeight: 1,
    oceanLineColor: '#0a2840',
    oceanPalette: 'blue',
    oceanTooltips: true,
    selectedOceanLayer: null,
    coastlinesData: null,
    coastlinesDetailedData: null,
    coastlinesStandardData: null,
    riverDetailLevel: 6,
    riverStyle: 'strong',
    riverHover: 'on',
    riverSensitivity: 'standard',
    cityHover: 'on',
    citySensitivity: 'standard',
    cityLightness: 'pale',
    cityOutline: 'normal',
    cityOutlineColor: 'light',
    coastlineStyle: 'strong',
    coastlineDetail: 'detailed',

    // Civ name label settings
    labelPosition: 'visual',

    // Hovered river tracking (for re-applying highlight after zoom)
    hoveredRiverSystem: null,
    labelDensity: 'major',
    labelSubtlety: 'normal',
    labelCase: 'uppercase',
    labelContrast: 'medium'
};

// Interpolate color from ramp
function getColorFromRamp(value, ramp) {
    const stops = colorRamps[ramp];
    value = Math.max(0, Math.min(1, value));

    for (let i = 0; i < stops.length - 1; i++) {
        if (value >= stops[i][0] && value <= stops[i + 1][0]) {
            const t = (value - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
            const c1 = stops[i][1];
            const c2 = stops[i + 1][1];
            return [
                Math.round(c1[0] + t * (c2[0] - c1[0])),
                Math.round(c1[1] + t * (c2[1] - c1[1])),
                Math.round(c1[2] + t * (c2[2] - c1[2]))
            ];
        }
    }
    return stops[stops.length - 1][1];
}

// Custom tile layer that processes elevation data
function createElevationLayer() {
    const ElevationLayer = L.GridLayer.extend({
        createTile: function(coords, done) {
            const tile = document.createElement('canvas');
            const size = this.getTileSize();
            tile.width = size.x;
            tile.height = size.y;

            const ctx = tile.getContext('2d');
            const img = new Image();
            img.crossOrigin = 'anonymous';

            // AWS Terrain Tiles (Terrarium format)
            img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${coords.z}/${coords.x}/${coords.y}.png`;

            img.onload = () => {
                // Draw original to read pixels
                ctx.drawImage(img, 0, 0, size.x, size.y);
                const imageData = ctx.getImageData(0, 0, size.x, size.y);
                const data = imageData.data;

                // Process each pixel
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];

                    // Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768
                    let elevation = (r * 256 + g + b / 256) - 32768;

                    // Skip water (negative elevation) or make it transparent
                    if (elevation < 0) {
                        data[i + 3] = 0; // Transparent
                        continue;
                    }

                    // Normalize to 0-1 based on max height
                    let normalized = Math.min(1, (elevation / terrainState.maxHeight) * terrainState.terrainIntensity);

                    // Get color from ramp
                    const color = getColorFromRamp(normalized, terrainState.currentRamp);

                    data[i] = color[0];
                    data[i + 1] = color[1];
                    data[i + 2] = color[2];
                    data[i + 3] = Math.round(terrainState.terrainOpacity * 255);
                }

                ctx.putImageData(imageData, 0, 0);
                done(null, tile);
            };

            img.onerror = () => {
                done(null, tile);
            };

            return tile;
        }
    });

    return new ElevationLayer({ maxZoom: 15 });
}

// Hillshade layer (normal map based)
function createHillshadeLayer() {
    const HillshadeLayer = L.GridLayer.extend({
        createTile: function(coords, done) {
            const tile = document.createElement('canvas');
            const size = this.getTileSize();
            tile.width = size.x;
            tile.height = size.y;

            const ctx = tile.getContext('2d');
            const img = new Image();
            img.crossOrigin = 'anonymous';

            // AWS Normal tiles for hillshade
            img.src = `https://s3.amazonaws.com/elevation-tiles-prod/normal/${coords.z}/${coords.x}/${coords.y}.png`;

            img.onload = () => {
                ctx.drawImage(img, 0, 0, size.x, size.y);
                const imageData = ctx.getImageData(0, 0, size.x, size.y);
                const data = imageData.data;

                // Sun direction (from northwest, elevated)
                const sunX = -0.6;
                const sunY = -0.6;
                const sunZ = 0.5;

                for (let i = 0; i < data.length; i += 4) {
                    // Normal map: RGB encodes normal vector
                    const nx = (data[i] / 255) * 2 - 1;
                    const ny = (data[i + 1] / 255) * 2 - 1;
                    const nz = (data[i + 2] / 255) * 2 - 1;

                    // Dot product with sun direction
                    let shade = nx * sunX + ny * sunY + nz * sunZ;
                    shade = Math.max(0, Math.min(1, (shade + 1) / 2));

                    // Apply as grayscale
                    const v = Math.round(shade * 255);
                    data[i] = v;
                    data[i + 1] = v;
                    data[i + 2] = v;
                    data[i + 3] = Math.round(0.4 * 255); // Semi-transparent
                }

                ctx.putImageData(imageData, 0, 0);
                done(null, tile);
            };

            img.onerror = () => {
                done(null, tile);
            };

            return tile;
        }
    });

    return new HillshadeLayer({ maxZoom: 15 });
}

// Determine if current basemap is dark or light
function isDarkBasemap() {
    return ['dark', 'black', 'satellite'].includes(terrainState.currentBasemap);
}

// Coastline styling
function getCoastlineStyle() {
    const zoom = state.map.getZoom();
    const zoomScale = Math.max(0.4, Math.min(1.2, (zoom - 2) / 8));
    const dark = isDarkBasemap();

    const stylePresets = {
        intense: { opacity: 1.0, weightMult: 2.5, lightColor: 'rgb(40, 40, 40)', darkColor: 'rgb(220, 220, 220)' },
        strong:  { opacity: 0.9, weightMult: 1.8, lightColor: 'rgb(50, 50, 50)', darkColor: 'rgb(200, 200, 200)' },
        bold:    { opacity: 0.75, weightMult: 1.4, lightColor: 'rgb(60, 60, 60)', darkColor: 'rgb(180, 180, 180)' },
        normal:  { opacity: 0.55, weightMult: 1.0, lightColor: 'rgb(80, 80, 80)', darkColor: 'rgb(160, 160, 160)' },
        subtle:  { opacity: 0.35, weightMult: 0.8, lightColor: 'rgb(100, 100, 100)', darkColor: 'rgb(140, 140, 140)' },
        faint:   { opacity: 0.2, weightMult: 0.6, lightColor: 'rgb(120, 120, 120)', darkColor: 'rgb(120, 120, 120)' }
    };

    const preset = stylePresets[terrainState.coastlineStyle] || stylePresets.normal;
    const color = dark ? preset.darkColor : preset.lightColor;

    return {
        color: color,
        weight: 0.8 * zoomScale * preset.weightMult,
        opacity: preset.opacity
    };
}

// River styling
function getRiverStyle(feature) {
    const rank = feature.properties.scalerank || 5;
    const zoom = state.map.getZoom();

    const stylePresets = {
        intense: {
            opacity: 1.0,
            weightMult: 2.0,
            colors: {
                0: '#0a2a4a', 1: '#0a2a4a',
                2: '#0a3a5a', 3: '#0a3a5a',
                4: '#1a4a6a', 5: '#1a4a6a',
                6: '#2a5a7a', 7: '#2a5a7a',
                8: '#3a6a8a', 9: '#3a6a8a',
                10: '#4a7a9a'
            }
        },
        strong: {
            opacity: 0.95,
            weightMult: 1.6,
            colors: {
                0: '#0a3a5a', 1: '#0a3a5a',
                2: '#1a4a6a', 3: '#1a4a6a',
                4: '#2a5a7a', 5: '#2a5a7a',
                6: '#3a6a8a', 7: '#3a6a8a',
                8: '#4a7a9a', 9: '#4a7a9a',
                10: '#5a8aaa'
            }
        },
        bold: {
            opacity: 0.9,
            weightMult: 1.3,
            colors: {
                0: '#1a4a6a', 1: '#1a4a6a',
                2: '#2a5a7a', 3: '#2a5a7a',
                4: '#3a6a8a', 5: '#3a6a8a',
                6: '#4a7a9a', 7: '#4a7a9a',
                8: '#5a8aaa', 9: '#5a8aaa',
                10: '#6a9aba'
            }
        },
        normal: {
            opacity: 0.75,
            weightMult: 1.0,
            colors: {
                0: '#2c5a7c', 1: '#2c5a7c',
                2: '#3a6d8c', 3: '#3a6d8c',
                4: '#4a7d9c', 5: '#4a7d9c',
                6: '#5a8dac', 7: '#5a8dac',
                8: '#6a9dbc', 9: '#6a9dbc',
                10: '#7aadcc'
            }
        },
        subtle: {
            opacity: 0.5,
            weightMult: 0.8,
            colors: {
                0: '#4a7090', 1: '#4a7090',
                2: '#5a80a0', 3: '#5a80a0',
                4: '#6a90b0', 5: '#6a90b0',
                6: '#7aa0c0', 7: '#7aa0c0',
                8: '#8ab0d0', 9: '#8ab0d0',
                10: '#9ac0e0'
            }
        },
        faint: {
            opacity: 0.3,
            weightMult: 0.6,
            colors: {
                0: '#6a8aa0', 1: '#6a8aa0',
                2: '#7a9ab0', 3: '#7a9ab0',
                4: '#8aaac0', 5: '#8aaac0',
                6: '#9abacc', 7: '#9abacc',
                8: '#aacadc', 9: '#aacadc',
                10: '#badaec'
            }
        }
    };

    const preset = stylePresets[terrainState.riverStyle] || stylePresets.normal;
    const baseWeight = Math.max(0.3, 1.8 - rank * 0.15);
    const zoomScale = Math.max(0.3, Math.min(1.5, (zoom - 2) / 6));

    return {
        color: preset.colors[rank] || preset.colors[5],
        weight: baseWeight * zoomScale * preset.weightMult,
        opacity: preset.opacity
    };
}

// Update river styles without recreating the layer
function updateRiversStyle() {
    if (terrainState.riversLayer) {
        terrainState.riversLayer.setStyle(getRiverStyle);

        // Re-apply highlight to selected river system if any
        if (state.selectedRiverSystem && state.selectedRiverSystem.length > 0) {
            terrainState.riversLayer.eachLayer(visibleLayer => {
                if (state.selectedRiverSystem.includes(visibleLayer.feature)) {
                    visibleLayer.setStyle({
                        weight: visibleLayer.options.weight * 2.5,
                        opacity: 1,
                        color: '#4fc3f7'
                    });
                }
            });
        }

        // Re-apply highlight to hovered river system if any (and not already selected)
        if (terrainState.hoveredRiverSystem && terrainState.hoveredRiverSystem.length > 0) {
            const isAlreadySelected = state.selectedRiverSystem &&
                terrainState.hoveredRiverSystem.some(f => state.selectedRiverSystem.includes(f));
            if (!isAlreadySelected) {
                terrainState.riversLayer.eachLayer(visibleLayer => {
                    if (terrainState.hoveredRiverSystem.includes(visibleLayer.feature)) {
                        visibleLayer.setStyle({
                            weight: visibleLayer.options.weight * 2.5,
                            opacity: 1,
                            color: '#4fc3f7'
                        });
                    }
                });
            }
        }
    }
}

// Update rivers layer
export function updateRiversLayer() {
    if (terrainState.riversLayer) {
        state.map.removeLayer(terrainState.riversLayer);
        terrainState.riversLayer = null;
    }
    if (terrainState.riversHitLayer) {
        state.map.removeLayer(terrainState.riversHitLayer);
        terrainState.riversHitLayer = null;
    }

    if (!terrainState.showRivers || !terrainState.allRiversData) return;

    const filteredFeatures = terrainState.allRiversData.features.filter(f =>
        (f.properties.scalerank || 0) <= terrainState.riverDetailLevel
    );

    const countDisplay = document.getElementById('river-count-display');
    if (countDisplay) {
        countDisplay.textContent = filteredFeatures.length + ' rivers';
    }

    // Build rivernum index for connected river systems (rivers + lake centerlines)
    const rivernumIndex = {};
    for (const feature of filteredFeatures) {
        const rivernum = feature.properties.rivernum;
        if (rivernum !== undefined && rivernum !== null) {
            if (!rivernumIndex[rivernum]) {
                rivernumIndex[rivernum] = [];
            }
            rivernumIndex[rivernum].push(feature);
        }
    }
    terrainState.rivernumIndex = rivernumIndex;

    // Create visible river layer (non-interactive)
    terrainState.riversLayer = L.geoJSON({
        type: 'FeatureCollection',
        features: filteredFeatures
    }, {
        pane: 'riverPane',
        style: getRiverStyle,
        interactive: false
    });

    // Determine hit detection width based on sensitivity setting
    const sensitivityWidths = {
        standard: 12,
        insensitive: 6,
        off: 4 // Minimal width, just enough for clicks
    };
    const hitWidth = sensitivityWidths[terrainState.riverSensitivity] || 12;
    const hoverEnabled = terrainState.riverSensitivity !== 'off';

    // Create invisible hit detection layer (wider, for easier hovering)
    terrainState.riversHitLayer = L.geoJSON({
        type: 'FeatureCollection',
        features: filteredFeatures
    }, {
        pane: 'riverHitPane',
        style: feature => {
            const baseStyle = getRiverStyle(feature);
            return {
                weight: Math.max(hitWidth, baseStyle.weight * (hoverEnabled ? 4 : 2)),
                opacity: 0,
                color: 'transparent'
            };
        },
        interactive: true,
        onEachFeature: (feature, layer) => {
            layer.riverFeature = feature;

            layer.on({
                mouseover: e => {
                    // Skip hover effects if sensitivity is off
                    if (!hoverEnabled) return;

                    const rivernum = feature.properties.rivernum;
                    const connectedFeatures = rivernum !== undefined ? (rivernumIndex[rivernum] || [feature]) : [feature];

                    // Track hovered river for re-applying after zoom
                    terrainState.hoveredRiverSystem = connectedFeatures;

                    // Skip highlighting if this river system is already selected
                    const isAlreadySelected = state.selectedRiverSystem &&
                        connectedFeatures.some(f => state.selectedRiverSystem.includes(f));

                    // Only apply highlight if not already selected
                    if (!isAlreadySelected) {
                        // Highlight ALL connected features (river + lake centerlines)
                        terrainState.riversLayer.eachLayer(visibleLayer => {
                            if (connectedFeatures.includes(visibleLayer.feature)) {
                                visibleLayer.setStyle({
                                    weight: visibleLayer.options.weight * 2.5,
                                    opacity: 1,
                                    color: '#4fc3f7'
                                });
                            }
                        });
                    }

                    // Highlight underlying territory
                    if (window.highlightPolityAt) {
                        window.highlightPolityAt(e.latlng.lng, e.latlng.lat);
                    }

                    // Show info panel on hover if enabled
                    if (terrainState.riverHover === 'on' && !state.infoPanelPinned) {
                        state.hoverPriority = 'river';
                        const hoverCoords = [e.latlng.lng, e.latlng.lat];
                        showCompoundInfo({
                            city: null,
                            coords: hoverCoords,
                            river: feature,
                            connectedFeatures: connectedFeatures,
                            isHover: true
                        });
                    }
                },
                mousemove: e => {
                    // Update info panel as user moves along river
                    if (!hoverEnabled) return;
                    if (state.infoPanelPinned) return;

                    const rivernum = feature.properties.rivernum;
                    const connectedFeatures = rivernum !== undefined ? (rivernumIndex[rivernum] || [feature]) : [feature];

                    // Update territory highlight
                    if (window.resetHoveredPolity) {
                        window.resetHoveredPolity();
                    }
                    if (window.highlightPolityAt) {
                        window.highlightPolityAt(e.latlng.lng, e.latlng.lat);
                    }

                    // Update info panel with new position
                    if (terrainState.riverHover === 'on') {
                        const hoverCoords = [e.latlng.lng, e.latlng.lat];
                        showCompoundInfo({
                            city: null,
                            coords: hoverCoords,
                            river: feature,
                            connectedFeatures: connectedFeatures,
                            isHover: true
                        });
                    }
                },
                mouseout: e => {
                    // Skip if hover effects are disabled
                    if (!hoverEnabled) return;

                    const rivernum = feature.properties.rivernum;
                    const connectedFeatures = rivernum !== undefined ? (rivernumIndex[rivernum] || [feature]) : [feature];

                    // Clear hovered river tracking
                    terrainState.hoveredRiverSystem = null;

                    // Reset ALL connected features
                    const isSelected = state.selectedRiver && connectedFeatures.includes(state.selectedRiver);
                    if (!isSelected) {
                        terrainState.riversLayer.eachLayer(visibleLayer => {
                            if (connectedFeatures.includes(visibleLayer.feature)) {
                                terrainState.riversLayer.resetStyle(visibleLayer);
                            }
                        });
                    }

                    // Reset territory highlight
                    if (window.resetHoveredPolity) {
                        window.resetHoveredPolity();
                    }

                    // Clear hover priority and hide info panel if not pinned
                    state.hoverPriority = null;
                    hideInfo();
                },
                click: e => {
                    // Mark event as handled so territory click doesn't override
                    e.originalEvent._riverHandled = true;

                    const rivernum = feature.properties.rivernum;
                    const connectedFeatures = rivernum !== undefined ? (rivernumIndex[rivernum] || [feature]) : [feature];

                    // Reset previously selected river system
                    if (state.selectedRiverSystem && state.selectedRiverSystem.length > 0) {
                        terrainState.riversLayer.eachLayer(visibleLayer => {
                            if (state.selectedRiverSystem.includes(visibleLayer.feature)) {
                                terrainState.riversLayer.resetStyle(visibleLayer);
                            }
                        });
                    }

                    // Close any open tooltip
                    layer.closeTooltip();
                    layer.unbindTooltip();

                    // Store the connected system for selection
                    state.infoPanelPinned = false;
                    state.selectedRiver = feature;
                    state.selectedRiverSystem = connectedFeatures;

                    // Highlight the new selection
                    terrainState.riversLayer.eachLayer(visibleLayer => {
                        if (connectedFeatures.includes(visibleLayer.feature)) {
                            visibleLayer.setStyle({
                                weight: visibleLayer.options.weight * 2.5,
                                opacity: 1,
                                color: '#4fc3f7'
                            });
                        }
                    });

                    // Get click coordinates for territory lookup
                    const clickCoords = [e.latlng.lng, e.latlng.lat];

                    // Reset previously selected city first (always)
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

                    // Find any city at this location
                    const city = findCityAtPoint(e.latlng.lng, e.latlng.lat, state.currentYear);

                    // If there's a city, highlight it too
                    if (city && window.cityHitLayer) {
                        // Highlight the city
                        window.cityHitLayer.eachLayer(layer => {
                            if (layer.cityData && layer.cityData.city === city) {
                                layer.cityData.visualMarker.setStyle({
                                    weight: 3,
                                    color: '#2D2D2D',
                                    fillOpacity: 0.9
                                });
                            }
                        });

                        state.selectedCity = city;
                    }

                    // Reset previously selected polity layer
                    if (state.selectedPolityLayer && state.polityLayer) {
                        state.polityLayer.resetStyle(state.selectedPolityLayer);
                    }

                    // Reset previously selected ocean
                    resetOceanSelection();

                    // Highlight the territory at click location
                    if (window.highlightPolityAt) {
                        const polityLayer = window.highlightPolityAt(clickCoords[0], clickCoords[1]);
                        if (polityLayer) {
                            state.selectedPolityLayer = polityLayer;
                        }
                    }

                    // Show compound info (city if present + territory + river)
                    showCompoundInfo({
                        city: city,
                        coords: clickCoords,
                        river: feature,
                        connectedFeatures: connectedFeatures
                    });
                    pinInfoPanel();
                    L.DomEvent.stopPropagation(e);
                }
            });
        }
    });

    terrainState.riversLayer.addTo(state.map);
    terrainState.riversHitLayer.addTo(state.map);
    bringDataLayersToFront();

    // Re-apply highlight to selected river system if any
    if (state.selectedRiverSystem && state.selectedRiverSystem.length > 0) {
        terrainState.riversLayer.eachLayer(visibleLayer => {
            if (state.selectedRiverSystem.includes(visibleLayer.feature)) {
                visibleLayer.setStyle({
                    weight: visibleLayer.options.weight * 2.5,
                    opacity: 1,
                    color: '#4fc3f7'
                });
            }
        });
    }

    // Re-apply highlight to hovered river system if any (and not already selected)
    if (terrainState.hoveredRiverSystem && terrainState.hoveredRiverSystem.length > 0) {
        const isAlreadySelected = state.selectedRiverSystem &&
            terrainState.hoveredRiverSystem.some(f => state.selectedRiverSystem.includes(f));
        if (!isAlreadySelected) {
            terrainState.riversLayer.eachLayer(visibleLayer => {
                if (terrainState.hoveredRiverSystem.includes(visibleLayer.feature)) {
                    visibleLayer.setStyle({
                        weight: visibleLayer.options.weight * 2.5,
                        opacity: 1,
                        color: '#4fc3f7'
                    });
                }
            });
        }
    }
}

// Reset river selection highlighting (called when info panel is closed)
export function resetRiverSelection() {
    if (state.selectedRiverSystem && state.selectedRiverSystem.length > 0 && terrainState.riversLayer) {
        terrainState.riversLayer.eachLayer(visibleLayer => {
            if (state.selectedRiverSystem.includes(visibleLayer.feature)) {
                terrainState.riversLayer.resetStyle(visibleLayer);
            }
        });
    }
}

// Expose globally for cross-module access
window.resetRiverSelection = resetRiverSelection;

// Reset ocean selection highlighting (called when info panel is closed or clicking elsewhere)
export function resetOceanSelection() {
    if (terrainState.selectedOceanLayer && terrainState.oceansLayer) {
        const palette = oceanPalettes[terrainState.oceanPalette] || oceanPalettes.blue;
        const feature = terrainState.selectedOceanLayer.feature;
        const featureType = feature.properties.featurecla || 'generic';
        const color = palette[featureType] || palette.generic;
        terrainState.selectedOceanLayer.setStyle({
            fillColor: color,
            fillOpacity: terrainState.oceanFill ? terrainState.oceanOpacity : 0,
            color: terrainState.oceanLineColor,
            weight: terrainState.oceanLineWeight,
            opacity: terrainState.oceanLineWeight > 0 ? 0.9 : 0
        });
        terrainState.selectedOceanLayer = null;
    }
}

// Expose globally for cross-module access
window.resetOceanSelection = resetOceanSelection;

// Update coastline styles without recreating the layer
function updateCoastlinesStyle() {
    if (terrainState.coastlinesLayer) {
        terrainState.coastlinesLayer.setStyle(getCoastlineStyle);
    }
}

// Update civ name label styles via CSS variables
function updateLabelStyles() {
    const root = document.documentElement;

    // Subtlety presets (color opacity)
    const subtletyPresets = {
        bold: 'rgba(255, 255, 255, 1)',
        normal: 'rgba(255, 255, 255, 0.85)',
        subtle: 'rgba(255, 255, 255, 0.65)',
        faint: 'rgba(255, 255, 255, 0.45)'
    };

    // Contrast presets (shadow)
    const contrastPresets = {
        high: `-1px -1px 0 rgba(0, 0, 0, 0.9),
               1px -1px 0 rgba(0, 0, 0, 0.9),
              -1px  1px 0 rgba(0, 0, 0, 0.9),
               1px  1px 0 rgba(0, 0, 0, 0.9)`,
        medium: `-1px -1px 0 rgba(0, 0, 0, 0.6),
                 1px -1px 0 rgba(0, 0, 0, 0.6),
                -1px  1px 0 rgba(0, 0, 0, 0.6),
                 1px  1px 0 rgba(0, 0, 0, 0.6)`,
        low: `-1px -1px 0 rgba(0, 0, 0, 0.35),
              1px -1px 0 rgba(0, 0, 0, 0.35),
             -1px  1px 0 rgba(0, 0, 0, 0.35),
              1px  1px 0 rgba(0, 0, 0, 0.35)`,
        none: 'none'
    };

    // Case presets
    const casePresets = {
        uppercase: 'uppercase',
        capitalize: 'capitalize',
        none: 'none'
    };

    root.style.setProperty('--label-color', subtletyPresets[terrainState.labelSubtlety] || subtletyPresets.normal);
    root.style.setProperty('--label-shadow', contrastPresets[terrainState.labelContrast] || contrastPresets.medium);
    root.style.setProperty('--label-transform', casePresets[terrainState.labelCase] || casePresets.uppercase);
}

// Update coastlines layer
export function updateCoastlinesLayer() {
    if (terrainState.coastlinesLayer) {
        state.map.removeLayer(terrainState.coastlinesLayer);
        terrainState.coastlinesLayer = null;
    }

    if (!terrainState.showCoastlines || !terrainState.coastlinesData) return;

    terrainState.coastlinesLayer = L.geoJSON(terrainState.coastlinesData, {
        style: getCoastlineStyle,
        interactive: false
    });

    terrainState.coastlinesLayer.addTo(state.map);
    bringDataLayersToFront();
}

// Refresh elevation layer
export function refreshElevation() {
    if (terrainState.showElevation) {
        if (terrainState.elevationLayer) {
            state.map.removeLayer(terrainState.elevationLayer);
        }
        terrainState.elevationLayer = createElevationLayer();
        terrainState.elevationLayer.addTo(state.map);

        // Re-add rivers on top if visible
        if (terrainState.showRivers && terrainState.riversLayer) {
            state.map.removeLayer(terrainState.riversLayer);
            terrainState.riversLayer.addTo(state.map);
        }

        // Bring polity and city layers to front
        bringDataLayersToFront();
    }
}

// Re-order layers properly
function reorderLayers() {
    // Order: base -> hillshade -> elevation -> coastlines -> rivers -> polities -> cities
    if (terrainState.showHillshade && terrainState.hillshadeLayer) {
        state.map.removeLayer(terrainState.hillshadeLayer);
        terrainState.hillshadeLayer.addTo(state.map);
    }
    if (terrainState.showElevation && terrainState.elevationLayer) {
        state.map.removeLayer(terrainState.elevationLayer);
        terrainState.elevationLayer.addTo(state.map);
    }
    if (terrainState.showCoastlines) {
        updateCoastlinesLayer();
    }
    if (terrainState.showRivers) {
        updateRiversLayer();
    }

    bringDataLayersToFront();
}

// Bring polity and city layers to front, with rivers over polities
export function bringDataLayersToFront() {
    // Layer order (bottom to top): polities → rivers → river hit layer → cities → civ names
    // Priority: cities (top) > rivers > territories
    // The invisible hit layer is below cities so cities maintain highest priority
    if (state.polityLayer?.bringToFront) {
        state.polityLayer.bringToFront();
    }
    if (terrainState.riversLayer?.bringToFront) {
        terrainState.riversLayer.bringToFront();
    }
    if (terrainState.riversHitLayer?.bringToFront) {
        terrainState.riversHitLayer.bringToFront();
    }
    if (state.cityLayer?.bringToFront) {
        state.cityLayer.bringToFront();
    }
    if (state.civNamesLayer?.bringToFront) {
        state.civNamesLayer.bringToFront();
    }
    // Also bring city hit layer to front if it exists (defined in map.js)
    if (window.cityHitLayer?.bringToFront) {
        window.cityHitLayer.bringToFront();
    }
}

// Expose globally for cross-module access
window.bringDataLayersToFront = bringDataLayersToFront;

// Find the marine area (ocean, sea, gulf, etc.) at a given point
function getMarineAreaAtPoint(lon, lat) {
    if (!terrainState.marineData?.features) return null;

    for (const feature of terrainState.marineData.features) {
        if (pointInGeometry(lon, lat, feature.geometry)) {
            return {
                name: feature.properties.name,
                type: feature.properties.featurecla,
                geometry: feature.geometry  // Include geometry for neighbor detection
            };
        }
    }
    return null;
}

// Expose globally for cross-module access
window.getMarineAreaAtPoint = getMarineAreaAtPoint;

// Color palettes for marine feature types
const oceanPalettes = {
    blue: {
        ocean: '#1a4b6e', sea: '#2d6a8a', gulf: '#3d7a9a', bay: '#4d8aaa',
        strait: '#3d7090', sound: '#4d80a0', channel: '#3d7090', lagoon: '#5d90b0',
        fjord: '#4d7a8a', generic: '#3d6a7a', river: '#2d5a6a', reef: '#4d8090', inlet: '#4d7a8a'
    },
    deep: {
        ocean: '#0a1628', sea: '#0f2438', gulf: '#143248', bay: '#1a4058',
        strait: '#1f4e68', sound: '#245c78', channel: '#296a88', lagoon: '#2e7898',
        fjord: '#122a40', generic: '#0d2030', river: '#081820', reef: '#1f4a5a', inlet: '#1a3c4c'
    },
    teal: {
        ocean: '#0d4a4a', sea: '#1a6060', gulf: '#2a7070', bay: '#3a8080',
        strait: '#4a9090', sound: '#5aa0a0', channel: '#6ab0b0', lagoon: '#7ac0c0',
        fjord: '#2a6060', generic: '#1a5050', river: '#0d4040', reef: '#5a9090', inlet: '#4a8080'
    },
    navy: {
        ocean: '#0a1830', sea: '#102040', gulf: '#162850', bay: '#1c3060',
        strait: '#223870', sound: '#284080', channel: '#2e4890', lagoon: '#3450a0',
        fjord: '#142040', generic: '#101830', river: '#0a1020', reef: '#284070', inlet: '#203060'
    },
    arctic: {
        ocean: '#3a5a6a', sea: '#4a6a7a', gulf: '#5a7a8a', bay: '#6a8a9a',
        strait: '#7a9aaa', sound: '#8aaaba', channel: '#9abaca', lagoon: '#aacada',
        fjord: '#5a7080', generic: '#4a6070', river: '#3a5060', reef: '#7a9aa0', inlet: '#6a8a90'
    },
    warm: {
        ocean: '#4a3020', sea: '#5a4030', gulf: '#6a5040', bay: '#7a6050',
        strait: '#8a7060', sound: '#9a8070', channel: '#aa9080', lagoon: '#baa090',
        fjord: '#5a4030', generic: '#4a3525', river: '#3a2515', reef: '#7a6555', inlet: '#6a5545'
    },
    mono: {
        ocean: '#2a2a2a', sea: '#3a3a3a', gulf: '#4a4a4a', bay: '#5a5a5a',
        strait: '#6a6a6a', sound: '#7a7a7a', channel: '#8a8a8a', lagoon: '#9a9a9a',
        fjord: '#4a4a4a', generic: '#3a3a3a', river: '#2a2a2a', reef: '#6a6a6a', inlet: '#5a5a5a'
    }
};

// Render oceans layer showing all marine areas with distinct colors
function renderOceansLayer() {
    // Remove existing layer and clear selection
    if (terrainState.oceansLayer) {
        state.map.removeLayer(terrainState.oceansLayer);
        terrainState.oceansLayer = null;
    }
    terrainState.selectedOceanLayer = null;

    if (!terrainState.showOceans || !terrainState.marineData?.features) return;

    const palette = oceanPalettes[terrainState.oceanPalette] || oceanPalettes.blue;

    const styleFunc = (feature) => {
        const featureType = feature.properties.featurecla || 'generic';
        const color = palette[featureType] || palette.generic;
        return {
            fillColor: color,
            fillOpacity: terrainState.oceanFill ? terrainState.oceanOpacity : 0,
            color: terrainState.oceanLineColor,
            weight: terrainState.oceanLineWeight,
            opacity: terrainState.oceanLineWeight > 0 ? 0.9 : 0
        };
    };

    // Highlight style for selected ocean
    const highlightStyle = (feature) => {
        const featureType = feature.properties.featurecla || 'generic';
        const baseColor = palette[featureType] || palette.generic;
        // Lighten the fill color for selection
        const highlightFill = lightenColor(baseColor, 0.3);
        return {
            fillColor: highlightFill,
            fillOpacity: terrainState.oceanFill ? Math.min(terrainState.oceanOpacity + 0.15, 0.8) : 0,
            color: '#60a0d0',  // Bright blue edge
            weight: 2.5,
            opacity: 1
        };
    };

    // Helper to lighten a hex color
    function lightenColor(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
        const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
        const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    terrainState.oceansLayer = L.geoJSON(terrainState.marineData, {
        style: styleFunc,
        interactive: terrainState.oceanTooltips,
        onEachFeature: (feature, layer) => {
            if (terrainState.oceanTooltips) {
                const name = feature.properties.name || 'Unknown';
                const type = feature.properties.featurecla || 'water';
                const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
                layer.bindTooltip(`${name} (${typeLabel})`, {
                    sticky: true,
                    className: 'ocean-tooltip'
                });
            }

            // Hover effect - show info panel and subtle highlight
            layer.on('mouseover', (e) => {
                // Set hover priority to prevent territory hover from overriding
                state.hoverPriority = 'ocean';

                if (terrainState.selectedOceanLayer !== layer) {
                    layer.setStyle({
                        ...styleFunc(feature),
                        weight: 1.5,
                        color: '#4080b0'
                    });
                    layer.bringToFront();
                    // Keep selected layer on top
                    if (terrainState.selectedOceanLayer) {
                        terrainState.selectedOceanLayer.bringToFront();
                    }
                }

                // Show hover info in panel (if not pinned and hover enabled)
                if (!state.infoPanelPinned && terrainState.oceanTooltips) {
                    const lon = e.latlng.lng;
                    const lat = e.latlng.lat;
                    state.selectedLocation = {
                        type: 'point',
                        coords: [lon, lat],
                        isHover: true
                    };
                    renderInfoPanel();
                }
            });

            layer.on('mouseout', () => {
                // Clear hover priority
                if (state.hoverPriority === 'ocean') {
                    state.hoverPriority = null;
                }

                if (terrainState.selectedOceanLayer !== layer) {
                    layer.setStyle(styleFunc(feature));
                }

                // Hide info panel if not pinned (hover was showing it)
                if (!state.infoPanelPinned) {
                    hideInfo();
                }
            });

            layer.on('click', (e) => {
                // Mark event as handled to prevent map click from overriding
                e.originalEvent._oceanHandled = true;

                const lon = e.latlng.lng;
                const lat = e.latlng.lat;

                // Reset previously selected ocean visual
                if (terrainState.selectedOceanLayer && terrainState.selectedOceanLayer !== layer) {
                    const prevFeature = terrainState.selectedOceanLayer.feature;
                    terrainState.selectedOceanLayer.setStyle(styleFunc(prevFeature));
                }

                // Reset other selections (city, river, polity)
                if (state.selectedCity && window.resetCitySelection) {
                    window.resetCitySelection();
                }
                if (state.selectedRiverSystem && window.resetRiverSelection) {
                    window.resetRiverSelection();
                }
                if (state.selectedPolityLayer && state.polityLayer) {
                    state.polityLayer.resetStyle(state.selectedPolityLayer);
                    state.selectedPolityLayer = null;
                }

                // Toggle selection - clicking same ocean deselects
                if (terrainState.selectedOceanLayer === layer) {
                    layer.setStyle(styleFunc(feature));
                    terrainState.selectedOceanLayer = null;
                    // Unpin and hide info panel
                    unpinInfoPanel();
                } else {
                    // Select new ocean
                    layer.setStyle(highlightStyle(feature));
                    layer.bringToFront();
                    terrainState.selectedOceanLayer = layer;

                    // Show info panel with marine info - use showPointInfo
                    // First unpin if pinned to allow new selection
                    if (state.infoPanelPinned) {
                        state.infoPanelPinned = false;
                    }
                    showPointInfo(lon, lat);
                }

                L.DomEvent.stopPropagation(e);
            });
        }
    }).addTo(state.map);

    // Send to back so it doesn't cover territories
    terrainState.oceansLayer.bringToBack();
}

// Toggle oceans layer
function toggleOceans() {
    terrainState.showOceans = !terrainState.showOceans;
    renderOceansLayer();
}

// Toggle labels layer
function toggleLabels() {
    if (terrainState.showLabels && !terrainState.labelsLayer) {
        terrainState.labelsLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 20,
            pane: 'overlayPane'
        }).addTo(state.map);
    } else if (!terrainState.showLabels && terrainState.labelsLayer) {
        state.map.removeLayer(terrainState.labelsLayer);
        terrainState.labelsLayer = null;
    }
}

// Switch base map
export function switchBasemap(mapType) {
    if (mapType === terrainState.currentBasemap) return;

    terrainState.currentBasemap = mapType;

    // Remove old base layer
    if (state.baseLayer) {
        state.map.removeLayer(state.baseLayer);
    }

    // Add new base layer
    const config = baseMaps[mapType];
    if (config.url) {
        state.baseLayer = L.tileLayer(config.url, {
            ...config.options,
            attribution: config.attribution
        });
        state.baseLayer.addTo(state.map);
        state.baseLayer.bringToBack();
    } else {
        // Pure black - create an empty layer
        state.baseLayer = L.layerGroup().addTo(state.map);
    }

    // Re-order layers
    reorderLayers();
}

// Load terrain data files
async function loadTerrainData() {
    // Load rivers
    try {
        const response = await fetch('data/terrain/rivers_detailed.geojson');
        if (response.ok) {
            terrainState.allRiversData = await response.json();
        }
    } catch (err) {
        console.warn('Could not load detailed rivers:', err);
        try {
            const response = await fetch('data/terrain/rivers.geojson');
            if (response.ok) {
                terrainState.allRiversData = await response.json();
            }
        } catch (e) {
            console.warn('Could not load rivers:', e);
        }
    }

    // Load both coastline versions
    try {
        const response = await fetch('data/terrain/coastlines_detailed.geojson');
        if (response.ok) {
            terrainState.coastlinesDetailedData = await response.json();
        }
    } catch (err) {
        console.warn('Could not load detailed coastlines:', err);
    }

    try {
        const response = await fetch('data/terrain/coastlines.geojson');
        if (response.ok) {
            terrainState.coastlinesStandardData = await response.json();
        }
    } catch (err) {
        console.warn('Could not load standard coastlines:', err);
    }

    // Set active coastlines data based on detail level
    terrainState.coastlinesData = terrainState.coastlineDetail === 'detailed'
        ? (terrainState.coastlinesDetailedData || terrainState.coastlinesStandardData)
        : (terrainState.coastlinesStandardData || terrainState.coastlinesDetailedData);

    // Load marine areas (oceans, seas, etc.)
    try {
        const response = await fetch('data/terrain/marine.geojson');
        if (response.ok) {
            terrainState.marineData = await response.json();
        }
    } catch (err) {
        console.warn('Could not load marine data:', err);
    }
}

// Setup terrain controls
export function setupTerrainControls() {
    // Base map chip buttons
    document.querySelectorAll('.basemap-chip').forEach(btn => {
        btn.addEventListener('click', function() {
            const mapType = this.dataset.basemap;
            document.querySelectorAll('.basemap-chip').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            switchBasemap(mapType);
        });
    });

    // Legacy basemap buttons (fallback)
    document.querySelectorAll('#view-panel .basemap-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const mapType = this.dataset.basemap;
            document.querySelectorAll('#view-panel .basemap-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            switchBasemap(mapType);
        });
    });

    // Helper to update toggle button text
    function updateToggleText(btn, isActive) {
        if (btn.classList.contains('ribbon-toggle')) {
            btn.textContent = isActive ? 'On' : 'Off';
        }
    }

    // Elevation toggle
    const elevationBtn = document.getElementById('toggle-elevation');
    if (elevationBtn) {
        elevationBtn.addEventListener('click', function() {
            terrainState.showElevation = !terrainState.showElevation;
            this.classList.toggle('active', terrainState.showElevation);
            updateToggleText(this, terrainState.showElevation);
            if (terrainState.showElevation) {
                if (!terrainState.elevationLayer) {
                    terrainState.elevationLayer = createElevationLayer();
                }
                terrainState.elevationLayer.addTo(state.map);
                bringDataLayersToFront();
            } else {
                if (terrainState.elevationLayer) {
                    state.map.removeLayer(terrainState.elevationLayer);
                }
            }
        });
    }

    // Hillshade toggle
    const hillshadeBtn = document.getElementById('toggle-hillshade');
    if (hillshadeBtn) {
        hillshadeBtn.addEventListener('click', function() {
            terrainState.showHillshade = !terrainState.showHillshade;
            this.classList.toggle('active', terrainState.showHillshade);
            updateToggleText(this, terrainState.showHillshade);
            if (terrainState.showHillshade) {
                if (!terrainState.hillshadeLayer) {
                    terrainState.hillshadeLayer = createHillshadeLayer();
                }
                terrainState.hillshadeLayer.addTo(state.map);
                // Ensure proper layer order
                if (terrainState.showElevation && terrainState.elevationLayer) {
                    state.map.removeLayer(terrainState.elevationLayer);
                    terrainState.elevationLayer.addTo(state.map);
                }
                bringDataLayersToFront();
            } else {
                if (terrainState.hillshadeLayer) {
                    state.map.removeLayer(terrainState.hillshadeLayer);
                }
            }
        });
    }

    // Rivers toggle
    const riversBtn = document.getElementById('toggle-rivers');
    if (riversBtn) {
        riversBtn.addEventListener('click', function() {
            terrainState.showRivers = !terrainState.showRivers;
            this.classList.toggle('active', terrainState.showRivers);
            updateToggleText(this, terrainState.showRivers);
            updateRiversLayer();
            bringDataLayersToFront();
        });
    }

    // Coastlines toggle
    const coastlinesBtn = document.getElementById('toggle-coastlines');
    if (coastlinesBtn) {
        coastlinesBtn.addEventListener('click', function() {
            terrainState.showCoastlines = !terrainState.showCoastlines;
            this.classList.toggle('active', terrainState.showCoastlines);
            updateToggleText(this, terrainState.showCoastlines);
            updateCoastlinesLayer();
            bringDataLayersToFront();
        });
    }

    // Labels toggle
    const labelsBtn = document.getElementById('toggle-labels');
    if (labelsBtn) {
        labelsBtn.addEventListener('click', function() {
            terrainState.showLabels = !terrainState.showLabels;
            this.classList.toggle('active', terrainState.showLabels);
            updateToggleText(this, terrainState.showLabels);
            toggleLabels();
        });
    }

    // Civilization names toggle
    const civNamesBtn = document.getElementById('toggle-civ-names');
    if (civNamesBtn) {
        civNamesBtn.addEventListener('click', function() {
            state.showCivNames = !state.showCivNames;
            this.classList.toggle('active', state.showCivNames);
            updateToggleText(this, state.showCivNames);
            // Trigger map update to refresh labels
            if (window.updateMapWithGraph) {
                window.updateMapWithGraph(state.currentYear);
            }
        });
    }

    // Oceans toggle
    const oceansBtn = document.getElementById('toggle-oceans');
    if (oceansBtn) {
        oceansBtn.addEventListener('click', function() {
            this.classList.toggle('active', !terrainState.showOceans);
            updateToggleText(this, !terrainState.showOceans);
            toggleOceans();
        });
    }

    // Ocean fill toggle
    const oceanFillSelect = document.getElementById('ocean-fill');
    if (oceanFillSelect) {
        oceanFillSelect.addEventListener('change', function() {
            terrainState.oceanFill = this.value === 'on';
            renderOceansLayer();
        });
    }

    // Ocean opacity
    const oceanOpacitySelect = document.getElementById('ocean-opacity');
    if (oceanOpacitySelect) {
        oceanOpacitySelect.addEventListener('change', function() {
            terrainState.oceanOpacity = parseFloat(this.value);
            renderOceansLayer();
        });
    }

    // Ocean line weight
    const oceanLineWeightSelect = document.getElementById('ocean-line-weight');
    if (oceanLineWeightSelect) {
        oceanLineWeightSelect.addEventListener('change', function() {
            terrainState.oceanLineWeight = parseFloat(this.value);
            renderOceansLayer();
        });
    }

    // Ocean line color
    const oceanLineColorSelect = document.getElementById('ocean-line-color');
    if (oceanLineColorSelect) {
        oceanLineColorSelect.addEventListener('change', function() {
            terrainState.oceanLineColor = this.value;
            renderOceansLayer();
        });
    }

    // Ocean palette
    const oceanPaletteSelect = document.getElementById('ocean-palette');
    if (oceanPaletteSelect) {
        oceanPaletteSelect.addEventListener('change', function() {
            terrainState.oceanPalette = this.value;
            renderOceansLayer();
        });
    }

    // Ocean tooltips
    const oceanTooltipsSelect = document.getElementById('ocean-tooltips');
    if (oceanTooltipsSelect) {
        oceanTooltipsSelect.addEventListener('change', function() {
            terrainState.oceanTooltips = this.value === 'on';
            renderOceansLayer();
        });
    }

    // Opacity slider
    const opacitySlider = document.getElementById('terrain-opacity-slider');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', function() {
            terrainState.terrainOpacity = this.value / 100;
            document.getElementById('terrain-opacity-value').textContent = this.value + '%';
            refreshElevation();
        });
    }

    // Intensity slider
    const intensitySlider = document.getElementById('terrain-intensity-slider');
    if (intensitySlider) {
        intensitySlider.addEventListener('input', function() {
            terrainState.terrainIntensity = this.value / 100;
            document.getElementById('terrain-intensity-value').textContent = this.value + '%';
            refreshElevation();
        });
    }

    // Max height selector
    const maxHeightSelect = document.getElementById('terrain-max-height');
    if (maxHeightSelect) {
        maxHeightSelect.addEventListener('change', function() {
            terrainState.maxHeight = parseInt(this.value);
            refreshElevation();
        });
    }

    // Gradient picker dropdown
    const gradientPicker = document.getElementById('elevation-gradient-picker');
    if (gradientPicker) {
        const selected = gradientPicker.querySelector('.gradient-selected');
        const dropdown = gradientPicker.querySelector('.gradient-dropdown');
        const options = gradientPicker.querySelectorAll('.gradient-option');

        // Toggle dropdown
        selected.addEventListener('click', (e) => {
            e.stopPropagation();
            gradientPicker.classList.toggle('open');
        });

        // Select option
        options.forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const preset = option.dataset.preset;
                const gradient = option.style.background;

                // Update selected display
                selected.style.background = gradient;
                selected.dataset.preset = preset;

                // Update active state
                options.forEach(o => o.classList.remove('active'));
                option.classList.add('active');

                // Apply preset
                terrainState.currentRamp = preset;
                refreshElevation();

                // Close dropdown
                gradientPicker.classList.remove('open');
            });
        });

        // Close on outside click
        document.addEventListener('click', () => {
            gradientPicker.classList.remove('open');
        });
    }

    // River detail selector
    const riverDetail = document.getElementById('river-detail');
    if (riverDetail) {
        riverDetail.addEventListener('change', function() {
            terrainState.riverDetailLevel = parseInt(this.value);
            updateRiversLayer();
            bringDataLayersToFront();
        });
    }

    // River style selector
    const riverStyleSelect = document.getElementById('river-style');
    if (riverStyleSelect) {
        riverStyleSelect.addEventListener('change', function() {
            terrainState.riverStyle = this.value;
            updateRiversLayer();
            bringDataLayersToFront();
        });
    }

    // River hover toggle
    const riverHoverSelect = document.getElementById('river-hover');
    if (riverHoverSelect) {
        riverHoverSelect.addEventListener('change', function() {
            terrainState.riverHover = this.value;
        });
    }

    // River sensitivity selector
    const riverSensitivitySelect = document.getElementById('river-sensitivity');
    if (riverSensitivitySelect) {
        riverSensitivitySelect.addEventListener('change', function() {
            terrainState.riverSensitivity = this.value;
            updateRiversLayer();
            bringDataLayersToFront();
        });
    }

    // City hover toggle
    const cityHoverSelect = document.getElementById('city-hover');
    if (cityHoverSelect) {
        cityHoverSelect.addEventListener('change', function() {
            terrainState.cityHover = this.value;
        });
    }

    // City sensitivity selector
    const citySensitivitySelect = document.getElementById('city-sensitivity');
    if (citySensitivitySelect) {
        citySensitivitySelect.addEventListener('change', function() {
            terrainState.citySensitivity = this.value;
            // Trigger city layer rebuild
            if (window.updateCityLayer) {
                window.updateCityLayer();
            }
        });
    }

    // City lightness selector
    const cityLightnessSelect = document.getElementById('city-lightness');
    if (cityLightnessSelect) {
        cityLightnessSelect.addEventListener('change', function() {
            terrainState.cityLightness = this.value;
            if (window.updateCityLayer) {
                window.updateCityLayer();
            }
        });
    }

    // City outline selector
    const cityOutlineSelect = document.getElementById('city-outline');
    if (cityOutlineSelect) {
        cityOutlineSelect.addEventListener('change', function() {
            terrainState.cityOutline = this.value;
            if (window.updateCityLayer) {
                window.updateCityLayer();
            }
        });
    }

    // City outline color selector
    const cityOutlineColorSelect = document.getElementById('city-outline-color');
    if (cityOutlineColorSelect) {
        cityOutlineColorSelect.addEventListener('change', function() {
            terrainState.cityOutlineColor = this.value;
            if (window.updateCityLayer) {
                window.updateCityLayer();
            }
        });
    }

    // Coastline detail selector
    const coastlineDetailSelect = document.getElementById('coastline-detail');
    if (coastlineDetailSelect) {
        coastlineDetailSelect.addEventListener('change', function() {
            terrainState.coastlineDetail = this.value;
            // Switch to appropriate dataset
            terrainState.coastlinesData = this.value === 'detailed'
                ? (terrainState.coastlinesDetailedData || terrainState.coastlinesStandardData)
                : (terrainState.coastlinesStandardData || terrainState.coastlinesDetailedData);
            updateCoastlinesLayer();
            bringDataLayersToFront();
        });
    }

    // Coastline style selector
    const coastlineStyleSelect = document.getElementById('coastline-style');
    if (coastlineStyleSelect) {
        coastlineStyleSelect.addEventListener('change', function() {
            terrainState.coastlineStyle = this.value;
            updateCoastlinesLayer();
            bringDataLayersToFront();
        });
    }

    // Civ name label controls
    const labelPosition = document.getElementById('label-position');
    if (labelPosition) {
        labelPosition.addEventListener('change', function() {
            terrainState.labelPosition = this.value;
            if (state.showCivNames && window.updateMapWithGraph) {
                window.updateMapWithGraph(state.currentYear);
            }
        });
    }

    const labelDensity = document.getElementById('label-density');
    if (labelDensity) {
        labelDensity.addEventListener('change', function() {
            terrainState.labelDensity = this.value;
            if (state.showCivNames && window.updateMapWithGraph) {
                window.updateMapWithGraph(state.currentYear);
            }
        });
    }

    const labelSubtlety = document.getElementById('label-subtlety');
    if (labelSubtlety) {
        labelSubtlety.addEventListener('change', function() {
            terrainState.labelSubtlety = this.value;
            updateLabelStyles();
        });
    }

    const labelCase = document.getElementById('label-case');
    if (labelCase) {
        labelCase.addEventListener('change', function() {
            terrainState.labelCase = this.value;
            updateLabelStyles();
        });
    }

    const labelContrast = document.getElementById('label-contrast');
    if (labelContrast) {
        labelContrast.addEventListener('change', function() {
            terrainState.labelContrast = this.value;
            updateLabelStyles();
        });
    }

    // Update river and coastline styles on zoom (without recreating layers)
    state.map.on('zoomend', function() {
        if (terrainState.showRivers && terrainState.riversLayer) {
            updateRiversStyle();
        }
        if (terrainState.showCoastlines && terrainState.coastlinesLayer) {
            updateCoastlinesStyle();
        }
        // Update civ name labels on zoom (filter changes by zoom level)
        if (state.showCivNames && window.updateMapWithGraph) {
            window.updateMapWithGraph(state.currentYear);
        }
    });
}

// Initialize terrain module
export async function initTerrain() {
    // Load terrain data
    await loadTerrainData();

    // Setup controls
    setupTerrainControls();

    // Set button states to match defaults
    const elevationBtn = document.getElementById('toggle-elevation');
    const riversBtn = document.getElementById('toggle-rivers');
    const coastlinesBtn = document.getElementById('toggle-coastlines');

    if (elevationBtn) elevationBtn.classList.add('active');
    if (riversBtn) riversBtn.classList.add('active');
    if (coastlinesBtn) coastlinesBtn.classList.add('active');

    // Initialize default layers
    if (terrainState.showElevation) {
        terrainState.elevationLayer = createElevationLayer();
        terrainState.elevationLayer.addTo(state.map);
    }

    if (terrainState.showRivers && terrainState.allRiversData) {
        updateRiversLayer();
    }

    if (terrainState.showCoastlines && terrainState.coastlinesData) {
        updateCoastlinesLayer();
    }

    // Bring data layers to front
    bringDataLayersToFront();
}
