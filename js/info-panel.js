// Info panel - polity/city details display with location history
import { state } from './state.js';
import { formatYear, formatArea, formatPopulation, getPopulationForYear, pointInGeometry, getColor, calculateRiverLength, getRiverEndpoints, getRiverPolities, formatCoordinate, CITY_TERRITORY_TOLERANCE } from './utils.js';

// Cache for reverse geocoding results
const geocodeCache = new Map();

// Reverse geocode to get modern country name
async function getModernCountry(lon, lat) {
    const cacheKey = `${lon.toFixed(2)},${lat.toFixed(2)}`;
    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=3&accept-language=en`,
            { headers: { 'User-Agent': 'CivilizationMap/1.0' } }
        );
        const data = await response.json();

        let result = null;
        if (data.address) {
            // Check if it's ocean/sea
            if (data.address.ocean || data.address.sea) {
                result = { isOcean: true, name: data.address.ocean || data.address.sea };
            } else {
                result = {
                    isOcean: false,
                    country: data.address.country || null,
                    region: data.address.state || data.address.region || null
                };
            }
        }

        geocodeCache.set(cacheKey, result);
        return result;
    } catch (error) {
        console.warn('Geocoding failed:', error);
        return null;
    }
}

// Update the subtitle with modern country info
async function updateModernLocation(lon, lat) {
    const geoData = await getModernCountry(lon, lat);
    const subtitleEl = document.getElementById('info-subtitle');
    const nameEl = document.getElementById('info-name');

    if (geoData) {
        if (geoData.isOcean) {
            // Update name to show ocean/sea name
            if (nameEl.textContent === 'Uncharted Territory') {
                nameEl.textContent = geoData.name || 'Ocean';
            }
        } else if (geoData.country) {
            // Add modern country to subtitle
            const currentText = subtitleEl.textContent;
            if (!currentText.includes('Modern day')) {
                subtitleEl.textContent = currentText + ` · Modern day ${geoData.country}`;
            }
        }
    }
}

// Show crosshair marker at a location
function showCrosshair(lon, lat) {
    // Remove existing crosshair
    if (state.crosshairMarker) {
        state.map.removeLayer(state.crosshairMarker);
        state.crosshairMarker = null;
    }

    if (!state.map) return;

    // Create a custom crosshair icon
    const crosshairIcon = L.divIcon({
        className: 'crosshair-marker',
        html: '<div class="crosshair-icon">+</div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    state.crosshairMarker = L.marker([lat, lon], {
        icon: crosshairIcon,
        interactive: false,
        zIndexOffset: 1000
    }).addTo(state.map);
}

// Remove crosshair marker
function hideCrosshair() {
    if (state.crosshairMarker && state.map) {
        state.map.removeLayer(state.crosshairMarker);
        state.crosshairMarker = null;
    }
}

// === PANEL RENDERING HELPERS ===

// Render city panel (expanded or collapsed)
function renderCityPanel(city, year, containingPolity, options = {}) {
    const { expanded = false, showActions = false, actionButtonsHtml = '', componentId = 'city' } = options;
    const props = city.properties;
    const popData = getPopulationForYear(city, year);
    const [lon, lat] = city.geometry.coordinates;

    let cityName = props.name;
    if (props.otherName) cityName += ` (${props.otherName})`;
    const polityName = containingPolity ? containingPolity.properties.Name : 'Unclaimed territory';

    const expandedClass = expanded ? 'expanded' : '';
    const expandBtn = !expanded ? `<button class="panel-expand-btn" data-component="${componentId}">▼</button>` : '';

    let html = `<div class="info-stacked-panel city-panel ${expandedClass}" data-component="${componentId}">`;
    html += '<div class="stacked-header">';
    if (showActions) html += actionButtonsHtml;
    html += `<h3 class="stacked-name">${cityName}</h3>`;
    html += `<div class="stacked-subtitle">${formatYear(year)} · City${expandBtn}</div>`;
    html += '</div>';

    if (popData) {
        // Collapsed: just show key stats
        html += '<div class="stacked-content">';
        html += '<div class="info-stats-grid">';
        html += `<div class="info-stat"><div class="info-stat-value">${formatPopulation(popData.pop)}</div><div class="info-stat-label">Population</div></div>`;
        html += '</div>';

        // Expanded: show full detail
        if (expanded) {
            const statusLabels = {
                recorded: 'Historical record',
                interpolated: `Interpolated (~${popData.gap}yr gap)`,
                estimated: `Estimated from ${formatYear(popData.year)}`,
                projected: `Projected from ${formatYear(popData.year)}`,
                prehistoric: 'Pre-historical estimate'
            };

            html += '<div class="info-coords">';
            html += `<span class="coord-label">Location:</span> ${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
            html += '</div>';
            html += `<p style="margin: 8px 0 4px; font-size: 12px; color: #888;"><strong>Empire:</strong> <span style="color: #ccc">${polityName}</span></p>`;
            html += '<div class="info-section">';
            html += '<div class="info-section-title">City Data</div>';
            html += `<p><strong>First recorded:</strong> ${formatYear(props.minYear)}</p>`;
            html += `<p><strong>Last recorded:</strong> ${formatYear(props.maxYear)}</p>`;
            html += `<p><strong>Data quality:</strong> ${statusLabels[popData.status] || 'Unknown'}</p>`;
            html += '</div>';
        }
        html += '</div>';
    } else {
        // City doesn't exist yet or no longer exists
        const beforeCity = year < props.minYear;
        html += '<div class="stacked-content">';
        html += '<div class="info-status-box">';
        if (beforeCity) {
            html += `<p class="info-status">Not yet founded (est. ${formatYear(props.minYear)})</p>`;
        } else {
            html += `<p class="info-status">Last recorded in <strong>${formatYear(props.maxYear)}</strong></p>`;
            if (expanded) {
                html += `<button class="info-jump-btn" data-year="${props.maxYear}">Jump to last record →</button>`;
            }
        }
        html += '</div>';
        if (expanded && !beforeCity) {
            html += '<div class="info-section">';
            html += '<div class="info-section-title">Historical Record</div>';
            html += `<p><strong>Active period:</strong> ${formatYear(props.minYear)} – ${formatYear(props.maxYear)}</p>`;
            html += '</div>';
        }
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// Render territory panel (expanded or collapsed)
function renderTerritoryPanel(polity, year, options = {}) {
    const { expanded = false, showActions = false, actionButtonsHtml = '', componentId = 'territory' } = options;

    const expandedClass = expanded ? 'expanded' : '';
    const expandBtn = !expanded ? `<button class="panel-expand-btn" data-component="${componentId}">▼</button>` : '';

    let html = `<div class="info-stacked-panel territory-panel ${expandedClass}" data-component="${componentId}">`;

    if (polity) {
        const props = polity.properties;
        const foundingYear = state.polityFoundingYears[props.Name] ?? props.FromYear;
        const age = year - foundingYear;
        const polityObj = { geometry: polity.geometry, properties: props };
        const cities = getCitiesInPolity(polityObj, year);
        const totalUrbanPop = cities.reduce((sum, c) => sum + c.pop, 0);

        html += '<div class="stacked-header">';
        if (showActions) html += actionButtonsHtml;
        html += `<h3 class="stacked-name">${props.Name}</h3>`;
        html += `<div class="stacked-subtitle">${formatYear(year)} · Empire${expandBtn}</div>`;
        html += '</div>';
        html += '<div class="stacked-content">';

        // Always show stats grid
        html += '<div class="info-stats-grid">';
        html += `<div class="info-stat"><div class="info-stat-value">${formatArea(props.Area)}</div><div class="info-stat-label">Territory</div></div>`;
        html += `<div class="info-stat"><div class="info-stat-value">${age}</div><div class="info-stat-label">Years Old</div></div>`;
        html += `<div class="info-stat"><div class="info-stat-value">${cities.length}</div><div class="info-stat-label">Cities</div></div>`;
        html += `<div class="info-stat"><div class="info-stat-value">${formatPopulation(totalUrbanPop)}</div><div class="info-stat-label">Urban Pop</div></div>`;
        html += '</div>';

        // Expanded: show full detail
        if (expanded) {
            html += '<div class="info-section">';
            html += '<div class="info-section-title">Historical Period</div>';
            html += `<p><strong>Founded:</strong> ${formatYear(foundingYear)}</p>`;
            html += `<p><strong>Current borders:</strong> ${formatYear(props.FromYear)} – ${formatYear(props.ToYear)}</p>`;
            html += '</div>';

            // Cities list
            if (cities.length > 0) {
                const topCities = cities.slice(0, 3);
                const remainingCities = cities.slice(3);
                const citiesExpandedClass = state.citiesExpanded ? 'expanded' : '';
                const formatFounded = (y) => y < 0 ? `${Math.abs(y)} BCE` : `${y} CE`;

                html += `<div class="info-cities-section ${citiesExpandedClass}">`;
                html += '<div class="info-section-title">Cities</div>';
                html += '<div class="info-cities-header-row"><span class="city-col-name">Name</span><span class="city-col-founded">Founded</span><span class="city-col-pop">Pop</span></div>';
                html += '<div class="info-cities-list info-cities-top">';
                for (const city of topCities) {
                    html += `<div class="info-city-item" data-lon="${city.coords[0]}" data-lat="${city.coords[1]}" data-name="${city.name}">`;
                    html += `<span class="city-name">${city.name}</span>`;
                    html += `<span class="city-founded">${formatFounded(city.founded)}</span>`;
                    html += `<span class="city-pop">${formatPopulation(city.pop)}</span>`;
                    html += '</div>';
                }
                html += '</div>';
                if (remainingCities.length > 0) {
                    html += `<div class="info-cities-more" id="cities-toggle"><span class="cities-more-text">${remainingCities.length} more cities</span><span class="cities-chevron">▼</span></div>`;
                    html += '<div class="info-cities-content"><div class="info-cities-list">';
                    for (const city of remainingCities) {
                        html += `<div class="info-city-item" data-lon="${city.coords[0]}" data-lat="${city.coords[1]}" data-name="${city.name}">`;
                        html += `<span class="city-name">${city.name}</span>`;
                        html += `<span class="city-founded">${formatFounded(city.founded)}</span>`;
                        html += `<span class="city-pop">${formatPopulation(city.pop)}</span>`;
                        html += '</div>';
                    }
                    html += '</div></div>';
                }
                html += '</div>';
            }

            // Wiki button
            if (props.Wikipedia) {
                html += `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(props.Wikipedia)}" target="_blank" class="info-wiki-link">Wikipedia →</a>`;
            }
        }
        html += '</div>';
    } else {
        // Unclaimed territory
        html += '<div class="stacked-header">';
        if (showActions) html += actionButtonsHtml;
        html += '<h3 class="stacked-name">Unclaimed Territory</h3>';
        html += `<div class="stacked-subtitle">${formatYear(year)}</div>`;
        html += '</div>';
        html += '<div class="stacked-content">';
        html += '<p class="info-status" style="margin:0">No empire controls this location</p>';
        html += '</div>';
    }

    html += '</div>';
    return html;
}

// Render river panel (expanded or collapsed)
function renderRiverPanel(river, connectedFeatures, year, visiblePolities, options = {}) {
    const { expanded = false, showActions = false, actionButtonsHtml = '', componentId = 'river' } = options;

    // Get river name
    let riverName = 'Unknown River';
    for (const f of connectedFeatures) {
        const n = f.properties.name || f.properties.NAME || f.properties.name_en;
        if (n && f.properties.featurecla !== 'Lake Centerline') { riverName = n; break; }
    }
    if (riverName === 'Unknown River') {
        riverName = river.properties.name || river.properties.NAME || river.properties.name_en || 'Unknown River';
    }

    // Feature class
    let featureClass = river.properties.featurecla || 'River';
    const hasLakeCenterline = connectedFeatures.some(f => f.properties.featurecla === 'Lake Centerline');
    const hasRiver = connectedFeatures.some(f => f.properties.featurecla !== 'Lake Centerline');
    if (hasLakeCenterline && hasRiver && connectedFeatures.length > 1) featureClass = 'River System';

    // Calculate length
    let totalLength = 0;
    for (const f of connectedFeatures) totalLength += calculateRiverLength(f.geometry);

    // Get endpoints
    const endpoints = getSystemEndpoints(connectedFeatures);

    // Find polities
    const politySet = new Map();
    for (const f of connectedFeatures) {
        const polities = getRiverPolities(f.geometry, visiblePolities);
        for (const p of polities) if (!politySet.has(p.name)) politySet.set(p.name, p);
    }
    const riverPolities = Array.from(politySet.values());

    const expandedClass = expanded ? 'expanded' : '';
    const expandBtn = !expanded ? `<button class="panel-expand-btn" data-component="${componentId}">▼</button>` : '';

    let html = `<div class="info-stacked-panel river-panel ${expandedClass}" data-component="${componentId}">`;
    html += '<div class="stacked-header">';
    if (showActions) html += actionButtonsHtml;
    html += `<h3 class="stacked-name">${riverName}</h3>`;
    html += `<div class="stacked-subtitle">${formatYear(year)} · ${featureClass}${expandBtn}</div>`;
    html += '</div>';
    html += '<div class="stacked-content">';

    // Always show stats
    html += '<div class="info-stats-grid">';
    html += `<div class="info-stat"><div class="info-stat-value">${totalLength.toLocaleString()} km</div><div class="info-stat-label">Length</div></div>`;
    html += `<div class="info-stat"><div class="info-stat-value">${riverPolities.length}</div><div class="info-stat-label">Empire${riverPolities.length !== 1 ? 's' : ''}</div></div>`;
    html += '</div>';

    // Expanded: show full detail
    if (expanded) {
        if (endpoints.source || endpoints.mouth) {
            html += '<div class="info-section">';
            html += '<div class="info-section-title">Geography</div>';
            if (endpoints.source) html += `<p><strong>Source region:</strong> <span class="info-coord-link" data-lon="${endpoints.source[0]}" data-lat="${endpoints.source[1]}">${formatCoordinate(endpoints.source[0], endpoints.source[1])}</span></p>`;
            if (endpoints.mouth) html += `<p><strong>Mouth region:</strong> <span class="info-coord-link" data-lon="${endpoints.mouth[0]}" data-lat="${endpoints.mouth[1]}">${formatCoordinate(endpoints.mouth[0], endpoints.mouth[1])}</span></p>`;
            html += '</div>';
        }

        if (riverPolities.length > 0) {
            html += '<div class="info-section">';
            html += `<div class="info-section-title">Empires (${riverPolities.length})</div>`;
            html += '<div class="info-polities-list">';
            for (const pol of riverPolities) {
                html += `<div class="info-polity-item" data-name="${pol.name}"><span class="polity-marker" style="background: ${pol.color}"></span><span class="polity-name">${pol.name}</span></div>`;
            }
            html += '</div>';
            html += '</div>';
        }
    }

    html += '</div>';
    html += '</div>';
    return html;
}

// Get all cities in a polity for the current year
export function getCitiesInPolity(polity, year) {
    const cities = [];
    for (const city of state.allCities) {
        const popData = getPopulationForYear(city, year);
        if (!popData) continue;
        const [lon, lat] = city.geometry.coordinates;
        // Use tolerance for coastal cities that fall just outside low-res territory boundaries
        if (pointInGeometry(lon, lat, polity.geometry, CITY_TERRITORY_TOLERANCE)) {
            cities.push({
                name: city.properties.name,
                pop: popData.pop,
                founded: city.properties.minYear,
                coords: [lon, lat]
            });
        }
    }
    cities.sort((a, b) => b.pop - a.pop);
    return cities; // Return all cities, not limited
}

// Find which polity controls a point at a given year
function getPolityAtPoint(lon, lat, year) {
    for (const polity of state.allPolities) {
        const name = polity.properties.Name;
        // Skip parenthetical entries - they are composite representations
        if (name.startsWith('(') && name.endsWith(')')) continue;

        const from = polity.properties.FromYear;
        const to = polity.properties.ToYear;
        if (year >= from && year <= to) {
            if (pointInGeometry(lon, lat, polity.geometry)) {
                return polity;
            }
        }
    }
    return null;
}

// Get the display name for a polity, including parent empire if applicable
function getPolityDisplayName(props) {
    const name = props.Name;
    const memberOf = props.MemberOf || '';

    // Parse MemberOf - it can contain multiple values separated by semicolons
    // e.g., "(Merovingian Empire);(Kingdom of the Franks)"
    const parents = memberOf.split(';').filter(p => p.trim());

    // Find the first parent that isn't a self-reference
    // Self-reference: "Roman Empire" memberOf "(Roman Empire)"
    for (const parent of parents) {
        const cleanParent = parent.trim().replace(/^\(|\)$/g, ''); // Strip parentheses
        if (cleanParent !== name) {
            return `${name} (${cleanParent})`;
        }
    }

    return name;
}

// Get full history of a point - all polities that ever controlled it
function getLocationHistory(lon, lat) {
    const history = [];
    const seen = new Set();

    // Sort polities by start year
    const sortedPolities = [...state.allPolities].sort((a, b) =>
        a.properties.FromYear - b.properties.FromYear
    );

    for (const polity of sortedPolities) {
        const props = polity.properties;

        // Skip parenthetical entries - these are composite/aggregate representations
        // We show the actual polities and include parent info via MemberOf
        if (props.Name.startsWith('(')) continue;

        if (pointInGeometry(lon, lat, polity.geometry)) {
            const key = `${props.Name}_${props.FromYear}_${props.ToYear}`;
            if (!seen.has(key)) {
                seen.add(key);
                history.push({
                    name: props.Name,
                    displayName: getPolityDisplayName(props),
                    fromYear: props.FromYear,
                    toYear: props.ToYear,
                    area: props.Area,
                    color: getColor(props.Name),
                    polity: polity
                });
            }
        }
    }

    // Sort by start year
    history.sort((a, b) => a.fromYear - b.fromYear);

    // Merge consecutive entries of the same polity
    // Allow small gaps (up to 5 years) to handle data fragmentation
    const merged = [];
    for (const entry of history) {
        const last = merged[merged.length - 1];
        if (last && last.name === entry.name && entry.fromYear <= last.toYear + 5) {
            // Extend the previous entry
            last.toYear = Math.max(last.toYear, entry.toYear);
        } else {
            // Start a new entry (copy to avoid mutating original)
            merged.push({ ...entry });
        }
    }

    return merged;
}

// Render the info panel content
function renderInfoPanel() {
    if (!state.selectedLocation) return;

    const panel = document.getElementById('info-panel');
    const year = state.currentYear;

    // Hide wiki button by default (will show if polity has Wikipedia)
    const wikiBtn = document.getElementById('info-wiki');
    if (wikiBtn) wikiBtn.style.display = 'none';

    let mainContent = '';
    let historyHtml = '';
    let locationHistory = [];

    if (state.selectedLocation.type === 'city') {
        // City selection - use unified stacked panel style
        const city = state.selectedLocation.city;
        const props = city.properties;
        const popData = getPopulationForYear(city, year);
        const [lon, lat] = city.geometry.coordinates;

        locationHistory = getLocationHistory(lon, lat);
        const containingPolity = getPolityAtPoint(lon, lat, year);

        panel.className = 'info-panel compound' + (state.infoPanelPinned ? ' pinned' : '');
        // Hide the default header elements (we use stacked panel headers)
        document.getElementById('info-name').textContent = '';
        document.getElementById('info-subtitle').textContent = '';

        state.currentInfoData = {
            type: 'city',
            name: props.name,
            otherName: props.otherName,
            currentYear: year,
            population: popData ? popData.pop : null,
            popStatus: popData ? popData.status : null,
            minYear: props.minYear,
            maxYear: props.maxYear,
            country: props.country,
            containingPolity: containingPolity ? containingPolity.properties.Name : null,
            coords: [lon, lat],
            history: locationHistory.filter(h => h.fromYear <= year)
        };

        // Action buttons for standalone
        const actionButtonsHtml = `
            <div class="stacked-actions">
                <button class="info-panel-btn" id="compound-copy" title="Copy info">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                </button>
                <button class="info-panel-btn info-panel-close" id="compound-close" title="Close">×</button>
            </div>
        `;

        mainContent += renderCityPanel(city, year, containingPolity, { expanded: true, showActions: true, actionButtonsHtml });

    } else if (state.selectedLocation.type === 'compound') {
        // Compound selection - show separate standalone panels stacked
        const city = state.selectedLocation.city;
        const river = state.selectedLocation.river;
        const connectedFeatures = state.selectedLocation.connectedFeatures;
        const [lon, lat] = state.selectedLocation.coords;

        // Get territory at this location
        const polity = getPolityAtPoint(lon, lat, year);
        locationHistory = getLocationHistory(lon, lat);

        panel.className = 'info-panel compound' + (state.infoPanelPinned ? ' pinned' : '');
        document.getElementById('info-name').textContent = '';
        document.getElementById('info-subtitle').textContent = '';

        // Action buttons HTML for compound panels
        const actionButtonsHtml = `
            <div class="stacked-actions">
                <button class="info-panel-btn" id="compound-copy" title="Copy info">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                </button>
                <button class="info-panel-btn info-panel-close" id="compound-close" title="Close">×</button>
            </div>
        `;

        // Get visible polities for river panel
        const visiblePolities = state.allPolities.filter(f => {
            const pName = f.properties.Name;
            if (pName.startsWith('(') && pName.endsWith(')')) return false;
            return year >= f.properties.FromYear && year <= f.properties.ToYear;
        });

        // Determine which component is expanded (if any)
        const expanded = state.expandedComponent;
        let isFirstPanel = true;

        // === CITY PANEL (if present) ===
        if (city) {
            const cityExpanded = expanded === 'city';
            mainContent += renderCityPanel(city, year, polity, {
                expanded: cityExpanded,
                showActions: isFirstPanel,
                actionButtonsHtml: isFirstPanel ? actionButtonsHtml : '',
                componentId: 'city'
            });
            isFirstPanel = false;
        }

        // === TERRITORY PANEL ===
        // For river-only HOVERS (no city), only show territory if there's a civilization at the point
        // For clicks, always show territory (even unclaimed)
        // Note: river panel already shows list of empires the river passes through
        const isRiverOnly = river && !city;
        const isHover = state.selectedLocation.isHover;
        const showTerritory = !isRiverOnly || polity || !isHover;

        if (showTerritory) {
            const territoryExpanded = expanded === 'territory';
            mainContent += renderTerritoryPanel(polity, year, {
                expanded: territoryExpanded,
                showActions: isFirstPanel,
                actionButtonsHtml: isFirstPanel ? actionButtonsHtml : '',
                componentId: 'territory'
            });
            isFirstPanel = false;
        }

        // === RIVER PANEL (if present) ===
        if (river && connectedFeatures) {
            const riverExpanded = expanded === 'river';
            mainContent += renderRiverPanel(river, connectedFeatures, year, visiblePolities, {
                expanded: riverExpanded,
                showActions: isFirstPanel,
                actionButtonsHtml: isFirstPanel ? actionButtonsHtml : '',
                componentId: 'river'
            });
        }

        // Store compound info data
        state.currentInfoData = {
            type: 'compound',
            city: city ? city.properties.name : null,
            polity: polity ? polity.properties.Name : null,
            river: river ? (river.properties.name || 'River') : null,
            currentYear: year,
            coords: [lon, lat],
            history: locationHistory.filter(h => h.fromYear <= year)
        };

    } else if (state.selectedLocation.type === 'river') {
        // River selection - use unified stacked panel style
        const river = state.selectedLocation.river;
        const connectedFeatures = state.selectedLocation.connectedFeatures || [river];

        panel.className = 'info-panel compound' + (state.infoPanelPinned ? ' pinned' : '');
        document.getElementById('info-name').textContent = '';
        document.getElementById('info-subtitle').textContent = '';

        // Get visible polities
        const visiblePolities = state.allPolities.filter(f => {
            const pName = f.properties.Name;
            if (pName.startsWith('(') && pName.endsWith(')')) return false;
            return year >= f.properties.FromYear && year <= f.properties.ToYear;
        });

        // Get river name for currentInfoData
        let name = 'Unknown River';
        for (const f of connectedFeatures) {
            const n = f.properties.name || f.properties.NAME || f.properties.name_en;
            if (n && f.properties.featurecla !== 'Lake Centerline') { name = n; break; }
        }
        if (name === 'Unknown River') {
            name = river.properties.name || river.properties.NAME || river.properties.name_en || 'Unknown River';
        }

        let totalLength = 0;
        for (const f of connectedFeatures) totalLength += calculateRiverLength(f.geometry);
        const endpoints = getSystemEndpoints(connectedFeatures);

        const politySet = new Map();
        for (const f of connectedFeatures) {
            const polities = getRiverPolities(f.geometry, visiblePolities);
            for (const p of polities) if (!politySet.has(p.name)) politySet.set(p.name, p);
        }
        const riverPolities = Array.from(politySet.values());

        state.currentInfoData = {
            type: 'river',
            name: name,
            featureClass: river.properties.featurecla || 'River',
            currentYear: year,
            length: totalLength,
            polities: riverPolities,
            endpoints: endpoints,
            segmentCount: connectedFeatures.length
        };

        // Action buttons
        const actionButtonsHtml = `
            <div class="stacked-actions">
                <button class="info-panel-btn" id="compound-copy" title="Copy info">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                </button>
                <button class="info-panel-btn info-panel-close" id="compound-close" title="Close">×</button>
            </div>
        `;

        mainContent += renderRiverPanel(river, connectedFeatures, year, visiblePolities, {
            expanded: true,
            showActions: true,
            actionButtonsHtml
        });

    } else {
        // Point/territory selection - use unified stacked panel style
        const [lon, lat] = state.selectedLocation.coords;
        const polity = getPolityAtPoint(lon, lat, year);

        locationHistory = getLocationHistory(lon, lat);

        panel.className = 'info-panel compound' + (state.infoPanelPinned ? ' pinned' : '');
        document.getElementById('info-name').textContent = '';
        document.getElementById('info-subtitle').textContent = '';

        if (polity) {
            const props = polity.properties;
            const foundingYear = state.polityFoundingYears[props.Name] ?? props.FromYear;
            const polityObj = { geometry: polity.geometry, properties: props };
            const cities = getCitiesInPolity(polityObj, year);
            const totalUrbanPop = cities.reduce((sum, c) => sum + c.pop, 0);

            state.currentInfoData = {
                type: 'polity',
                name: props.Name,
                currentYear: year,
                foundingYear: foundingYear,
                fromYear: props.FromYear,
                toYear: props.ToYear,
                age: year - foundingYear,
                area: props.Area,
                cities: cities,
                urbanPop: totalUrbanPop,
                wikipedia: props.Wikipedia,
                coords: [lon, lat],
                history: locationHistory.filter(h => h.fromYear <= year)
            };
        } else {
            const pastPolities = locationHistory.filter(h => h.toYear < year);
            const lastPolity = pastPolities[pastPolities.length - 1];
            const pastHistoryFiltered = locationHistory.filter(h => h.fromYear <= year);

            state.currentInfoData = {
                type: 'unclaimed',
                currentYear: year,
                coords: [lon, lat],
                lastPolity: lastPolity,
                history: pastHistoryFiltered
            };
        }

        // Action buttons
        const actionButtonsHtml = `
            <div class="stacked-actions">
                <button class="info-panel-btn" id="compound-copy" title="Copy info">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                </button>
                <button class="info-panel-btn info-panel-close" id="compound-close" title="Close">×</button>
            </div>
        `;

        mainContent += renderTerritoryPanel(polity, year, {
            expanded: true,
            showActions: true,
            actionButtonsHtml
        });
    }

    // Build history timeline section - only show civilizations up to current year
    const pastHistory = locationHistory.filter(h => h.fromYear <= year);
    // All panels now use stacked styling, so always wrap history in a panel
    const useStackedHistory = true;

    // Find the previous empire (the one before the current controlling empire)
    // Current empire is the one where year is between fromYear and toYear
    const currentEmpire = pastHistory.find(h => year >= h.fromYear && year <= h.toYear);
    let previousEmpire = null;

    if (currentEmpire) {
        // Find the empire that ended most recently before the current one started
        const priorEmpires = pastHistory.filter(h => h.toYear < currentEmpire.fromYear);
        if (priorEmpires.length > 0) {
            previousEmpire = priorEmpires[priorEmpires.length - 1]; // Last one (most recent)
        }
    } else if (pastHistory.length > 0) {
        // No current empire - the previous is the most recent one that ended
        const endedEmpires = pastHistory.filter(h => h.toYear < year);
        if (endedEmpires.length > 0) {
            previousEmpire = endedEmpires[endedEmpires.length - 1];
        }
    }

    if (pastHistory.length > 0) {
        const expandedClass = state.historyExpanded ? 'expanded' : '';

        // Build "Previously" section
        let previouslyHtml = '';
        if (currentEmpire) {
            if (previousEmpire) {
                previouslyHtml = `
                    <div class="info-previously-section">
                        <div class="previously-header">Previously</div>
                        <div class="info-previously" data-from="${previousEmpire.fromYear}" data-to="${previousEmpire.toYear}">
                            <span class="previously-marker" style="background: ${previousEmpire.color}"></span>
                            <span class="previously-name">${previousEmpire.displayName}</span>
                            <span class="previously-period">${formatYear(previousEmpire.fromYear)} – ${formatYear(previousEmpire.toYear)}</span>
                        </div>
                    </div>
                `;
            } else {
                previouslyHtml = `
                    <div class="info-previously-section">
                        <div class="previously-header">Previously</div>
                        <div class="info-previously unclaimed">
                            <span class="previously-name">Unclaimed territory</span>
                        </div>
                    </div>
                `;
            }
        }

        // Build the history content
        const historyContent = `
            ${previouslyHtml}
            <div class="info-history ${expandedClass}">
                <div class="info-history-header" id="history-toggle">
                    <span class="info-section-title">Location History</span>
                    <span class="history-count">${pastHistory.length} civilization${pastHistory.length > 1 ? 's' : ''}</span>
                    <span class="history-chevron">▼</span>
                </div>
                <div class="info-history-content">
                    <div class="history-timeline">
                        ${[...pastHistory].reverse().map(h => {
                            const isCurrent = state.currentYear >= h.fromYear && state.currentYear <= h.toYear;
                            // Don't show future end dates - cap at current year or use "present"
                            const displayToYear = h.toYear > year ? year : h.toYear;
                            const isOngoing = h.toYear > year;
                            const duration = displayToYear - h.fromYear;
                            return `
                                <div class="history-item ${isCurrent ? 'current' : ''}" data-from="${h.fromYear}" data-to="${h.toYear}">
                                    <div class="history-marker" style="background: ${h.color}"></div>
                                    <div class="history-details">
                                        <div class="history-name">${h.displayName}</div>
                                        <div class="history-period">${formatYear(h.fromYear)} – ${isOngoing ? 'Present' : formatYear(displayToYear)}</div>
                                    </div>
                                    <div class="history-duration">${duration} yrs</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;

        // Always wrap in stacked panel for consistent styling
        if (useStackedHistory) {
            historyHtml = `
                <div class="info-stacked-panel history-panel">
                    <div class="stacked-content" style="padding-top: 14px;">
                        ${historyContent}
                    </div>
                </div>
            `;
        } else {
            historyHtml = historyContent;
        }
    }

    document.getElementById('info-content').innerHTML = mainContent + historyHtml;
    panel.style.display = 'block';

    // Add event listeners for jump buttons
    document.querySelectorAll('.info-jump-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const year = parseInt(btn.dataset.year);
            jumpToYear(year);
        });
    });

    // Add event listener for history toggle
    const historyToggle = document.getElementById('history-toggle');
    if (historyToggle) {
        historyToggle.addEventListener('click', () => {
            state.historyExpanded = !state.historyExpanded;
            document.querySelector('.info-history').classList.toggle('expanded', state.historyExpanded);
        });
    }

    // Add event listeners for history items
    document.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const fromYear = parseInt(item.dataset.from);
            const empireName = item.querySelector('.history-name')?.textContent || 'Unknown';
            const empireColor = item.querySelector('.history-marker')?.style.background || '#4da6ff';
            jumpToYear(fromYear, { empireName, empireColor });
        });
    });

    // Add event listener for "Previously" section (click to jump to that era)
    const previouslySection = document.querySelector('.info-previously[data-from]');
    if (previouslySection) {
        previouslySection.addEventListener('click', (e) => {
            e.stopPropagation();
            const fromYear = parseInt(previouslySection.dataset.from);
            const empireName = previouslySection.querySelector('.previously-name')?.textContent || 'Unknown';
            const empireColor = previouslySection.querySelector('.previously-marker')?.style.background || '#4da6ff';
            jumpToYear(fromYear, { empireName, empireColor });
        });
    }

    // Add event listener for cities toggle
    const citiesToggle = document.getElementById('cities-toggle');
    if (citiesToggle) {
        citiesToggle.addEventListener('click', () => {
            state.citiesExpanded = !state.citiesExpanded;
            document.querySelector('.info-cities-section').classList.toggle('expanded', state.citiesExpanded);
        });
    }

    // Add event listeners for city items (click to navigate)
    document.querySelectorAll('.info-city-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const lon = parseFloat(item.dataset.lon);
            const lat = parseFloat(item.dataset.lat);
            const cityName = item.dataset.name;
            if (state.map) {
                state.map.setView([lat, lon], Math.max(state.map.getZoom(), 6));
                highlightCity(lat, lon, cityName);
            }
        });
    });

    // Add event listeners for polity items in river panel (click to navigate)
    document.querySelectorAll('.info-polity-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const polityName = item.dataset.name;
            // Find the polity and navigate to its centroid
            const polity = state.allPolities.find(p =>
                p.properties.Name === polityName &&
                state.currentYear >= p.properties.FromYear &&
                state.currentYear <= p.properties.ToYear
            );
            if (polity && state.map) {
                // Calculate centroid
                let coords;
                if (polity.geometry.type === 'Polygon') {
                    coords = polity.geometry.coordinates[0];
                } else if (polity.geometry.type === 'MultiPolygon') {
                    coords = polity.geometry.coordinates[0][0];
                }
                if (coords) {
                    const lon = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
                    const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
                    state.map.setView([lat, lon], Math.max(state.map.getZoom(), 5));
                }
            }
        });
    });

    // Add event listeners for coordinate links (river source/mouth)
    document.querySelectorAll('.info-coord-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            const lon = parseFloat(link.dataset.lon);
            const lat = parseFloat(link.dataset.lat);
            if (state.map && !isNaN(lon) && !isNaN(lat)) {
                state.map.setView([lat, lon], Math.max(state.map.getZoom(), 8));
            }
        });
    });

    // Show crosshair and fetch modern country/ocean info for point selections (clicks only, not hover)
    if (state.selectedLocation && state.selectedLocation.type === 'point' && !state.selectedLocation.isHover) {
        const [lon, lat] = state.selectedLocation.coords;
        showCrosshair(lon, lat);
        updateModernLocation(lon, lat);
    } else {
        // Hide crosshair for non-point selections (cities, rivers) or hover
        hideCrosshair();
    }

    // Add event listeners for expand buttons in compound view
    document.querySelectorAll('.panel-expand-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const componentId = btn.dataset.component;
            // Toggle: if already expanded, collapse; otherwise expand this one
            if (state.expandedComponent === componentId) {
                state.expandedComponent = null;
            } else {
                state.expandedComponent = componentId;
            }
            // Re-render the panel
            renderInfoPanel();
        });
    });

    // Also allow clicking on collapsed panel header to expand
    document.querySelectorAll('.info-stacked-panel:not(.expanded) .stacked-header').forEach(header => {
        const panel = header.closest('.info-stacked-panel');
        const componentId = panel?.dataset.component;
        if (componentId && state.selectedLocation?.type === 'compound') {
            header.style.cursor = 'pointer';
            header.addEventListener('click', (e) => {
                // Don't expand if clicking on action buttons
                if (e.target.closest('.stacked-actions')) return;
                e.stopPropagation();
                state.expandedComponent = componentId;
                renderInfoPanel();
            });
        }
    });

    // Add event listeners for compound panel buttons
    const compoundClose = document.getElementById('compound-close');
    if (compoundClose) {
        compoundClose.addEventListener('click', unpinInfoPanel);
    }
    const compoundCopy = document.getElementById('compound-copy');
    if (compoundCopy) {
        compoundCopy.addEventListener('click', copyInfoToClipboard);
    }
}

