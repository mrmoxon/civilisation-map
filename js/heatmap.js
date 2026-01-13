// Heatmap visualization - contested and settled areas
// Uses canvas overlay for proper grid-based intensity display
import { state } from './state.js';

// Color scales (interpolated for smooth gradients)
const CONTESTED_COLORS = [
    [13, 27, 42],     // Very dark blue (low)
    [27, 73, 101],    // Dark blue
    [95, 168, 211],   // Medium blue
    [190, 233, 232],  // Light cyan
    [255, 209, 102],  // Yellow
    [239, 71, 111],   // Pink-red
    [255, 10, 84]     // Bright red (high)
];

const SETTLED_COLORS = [
    [10, 47, 10],     // Very dark green (low)
    [27, 67, 50],     // Dark green
    [64, 145, 108],   // Medium green
    [149, 213, 178],  // Light green
    [255, 209, 102],  // Yellow
    [247, 127, 0],    // Orange
    [214, 40, 40]     // Red (high)
];

// Interpolate between colors based on value 0-1
function interpolateColor(colors, t) {
    t = Math.max(0, Math.min(1, t));
    const segments = colors.length - 1;
    const segment = Math.min(Math.floor(t * segments), segments - 1);
    const segmentT = (t * segments) - segment;

    const c1 = colors[segment];
    const c2 = colors[segment + 1];

    return [
        Math.round(c1[0] + (c2[0] - c1[0]) * segmentT),
        Math.round(c1[1] + (c2[1] - c1[1]) * segmentT),
        Math.round(c1[2] + (c2[2] - c1[2]) * segmentT)
    ];
}

