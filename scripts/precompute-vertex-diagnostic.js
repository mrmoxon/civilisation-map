#!/usr/bin/env node
// Pre-compute vertex classifications (coastal vs inland) for all territories at 1 CE
//
// Uses the detailed coastline LineStrings to measure each vertex's distance
// to the nearest coastline. Close = coastal (blue), far = inland (green).
//
// Output: data/vertex_diagnostic_1ce.json
// Format: { "Territory Name": [[bool, bool, ...], ...], ... }
//
// Usage: node scripts/precompute-vertex-diagnostic.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// --- Thresholds ---
const TIGHT = 0.4;         // ~44km: definitely coastal
const LOOSE = 1.2;         // ~130km: coastal if both neighbors are too
const SEARCH_RADIUS = 2.0; // search box half-width in degrees

// --- Geometry helpers ---

function nearestPointOnSegmentDist2(pt, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return (pt[0] - a[0]) ** 2 + (pt[1] - a[1]) ** 2;
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return (pt[0] - px) ** 2 + (pt[1] - py) ** 2;
}

// Returns [px, py, dist2] — the nearest point on segment and squared distance
function nearestPointOnSegment(pt, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        const d2 = (pt[0] - a[0]) ** 2 + (pt[1] - a[1]) ** 2;
        return [a[0], a[1], d2];
    }
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    const d2 = (pt[0] - px) ** 2 + (pt[1] - py) ** 2;
    return [px, py, d2];
}

// --- Spatial index for coastline segments ---

const GRID_SIZE = 1; // 1-degree cells for finer granularity

class CoastlineIndex {
    constructor() {
        this.grid = {};
        this.segCount = 0;
    }

    // Add all segments from a LineString's coordinate array
    // featureIdx tracks which LineString this came from (for ordering)
    addLineString(coords, featureIdx) {
        for (let i = 0; i < coords.length - 1; i++) {
            const a = coords[i], b = coords[i + 1];
            const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
            const minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
            const x0 = Math.floor(minX / GRID_SIZE);
            const y0 = Math.floor(minY / GRID_SIZE);
            const x1 = Math.floor(maxX / GRID_SIZE);
            const y1 = Math.floor(maxY / GRID_SIZE);
            const seg = [a, b, featureIdx, i]; // [pointA, pointB, featureIdx, segIdx]
            for (let gx = x0; gx <= x1; gx++) {
                for (let gy = y0; gy <= y1; gy++) {
                    const key = `${gx},${gy}`;
                    if (!this.grid[key]) this.grid[key] = [];
                    this.grid[key].push(seg);
                }
            }
            this.segCount++;
        }
    }

    // Find distance to nearest coastline segment within search radius
    nearestDist(lon, lat, radius) {
        const x0 = Math.floor((lon - radius) / GRID_SIZE);
        const y0 = Math.floor((lat - radius) / GRID_SIZE);
        const x1 = Math.floor((lon + radius) / GRID_SIZE);
        const y1 = Math.floor((lat + radius) / GRID_SIZE);
        let bestDist2 = Infinity;
        const pt = [lon, lat];
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                const segs = this.grid[key];
                if (!segs) continue;
                for (const seg of segs) {
                    const d2 = nearestPointOnSegmentDist2(pt, seg[0], seg[1]);
                    if (d2 < bestDist2) bestDist2 = d2;
                }
            }
        }
        return Math.sqrt(bestDist2);
    }

    // Find nearest point on coastline with full position info
    // Returns { point: [lon, lat], featureIdx, segIdx, t, dist2 } or null
    nearestPointFull(lon, lat, radius) {
        const x0 = Math.floor((lon - radius) / GRID_SIZE);
        const y0 = Math.floor((lat - radius) / GRID_SIZE);
        const x1 = Math.floor((lon + radius) / GRID_SIZE);
        const y1 = Math.floor((lat + radius) / GRID_SIZE);
        let bestDist2 = Infinity, best = null;
        const pt = [lon, lat];
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                const segs = this.grid[key];
                if (!segs) continue;
                for (const seg of segs) {
                    const a = seg[0], b = seg[1];
                    const dx = b[0] - a[0], dy = b[1] - a[1];
                    const lenSq = dx * dx + dy * dy;
                    let t, px, py;
                    if (lenSq === 0) {
                        t = 0; px = a[0]; py = a[1];
                    } else {
                        t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
                        t = Math.max(0, Math.min(1, t));
                        px = a[0] + t * dx;
                        py = a[1] + t * dy;
                    }
                    const d2 = (pt[0] - px) ** 2 + (pt[1] - py) ** 2;
                    if (d2 < bestDist2) {
                        bestDist2 = d2;
                        best = { point: [px, py], featureIdx: seg[2], segIdx: seg[3], t, dist2: d2 };
                    }
                }
            }
        }
        return best;
    }
}