// Highlight a city on the map with a pulse effect
function highlightCity(lat, lon, name) {
    // Remove any existing highlight
    if (state.cityHighlight) {
        state.map.removeLayer(state.cityHighlight);
        state.cityHighlight = null;
    }

    // Create a pulsing circle marker
    const highlight = L.circleMarker([lat, lon], {
        radius: 20,
        color: '#e94560',
        weight: 3,
        opacity: 1,
        fillColor: '#e94560',
        fillOpacity: 0.3,
        className: 'city-highlight-pulse'
    }).addTo(state.map);

    state.cityHighlight = highlight;

    // Remove after animation completes
    setTimeout(() => {
        if (state.cityHighlight === highlight) {
            state.map.removeLayer(highlight);
            state.cityHighlight = null;
        }
    }, 2000);
}

// Jump to a specific year
// jumpInfo: optional { empireName, empireColor } for tracking history jumps
function jumpToYear(year, jumpInfo = null) {
    const previousYear = state.currentYear;
    const timeline = document.getElementById('timeline');
    timeline.value = year;

    // Trigger the map update
    if (window.updateMapWithGraph) {
        window.updateMapWithGraph(year);
    }

    // Update year input
    const input = document.getElementById('year-input');
    const select = document.getElementById('era-select');
    if (year < 0) {
        input.value = Math.abs(year);
        select.value = 'bce';
    } else {
        input.value = year;
        select.value = 'ce';
    }

    // Track timeline jump if this is from location history
    if (jumpInfo) {
        state.timelineJump = {
            fromYear: previousYear,
            toYear: year,
            empireName: jumpInfo.empireName,
            empireColor: jumpInfo.empireColor
        };
        showTimelineJumpIndicator();
    }
}

