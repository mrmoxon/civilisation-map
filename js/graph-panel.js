// Graph panel - metrics and canvas drawing
import { state, metricConfig } from './state.js';
import { getColor, formatYear, formatArea, formatPopulation, formatAge, getWorldStatsForYear, getPopulationForYear } from './utils.js';

// Update metric formatters that depend on utils
metricConfig.landArea.format = v => formatArea(v);
metricConfig.urbanPop.format = v => formatPopulation(v);
metricConfig.largestEmpire.format = v => formatArea(v);
metricConfig.avgAge.format = v => formatAge(Math.round(v));

// Fast calculation - skips expensive city-to-civ mapping
export function calculateMetricsFast(year, visiblePolities) {
    const stats = getWorldStatsForYear(year);

    const civData = {};
    for (const p of visiblePolities) {
        const name = p.properties.Name;
        if (!civData[name]) {
            civData[name] = {
                area: 0,
                fromYear: p.properties.FromYear,
                color: getColor(name)
            };
        }
        civData[name].area += p.properties.Area || 0;
        civData[name].fromYear = Math.min(civData[name].fromYear, p.properties.FromYear);
    }

    const civList = Object.entries(civData);
    const totalArea = civList.reduce((sum, [_, c]) => sum + c.area, 0);
    const largestArea = civList.length > 0 ? Math.max(...civList.map(([_, c]) => c.area)) : 0;
    const avgAge = civList.length > 0
        ? civList.reduce((sum, [_, c]) => sum + (year - c.fromYear), 0) / civList.length
        : 0;

    let totalCities = 0;
    let totalUrbanPop = 0;
    for (const city of state.allCities) {
        const popData = getPopulationForYear(city, year);
        if (popData) {
            totalCities++;
            totalUrbanPop += popData.pop;
        }
    }

    return {
        totals: {
            population: stats ? stats.population : 0,
            civilizations: civList.length,
            landArea: totalArea,
            cities: totalCities,
            urbanPop: totalUrbanPop,
            gdpPerCapita: stats ? stats.gdp_per_capita : 0,
            largestEmpire: largestArea,
            avgAge: avgAge
        },
        civs: civData
    };
}

function storeGraphData(year, data) {
    state.graphData[year] = data;
}

function getAllCivsInWindow(startYear, endYear) {
    const civSet = new Set();
    for (let y = startYear; y <= endYear; y++) {
        if (state.graphData[y] && state.graphData[y].civs) {
            Object.keys(state.graphData[y].civs).forEach(name => civSet.add(name));
        }
    }
    const civTotals = {};
    civSet.forEach(name => {
        civTotals[name] = 0;
        for (let y = startYear; y <= endYear; y++) {
            if (state.graphData[y] && state.graphData[y].civs && state.graphData[y].civs[name]) {
                civTotals[name] += state.graphData[y].civs[name].area;
            }
        }
    });
    return Array.from(civSet).sort((a, b) => civTotals[b] - civTotals[a]);
}

