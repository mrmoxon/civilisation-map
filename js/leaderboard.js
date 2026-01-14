// Leaderboard rendering and sorting
import { state } from './state.js';
import { getColor, formatArea, formatAge, formatBillions, getWorldStatsForYear, countCitiesInPolity } from './utils.js';
import { showPointInfo, showLocationJumpIndicator } from './info-panel.js';

// Update stats panel separately
export function updateStatsPanel(visiblePolities, year) {
    const content = document.getElementById('stats-panel-content');
    if (!content) return;

    const stats = getWorldStatsForYear(year);
    const uniqueNames = new Set(visiblePolities.map(p => p.properties.Name));
    const civCount = uniqueNames.size;

    const cityCount = state.allCities.filter(city => {
        const fromYear = city.properties.FromYear || -10000;
        const toYear = city.properties.ToYear || 2100;
        return year >= fromYear && year <= toYear;
    }).length;

    const totalGdp = stats ? (stats.population * stats.gdp_per_capita / 1000) : null;

    let html = '<div class="leaderboard-stats">';
    html += `<div class="leaderboard-stat">
        <div class="leaderboard-stat-value">${stats ? stats.population + 'M' : '—'}</div>
        <div class="leaderboard-stat-label">World Pop</div>
    </div>`;
    html += `<div class="leaderboard-stat">
        <div class="leaderboard-stat-value">${stats ? '$' + stats.gdp_per_capita : '—'}</div>
        <div class="leaderboard-stat-label">GDP/capita</div>
    </div>`;
    html += `<div class="leaderboard-stat">
        <div class="leaderboard-stat-value">${totalGdp ? formatBillions(totalGdp) : '—'}</div>
        <div class="leaderboard-stat-label">World GDP</div>
    </div>`;
    html += `<div class="leaderboard-stat">
        <div class="leaderboard-stat-value">${cityCount}</div>
        <div class="leaderboard-stat-label">Cities</div>
    </div>`;
    html += `<div class="leaderboard-stat">
        <div class="leaderboard-stat-value">${civCount}</div>
        <div class="leaderboard-stat-label">Civilizations</div>
    </div>`;
    html += '</div>';

    content.innerHTML = html;
}

// Position leaderboard based on stats panel visibility
export function updateLeaderboardPosition() {
    const statsPanel = document.getElementById('stats-panel');
    const leaderboard = document.getElementById('leaderboard');
    if (!statsPanel || !leaderboard) return;

    const statsVisible = !statsPanel.classList.contains('hidden');
    const leaderboardVisible = !leaderboard.classList.contains('hidden');

    // Get base offset (accounts for controls at top and edge offset)
    const controlsAtTop = document.body.classList.contains('controls-at-top');
    const edgeOffsetFurther = document.body.classList.contains('edge-offset-further');
    const controlsWrapper = document.getElementById('controls-wrapper');
    let baseOffset = 10;

    if (controlsAtTop && controlsWrapper) {
        // When collapsed, only the tab bar (36px) is visible
        const isCollapsed = controlsWrapper.classList.contains('collapsed');
        const visibleHeight = isCollapsed ? 36 : controlsWrapper.offsetHeight;
        // Add extra offset if "Further" is enabled and collapsed
        const edgeExtra = (edgeOffsetFurther && isCollapsed) ? 14 : 0;
        baseOffset = visibleHeight + 10 + edgeExtra;
    }

    if (statsVisible && leaderboardVisible) {
        // Position stats at base offset, leaderboard below stats
        statsPanel.style.top = baseOffset + 'px';
        const statsHeight = statsPanel.offsetHeight;
        leaderboard.style.top = (baseOffset + statsHeight) + 'px';
        statsPanel.style.borderBottomLeftRadius = '0';
        statsPanel.style.borderBottomRightRadius = '0';
        leaderboard.style.borderTopLeftRadius = '0';
        leaderboard.style.borderTopRightRadius = '0';
    } else if (statsVisible) {
        statsPanel.style.top = baseOffset + 'px';
        statsPanel.style.borderBottomLeftRadius = '';
        statsPanel.style.borderBottomRightRadius = '';
    } else if (leaderboardVisible) {
        leaderboard.style.top = baseOffset + 'px';
        leaderboard.style.borderTopLeftRadius = '';
        leaderboard.style.borderTopRightRadius = '';
    } else {
        // Reset positions
        leaderboard.style.top = baseOffset + 'px';
        statsPanel.style.top = baseOffset + 'px';
        statsPanel.style.borderBottomLeftRadius = '';
        statsPanel.style.borderBottomRightRadius = '';
        leaderboard.style.borderTopLeftRadius = '';
        leaderboard.style.borderTopRightRadius = '';
    }
}

