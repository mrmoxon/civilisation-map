// Timeline controls with zoom functionality
import { state } from './state.js';
import { updateMap as baseUpdateMap } from './map.js';

// Zoom levels: [windowSize, label, majorInterval, minorInterval, showLabelsEvery, showDecades]
// All levels now show century (100y) markers at minimum for better granularity
const ZOOM_LEVELS = [
    { size: 5724, label: 'Full', major: 1000, minor: 100, labelEvery: 500, showDecades: false },
    { size: 2000, label: '2000y', major: 500, minor: 100, labelEvery: 500, showDecades: false },
    { size: 1000, label: '1000y', major: 200, minor: 50, labelEvery: 200, showDecades: false },
    { size: 500, label: '500y', major: 100, minor: 25, labelEvery: 100, showDecades: true },
    { size: 200, label: '200y', major: 50, minor: 10, labelEvery: 50, showDecades: true },
    { size: 100, label: '100y', major: 25, minor: 5, labelEvery: 25, showDecades: true },
    { size: 50, label: '50y', major: 10, minor: 1, labelEvery: 10, showDecades: true }
];

const MIN_YEAR = -3700;
const MAX_YEAR = 2024;
const FULL_RANGE = MAX_YEAR - MIN_YEAR;

// Timeline state
let currentZoomLevel = 0;
let windowStart = MIN_YEAR;
let windowEnd = MAX_YEAR;

// Use enhanced updateMap if available (includes graph update)
function updateMap(year) {
    if (window.updateMapWithGraph) {
        return window.updateMapWithGraph(year);
    }
    return baseUpdateMap(year);
}

// Format year for display
function formatYearLabel(year) {
    if (year < 0) {
        return Math.abs(year) + ' BCE';
    } else if (year === 0) {
        return '0 CE';
    } else {
        return year + ' CE';
    }
}

// Format year for compact display
function formatYearCompact(year) {
    if (year < 0) {
        return Math.abs(year) + ' BC';
    } else if (year === 0) {
        return '0';
    } else {
        return year + ' AD';
    }
}

// Generate ticks based on current zoom level and window
export function generateTimelineTicks() {
    const container = document.getElementById('timeline-ticks');
    if (!container) return;

    const zoom = ZOOM_LEVELS[currentZoomLevel];
    const windowSize = windowEnd - windowStart;

    const ticks = [];
    const tickSet = new Set(); // Track which years we've added

    // Determine the smallest tick interval to use
    let smallestInterval = zoom.minor;
    if (zoom.showDecades && smallestInterval > 10) {
        smallestInterval = 10;
    }

    // Calculate tick positions starting from the smallest interval
    const startTick = Math.ceil(windowStart / smallestInterval) * smallestInterval;

    for (let year = startTick; year <= windowEnd; year += smallestInterval) {
        const position = ((year - windowStart) / windowSize) * 100;

        if (position < 0 || position > 100) continue;
        if (tickSet.has(year)) continue;
        tickSet.add(year);

        // Determine tick class based on hierarchy
        const isMillennium = year % 1000 === 0;
        const isCentury = year % 100 === 0;
        const isMajor = year % zoom.major === 0;
        const isMinor = year % zoom.minor === 0;
        const isDecade = year % 10 === 0;
        const showLabel = year % zoom.labelEvery === 0;

        let label = '';
        if (showLabel) {
            if (currentZoomLevel <= 2) {
                label = formatYearCompact(year);
            } else {
                label = formatYearLabel(year);
            }
        }

        // Assign tick class based on significance (higher takes precedence)
        let tickClass = 'decade';
        if (isMillennium) {
            tickClass = 'millennium';
        } else if (isMajor) {
            tickClass = 'major';
        } else if (isCentury) {
            tickClass = 'century';
        } else if (isMinor) {
            tickClass = 'minor';
        } else if (isDecade && zoom.showDecades) {
            tickClass = 'decade';
        } else {
            continue; // Skip ticks that don't match any category
        }

        ticks.push({ year, position, tickClass, label });
    }

    container.innerHTML = ticks.map(t => `
        <div class="timeline-tick ${t.tickClass}" style="left: ${t.position}%">
            <div class="timeline-tick-line"></div>
            ${t.label ? `<span class="timeline-tick-label">${t.label}</span>` : ''}
        </div>
    `).join('');
}

// Update slider range based on zoom window
function updateSliderRange() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    timeline.min = windowStart;
    timeline.max = windowEnd;

    // Ensure current value is within range
    const currentValue = parseInt(timeline.value);
    if (currentValue < windowStart) {
        timeline.value = windowStart;
    } else if (currentValue > windowEnd) {
        timeline.value = windowEnd;
    }
}