// Show the timeline jump indicator
function showTimelineJumpIndicator() {
    let indicator = document.getElementById('timeline-jump-indicator');

    // Create indicator if it doesn't exist
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'timeline-jump-indicator';
        indicator.className = 'timeline-jump-indicator';
        document.body.appendChild(indicator);
    }

    const jump = state.timelineJump;
    if (!jump) {
        indicator.classList.remove('visible');
        return;
    }

    indicator.innerHTML = `
        <div class="jump-indicator-content">
            <div class="jump-indicator-marker" style="background: ${jump.empireColor}"></div>
            <div class="jump-indicator-text">
                <span class="jump-indicator-label">Viewing</span>
                <span class="jump-indicator-empire">${jump.empireName}</span>
            </div>
            <button class="jump-indicator-return" title="Return to ${formatYear(jump.fromYear)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Return
            </button>
            <button class="jump-indicator-close" title="Dismiss">×</button>
        </div>
    `;

    // Add event listeners
    indicator.querySelector('.jump-indicator-return').addEventListener('click', () => {
        const returnYear = state.timelineJump?.fromYear;
        state.timelineJump = null;
        hideTimelineJumpIndicator();
        if (returnYear !== undefined) {
            jumpToYear(returnYear);
        }
    });

    indicator.querySelector('.jump-indicator-close').addEventListener('click', () => {
        state.timelineJump = null;
        hideTimelineJumpIndicator();
    });

    // Show with animation
    requestAnimationFrame(() => {
        indicator.classList.add('visible');
    });
}