// --- Build coastline index ---

function buildCoastlineIndex(coastlineGeoJSON) {
    const index = new CoastlineIndex();
    let featureIdx = 0;
    for (const feature of coastlineGeoJSON.features) {
        const geom = feature.geometry;
        if (geom.type === 'LineString') {
            index.addLineString(geom.coordinates, featureIdx++);
        } else if (geom.type === 'MultiLineString') {
            for (const line of geom.coordinates) {
                index.addLineString(line, featureIdx++);
            }
        }
    }
    return index;
}

// --- Classify vertices for a ring ---

function classifyRing(ring, coastIndex) {
    const n = ring.length;
    // Pass 1: distance to nearest coastline for every vertex
    const dists = ring.map(pt => coastIndex.nearestDist(pt[0], pt[1], SEARCH_RADIUS));

    // Pass 2: narrow strip detection — demote inland-side vertices using raw distances
    // In a narrow coastal strip, both the sea-facing and inland-facing edges
    // are close to the coastline. But the inland-facing vertex will have a
    // non-adjacent vertex (the sea-facing one) that is spatially nearby yet
    // significantly closer to the coast. Flag these as "dominated" so they
    // won't be promoted to coastal in later passes.
    const STRIP_SPATIAL_RADIUS = 1.5; // degrees — max spatial distance to check
    const MIN_RING_SEPARATION = 4;     // minimum ring-distance to count as non-adjacent
    const DIST_RATIO_THRESHOLD = 0.45; // the other vertex must be < 45% of our distance

    const dominated = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
        const di = dists[i];
        if (di >= LOOSE) continue;          // too far from coast to matter
        if (di < TIGHT * 0.5) continue;     // very close to coast — definitely coastal, skip

        const xi = ring[i][0], yi = ring[i][1];

        for (let j = 0; j < n; j++) {
            const ringDist = Math.min(Math.abs(j - i), n - Math.abs(j - i));
            if (ringDist < MIN_RING_SEPARATION) continue;

            const dx = ring[j][0] - xi, dy = ring[j][1] - yi;
            const spatialDist2 = dx * dx + dy * dy;
            if (spatialDist2 > STRIP_SPATIAL_RADIUS * STRIP_SPATIAL_RADIUS) continue;

            if (dists[j] < di * DIST_RATIO_THRESHOLD) {
                dominated[i] = true;
                break;
            }
        }
    }

    // Pass 3: classify with neighbor context (dominated vertices forced inland)
    // Biased towards green: LOOSE-range vertices need all 4 nearest neighbors
    // within TIGHT to be promoted to coastal
    const result = [];
    for (let i = 0; i < n; i++) {
        if (dominated[i]) {
            result.push(false);
            continue;
        }
        const d = dists[i];
        let coastal;
        if (d < TIGHT) {
            coastal = true;
        } else if (d < LOOSE) {
            const prev1 = dists[(i - 1 + n) % n];
            const next1 = dists[(i + 1) % n];
            const prev2 = dists[(i - 2 + n) % n];
            const next2 = dists[(i + 2) % n];
            coastal = prev1 < TIGHT && next1 < TIGHT && prev2 < TIGHT && next2 < TIGHT;
        } else {
            coastal = false;
        }
        result.push(coastal);
    }

    // Pass 4: smoothing — only smooth towards green (inland), never promote to blue
    const smoothed = result.slice();
    for (let i = 0; i < n; i++) {
        if (!result[i]) continue; // already green, leave it
        const p1 = result[(i - 1 + n) % n];
        const n1 = result[(i + 1) % n];
        const p2 = result[(i - 2 + n) % n];
        const n2 = result[(i + 2) % n];
        // Flip blue to green if both immediate neighbors are green
        if (!p1 && !n1) {
            smoothed[i] = false;
        }
        // Flip blue to green if both one-away neighbors are green
        else if (!p2 && !n2) {
            smoothed[i] = false;
        }
    }
    // Pass 5: green spread — if either of the two neighbors on BOTH sides is green, flip to green
    const final = smoothed.slice();
    for (let i = 0; i < n; i++) {
        if (!smoothed[i]) continue; // already green
        const leftGreen = !smoothed[(i - 1 + n) % n] || !smoothed[(i - 2 + n) % n];
        const rightGreen = !smoothed[(i + 1) % n] || !smoothed[(i + 2) % n];
        if (leftGreen && rightGreen) {
            final[i] = false;
        }
    }
    // Pass 6: sharp coastline transitions — trim blue run edges to find the "hard start"
    // At the boundary of a blue run, iteratively peel back vertices that aren't
    // genuinely close to the coast. Stops when a vertex truly sits on the coastline.
    const BOUNDARY_TIGHT = TIGHT * 0.5; // ~0.2° ~22km — must be this close at a transition
    const sharpened = final.slice();
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < n; i++) {
            if (!sharpened[i]) continue;              // already green
            if (dists[i] <= BOUNDARY_TIGHT) continue; // genuinely on coast, keep blue
            // Is this vertex at the edge of a blue run? (has a green neighbor)
            const prevGreen = !sharpened[(i - 1 + n) % n];
            const nextGreen = !sharpened[(i + 1) % n];
            if (prevGreen || nextGreen) {
                sharpened[i] = false;
                changed = true;
            }
        }
    }
    return sharpened;
}