// Update navigation button states
function updateNavButtons() {
    const leftBtn = document.getElementById('timeline-nav-left');
    const rightBtn = document.getElementById('timeline-nav-right');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const zoomLabel = document.getElementById('zoom-level');

    const isFullZoom = currentZoomLevel === 0;
    const isMaxZoom = currentZoomLevel === ZOOM_LEVELS.length - 1;

    if (leftBtn) {
        leftBtn.disabled = isFullZoom || windowStart <= MIN_YEAR;
    }
    if (rightBtn) {
        rightBtn.disabled = isFullZoom || windowEnd >= MAX_YEAR;
    }
    if (zoomInBtn) {
        zoomInBtn.disabled = isMaxZoom;
    }
    if (zoomOutBtn) {
        zoomOutBtn.disabled = isFullZoom;
    }
    if (zoomLabel) {
        zoomLabel.textContent = ZOOM_LEVELS[currentZoomLevel].label;
    }
}

// Center window on a specific year
function centerWindowOnYear(year) {
    const zoom = ZOOM_LEVELS[currentZoomLevel];
    const halfWindow = zoom.size / 2;

    windowStart = Math.max(MIN_YEAR, year - halfWindow);
    windowEnd = windowStart + zoom.size;

    // Adjust if we hit the max
    if (windowEnd > MAX_YEAR) {
        windowEnd = MAX_YEAR;
        windowStart = Math.max(MIN_YEAR, windowEnd - zoom.size);
    }

    updateSliderRange();
    generateTimelineTicks();
    updateNavButtons();
}

// Pan the timeline window
function panTimeline(direction) {
    const zoom = ZOOM_LEVELS[currentZoomLevel];
    const panAmount = zoom.size / 4; // Pan by 25% of window

    if (direction === 'left') {
        windowStart = Math.max(MIN_YEAR, windowStart - panAmount);
        windowEnd = windowStart + zoom.size;
    } else {
        windowEnd = Math.min(MAX_YEAR, windowEnd + panAmount);
        windowStart = windowEnd - zoom.size;
        if (windowStart < MIN_YEAR) {
            windowStart = MIN_YEAR;
            windowEnd = windowStart + zoom.size;
        }
    }

    updateSliderRange();
    generateTimelineTicks();
    updateNavButtons();
}

// Zoom in
function zoomIn() {
    if (currentZoomLevel >= ZOOM_LEVELS.length - 1) return;

    currentZoomLevel++;
    centerWindowOnYear(state.currentYear);
}

// Zoom out
function zoomOut() {
    if (currentZoomLevel <= 0) return;

    currentZoomLevel--;

    if (currentZoomLevel === 0) {
        windowStart = MIN_YEAR;
        windowEnd = MAX_YEAR;
        updateSliderRange();
        generateTimelineTicks();
        updateNavButtons();
    } else {
        centerWindowOnYear(state.currentYear);
    }
}

export function updateYearInput(year) {
    const input = document.getElementById('year-input');
    const select = document.getElementById('era-select');
    if (year < 0) {
        input.value = Math.abs(year);
        select.value = 'bce';
    } else {
        input.value = year;
        select.value = 'ce';
    }
}

export function goToYear() {
    const timeline = document.getElementById('timeline');
    const input = document.getElementById('year-input');
    const select = document.getElementById('era-select');
    let year = parseInt(input.value) || 0;
    if (select.value === 'bce') {
        year = -year;
    }
    year = Math.max(MIN_YEAR, Math.min(MAX_YEAR, year));

    // If zoomed in, center on the year
    if (currentZoomLevel > 0) {
        centerWindowOnYear(year);
    }

    timeline.value = year;
    updateMap(year);
    updateYearInput(year);
}

