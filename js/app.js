// Main entry point
import { state } from './state.js';
import { loadAllData } from './data-loader.js';
import { initMap, updateMap } from './map.js';
import { setupTimeline, updateYearInput } from './timeline.js';
import { setupInfoPanel, unpinInfoPanel, updateInfoPanel, showPointInfo, hideTimelineJumpIndicator } from './info-panel.js';
import { setupLeaderboard, updateLeaderboardPosition } from './leaderboard.js';
import { setupGraphPanel, updateGraph, preloadGraphData } from './graph-panel.js';
import { setupHeatmapControls } from './heatmap.js';
import { initTerrain } from './terrain.js';
import { setupSettings } from './themes.js';

// Store reference to original updateMap for graph integration
let originalUpdateMap = updateMap;

// Enhanced updateMap that also updates graph and info panel when visible
function updateMapWithGraph(year) {
    const visiblePolities = originalUpdateMap(year);

    // Clear timeline history only if this is NOT a history jump (manual timeline change)
    if (state.timelineHistory.length > 0 && !state._isHistoryJump) {
        state.timelineHistory = [];
        hideTimelineJumpIndicator();
    }

    // Update info panel if pinned
    updateInfoPanel();

    // Only update graph if panel is visible
    const graphPanel = document.getElementById('graph-panel');
    if (graphPanel && graphPanel.classList.contains('visible')) {
        updateGraph(year, visiblePolities);
    }

    return visiblePolities;
}

async function init() {
    // Initialize map
    initMap();

    // Setup map click to select any point on the map
    state.map.on('click', function(e) {
        // Check if click originated from a UI element (not the map itself)
        const target = e.originalEvent.target;
        const isUIClick = target.closest('.controls-wrapper, .info-panel, .leaderboard, .view-panel, .graph-container, .stats-bar, .quick-menu, .leaflet-control');
        if (isUIClick) {
            return; // Don't handle clicks on UI elements
        }

        // If a city, river, territory, or ocean click already handled this event, don't override
        if (e.originalEvent._cityHandled || e.originalEvent._riverHandled || e.originalEvent._polityHandled || e.originalEvent._oceanHandled) {
            return;
        }

        const lon = e.latlng.lng;
        const lat = e.latlng.lat;

        // If already pinned, unpin first then select new point
        if (state.infoPanelPinned) {
            unpinInfoPanel();
        }

        // Select this point and show info
        showPointInfo(lon, lat);
    });

    // Setup UI components
    setupTimeline();
    setupInfoPanel();
    setupLeaderboard();
    setupGraphPanel();
    setupHeatmapControls();
    setupSettings();

    // Initialize terrain layers (async - loads rivers/coastlines data)
    await initTerrain();

    // Load data
    loadAllData(
        // Progress callback
        (type, message) => {
            if (type === 'polities') {
                document.getElementById('loading-polities').textContent = message;
            } else if (type === 'cities') {
                document.getElementById('loading-cities').textContent = message;
            }
        },
        // Complete callback
        () => {
            document.getElementById('loading').style.display = 'none';
            updateMapWithGraph(1);
            updateYearInput(1);
        }
    );

    // Override updateMap in modules that need it to include graph update
    // This is done by re-exporting from timeline.js
}

// Make updateMapWithGraph available globally for timeline/leaderboard
window.updateMapWithGraph = updateMapWithGraph;