// Hide the timeline jump indicator
function hideTimelineJumpIndicator() {
    const indicator = document.getElementById('timeline-jump-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
    }
}

// Show the location jump indicator (for leaderboard navigation)
function showLocationJumpIndicator() {
    let indicator = document.getElementById('location-jump-indicator');

    // Create indicator if it doesn't exist
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'location-jump-indicator';
        indicator.className = 'location-jump-indicator';
        document.body.appendChild(indicator);
    }

    const history = state.locationHistory;
    if (!history || history.length === 0) {
        indicator.classList.remove('visible');
        return;
    }

    // Get the current location (last in history) for display
    const current = history[history.length - 1];
    // Steps back = history length minus 1 (the starting point doesn't count as a step)
    const stepsBack = history.length - 1;

    indicator.innerHTML = `
        <div class="jump-indicator-content">
            <div class="jump-indicator-marker" style="background: ${current.territoryColor}"></div>
            <div class="jump-indicator-text">
                <span class="jump-indicator-label">Viewing</span>
                <span class="jump-indicator-empire">${current.territoryName}</span>
            </div>
            <button class="jump-indicator-return" title="Return to previous location">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back${stepsBack > 1 ? ` (${stepsBack})` : ''}
            </button>
            <button class="jump-indicator-close" title="Clear history">×</button>
        </div>
    `;

    // Add event listeners
    indicator.querySelector('.jump-indicator-return').addEventListener('click', () => {
        if (state.locationHistory.length > 1) {
            // Pop the current location off the stack
            state.locationHistory.pop();

            // Navigate to the previous location (now the last item)
            const previous = state.locationHistory[state.locationHistory.length - 1];
            state.map.setView(previous.coords, previous.zoom);

            // If we're back at the starting point (only 1 item left), clear history
            if (state.locationHistory.length === 1) {
                state.locationHistory = [];
                hideLocationJumpIndicator();
            } else {
                // Update the indicator to show new current
                showLocationJumpIndicator();
            }
        }
    });

    indicator.querySelector('.jump-indicator-close').addEventListener('click', () => {
        state.locationHistory = [];
        hideLocationJumpIndicator();
    });

    // Show with animation
    requestAnimationFrame(() => {
        indicator.classList.add('visible');
    });
}