export function drawGraph() {
    const canvas = document.getElementById('graph-canvas');
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    canvas.width = container.clientWidth * 2;
    canvas.height = container.clientHeight * 2;
    ctx.scale(2, 2);

    const width = container.clientWidth;
    const height = container.clientHeight;
    const padding = { top: 10, right: 10, bottom: 10, left: 10 };

    ctx.clearRect(0, 0, width, height);

    const startYear = state.graphWindowStart;
    const endYear = state.graphWindowStart + state.windowSize;

    document.getElementById('graph-range-start').textContent = formatYear(startYear);
    document.getElementById('graph-range-end').textContent = formatYear(endYear);

    const yearsInWindow = Object.keys(state.graphData)
        .map(Number)
        .filter(y => y >= startYear && y <= endYear)
        .sort((a, b) => a - b);

    if (yearsInWindow.length < 2) {
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.graphDataLoaded ? 'No data for this period' : 'Loading data...', width / 2, height / 2);
        return;
    }

    const config = metricConfig[state.currentMetric];
    const isStackable = config.stackable;

    const xScale = x => padding.left + (x - startYear) / state.windowSize * (width - padding.left - padding.right);

    if (isStackable) {
        const allCivs = getAllCivsInWindow(startYear, endYear);

        let maxStack = 0;
        for (const year of yearsInWindow) {
            let stack = 0;
            const data = state.graphData[year];
            if (data && data.civs) {
                for (const name of allCivs) {
                    stack += (data.civs[name]?.area) || 0;
                }
            }
            maxStack = Math.max(maxStack, stack);
        }

        const yScale = y => height - padding.bottom - (y / (maxStack || 1)) * (height - padding.top - padding.bottom);

        for (let i = allCivs.length - 1; i >= 0; i--) {
            const civName = allCivs[i];

            const points = [];
            for (const year of yearsInWindow) {
                let cumulative = 0;
                const data = state.graphData[year];
                if (data && data.civs) {
                    for (let j = allCivs.length - 1; j >= i; j--) {
                        cumulative += (data.civs[allCivs[j]]?.area) || 0;
                    }
                }
                points.push({ year, value: cumulative });
            }

            const baseline = [];
            for (const year of yearsInWindow) {
                let cumulative = 0;
                const data = state.graphData[year];
                if (data && data.civs) {
                    for (let j = allCivs.length - 1; j > i; j--) {
                        cumulative += (data.civs[allCivs[j]]?.area) || 0;
                    }
                }
                baseline.push({ year, value: cumulative });
            }

            ctx.beginPath();
            ctx.moveTo(xScale(points[0].year), yScale(baseline[0].value));
            for (let p = 0; p < points.length; p++) {
                ctx.lineTo(xScale(points[p].year), yScale(points[p].value));
            }
            for (let p = points.length - 1; p >= 0; p--) {
                ctx.lineTo(xScale(baseline[p].year), yScale(baseline[p].value));
            }
            ctx.closePath();

            const civColor = state.graphData[yearsInWindow[0]]?.civs?.[civName]?.color || getColor(civName);
            ctx.fillStyle = civColor + 'aa';
            ctx.fill();
            ctx.strokeStyle = civColor;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }

        if (state.currentYear >= startYear && state.currentYear <= endYear) {
            ctx.beginPath();
            ctx.moveTo(xScale(state.currentYear), padding.top);
            ctx.lineTo(xScale(state.currentYear), height - padding.bottom);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

    } else {
        const values = yearsInWindow.map(year => ({
            year,
            value: state.graphData[year]?.totals?.[state.currentMetric] || 0
        }));

        const maxVal = Math.max(...values.map(v => v.value));
        const minVal = Math.min(...values.map(v => v.value));
        const range = maxVal - minVal || 1;

        const yScale = y => height - padding.bottom - ((y - minVal) / range) * (height - padding.top - padding.bottom);

        ctx.beginPath();
        ctx.moveTo(xScale(values[0].year), height - padding.bottom);
        for (const v of values) {
            ctx.lineTo(xScale(v.year), yScale(v.value));
        }
        ctx.lineTo(xScale(values[values.length - 1].year), height - padding.bottom);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(77, 166, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(77, 166, 255, 0.05)');
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(xScale(values[0].year), yScale(values[0].value));
        for (let i = 1; i < values.length; i++) {
            ctx.lineTo(xScale(values[i].year), yScale(values[i].value));
        }
        ctx.strokeStyle = '#4da6ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        const currentData = values.find(v => v.year === state.currentYear);
        if (currentData) {
            ctx.beginPath();
            ctx.arc(xScale(currentData.year), yScale(currentData.value), 5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#4da6ff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}

export function updateWindowDisplay() {
    const startYear = state.graphWindowStart;
    const endYear = state.graphWindowStart + state.windowSize;
    document.getElementById('window-year-display').textContent =
        formatYear(startYear) + ' — ' + formatYear(endYear);
    document.getElementById('window-slider').value = state.graphWindowStart;
}

export function updateGraph(year, visiblePolities) {
    const data = calculateMetricsFast(year, visiblePolities);
    storeGraphData(year, data);

    const currentValue = data.totals[state.currentMetric];
    const config = metricConfig[state.currentMetric];
    document.getElementById('graph-value').textContent = config.format(currentValue);

    const stackNote = config.stackable ? ' — stacked by civilization' : '';
    document.getElementById('graph-label').textContent = config.label + stackNote;

    const prevYear = year - 1;
    const deltaEl = document.getElementById('graph-delta');

    if (state.graphData[prevYear]) {
        const prevValue = state.graphData[prevYear].totals[state.currentMetric] || 0;
        const delta = currentValue - prevValue;
        const pctChange = prevValue !== 0 ? ((delta / prevValue) * 100) : 0;

        if (Math.abs(pctChange) < 0.1) {
            deltaEl.className = 'graph-delta neutral';
            deltaEl.textContent = '—';
        } else if (delta > 0) {
            deltaEl.className = 'graph-delta positive';
            deltaEl.textContent = '+' + Math.abs(pctChange).toFixed(1) + '%';
        } else {
            deltaEl.className = 'graph-delta negative';
            deltaEl.textContent = '-' + Math.abs(pctChange).toFixed(1) + '%';
        }
    } else {
        deltaEl.className = 'graph-delta neutral';
        deltaEl.textContent = '—';
    }

    if (state.windowMode === 'sliding') {
        state.graphWindowStart = year - state.windowSize;
        state.graphWindowStart = Math.max(-3700, state.graphWindowStart);
        updateWindowDisplay();
    } else {
        if (year < state.graphWindowStart || year > state.graphWindowStart + state.windowSize) {
            state.graphWindowStart = year - state.windowSize / 2;
            state.graphWindowStart = Math.max(-3700, Math.min(2024 - state.windowSize, state.graphWindowStart));
            updateWindowDisplay();
        }
    }

    drawGraph();
}

export function preloadGraphData(callback) {
    if (state.graphDataLoaded) {
        if (callback) callback();
        return;
    }

    console.log('Preloading graph data...');
    const startTime = performance.now();
    const step = 50;
    const years = [];
    for (let year = -3700; year <= 2024; year += step) {
        years.push(year);
    }

    let index = 0;
    const chunkSize = 20;

    function processChunk() {
        const end = Math.min(index + chunkSize, years.length);
        for (; index < end; index++) {
            const year = years[index];
            const visiblePolities = state.allPolities.filter(f => {
                const from = f.properties.FromYear;
                const to = f.properties.ToYear;
                return year >= from && year <= to;
            });
            const data = calculateMetricsFast(year, visiblePolities);
            storeGraphData(year, data);
        }

        if (index < years.length) {
            requestAnimationFrame(processChunk);
        } else {
            state.graphDataLoaded = true;
            console.log(`Graph data preloaded in ${(performance.now() - startTime).toFixed(0)}ms`);
            updateWindowDisplay();
            drawGraph();
            if (callback) callback();
        }
    }

    requestAnimationFrame(processChunk);
}

export function setupGraphPanel() {
    // Window slider
    document.getElementById('window-slider').addEventListener('input', function() {
        state.graphWindowStart = parseInt(this.value);
        updateWindowDisplay();
        drawGraph();
    });

    // Window width selector
    document.getElementById('window-width-select').addEventListener('change', function() {
        state.windowSize = parseInt(this.value);
        const slider = document.getElementById('window-slider');

        if (state.windowSize >= 5700) {
            state.graphWindowStart = -3700;
            slider.value = -3700;
            slider.disabled = true;
        } else {
            slider.disabled = false;
            slider.max = 2024 - state.windowSize;

            if (state.graphWindowStart > 2024 - state.windowSize) {
                state.graphWindowStart = 2024 - state.windowSize;
                slider.value = state.graphWindowStart;
            }
        }

        updateWindowDisplay();
        drawGraph();
    });

    // Window mode toggle
    document.querySelectorAll('.window-mode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.window-mode-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            state.windowMode = this.dataset.mode;

            const slider = document.getElementById('window-slider');
            if (state.windowMode === 'sliding') {
                slider.disabled = true;
                state.graphWindowStart = state.currentYear - state.windowSize;
                state.graphWindowStart = Math.max(-3700, state.graphWindowStart);
                updateWindowDisplay();
                drawGraph();
            } else {
                slider.disabled = (state.windowSize >= 5700);
            }
        });
    });

    // Graph toggle (from bottom bar)
    const graphToggleBtn = document.getElementById('toggle-graph');
    if (graphToggleBtn) {
        graphToggleBtn.addEventListener('click', function() {
            const panel = document.getElementById('graph-panel');
            const isVisible = panel.classList.contains('visible');
            panel.classList.toggle('visible', !isVisible);
            this.classList.toggle('active', !isVisible);
            if (!isVisible) {
                preloadGraphData();
            }
        });
    }

    // Make graph panel draggable and resizable
    const graphPanel = document.getElementById('graph-panel');
    const graphHeader = graphPanel.querySelector('.graph-header');
    let isDragging = false;
    let isResizing = false;
    let resizeDir = null;
    let dragOffset = { x: 0, y: 0 };
    let startRect = null;
    let startMouse = { x: 0, y: 0 };

    const MIN_WIDTH = 350;
    const MIN_HEIGHT = 280;

    // Dragging by header
    graphHeader.addEventListener('mousedown', function(e) {
        if (e.target.closest('.graph-close')) return;
        isDragging = true;
        const rect = graphPanel.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        graphPanel.style.transition = 'none';
        e.preventDefault();
    });

    // Resizing by handles
    graphPanel.querySelectorAll('[data-resize]').forEach(handle => {
        handle.addEventListener('mousedown', function(e) {
            isResizing = true;
            resizeDir = this.dataset.resize;
            startRect = graphPanel.getBoundingClientRect();
            startMouse = { x: e.clientX, y: e.clientY };
            graphPanel.style.transition = 'none';
            e.preventDefault();
            e.stopPropagation();
        });
    });

    document.addEventListener('mousemove', function(e) {
        if (isDragging) {
            const newX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - dragOffset.x));
            const newY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.y));
            graphPanel.style.left = newX + 'px';
            graphPanel.style.top = newY + 'px';
        } else if (isResizing && startRect) {
            const dx = e.clientX - startMouse.x;
            const dy = e.clientY - startMouse.y;

            let newLeft = startRect.left;
            let newTop = startRect.top;
            let newWidth = startRect.width;
            let newHeight = startRect.height;

            // Handle horizontal resizing
            if (resizeDir.includes('e')) {
                newWidth = Math.max(MIN_WIDTH, startRect.width + dx);
            }
            if (resizeDir.includes('w')) {
                const potentialWidth = startRect.width - dx;
                if (potentialWidth >= MIN_WIDTH) {
                    newWidth = potentialWidth;
                    newLeft = startRect.left + dx;
                }
            }

            // Handle vertical resizing
            if (resizeDir.includes('s')) {
                newHeight = Math.max(MIN_HEIGHT, startRect.height + dy);
            }
            if (resizeDir.includes('n')) {
                const potentialHeight = startRect.height - dy;
                if (potentialHeight >= MIN_HEIGHT) {
                    newHeight = potentialHeight;
                    newTop = startRect.top + dy;
                }
            }

            graphPanel.style.left = newLeft + 'px';
            graphPanel.style.top = newTop + 'px';
            graphPanel.style.width = newWidth + 'px';
            graphPanel.style.height = newHeight + 'px';
        }
    });

    document.addEventListener('mouseup', function() {
        if (isDragging || isResizing) {
            isDragging = false;
            isResizing = false;
            resizeDir = null;
            startRect = null;
            graphPanel.style.transition = '';
        }
    });

    // Graph close
    document.getElementById('graph-close').addEventListener('click', function() {
        document.getElementById('graph-panel').classList.remove('visible');
        const toggleBtn = document.getElementById('toggle-graph');
        if (toggleBtn) toggleBtn.classList.remove('active');
    });

    // Metric tabs
    document.querySelectorAll('.metric-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.metric-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            state.currentMetric = this.dataset.metric;

            if (state.graphData[state.currentYear]) {
                const data = state.graphData[state.currentYear];
                const config = metricConfig[state.currentMetric];
                document.getElementById('graph-value').textContent = config.format(data.totals[state.currentMetric] || 0);
                const stackNote = config.stackable ? ' — stacked by civilization' : '';
                document.getElementById('graph-label').textContent = config.label + stackNote;
                drawGraph();
            }
        });
    });
}