export function updateLeaderboard(visiblePolities, year) {
    const content = document.getElementById('leaderboard-content');

    // Also update stats panel
    updateStatsPanel(visiblePolities, year);
    updateLeaderboardPosition();

    if (visiblePolities.length === 0) {
        content.innerHTML = '<div class="leaderboard-empty">No civilizations at this time</div>';
        return;
    }

    const polityData = visiblePolities.map(p => {
        // Use founding year lookup for actual empire age (not just since border change)
        const foundingYear = state.polityFoundingYears[p.properties.Name] ?? p.properties.FromYear;
        const age = year - foundingYear;
        const cityCount = countCitiesInPolity(p, state.allCities, year);
        return {
            name: p.properties.Name,
            area: p.properties.Area || 0,
            cities: cityCount,
            age: age,
            color: getColor(p.properties.Name),
            geometry: p.geometry
        };
    });

    const aggregated = {};
    for (const p of polityData) {
        if (!aggregated[p.name]) {
            aggregated[p.name] = { ...p };
        } else {
            aggregated[p.name].area += p.area;
            aggregated[p.name].cities += p.cities;
            aggregated[p.name].age = Math.max(aggregated[p.name].age, p.age);
        }
    }

    const polities = Object.values(aggregated);

    // Compute ranks for each metric
    const byArea = [...polities].sort((a, b) => b.area - a.area);
    const byCities = [...polities].sort((a, b) => b.cities - a.cities);
    const byAge = [...polities].sort((a, b) => b.age - a.age);

    // Add rank info to each polity
    polities.forEach(p => {
        p.rankArea = byArea.findIndex(x => x.name === p.name) + 1;
        p.rankCities = byCities.findIndex(x => x.name === p.name) + 1;
        p.rankAge = byAge.findIndex(x => x.name === p.name) + 1;
    });

    // Sort based on current selection
    if (state.leaderboardSort === 'area') {
        polities.sort((a, b) => a.rankArea - b.rankArea);
    } else if (state.leaderboardSort === 'cities') {
        polities.sort((a, b) => a.rankCities - b.rankCities);
    } else if (state.leaderboardSort === 'age') {
        polities.sort((a, b) => a.rankAge - b.rankAge);
    }
    // For 'all', sort by area as default

    const valueFormatter = {
        area: p => formatArea(p.area),
        cities: p => p.cities,
        age: p => formatAge(p.age)
    };

    const allPolities = polities; // Load all territories
    const expandedClass = state.leaderboardExpanded ? 'expanded' : '';

    let listHtml;
    if (state.leaderboardSort === 'all') {
        // "All" view with columns
        listHtml = allPolities.map(p => `
            <div class="leaderboard-item leaderboard-item-all" data-name="${p.name}" style="--polity-color: ${p.color}">
                <span class="leaderboard-name" title="${p.name}">${p.name}</span>
                <div class="leaderboard-ranks">
                    <span class="leaderboard-rank-cell" title="Area: ${formatArea(p.area)}">#${p.rankArea}</span>
                    <span class="leaderboard-rank-cell" title="Cities: ${p.cities}">#${p.rankCities}</span>
                    <span class="leaderboard-rank-cell" title="Age: ${formatAge(p.age)}">#${p.rankAge}</span>
                </div>
            </div>
        `).join('');
    } else {
        // Single metric view
        listHtml = allPolities.map((p, i) => `
            <div class="leaderboard-item" data-name="${p.name}" style="--polity-color: ${p.color}">
                <span class="leaderboard-rank">${i + 1}</span>
                <span class="leaderboard-name" title="${p.name}">${p.name}</span>
                <span class="leaderboard-value">${valueFormatter[state.leaderboardSort](p)}</span>
            </div>
        `).join('');
    }

    const showMoreBtn = allPolities.length > 5 ? `
        <div class="leaderboard-toggle" id="leaderboard-expand">
            <span class="leaderboard-toggle-text">${state.leaderboardExpanded ? 'Show less' : `Show ${allPolities.length - 5} more`}</span>
            <span class="leaderboard-toggle-chevron">${state.leaderboardExpanded ? '▲' : '▼'}</span>
        </div>
    ` : '';

    // Header row for "all" view
    const headerRow = state.leaderboardSort === 'all' ? `
        <div class="leaderboard-header-row">
            <span class="leaderboard-header-spacer"></span>
            <span class="leaderboard-header-name">Empire</span>
            <div class="leaderboard-header-ranks">
                <span class="leaderboard-header-cell">Area</span>
                <span class="leaderboard-header-cell">Cities</span>
                <span class="leaderboard-header-cell">Age</span>
            </div>
        </div>
    ` : '';

    const dividerText = state.leaderboardSort === 'all' ? 'All metrics' : 'Ranked by ' + state.leaderboardSort;
    content.innerHTML = `<div class="leaderboard-divider">${dividerText}</div>` + headerRow +
        `<div class="leaderboard-list ${expandedClass}">${listHtml}</div>` + showMoreBtn;

    content.querySelectorAll('.leaderboard-item').forEach(item => {
        item.addEventListener('click', () => {
            const name = item.dataset.name;
            const polity = visiblePolities.find(p => p.properties.Name === name);
            if (polity && state.map) {
                // Save current location before navigating
                const currentCenter = state.map.getCenter();
                const currentZoom = state.map.getZoom();

                // Calculate centroid from geometry
                let coords;
                if (polity.geometry.type === 'Polygon') {
                    coords = polity.geometry.coordinates[0];
                } else if (polity.geometry.type === 'MultiPolygon') {
                    // Use the first (usually largest) polygon
                    coords = polity.geometry.coordinates[0][0];
                }

                if (coords) {
                    const lon = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
                    const lat = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;

                    // If this is the first navigation, save the starting point first
                    if (state.locationHistory.length === 0) {
                        state.locationHistory.push({
                            coords: [currentCenter.lat, currentCenter.lng],
                            zoom: currentZoom,
                            territoryName: 'Starting point',
                            territoryColor: '#888'
                        });
                    }

                    // Push the NEW location we're navigating TO
                    state.locationHistory.push({
                        coords: [lat, lon],
                        zoom: currentZoom,
                        territoryName: name,
                        territoryColor: getColor(name)
                    });

                    // Navigate to centroid without changing zoom
                    state.map.setView([lat, lon], currentZoom);

                    // Select and pin the territory info
                    showPointInfo(lon, lat);

                    // Show the return indicator
                    showLocationJumpIndicator();
                }
            }
        });
    });

    // Expand/collapse toggle
    const expandBtn = document.getElementById('leaderboard-expand');
    if (expandBtn) {
        const totalCount = allPolities.length;
        expandBtn.addEventListener('click', () => {
            state.leaderboardExpanded = !state.leaderboardExpanded;
            document.querySelector('.leaderboard-list').classList.toggle('expanded', state.leaderboardExpanded);
            expandBtn.querySelector('.leaderboard-toggle-text').textContent =
                state.leaderboardExpanded ? 'Show less' : `Show ${totalCount - 5} more`;
            expandBtn.querySelector('.leaderboard-toggle-chevron').textContent =
                state.leaderboardExpanded ? '▲' : '▼';
        });
    }
}