// Hide the location jump indicator
function hideLocationJumpIndicator() {
    const indicator = document.getElementById('location-jump-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
    }
}

// Export for use in other modules if needed
export { hideTimelineJumpIndicator, showLocationJumpIndicator, hideLocationJumpIndicator };

export function showPolityInfo(props, geometry, clickLon, clickLat) {
    // Never update on hover if panel is pinned
    if (state.infoPanelPinned) {
        return;
    }

    // Don't override city/river hover info
    if (state.hoverPriority) {
        return;
    }

    // Determine coordinates - use click coords if provided, otherwise calculate centroid
    let lon, lat;
    const isClick = clickLon !== undefined && clickLat !== undefined;

    if (isClick) {
        lon = clickLon;
        lat = clickLat;
    } else if (geometry.type === 'Polygon') {
        const coords = geometry.coordinates[0];
        lon = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
        lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
    } else if (geometry.type === 'MultiPolygon') {
        const coords = geometry.coordinates[0][0];
        lon = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
        lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;
    }

    state.selectedLocation = {
        type: 'point',
        coords: [lon, lat],
        isHover: !isClick  // Flag to indicate hover vs click
    };

    renderInfoPanel();
}

export function showCityInfo(props, popData) {
    // Never update on hover if panel is pinned
    if (state.infoPanelPinned) {
        return;
    }

    // Find the full city object
    const city = state.allCities.find(c =>
        c.properties.name === props.name &&
        c.properties.minYear === props.minYear
    );

    state.selectedLocation = {
        type: 'city',
        coords: city ? city.geometry.coordinates : [0, 0],
        city: city
    };

    renderInfoPanel();
}