// Setup quick menu (vertical buttons on bottom right)
function setupQuickMenu() {
    const quickMenu = document.getElementById('quick-menu');
    const expandBtn = document.getElementById('qm-expand');
    const statsBtn = document.getElementById('qm-stats');
    const leaderboardBtn = document.getElementById('qm-leaderboard');
    const graphBtn = document.getElementById('qm-graph');
    const controlsWrapper = document.getElementById('controls-wrapper');
    const footerSettingsBtn = document.getElementById('settings-btn');

    // Position quick menu above controls-wrapper using CSS variable
    let lastHeight = 0;
    let lastCollapsed = false;

    function updateQuickMenuPosition() {
        if (!controlsWrapper) return;

        const isCollapsed = controlsWrapper.classList.contains('collapsed');
        const fullHeight = controlsWrapper.offsetHeight;
        // When collapsed, only the tab bar is visible (36px)
        const visibleHeight = isCollapsed ? 36 : fullHeight;

        if (visibleHeight !== lastHeight || isCollapsed !== lastCollapsed) {
            lastHeight = visibleHeight;
            lastCollapsed = isCollapsed;
            document.documentElement.style.setProperty('--controls-height', visibleHeight + 'px');
        }
    }

    // Initial position
    updateQuickMenuPosition();

    // Observe controls-wrapper for size changes
    const resizeObserver = new ResizeObserver(updateQuickMenuPosition);
    if (controlsWrapper) {
        resizeObserver.observe(controlsWrapper);
    }

    // Watch for collapsed class changes
    const classObserver = new MutationObserver(updateQuickMenuPosition);
    if (controlsWrapper) {
        classObserver.observe(controlsWrapper, { attributes: true, attributeFilter: ['class'] });
    }

    // Expand/collapse menu (default is expanded, toggle adds 'collapsed')
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            quickMenu.classList.toggle('collapsed');
        });
    }

    // Stats toggle - direct control
    if (statsBtn) {
        statsBtn.addEventListener('click', () => {
            state.statsCollapsed = !state.statsCollapsed;
            document.getElementById('stats-panel').classList.toggle('hidden', state.statsCollapsed);
            statsBtn.classList.toggle('active', !state.statsCollapsed);
            updateLeaderboardPosition();
        });
    }

    // Leaderboard toggle - direct control
    if (leaderboardBtn) {
        leaderboardBtn.addEventListener('click', () => {
            state.leaderboardCollapsed = !state.leaderboardCollapsed;
            document.getElementById('leaderboard').classList.toggle('hidden', state.leaderboardCollapsed);
            leaderboardBtn.classList.toggle('active', !state.leaderboardCollapsed);
            updateLeaderboardPosition();
        });
    }

    // Graph toggle - direct control
    if (graphBtn) {
        graphBtn.addEventListener('click', () => {
            const panel = document.getElementById('graph-panel');
            const isVisible = panel.classList.contains('visible');
            panel.classList.toggle('visible', !isVisible);
            graphBtn.classList.toggle('active', !isVisible);
            if (!isVisible) {
                preloadGraphData();
            }
        });
    }

    // Settings button in footer - open the View panel
    if (footerSettingsBtn) {
        footerSettingsBtn.addEventListener('click', () => {
            const viewTab = document.querySelector('[data-panel="view"]');
            const viewPanel = document.getElementById('view-panel');

            // Uncollapse if collapsed
            if (controlsWrapper.classList.contains('collapsed')) {
                controlsWrapper.classList.remove('collapsed');
                document.querySelector('.toggle-icon').textContent = '▼';
            }

            // Switch to view panel
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.controls-panel').forEach(p => p.classList.remove('active'));
            if (viewTab) viewTab.classList.add('active');
            if (viewPanel) viewPanel.classList.add('active');
        });
    }
}

// Toggle configuration for pinning
const toggleConfig = {
    territories: { label: 'Territories', initial: 'T', toggleId: 'toggle-territories' },
    cities: { label: 'Cities', initial: 'C', toggleId: 'toggle-cities' },
    elevation: { label: 'Elevation', initial: 'E', toggleId: 'toggle-elevation' },
    hillshade: { label: 'Hillshade', initial: 'H', toggleId: 'toggle-hillshade' },
    rivers: { label: 'Rivers', initial: 'R', toggleId: 'toggle-rivers' },
    coastlines: { label: 'Coasts', initial: 'Co', toggleId: 'toggle-coastlines' },
    oceans: { label: 'Oceans', initial: 'O', toggleId: 'toggle-oceans' },
    labels: { label: 'Labels', initial: 'L', toggleId: 'toggle-labels' },
    'civ-names': { label: 'Civ Names', initial: 'N', toggleId: 'toggle-civ-names' }
};