export function setupLeaderboard() {
    // Stats toggle (from bottom bar)
    const statsToggleBtn = document.getElementById('toggle-stats');
    if (statsToggleBtn) {
        statsToggleBtn.addEventListener('click', function() {
            state.statsCollapsed = !state.statsCollapsed;
            document.getElementById('stats-panel').classList.toggle('hidden', state.statsCollapsed);
            this.classList.toggle('active', !state.statsCollapsed);
            updateLeaderboardPosition();
        });
    }

    // Leaderboard toggle (from bottom bar)
    const toggleBtn = document.getElementById('toggle-leaderboard');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            state.leaderboardCollapsed = !state.leaderboardCollapsed;
            document.getElementById('leaderboard').classList.toggle('hidden', state.leaderboardCollapsed);
            this.classList.toggle('active', !state.leaderboardCollapsed);
            updateLeaderboardPosition();
        });
    }

    // Filter button toggle
    const filterBtn = document.getElementById('filter-btn');
    const filtersPanel = document.getElementById('leaderboard-filters');
    if (filterBtn && filtersPanel) {
        filterBtn.addEventListener('click', function() {
            state.filterPanelOpen = !state.filterPanelOpen;
            filtersPanel.classList.toggle('hidden', !state.filterPanelOpen);
            this.classList.toggle('active', state.filterPanelOpen);
        });
    }

    // Filter option buttons
    document.querySelectorAll('.filter-option').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filter-option').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            state.leaderboardSort = this.dataset.sort;

            // Use enhanced updateMap if available
            if (window.updateMapWithGraph) {
                window.updateMapWithGraph(state.currentYear);
            } else {
                import('./map.js').then(({ updateMap }) => {
                    updateMap(state.currentYear);
                });
            }
        });
    });
}