export function hideInfo() {
    if (state.infoPanelPinned) return;
    // Don't hide if a city/river is being hovered
    if (state.hoverPriority) return;
    document.getElementById('info-panel').style.display = 'none';
}

// Show info for any point on the map (clicked on empty area)
export function showPointInfo(lon, lat) {
    state.selectedLocation = {
        type: 'point',
        coords: [lon, lat]
    };

    renderInfoPanel();
    pinInfoPanel();
}

// Show info for a river (or connected river system)
export function showRiverInfo(feature, connectedFeatures = null) {
    // Never update on hover if panel is pinned
    if (state.infoPanelPinned) {
        return;
    }

    // Use connected features if provided, otherwise just the single feature
    const features = connectedFeatures && connectedFeatures.length > 0 ? connectedFeatures : [feature];

    // Calculate combined endpoints from the full system
    const systemEndpoints = getSystemEndpoints(features);
    const midpoint = systemEndpoints.source ? [
        (systemEndpoints.source[0] + (systemEndpoints.mouth ? systemEndpoints.mouth[0] : systemEndpoints.source[0])) / 2,
        (systemEndpoints.source[1] + (systemEndpoints.mouth ? systemEndpoints.mouth[1] : systemEndpoints.source[1])) / 2
    ] : [0, 0];

    state.selectedLocation = {
        type: 'river',
        coords: midpoint,
        river: feature,
        connectedFeatures: features
    };

    renderInfoPanel();
}