export function setupTimeline() {
    generateTimelineTicks();
    updateNavButtons();

    const timeline = document.getElementById('timeline');

    // Collapsible controls toggle
    const collapseToggle = document.getElementById('collapse-toggle');
    const controlsWrapper = document.getElementById('controls-wrapper');
    const panelTabs = document.querySelectorAll('.panel-tab');
    const panels = document.querySelectorAll('.controls-panel');

    if (collapseToggle && controlsWrapper) {
        collapseToggle.addEventListener('click', function(e) {
            e.stopPropagation();
            controlsWrapper.classList.toggle('collapsed');
        });
    }

    // Click on bar area (left of RHS buttons) to open with last panel
    const controlsTabLeft = document.querySelector('.controls-tab-left');
    if (controlsTabLeft && controlsWrapper) {
        controlsTabLeft.addEventListener('click', function(e) {
            // Don't handle if clicking on collapse toggle or panel tabs
            if (e.target.closest('.collapse-toggle') || e.target.closest('.panel-tab')) {
                return;
            }
            // Open if collapsed
            if (controlsWrapper.classList.contains('collapsed')) {
                controlsWrapper.classList.remove('collapsed');
            }
        });
    }

    // Panel tab switching
    panelTabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.stopPropagation();
            const panelId = this.dataset.panel + '-panel';
            const isCurrentlyActive = this.classList.contains('active');
            const isCollapsed = controlsWrapper.classList.contains('collapsed');

            if (isCurrentlyActive && !isCollapsed) {
                // Clicking active tab while open → collapse
                controlsWrapper.classList.add('collapsed');
            } else {
                // Switch to this tab and ensure panel is open
                controlsWrapper.classList.remove('collapsed');

                // Update tab states
                panelTabs.forEach(t => t.classList.remove('active'));
                this.classList.add('active');

                // Update panel visibility
                panels.forEach(p => p.classList.remove('active'));
                document.getElementById(panelId)?.classList.add('active');
            }
        });
    });

    // Timeline slider
    timeline.addEventListener('input', e => {
        const year = parseInt(e.target.value);
        updateMap(year);
        updateYearInput(year);
    });

    // Step buttons
    document.querySelectorAll('.step-btn[data-step]').forEach(btn => {
        btn.addEventListener('click', function() {
            const step = parseInt(this.dataset.step);
            const newYear = Math.max(MIN_YEAR, Math.min(MAX_YEAR, state.currentYear + step));

            // If zoomed in and year goes outside window, recenter
            if (currentZoomLevel > 0 && (newYear < windowStart || newYear > windowEnd)) {
                centerWindowOnYear(newYear);
            }

            timeline.value = newYear;
            updateMap(newYear);
            updateYearInput(newYear);
        });
    });

    // Zoom controls
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', zoomIn);
    }
    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', zoomOut);
    }

    // Navigation arrows
    const navLeftBtn = document.getElementById('timeline-nav-left');
    const navRightBtn = document.getElementById('timeline-nav-right');

    if (navLeftBtn) {
        navLeftBtn.addEventListener('click', () => panTimeline('left'));
    }
    if (navRightBtn) {
        navRightBtn.addEventListener('click', () => panTimeline('right'));
    }

    // Go to year button
    document.getElementById('go-to-year')?.addEventListener('click', goToYear);

    // Year input enter key
    document.getElementById('year-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            goToYear();
            e.preventDefault();
        }
    });

    // Keyboard controls
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        let step = 10;
        if (e.shiftKey) step = 100;
        if (e.ctrlKey || e.metaKey) step = 1;

        if (e.key === 'ArrowRight') {
            const newYear = Math.min(MAX_YEAR, state.currentYear + step);
            if (currentZoomLevel > 0 && newYear > windowEnd) {
                centerWindowOnYear(newYear);
            }
            timeline.value = newYear;
            updateMap(newYear);
            updateYearInput(newYear);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            const newYear = Math.max(MIN_YEAR, state.currentYear - step);
            if (currentZoomLevel > 0 && newYear < windowStart) {
                centerWindowOnYear(newYear);
            }
            timeline.value = newYear;
            updateMap(newYear);
            updateYearInput(newYear);
            e.preventDefault();
        } else if (e.key === '=' || e.key === '+') {
            zoomIn();
            e.preventDefault();
        } else if (e.key === '-' || e.key === '_') {
            zoomOut();
            e.preventDefault();
        }
    });

    // Toggle buttons
    document.getElementById('toggle-polities')?.addEventListener('click', function() {
        state.showPolities = !state.showPolities;
        this.classList.toggle('active', state.showPolities);
        updateMap(state.currentYear);
    });

    document.getElementById('toggle-cities')?.addEventListener('click', function() {
        state.showCities = !state.showCities;
        this.classList.toggle('active', state.showCities);
        updateMap(state.currentYear);
    });

    // Playback controls
    const playBtn = document.getElementById('play-btn');
    const playIcon = playBtn?.querySelector('.play-icon');
    const pauseIcon = playBtn?.querySelector('.pause-icon');
    const speedSelect = document.getElementById('playback-speed');
    let playbackInterval = null;
    let isPlaying = false;

    function startPlayback() {
        if (isPlaying) return;
        isPlaying = true;
        playBtn.classList.add('playing');
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'inline';

        const interval = parseInt(speedSelect.value) || 33;
        playbackInterval = setInterval(() => {
            const newYear = state.currentYear + 1;
            if (newYear > MAX_YEAR) {
                stopPlayback();
                return;
            }

            // If zoomed in and year goes outside window, recenter
            if (currentZoomLevel > 0 && newYear > windowEnd) {
                centerWindowOnYear(newYear);
            }

            timeline.value = newYear;
            updateMap(newYear);
            updateYearInput(newYear);
        }, interval);
    }

    function stopPlayback() {
        if (!isPlaying) return;
        isPlaying = false;
        playBtn.classList.remove('playing');
        playIcon.style.display = 'inline';
        pauseIcon.style.display = 'none';
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
    }

    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (isPlaying) {
                stopPlayback();
            } else {
                startPlayback();
            }
        });
    }

    // Update speed while playing
    if (speedSelect) {
        speedSelect.addEventListener('change', () => {
            if (isPlaying) {
                stopPlayback();
                startPlayback();
            }
        });
    }

    // Stop playback when user manually changes year
    timeline.addEventListener('mousedown', stopPlayback);
    document.querySelectorAll('.step-btn[data-step]').forEach(btn => {
        btn.addEventListener('click', stopPlayback);
    });

    // Mouse wheel zoom on timeline
    const timelineWrapper = document.querySelector('.timeline-wrapper');
    if (timelineWrapper) {
        timelineWrapper.addEventListener('wheel', e => {
            if (e.deltaY < 0) {
                zoomIn();
            } else {
                zoomOut();
            }
            e.preventDefault();
        }, { passive: false });
    }
}