// Setup pinned toggles menu
function setupPinnedToggles() {
    const pinnedMenu = document.getElementById('pinned-menu');
    const pinnedContainer = document.getElementById('pinned-toggles');
    const quickMenu = document.getElementById('quick-menu');

    // Load pinned toggles from localStorage, default to territories and cities
    const saved = localStorage.getItem('pinnedToggles');
    if (saved) {
        try {
            state.pinnedToggles = JSON.parse(saved);
        } catch (e) {
            state.pinnedToggles = ['territories', 'cities', 'oceans'];
        }
    } else {
        // Default pinned toggles
        state.pinnedToggles = ['territories', 'cities', 'oceans'];
    }

    // Update quick menu height CSS variable for pinned menu positioning
    function updateQuickMenuHeight() {
        if (quickMenu) {
            const height = quickMenu.offsetHeight;
            document.documentElement.style.setProperty('--quick-menu-height', height + 'px');
        }
    }

    // Observe quick menu for size changes
    const resizeObserver = new ResizeObserver(updateQuickMenuHeight);
    if (quickMenu) {
        resizeObserver.observe(quickMenu);
        updateQuickMenuHeight();
    }

    // Sync pinned menu collapse state with quick menu
    const expandBtn = document.getElementById('qm-expand');
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            // Wait for quick menu class to toggle
            setTimeout(() => {
                pinnedMenu.classList.toggle('collapsed', quickMenu.classList.contains('collapsed'));
                updateQuickMenuHeight();
            }, 0);
        });
    }

    // Render pinned toggles
    function renderPinnedToggles() {
        pinnedContainer.innerHTML = '';

        if (state.pinnedToggles.length === 0) {
            pinnedMenu.classList.add('hidden');
            return;
        }

        pinnedMenu.classList.remove('hidden');

        // Sync collapse state
        if (quickMenu.classList.contains('collapsed')) {
            pinnedMenu.classList.add('collapsed');
        } else {
            pinnedMenu.classList.remove('collapsed');
        }

        state.pinnedToggles.forEach(toggleId => {
            const config = toggleConfig[toggleId];
            if (!config) return;

            const originalToggle = document.getElementById(config.toggleId);
            const isActive = originalToggle && originalToggle.classList.contains('active');

            const btn = document.createElement('button');
            btn.className = 'pinned-toggle-btn' + (isActive ? ' active' : '');
            btn.dataset.toggle = toggleId;
            btn.title = config.label;
            btn.innerHTML = `
                <span class="pinned-label">${config.label}</span>
                <span class="pinned-initial">${config.initial}</span>
            `;

            btn.addEventListener('click', () => {
                // Click the original toggle button
                if (originalToggle) {
                    originalToggle.click();
                    // Update pinned button state
                    setTimeout(() => {
                        btn.classList.toggle('active', originalToggle.classList.contains('active'));
                    }, 10);
                }
            });

            pinnedContainer.appendChild(btn);
        });

        updateQuickMenuHeight();
    }

    // Save pinned toggles to localStorage
    function savePinnedToggles() {
        localStorage.setItem('pinnedToggles', JSON.stringify(state.pinnedToggles));
    }

    // Toggle pin state
    function togglePin(toggleId) {
        const index = state.pinnedToggles.indexOf(toggleId);
        if (index === -1) {
            state.pinnedToggles.push(toggleId);
        } else {
            state.pinnedToggles.splice(index, 1);
        }
        savePinnedToggles();
        renderPinnedToggles();
        updatePinButtonStates();
    }

    // Update pin button visual states
    function updatePinButtonStates() {
        document.querySelectorAll('.pin-btn').forEach(btn => {
            const toggleId = btn.dataset.toggle;
            btn.classList.toggle('pinned', state.pinnedToggles.includes(toggleId));
        });
    }

    // Setup pin button click handlers
    document.querySelectorAll('.pin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const toggleId = btn.dataset.toggle;
            togglePin(toggleId);
        });
    });

    // Watch for toggle state changes to update pinned buttons
    Object.keys(toggleConfig).forEach(toggleId => {
        const config = toggleConfig[toggleId];
        const toggle = document.getElementById(config.toggleId);
        if (toggle) {
            const observer = new MutationObserver(() => {
                const pinnedBtn = pinnedContainer.querySelector(`[data-toggle="${toggleId}"]`);
                if (pinnedBtn) {
                    pinnedBtn.classList.toggle('active', toggle.classList.contains('active'));
                }
            });
            observer.observe(toggle, { attributes: true, attributeFilter: ['class'] });
        }
    });

    // Initial render
    updatePinButtonStates();
    renderPinnedToggles();
}

// Setup layout settings
function setupLayoutSettings() {
    const controlsWrapper = document.getElementById('controls-wrapper');
    const positionBtns = document.querySelectorAll('[data-position]');
    const offsetBtns = document.querySelectorAll('[data-offset]');

    function updateControlsTopHeight() {
        if (controlsWrapper && document.body.classList.contains('controls-at-top')) {
            const height = controlsWrapper.offsetHeight;
            document.documentElement.style.setProperty('--controls-top-height', height + 'px');
        }
    }

    // Load saved preferences
    const savedPosition = localStorage.getItem('controlsPosition') || 'bottom';
    const savedOffset = localStorage.getItem('edgeOffset') || 'normal';

    // Apply saved position
    if (savedPosition === 'top') {
        document.body.classList.add('controls-at-top');
        positionBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.position === 'top'));
        setTimeout(() => {
            updateControlsTopHeight();
            updateLeaderboardPosition();
        }, 50);
    }

    // Apply saved offset
    if (savedOffset === 'further') {
        document.body.classList.add('edge-offset-further');
        offsetBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.offset === 'further'));
    }

    // Observe controls wrapper for size changes when at top
    if (controlsWrapper) {
        const resizeObserver = new ResizeObserver(() => {
            updateControlsTopHeight();
        });
        resizeObserver.observe(controlsWrapper);
    }

    // Handle position toggle
    positionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const position = btn.dataset.position;
            positionBtns.forEach(b => b.classList.toggle('active', b === btn));

            if (position === 'top') {
                document.body.classList.add('controls-at-top');
                localStorage.setItem('controlsPosition', 'top');
                setTimeout(() => {
                    updateControlsTopHeight();
                    updateLeaderboardPosition();
                }, 50);
            } else {
                document.body.classList.remove('controls-at-top');
                localStorage.setItem('controlsPosition', 'bottom');
                document.documentElement.style.setProperty('--controls-top-height', '0px');
                setTimeout(updateLeaderboardPosition, 50);
            }
        });
    });

    // Handle offset toggle
    offsetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const offset = btn.dataset.offset;
            offsetBtns.forEach(b => b.classList.toggle('active', b === btn));

            if (offset === 'further') {
                document.body.classList.add('edge-offset-further');
                localStorage.setItem('edgeOffset', 'further');
            } else {
                document.body.classList.remove('edge-offset-further');
                localStorage.setItem('edgeOffset', 'normal');
            }
            // Update leaderboard position when offset changes
            setTimeout(updateLeaderboardPosition, 50);
        });
    });
}

init();
setupQuickMenu();
setupPinnedToggles();
setupLayoutSettings();