// Get combined endpoints for a river system (finds the two most distant points)
function getSystemEndpoints(features) {
    if (features.length === 1) {
        return getRiverEndpoints(features[0].geometry);
    }

    // Collect all endpoints from all features
    const allEndpoints = [];
    for (const f of features) {
        const ep = getRiverEndpoints(f.geometry);
        if (ep.source) allEndpoints.push(ep.source);
        if (ep.mouth) allEndpoints.push(ep.mouth);
    }

    if (allEndpoints.length < 2) {
        return { source: allEndpoints[0] || null, mouth: null };
    }

    // Find the two most distant points (approximation of source and mouth)
    let maxDist = 0;
    let source = allEndpoints[0];
    let mouth = allEndpoints[1];

    for (let i = 0; i < allEndpoints.length; i++) {
        for (let j = i + 1; j < allEndpoints.length; j++) {
            const dx = allEndpoints[j][0] - allEndpoints[i][0];
            const dy = allEndpoints[j][1] - allEndpoints[i][1];
            const dist = dx * dx + dy * dy;
            if (dist > maxDist) {
                maxDist = dist;
                source = allEndpoints[i];
                mouth = allEndpoints[j];
            }
        }
    }

    return { source, mouth };
}

// Show compound info panel (city + territory + river combined)
// If isHover is true, don't update selection state (just show preview)
export function showCompoundInfo({ city = null, coords = null, river = null, connectedFeatures = null, isHover = false }) {
    // Safety check: never update panel on hover if already pinned
    if (isHover && state.infoPanelPinned) {
        return;
    }

    // Determine coordinates - prioritize: provided coords > city coords > river midpoint
    let lon, lat;
    if (coords) {
        // Use provided coordinates (e.g., hover position)
        [lon, lat] = coords;
    } else if (city) {
        [lon, lat] = city.geometry.coordinates;
    } else if (river && connectedFeatures) {
        // Fallback to river midpoint if no coords provided
        const systemEndpoints = getSystemEndpoints(connectedFeatures);
        if (systemEndpoints.source) {
            lon = (systemEndpoints.source[0] + (systemEndpoints.mouth ? systemEndpoints.mouth[0] : systemEndpoints.source[0])) / 2;
            lat = (systemEndpoints.source[1] + (systemEndpoints.mouth ? systemEndpoints.mouth[1] : systemEndpoints.source[1])) / 2;
        }
    }

    // Set up compound selection state
    state.selectedLocation = {
        type: 'compound',
        coords: [lon, lat],
        city: city,
        river: river,
        connectedFeatures: connectedFeatures || (river ? [river] : null),
        isHover: isHover
    };

    if (!isHover) {
        // Only set selection state when clicking (not hovering)
        state.selectedCity = city;
        state.selectedCoords = [lon, lat];
        if (river) {
            state.selectedRiver = river;
            state.selectedRiverSystem = connectedFeatures || [river];
        }
    }

    renderInfoPanel();
}

