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

// Store reference to original updateMap for graph integration
let originalUpdateMap = updateMap;

// Enhanced updateMap that also updates graph and info panel when visible
function updateMapWithGraph(year) {
    const visiblePolities = originalUpdateMap(year);

    // Clear any existing timeline jump indicator (jumpToYear will set it back if needed)
    if (state.timelineJump) {
        state.timelineJump = null;
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

        // If a city, river, or territory click already handled this event, don't override
        if (e.originalEvent._cityHandled || e.originalEvent._riverHandled || e.originalEvent._polityHandled) {
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

init();
setupQuickMenu();
