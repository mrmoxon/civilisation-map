// Leaderboard rendering and sorting
import { state } from './state.js';
import { getColor, formatArea, formatAge, formatBillions, getWorldStatsForYear, countCitiesInPolity, formatYear, getCentroid } from './utils.js';
import { showPointInfo, showLocationJumpIndicator } from './info-panel.js';

// ─── Search index & cache ─────────────────────────────────────────
let politySearchIndex = null;
let searchDebounceTimer = null;

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
    if (state.leaderboardSort === 'cities') {
        polities.sort((a, b) => a.rankCities - b.rankCities);
    } else if (state.leaderboardSort === 'age') {
        polities.sort((a, b) => a.rankAge - b.rankAge);
    } else {
        // Default to area
        polities.sort((a, b) => a.rankArea - b.rankArea);
    }

    const valueFormatter = {
        area: p => formatArea(p.area),
        cities: p => p.cities,
        age: p => formatAge(p.age)
    };

    const allPolities = polities; // Load all territories
    const expandedClass = state.leaderboardExpanded ? 'expanded' : '';

    const listHtml = allPolities.map((p, i) => `
        <div class="leaderboard-item" data-name="${p.name}" style="--polity-color: ${p.color}">
            <span class="leaderboard-rank">${i + 1}</span>
            <span class="leaderboard-name" title="${p.name}">${p.name}</span>
            <span class="leaderboard-value">${valueFormatter[state.leaderboardSort](p)}</span>
        </div>
    `).join('');

    const showMoreBtn = allPolities.length > 5 ? `
        <div class="leaderboard-toggle" id="leaderboard-expand">
            <span class="leaderboard-toggle-text">${state.leaderboardExpanded ? 'Show less' : `Show ${allPolities.length - 5} more`}</span>
            <span class="leaderboard-toggle-chevron">${state.leaderboardExpanded ? '▲' : '▼'}</span>
        </div>
    ` : '';

    const dividerText = 'Ranked by ' + state.leaderboardSort;
    content.innerHTML = `<div class="leaderboard-divider">${dividerText}</div>` +
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

// ─── Search functions ──────────────────────────────────────────────

function buildPolitySearchIndex() {
    if (politySearchIndex) return politySearchIndex;
    const byName = {};
    for (const p of state.allPolities) {
        const name = p.properties.Name;
        // Skip parenthetical sub-entries like "Roman Empire (Western)"
        if (/\(.*\)$/.test(name)) continue;
        if (!byName[name]) {
            byName[name] = {
                name,
                fromYear: p.properties.FromYear,
                toYear: p.properties.ToYear,
                color: getColor(name)
            };
        } else {
            byName[name].fromYear = Math.min(byName[name].fromYear, p.properties.FromYear);
            byName[name].toYear = Math.max(byName[name].toYear, p.properties.ToYear);
        }
    }
    politySearchIndex = Object.values(byName);
    return politySearchIndex;
}

function executeSearch(query, index) {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const scored = [];
    for (const entry of index) {
        const lower = entry.name.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx === -1) continue;

        // Scoring: prefix > word-start > contains
        let score = 0;
        if (idx === 0) {
            score = 100; // prefix match
        } else if (lower[idx - 1] === ' ' || lower[idx - 1] === '-') {
            score = 70; // word-start match
        } else {
            score = 30; // contains
        }

        // Boost currently alive polities
        const alive = state.currentYear >= entry.fromYear && state.currentYear <= entry.toYear;
        if (alive) score += 20;

        scored.push({ ...entry, score, alive });
    }

    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.slice(0, 20);
}

function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return `${before}<mark>${match}</mark>${after}`;
}

function renderSearchResults(results, query) {
    const container = document.getElementById('search-results');
    if (!container) return;

    if (results.length === 0) {
        container.innerHTML = '<div class="search-no-results">No polities found</div>';
        container.classList.remove('hidden');
        return;
    }

    container.innerHTML = results.map((r, i) => {
        const period = `${formatYear(r.fromYear)} — ${formatYear(r.toYear)}`;
        let badgeClass, badgeText;
        if (r.alive) {
            badgeClass = 'active'; badgeText = 'Active';
        } else if (r.toYear >= 2024) {
            badgeClass = 'modern'; badgeText = 'Modern';
        } else if (r.fromYear > state.currentYear) {
            badgeClass = 'future'; badgeText = 'Future';
        } else {
            badgeClass = 'historical'; badgeText = 'Historical';
        }
        return `<div class="search-result-item${i === state.searchSelectedIndex ? ' selected' : ''}" data-index="${i}" style="--polity-color: ${r.color}">
            <div class="search-result-info">
                <div class="search-result-name">${highlightMatch(r.name, query)}</div>
                <div class="search-result-period">${period}</div>
            </div>
            <span class="search-result-badge ${badgeClass}">${badgeText}</span>
        </div>`;
    }).join('');

    container.classList.remove('hidden');

    // Wire click handlers
    container.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index);
            navigateToSearchResult(results[idx]);
        });
    });
}