export function pinInfoPanel() {
    const panel = document.getElementById('info-panel');
    state.infoPanelPinned = true;
    panel.classList.add('pinned');
}

export function unpinInfoPanel() {
    const panel = document.getElementById('info-panel');

    // Reset river highlighting before clearing state
    if (window.resetRiverSelection) {
        window.resetRiverSelection();
    }

    // Reset city highlighting
    if (window.resetCitySelection) {
        window.resetCitySelection();
    }

    // Reset polity highlighting
    if (state.selectedPolityLayer && state.polityLayer) {
        state.polityLayer.resetStyle(state.selectedPolityLayer);
        state.selectedPolityLayer = null;
    }

    state.infoPanelPinned = false;
    state.selectedLocation = null;
    state.selectedCity = null;
    state.selectedCoords = null;
    state.selectedRiver = null;
    state.selectedRiverSystem = null;
    state.historyExpanded = false;
    state.expandedComponent = null;
    panel.classList.remove('pinned');
    panel.style.display = 'none';
    state.currentInfoData = null;
    hideCrosshair();

    // Clear location history when selection is cleared
    if (state.locationHistory.length > 0) {
        state.locationHistory = [];
        hideLocationJumpIndicator();
    }
}

// Called when timeline changes to update pinned panel
export function updateInfoPanel() {
    if (state.infoPanelPinned && state.selectedLocation) {
        renderInfoPanel();
    }
}

export function copyInfoToClipboard() {
    if (!state.currentInfoData) return;

    let text = '';
    const data = state.currentInfoData;

    if (data.type === 'polity') {
        text = `I'm looking at ${data.name} in the year ${formatYear(data.currentYear)}.\n\n`;
        text += `EMPIRE DETAILS:\n`;
        text += `- Name: ${data.name}\n`;
        text += `- Current viewing year: ${formatYear(data.currentYear)}\n`;
        text += `- Founded: ${formatYear(data.foundingYear)}\n`;
        text += `- Current borders: ${formatYear(data.fromYear)} – ${formatYear(data.toYear)}\n`;
        text += `- Age at viewing year: ${data.age} years\n`;
        text += `- Territory: ${Math.round(data.area).toLocaleString()} km²\n`;
        text += `- Cities: ${data.cities.length}\n`;
        text += `- Urban population: ${data.urbanPop.toLocaleString()}\n`;
        if (data.cities.length > 0) {
            text += `\nMAJOR CITIES:\n`;
            for (const city of data.cities) {
                text += `- ${city.name} (pop: ${city.pop.toLocaleString()})\n`;
            }
        }
        if (data.wikipedia) {
            text += `\nWikipedia: https://en.wikipedia.org/wiki/${encodeURIComponent(data.wikipedia)}\n`;
        }
    } else if (data.type === 'city') {
        text = `I'm looking at the city of ${data.name} in the year ${formatYear(data.currentYear)}.\n\n`;
        text += `CITY DETAILS:\n`;
        text += `- Name: ${data.name}`;
        if (data.otherName) text += ` (also known as: ${data.otherName})`;
        text += `\n`;
        text += `- Current viewing year: ${formatYear(data.currentYear)}\n`;
        if (data.population) {
            text += `- Population at this time: ${data.population.toLocaleString()}\n`;
        }
        text += `- First recorded: ${formatYear(data.minYear)}\n`;
        if (data.containingPolity) {
            text += `- Controlling empire: ${data.containingPolity}\n`;
        }
    } else if (data.type === 'unclaimed') {
        text = `I'm looking at an unclaimed territory in the year ${formatYear(data.currentYear)}.\n\n`;
        text += `LOCATION: ${data.coords[1].toFixed(4)}°, ${data.coords[0].toFixed(4)}°\n`;
        if (data.lastPolity) {
            text += `\nPreviously controlled by: ${data.lastPolity.displayName} (ended ${formatYear(data.lastPolity.toYear)})\n`;
        }
    } else if (data.type === 'river') {
        text = `I'm looking at the ${data.name} in the year ${formatYear(data.currentYear)}.\n\n`;
        text += `RIVER DETAILS:\n`;
        text += `- Name: ${data.name}\n`;
        text += `- Type: ${data.featureClass}\n`;
        text += `- Length: ~${data.length.toLocaleString()} km\n`;
        text += `- Current viewing year: ${formatYear(data.currentYear)}\n`;
        if (data.endpoints.source) {
            text += `- Source region: ${formatCoordinate(data.endpoints.source[0], data.endpoints.source[1])}\n`;
        }
        if (data.endpoints.mouth) {
            text += `- Mouth region: ${formatCoordinate(data.endpoints.mouth[0], data.endpoints.mouth[1])}\n`;
        }
        if (data.polities && data.polities.length > 0) {
            text += `\nEMPIRES ALONG THIS RIVER (${data.polities.length}):\n`;
            for (const pol of data.polities) {
                text += `- ${pol.name}\n`;
            }
        }
    }

    // Add location history
    if (data.history && data.history.length > 0) {
        text += `\nLOCATION HISTORY (${data.history.length} civilizations):\n`;
        for (const h of data.history) {
            const duration = h.toYear - h.fromYear;
            text += `- ${h.displayName}: ${formatYear(h.fromYear)} – ${formatYear(h.toYear)} (${duration} years)\n`;
        }
    }

    text += `\nPlease tell me more about this location's history and the civilizations that controlled it.`;

    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('info-copy');
        btn.classList.add('copied');
        btn.innerHTML = '✓';
        setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="2" width="9" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
        }, 1500);
    });
}

export function setupInfoPanel() {
    document.getElementById('info-close').addEventListener('click', unpinInfoPanel);
    document.getElementById('info-copy').addEventListener('click', copyInfoToClipboard);
}