// Custom canvas layer for grid-based heatmap
const HeatmapCanvasLayer = L.Layer.extend({
    initialize: function(data, options) {
        this._data = data;  // { points: [[lat, lon, value, cellSize], ...], max, colors }
        L.setOptions(this, options);
    },

    onAdd: function(map) {
        this._map = map;

        // Create canvas
        this._canvas = L.DomUtil.create('canvas', 'heatmap-canvas');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';

        const pane = map.getPane('overlayPane');
        pane.appendChild(this._canvas);

        map.on('moveend', this._reset, this);
        map.on('zoomend', this._reset, this);

        this._reset();
    },

    onRemove: function(map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend', this._reset, this);
        map.off('zoomend', this._reset, this);
    },

    _reset: function() {
        const map = this._map;
        const bounds = map.getBounds();
        const topLeft = map.latLngToLayerPoint(bounds.getNorthWest());
        const size = map.getSize();

        this._canvas.width = size.x;
        this._canvas.height = size.y;
        this._canvas.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px)`;

        this._draw();
    },

    _draw: function() {
        const ctx = this._canvas.getContext('2d');
        const map = this._map;
        const bounds = map.getBounds();

        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        const data = this._data;
        const points = data.points;
        const maxValue = data.max;
        const colors = data.colors;
        const globalRes = data.globalResolution || 1;

        // Get visible bounds with padding
        const south = bounds.getSouth() - 2;
        const north = bounds.getNorth() + 2;
        const west = bounds.getWest() - 2;
        const east = bounds.getEast() + 2;

        // Precompute canvas offset
        const canvasTopLeft = map.latLngToLayerPoint(bounds.getNorthWest());

        // Draw each point as a colored rectangle
        for (const point of points) {
            const lat = point[0];
            const lon = point[1];
            const value = point[2];
            const cellSize = point[3] || globalRes;

            // Skip if outside visible bounds
            if (lat < south || lat > north || lon < west || lon > east) {
                continue;
            }

            // Calculate normalized intensity (0-1) with power curve for better distribution
            let intensity = value / maxValue;
            intensity = Math.pow(intensity, 0.5);  // Square root for better spread
            intensity = Math.min(1, intensity);

            // Get color
            const rgb = interpolateColor(colors, intensity);

            // Calculate pixel positions for cell corners
            const halfCell = cellSize / 2;
            const nw = map.latLngToLayerPoint([lat + halfCell, lon - halfCell]);
            const se = map.latLngToLayerPoint([lat - halfCell, lon + halfCell]);

            // Adjust for canvas offset
            const x = nw.x - canvasTopLeft.x;
            const y = nw.y - canvasTopLeft.y;
            const width = se.x - nw.x;
            const height = se.y - nw.y;

            // Draw cell with opacity based on intensity
            const opacity = 0.3 + intensity * 0.5;  // 0.3 to 0.8
            ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
            ctx.fillRect(x, y, width + 1, height + 1);  // +1 to avoid gaps
        }
    },

    updateData: function(data) {
        this._data = data;
        if (this._map) {
            this._draw();
        }
    }
});

// Calculate percentile value from array
function getPercentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * p);
    return sorted[Math.min(index, sorted.length - 1)];
}

// Load precomputed heatmap data (global + high-res regions)
export async function loadHeatmapData() {
    if (state.heatmapComputed) return;

    const statusEl = document.getElementById('heatmap-status');
    if (statusEl) {
        statusEl.textContent = 'Loading heatmap...';
        statusEl.style.display = 'block';
    }

    try {
        // Load global and any regional high-res data in parallel
        const [globalResponse, britainResponse] = await Promise.all([
            fetch('data/heatmap.json'),
            fetch('data/heatmap-britain.json').catch(() => null)
        ]);

        if (!globalResponse.ok) {
            throw new Error(`Failed to load heatmap data: ${globalResponse.status}`);
        }

        const globalData = await globalResponse.json();
        const globalRes = globalData.metadata.gridResolution;

        // Add cell size to global points
        let contestedMerged = globalData.contested.map(p => [p[0], p[1], p[2], globalRes]);
        let settledMerged = globalData.settled.map(p => [p[0], p[1], p[2], globalRes]);

        // Load and merge Britain high-res if available
        if (britainResponse && britainResponse.ok) {
            const britainData = await britainResponse.json();
            const britainRes = britainData.metadata.gridResolution;
            const b = britainData.metadata.bounds;

            console.log(`Loading Britain high-res: ${britainData.metadata.dataPoints} points at ${britainRes}°`);

            // Remove global points within Britain bounds
            contestedMerged = contestedMerged.filter(p => {
                const lat = p[0], lon = p[1];
                return !(lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax);
            });
            settledMerged = settledMerged.filter(p => {
                const lat = p[0], lon = p[1];
                return !(lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax);
            });

            // Add Britain points with their resolution
            const britainContested = britainData.contested.map(p => [p[0], p[1], p[2], britainRes]);
            const britainSettled = britainData.settled.map(p => [p[0], p[1], p[2], britainRes]);

            contestedMerged = contestedMerged.concat(britainContested);
            settledMerged = settledMerged.concat(britainSettled);
        }

        // Calculate percentiles for better color distribution
        const contestedValues = contestedMerged.map(p => p[2]);
        const settledValues = settledMerged.map(p => p[2]);

        const contested95 = getPercentile(contestedValues, 0.95);
        const settled95 = getPercentile(settledValues, 0.95);

        state.heatmapData = {
            contested: contestedMerged,
            settled: settledMerged,
            maxContested: contested95,
            maxSettled: settled95,
            globalResolution: globalRes
        };

        state.heatmapComputed = true;

        const totalPoints = contestedMerged.length;
        if (statusEl) {
            statusEl.textContent = `${totalPoints.toLocaleString()} points`;
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 1500);
        }

        console.log(`Heatmap loaded: ${totalPoints} total points`);
        console.log(`Using 95th percentile: contested=${contested95}, settled=${settled95}`);

    } catch (error) {
        console.error('Error loading heatmap data:', error);
        if (statusEl) {
            statusEl.textContent = 'Failed to load';
            statusEl.style.color = '#e94560';
        }
    }
}

// Update the heatmap layer based on current mode
export function updateHeatmapLayer() {
    // Remove existing layer
    if (state.heatmapLayer) {
        state.map.removeLayer(state.heatmapLayer);
        state.heatmapLayer = null;
    }

    if (state.heatmapMode === 'off' || !state.heatmapComputed) {
        return;
    }

    let points, maxValue, colors;

    if (state.heatmapMode === 'contested') {
        points = state.heatmapData.contested;
        maxValue = state.heatmapData.maxContested;
        colors = CONTESTED_COLORS;
    } else if (state.heatmapMode === 'settled') {
        points = state.heatmapData.settled;
        maxValue = state.heatmapData.maxSettled;
        colors = SETTLED_COLORS;
    } else {
        return;
    }

    // Create custom canvas layer
    state.heatmapLayer = new HeatmapCanvasLayer({
        points: points,
        max: maxValue,
        colors: colors,
        globalResolution: state.heatmapData.globalResolution || 1
    });

    state.heatmapLayer.addTo(state.map);

    // Move polity and city layers above heatmap
    if (state.polityLayer) {
        state.polityLayer.bringToFront();
    }
    if (state.cityLayer) {
        state.cityLayer.bringToFront();
    }
}

// Setup heatmap control event listeners
export function setupHeatmapControls() {
    const cards = document.querySelectorAll('.dispute-card[data-heatmap]');

    cards.forEach(card => {
        card.addEventListener('click', async function() {
            const mode = this.dataset.heatmap;
            state.heatmapMode = mode;

            // Update card states
            cards.forEach(c => c.classList.remove('active'));
            this.classList.add('active');

            // Load data on first use if not already loaded
            if (state.heatmapMode !== 'off' && !state.heatmapComputed) {
                await loadHeatmapData();
            }

            updateHeatmapLayer();
        });
    });
}