function navigateToSearchResult(entry) {
    if (!state.map) return;

    const currentCenter = state.map.getCenter();
    const currentZoom = state.map.getZoom();

    // Determine the year to look at
    let targetYear = state.currentYear;
    const alive = state.currentYear >= entry.fromYear && state.currentYear <= entry.toYear;

    if (!alive) {
        // Jump timeline to midpoint of polity's existence
        targetYear = Math.round((entry.fromYear + entry.toYear) / 2);

        // Set the timeline
        const timeline = document.getElementById('timeline');
        timeline.value = targetYear;

        // Update year inputs
        const input = document.getElementById('year-input');
        const select = document.getElementById('era-select');
        if (targetYear < 0) {
            input.value = Math.abs(targetYear);
            select.value = 'bce';
        } else {
            input.value = targetYear;
            select.value = 'ce';
        }

        // Update the map
        if (window.updateMapWithGraph) {
            window.updateMapWithGraph(targetYear);
        }
    }

    // Find the polity geometry at the target year to get centroid
    const polity = state.allPolities.find(p =>
        p.properties.Name === entry.name &&
        targetYear >= p.properties.FromYear &&
        targetYear <= p.properties.ToYear
    );

    if (polity) {
        const centroid = getCentroid(polity.geometry);
        if (centroid) {
            // Save starting point if first navigation
            if (state.locationHistory.length === 0) {
                state.locationHistory.push({
                    coords: [currentCenter.lat, currentCenter.lng],
                    zoom: currentZoom,
                    territoryName: 'Starting point',
                    territoryColor: '#888'
                });
            }

            state.locationHistory.push({
                coords: [centroid.lat, centroid.lng],
                zoom: currentZoom,
                territoryName: entry.name,
                territoryColor: entry.color
            });

            state.map.setView([centroid.lat, centroid.lng], currentZoom);
            showPointInfo(centroid.lng, centroid.lat);
            showLocationJumpIndicator();
        }
    }

    closeSearch();
}

function openSearch() {
    state.searchOpen = true;
    state.searchQuery = '';
    state.searchSelectedIndex = -1;

    // Close filter panel if open
    if (state.filterPanelOpen) {
        state.filterPanelOpen = false;
        document.getElementById('leaderboard-filters')?.classList.add('hidden');
        document.getElementById('filter-btn')?.classList.remove('active');
    }

    document.getElementById('search-btn')?.classList.add('active');
    document.getElementById('leaderboard-search')?.classList.remove('hidden');
    document.getElementById('leaderboard-content')?.classList.add('hidden');
    document.getElementById('search-results')?.classList.add('hidden');

    const input = document.getElementById('search-input');
    if (input) {
        input.value = '';
        requestAnimationFrame(() => input.focus());
    }
    document.getElementById('search-clear')?.classList.add('hidden');
}

function closeSearch() {
    state.searchOpen = false;
    state.searchQuery = '';
    state.searchSelectedIndex = -1;

    document.getElementById('search-btn')?.classList.remove('active');
    document.getElementById('leaderboard-search')?.classList.add('hidden');
    document.getElementById('search-results')?.classList.add('hidden');
    document.getElementById('leaderboard-content')?.classList.remove('hidden');

    const input = document.getElementById('search-input');
    if (input) input.value = '';
}

function updateSelectedResult(items) {
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === state.searchSelectedIndex);
    });

    // Scroll selected into view
    if (state.searchSelectedIndex >= 0 && items[state.searchSelectedIndex]) {
        items[state.searchSelectedIndex].scrollIntoView({ block: 'nearest' });
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

    // Search button toggle
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            if (state.searchOpen) {
                closeSearch();
            } else {
                openSearch();
            }
        });
    }

    // Search input handling
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            const query = searchInput.value;
            state.searchQuery = query;
            state.searchSelectedIndex = -1;

            document.getElementById('search-clear')?.classList.toggle('hidden', !query);

            searchDebounceTimer = setTimeout(() => {
                if (!query.trim()) {
                    document.getElementById('search-results')?.classList.add('hidden');
                    return;
                }
                const index = buildPolitySearchIndex();
                const results = executeSearch(query, index);
                renderSearchResults(results, query);
            }, 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeSearch();
                return;
            }

            const items = document.querySelectorAll('.search-result-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                state.searchSelectedIndex = Math.min(state.searchSelectedIndex + 1, items.length - 1);
                updateSelectedResult(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                state.searchSelectedIndex = Math.max(state.searchSelectedIndex - 1, -1);
                updateSelectedResult(items);
            } else if (e.key === 'Enter' && state.searchSelectedIndex >= 0) {
                e.preventDefault();
                const index = buildPolitySearchIndex();
                const results = executeSearch(state.searchQuery, index);
                if (results[state.searchSelectedIndex]) {
                    navigateToSearchResult(results[state.searchSelectedIndex]);
                }
            }
        });
    }

    // Search clear button
    const searchClear = document.getElementById('search-clear');
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = '';
                input.dispatchEvent(new Event('input'));
                input.focus();
            }
        });
    }

    // Filter button — close search if open (mutually exclusive)
    const filterBtn = document.getElementById('filter-btn');
    const filtersPanel = document.getElementById('leaderboard-filters');
    if (filterBtn && filtersPanel) {
        filterBtn.addEventListener('click', function() {
            // Close search if open
            if (state.searchOpen) {
                closeSearch();
            }
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