// =====================
//        MAIN
// =====================

console.log('Loading data...');
const t0 = Date.now();
const coastlineData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/terrain/coastlines_detailed.geojson'), 'utf8'));
const politiesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/polities_initial.geojson'), 'utf8'));
console.log(`  Loaded in ${Date.now() - t0}ms`);

console.log('Building coastline index...');
const t1 = Date.now();
const coastIndex = buildCoastlineIndex(coastlineData);
console.log(`  ${coastIndex.segCount} segments indexed in ${Date.now() - t1}ms`);

// Filter for 1 CE
const year = 1;
const visible = politiesData.features.filter(f => {
    const name = f.properties.Name;
    if (name.startsWith('(') && name.endsWith(')')) return false;
    return f.properties.FromYear <= year && f.properties.ToYear >= year;
});
console.log(`\n${visible.length} territories visible at ${year} CE\n`);

// Classify all vertices
const t2 = Date.now();
const output = {};
let totalVertices = 0, totalCoastal = 0, totalInland = 0;

for (const f of visible) {
    const name = f.properties.Name;
    const geom = f.geometry;
    const rings = [];
    if (geom.type === 'Polygon') {
        rings.push(...geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) rings.push(...poly);
    }

    const ft = Date.now();
    const classifications = [];
    let fCoastal = 0, fInland = 0;

    for (const ring of rings) {
        const result = classifyRing(ring, coastIndex);
        classifications.push(result);
        for (const c of result) {
            if (c) fCoastal++; else fInland++;
        }
    }

    output[name] = classifications;
    totalVertices += fCoastal + fInland;
    totalCoastal += fCoastal;
    totalInland += fInland;
    console.log(`  ${name}: ${Date.now() - ft}ms, ${fCoastal} coastal + ${fInland} inland = ${fCoastal + fInland} vertices`);
}

const elapsed = Date.now() - t2;
console.log(`\nClassified ${totalVertices} vertices (${totalCoastal} coastal, ${totalInland} inland) in ${elapsed}ms`);
console.log(`Thresholds: TIGHT=${TIGHT}° (~${(TIGHT*111).toFixed(0)}km), LOOSE=${LOOSE}° (~${(LOOSE*111).toFixed(0)}km)`);

const outPath = path.join(ROOT, 'data/vertex_diagnostic_1ce.json');
fs.writeFileSync(outPath, JSON.stringify(output));
const size = fs.statSync(outPath).size;
console.log(`Saved to ${outPath} (${(size / 1024).toFixed(0)} KB)`);

// --- Snap ghost: for each blue vertex, find nearest point on coastline ---
// Then validate ordering: consecutive blue vertices should be monotonic
// along the coastline. Out-of-order snaps get nulled out.
console.log('\nComputing snap targets for ghost visualization...');
const t3 = Date.now();
const ghostOutput = {};
let snapCount = 0, reorderCount = 0;

