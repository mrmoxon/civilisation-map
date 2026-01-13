// Leaderboard rendering and sorting
import { state } from './state.js';
import { getColor, formatArea, formatAge, formatBillions, getWorldStatsForYear, countCitiesInPolity } from './utils.js';

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
function updateLeaderboardPosition() {
    const statsPanel = document.getElementById('stats-panel');
    const leaderboard = document.getElementById('leaderboard');
    if (!statsPanel || !leaderboard) return;

    const statsVisible = !statsPanel.classList.contains('hidden');
    const leaderboardVisible = !leaderboard.classList.contains('hidden');

    if (statsVisible && leaderboardVisible) {
        // Position leaderboard below stats
        const statsHeight = statsPanel.offsetHeight;
        leaderboard.style.top = (10 + statsHeight) + 'px';
        statsPanel.style.borderBottomLeftRadius = '0';
        statsPanel.style.borderBottomRightRadius = '0';
        leaderboard.style.borderTopLeftRadius = '0';
        leaderboard.style.borderTopRightRadius = '0';
    } else {
        // Reset positions
        leaderboard.style.top = '10px';
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

    const topPolities = polities.slice(0, 15);
    const expandedClass = state.leaderboardExpanded ? 'expanded' : '';

    let listHtml;
    if (state.leaderboardSort === 'all') {
        // "All" view with columns
        listHtml = topPolities.map(p => `
            <div class="leaderboard-item leaderboard-item-all" data-name="${p.name}">
                <div class="leaderboard-color" style="background: ${p.color}"></div>
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
        listHtml = topPolities.map((p, i) => `
            <div class="leaderboard-item" data-name="${p.name}">
                <span class="leaderboard-rank">${i + 1}</span>
                <div class="leaderboard-color" style="background: ${p.color}"></div>
                <span class="leaderboard-name" title="${p.name}">${p.name}</span>
                <span class="leaderboard-value">${valueFormatter[state.leaderboardSort](p)}</span>
            </div>
        `).join('');
    }

    const showMoreBtn = topPolities.length > 5 ? `
        <div class="leaderboard-toggle" id="leaderboard-expand">
            <span class="leaderboard-toggle-text">${state.leaderboardExpanded ? 'Show less' : `Show ${Math.min(topPolities.length, 15) - 5} more`}</span>
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
            if (polity && state.polityLayer) {
                state.polityLayer.eachLayer(layer => {
                    if (layer.feature && layer.feature.properties.Name === name) {
                        state.map.fitBounds(layer.getBounds());
                    }
                });
            }
        });
    });

    // Expand/collapse toggle
    const expandBtn = document.getElementById('leaderboard-expand');
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            state.leaderboardExpanded = !state.leaderboardExpanded;
            document.querySelector('.leaderboard-list').classList.toggle('expanded', state.leaderboardExpanded);
            expandBtn.querySelector('.leaderboard-toggle-text').textContent =
                state.leaderboardExpanded ? 'Show less' : `Show ${Math.min(topPolities.length, 15) - 5} more`;
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