for (const f of visible) {
    const name = f.properties.Name;
    const classifications = output[name];
    if (!classifications) continue;
    const geom = f.geometry;
    const rings = [];
    if (geom.type === 'Polygon') {
        rings.push(...geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) rings.push(...poly);
    }

    const ghostRings = [];
    for (let r = 0; r < rings.length && r < classifications.length; r++) {
        const ring = rings[r];
        const cls = classifications[r];
        const n = Math.min(ring.length, cls.length);

        // Step 1: compute snap info for all blue vertices
        const snapInfos = []; // { point, featureIdx, segIdx, t } or null
        for (let i = 0; i < n; i++) {
            if (cls[i]) {
                const info = coastIndex.nearestPointFull(ring[i][0], ring[i][1], SEARCH_RADIUS);
                snapInfos.push(info);
            } else {
                snapInfos.push(null);
            }
        }

        // Step 2: find runs of consecutive blue vertices and validate ordering
        // A "coastline parameter" = segIdx + t gives position along a LineString.
        // For consecutive blue vertices on the same feature, params should be monotonic.
        const nulled = new Set();

        // Find contiguous blue runs
        let runStart = -1;
        const runs = [];
        for (let i = 0; i < n; i++) {
            if (cls[i] && snapInfos[i] && runStart === -1) runStart = i;
            if ((!cls[i] || !snapInfos[i]) && runStart !== -1) {
                if (i - runStart >= 2) runs.push([runStart, i - 1]);
                runStart = -1;
            }
        }
        if (runStart !== -1 && n - runStart >= 2) runs.push([runStart, n - 1]);

        for (const [rs, re] of runs) {
            // Group consecutive vertices by featureIdx
            let groupStart = rs;
            for (let i = rs + 1; i <= re + 1; i++) {
                const prevFeat = snapInfos[i - 1] ? snapInfos[i - 1].featureIdx : -1;
                const curFeat = (i <= re && snapInfos[i]) ? snapInfos[i].featureIdx : -2;
                if (curFeat !== prevFeat || i > re) {
                    // End of a same-feature group: [groupStart, i-1]
                    const groupEnd = i - 1;
                    if (groupEnd > groupStart) {
                        // Check monotonicity of coastline parameter within this group
                        const params = [];
                        for (let j = groupStart; j <= groupEnd; j++) {
                            const info = snapInfos[j];
                            params.push({ idx: j, param: info.segIdx + info.t });
                        }
                        // Determine expected direction from first to last
                        const dir = params[params.length - 1].param - params[0].param;
                        const increasing = dir >= 0;

                        // Check each intermediate point maintains monotonicity
                        for (let k = 1; k < params.length - 1; k++) {
                            const prev = params[k - 1].param;
                            const curr = params[k].param;
                            const next = params[k + 1].param;
                            const outOfOrder = increasing
                                ? (curr < prev || curr > next)
                                : (curr > prev || curr < next);
                            if (outOfOrder) {
                                nulled.add(params[k].idx);
                                reorderCount++;
                            }
                        }
                    }
                    groupStart = i;
                }
            }
        }

        // Step 3: build output, nulling out-of-order snaps
        const ghostRing = [];
        for (let i = 0; i < n; i++) {
            const info = snapInfos[i];
            if (info && !nulled.has(i)) {
                const pt = info.point;
                ghostRing.push([Math.round(pt[0] * 10000) / 10000, Math.round(pt[1] * 10000) / 10000]);
                snapCount++;
            } else {
                ghostRing.push(null);
            }
        }
        ghostRings.push(ghostRing);
    }
    ghostOutput[name] = ghostRings;
}

const ghostPath = path.join(ROOT, 'data/snap_ghost_1ce.json');
fs.writeFileSync(ghostPath, JSON.stringify(ghostOutput));
const ghostSize = fs.statSync(ghostPath).size;
console.log(`Computed ${snapCount} snap targets in ${Date.now() - t3}ms`);
console.log(`Reordering fix: ${reorderCount} out-of-order snaps nulled`);
console.log(`Saved to ${ghostPath} (${(ghostSize / 1024).toFixed(0)} KB)`);
console.log('Done!');
