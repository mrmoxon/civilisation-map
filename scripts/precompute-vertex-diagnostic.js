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

const coastlineCoords = []; // featureIdx → coordinate array

function buildCoastlineIndex(coastlineGeoJSON) {
    const index = new CoastlineIndex();
    let featureIdx = 0;
    for (const feature of coastlineGeoJSON.features) {
        const geom = feature.geometry;
        if (geom.type === 'LineString') {
            coastlineCoords[featureIdx] = geom.coordinates;
            index.addLineString(geom.coordinates, featureIdx++);
        } else if (geom.type === 'MultiLineString') {
            for (const line of geom.coordinates) {
                coastlineCoords[featureIdx] = line;
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

// --- Coastline walking functions ---

// Round coordinate to 4 decimal places
function roundCoord(c) {
    return [Math.round(c[0] * 10000) / 10000, Math.round(c[1] * 10000) / 10000];
}

// Walk between two snap positions on the same coastline LineString.
// Returns intermediate coastline vertices (excluding the snap endpoints themselves).
// paramA = segIdxA + tA, paramB = segIdxB + tB
function walkBetween(featureIdx, segA, tA, segB, tB) {
    const coords = coastlineCoords[featureIdx];
    if (!coords) return [];

    const paramA = segA + tA;
    const paramB = segB + tB;

    const intermediates = [];

    if (paramA < paramB) {
        // Walk forward: collect coords[segA+1] through coords[segB]
        for (let i = segA + 1; i <= segB; i++) {
            intermediates.push(roundCoord(coords[i]));
        }
    } else if (paramA > paramB) {
        // Walk backward: collect coords[segA] down to coords[segB+1]
        for (let i = segA; i >= segB + 1; i--) {
            intermediates.push(roundCoord(coords[i]));
        }
    }
    // If paramA === paramB, no intermediates

    // Cap at 500 intermediate vertices
    if (intermediates.length > 500) {
        const step = intermediates.length / 500;
        const downsampled = [];
        for (let i = 0; i < 500; i++) {
            downsampled.push(intermediates[Math.floor(i * step)]);
        }
        return downsampled;
    }

    return intermediates;
}

// Walk full island perimeter (for a single blue vertex on a closed feature).
// Returns all unique coastline vertices starting from startSeg+1, wrapping around.
function walkFullIsland(featureIdx, startSeg, startT) {
    const coords = coastlineCoords[featureIdx];
    if (!coords || coords.length < 3) return [];

    // Check if feature is closed (first ≈ last coordinate)
    const first = coords[0], last = coords[coords.length - 1];
    const dx = first[0] - last[0], dy = first[1] - last[1];
    if (dx * dx + dy * dy > 0.0001) return []; // Not closed

    const numUnique = coords.length - 1; // last coord duplicates first
    const vertices = [];

    for (let k = 0; k < numUnique; k++) {
        const idx = (startSeg + 1 + k) % numUnique;
        vertices.push(roundCoord(coords[idx]));
    }

    // Cap at 1000 vertices
    if (vertices.length > 1000) {
        const step = vertices.length / 1000;
        const downsampled = [];
        for (let i = 0; i < 1000; i++) {
            downsampled.push(vertices[Math.floor(i * step)]);
        }
        return downsampled;
    }

    return vertices;
}

// Walk between two snap positions on a closed coastline feature, picking the shorter arc.
// For open features, falls back to walkBetween.
function walkBetweenShortest(featureIdx, segA, tA, segB, tB) {
    const coords = coastlineCoords[featureIdx];
    if (!coords || coords.length < 3) return walkBetween(featureIdx, segA, tA, segB, tB);

    // Check if feature is closed
    const first = coords[0], last = coords[coords.length - 1];
    const dx = first[0] - last[0], dy = first[1] - last[1];
    if (dx * dx + dy * dy > 0.0001) {
        // Open feature — use directional walkBetween
        return walkBetween(featureIdx, segA, tA, segB, tB);
    }

    const numUnique = coords.length - 1; // last coord duplicates first

    // Collect forward intermediates: segA+1 .. segB, wrapping
    const forward = [];
    let fi = (segA + 1) % numUnique;
    while (fi !== (segB + 1) % numUnique && forward.length < numUnique) {
        forward.push(roundCoord(coords[fi]));
        fi = (fi + 1) % numUnique;
    }

    // Collect backward intermediates: segA down to segB+1, wrapping
    const backward = [];
    let bi = segA;
    const bTarget = (segB + 1) % numUnique;
    while (bi !== bTarget && backward.length < numUnique) {
        backward.push(roundCoord(coords[bi]));
        bi = (bi - 1 + numUnique) % numUnique;
    }

    // Pick the shorter direction
    let intermediates = forward.length <= backward.length ? forward : backward;

    // Cap at 500 intermediates
    if (intermediates.length > 500) {
        const step = intermediates.length / 500;
        const downsampled = [];
        for (let i = 0; i < 500; i++) {
            downsampled.push(intermediates[Math.floor(i * step)]);
        }
        return downsampled;
    }

    return intermediates;
}

// Store all snap infos globally for walked borders computation
const allSnapInfos = {}; // name → [ ringIdx → snapInfos[] ]
const allSnapInfosRaw = {}; // name → [ ringIdx → snapInfos[] ] (before monotonicity nulling)

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
    if (!allSnapInfos[name]) allSnapInfos[name] = [];
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

        // Save raw snap infos before monotonicity nulling
        if (!allSnapInfosRaw[name]) allSnapInfosRaw[name] = [];
        allSnapInfosRaw[name][r] = snapInfos.map(s => s ? { ...s } : null);

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
        // Also null out snapInfos for out-of-order vertices (for walked borders)
        const ghostRing = [];
        for (let i = 0; i < n; i++) {
            const info = snapInfos[i];
            if (info && !nulled.has(i)) {
                const pt = info.point;
                ghostRing.push([Math.round(pt[0] * 10000) / 10000, Math.round(pt[1] * 10000) / 10000]);
                snapCount++;
            } else {
                ghostRing.push(null);
                if (nulled.has(i)) snapInfos[i] = null; // null out for walking
            }
        }
        ghostRings.push(ghostRing);
        allSnapInfos[name][r] = snapInfos;
    }
    ghostOutput[name] = ghostRings;
}

const ghostPath = path.join(ROOT, 'data/snap_ghost_1ce.json');
fs.writeFileSync(ghostPath, JSON.stringify(ghostOutput));
const ghostSize = fs.statSync(ghostPath).size;
console.log(`Computed ${snapCount} snap targets in ${Date.now() - t3}ms`);
console.log(`Reordering fix: ${reorderCount} out-of-order snaps nulled`);
console.log(`Saved to ${ghostPath} (${(ghostSize / 1024).toFixed(0)} KB)`);

// --- Walked borders: walk along coastline between consecutive snap points ---
console.log('\nComputing walked borders...');
const t4 = Date.now();
const walkedOutput = {};
let totalWalkedSegments = 0, totalOriginalSegments = 0, totalIslandWalks = 0;

for (const f of visible) {
    const name = f.properties.Name;
    const classifications = output[name];
    const snapInfosForTerritory = allSnapInfos[name];
    if (!classifications || !snapInfosForTerritory) continue;

    const geom = f.geometry;
    const rings = [];
    if (geom.type === 'Polygon') {
        rings.push(...geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) rings.push(...poly);
    }

    const territoryRings = [];
    for (let r = 0; r < rings.length && r < classifications.length; r++) {
        const ring = rings[r];
        const cls = classifications[r];
        const snapInfos = snapInfosForTerritory[r];
        if (!snapInfos) { territoryRings.push([]); continue; }
        const n = Math.min(ring.length, cls.length, snapInfos.length);

        const segments = [];
        let prevSnap = null; // { point, featureIdx, segIdx, t }

        for (let i = 0; i < n; i++) {
            const isBlue = cls[i];
            const snap = snapInfos[i];
            const hasValidSnap = isBlue && snap;

            if (!isBlue || !hasValidSnap) {
                // Green vertex or blue vertex with no/nulled snap — emit as original
                segments.push({ t: 'o', c: [roundCoord(ring[i])] });
                totalOriginalSegments++;
                prevSnap = null;
            } else {
                // Blue vertex with valid snap
                const snapPoint = roundCoord(snap.point);

                if (prevSnap && prevSnap.featureIdx === snap.featureIdx) {
                    // Same coastline feature — walk between them
                    const intermediates = walkBetween(
                        snap.featureIdx,
                        prevSnap.segIdx, prevSnap.t,
                        snap.segIdx, snap.t
                    );
                    const walkCoords = [roundCoord(prevSnap.point), ...intermediates, snapPoint];
                    segments.push({ t: 'w', c: walkCoords });
                    totalWalkedSegments++;
                } else {
                    // First blue in run or different feature — just emit snap point
                    segments.push({ t: 'w', c: [snapPoint] });
                    totalWalkedSegments++;
                }
                prevSnap = snap;
            }
        }

        // Wrap-around: check if first and last valid snaps are on the same feature
        let firstSnapIdx = -1, lastSnapIdx = -1;
        for (let i = 0; i < n; i++) {
            if (cls[i] && snapInfos[i]) { firstSnapIdx = i; break; }
        }
        for (let i = n - 1; i >= 0; i--) {
            if (cls[i] && snapInfos[i]) { lastSnapIdx = i; break; }
        }
        if (firstSnapIdx >= 0 && lastSnapIdx >= 0 && firstSnapIdx !== lastSnapIdx) {
            const firstSnap = snapInfos[firstSnapIdx];
            const lastSnap = snapInfos[lastSnapIdx];
            if (firstSnap.featureIdx === lastSnap.featureIdx) {
                const wrapIntermediates = walkBetween(
                    lastSnap.featureIdx,
                    lastSnap.segIdx, lastSnap.t,
                    firstSnap.segIdx, firstSnap.t
                );
                if (wrapIntermediates.length > 0) {
                    const wrapCoords = [roundCoord(lastSnap.point), ...wrapIntermediates, roundCoord(firstSnap.point)];
                    segments.push({ t: 'w', c: wrapCoords });
                    totalWalkedSegments++;
                }
            }
        }

        // Island detection: find blue vertices on closed features where no adjacent
        // blue vertex snaps to the same feature
        const featureSnapCounts = {}; // featureIdx → count of blue vertices snapping to it
        for (let i = 0; i < n; i++) {
            if (cls[i] && snapInfos[i]) {
                const fIdx = snapInfos[i].featureIdx;
                featureSnapCounts[fIdx] = (featureSnapCounts[fIdx] || 0) + 1;
            }
        }

        for (let i = 0; i < n; i++) {
            if (!cls[i] || !snapInfos[i]) continue;
            const snap = snapInfos[i];
            const fIdx = snap.featureIdx;

            // Only consider if this is the sole vertex snapping to this feature in the ring
            if (featureSnapCounts[fIdx] !== 1) continue;

            // Check if the feature is closed
            const coords = coastlineCoords[fIdx];
            if (!coords || coords.length < 3) continue;
            const first = coords[0], last = coords[coords.length - 1];
            const dx = first[0] - last[0], dy = first[1] - last[1];
            if (dx * dx + dy * dy > 0.0001) continue; // Not closed

            // Walk the full island
            const islandVerts = walkFullIsland(fIdx, snap.segIdx, snap.t);
            if (islandVerts.length > 0) {
                const snapPoint = roundCoord(snap.point);
                segments.push({ t: 'w', c: [snapPoint, ...islandVerts, snapPoint] });
                totalIslandWalks++;
            }
        }

        territoryRings.push(segments);
    }
    walkedOutput[name] = territoryRings;
}

const walkedPath = path.join(ROOT, 'data/walked_borders_1ce.json');
fs.writeFileSync(walkedPath, JSON.stringify(walkedOutput));
const walkedSize = fs.statSync(walkedPath).size;
console.log(`Walked borders: ${totalWalkedSegments} walked + ${totalOriginalSegments} original segments, ${totalIslandWalks} island walks`);
console.log(`Computed in ${Date.now() - t4}ms`);
console.log(`Saved to ${walkedPath} (${(walkedSize / 1024).toFixed(0)} KB)`);

// --- Continuous walked borders ---
// Two types of polylines per ring, kept separate:
//   1) Green segments: runs of inland vertices → original polygon coords
//   2) Coast walks: snap points grouped by feature, sorted by coastline param
// Plus connector segments linking green endpoints to nearest coast walk endpoints
// at each green↔blue transition in the ring.
// Output: { "Name": [ ring0: [polyline, ...], ring1: [...], ... ] }
console.log('\nComputing continuous walked borders...');
const t5 = Date.now();
const contOutput = {};
let contRings = 0, contPolylines = 0, contIslandLoops = 0, contGapCount = 0;
const contGaps = {}; // name → [ ringIdx → [{red, purple}, ...] ]

for (const f of visible) {
    const name = f.properties.Name;
    const classifications = output[name];
    const rawSnaps = allSnapInfosRaw[name];
    if (!classifications || !rawSnaps) continue;

    const geom = f.geometry;
    const rings = [];
    if (geom.type === 'Polygon') {
        rings.push(...geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) rings.push(...poly);
    }

    const territoryRings = [];
    for (let r = 0; r < rings.length && r < classifications.length; r++) {
        const ring = rings[r];
        const cls = classifications[r];
        const snapInfos = rawSnaps[r];
        if (!snapInfos) { territoryRings.push([]); continue; }
        const n = Math.min(ring.length, cls.length, snapInfos.length);

        const polylines = [];

        // 1) Green segments: runs of non-blue vertices → original polygon coords
        let greenRun = [];
        for (let i = 0; i < n; i++) {
            if (!cls[i] || !snapInfos[i]) {
                greenRun.push(roundCoord(ring[i]));
            } else {
                if (greenRun.length >= 2) polylines.push(greenRun);
                greenRun = [];
            }
        }
        if (greenRun.length >= 2) polylines.push(greenRun);

        // 2) Coastline walks: group snap points by feature, sort by param, walk
        const groups = {}; // featureIdx → [snapInfo, ...]
        for (let i = 0; i < n; i++) {
            if (cls[i] && snapInfos[i]) {
                const fIdx = snapInfos[i].featureIdx;
                if (!groups[fIdx]) groups[fIdx] = [];
                groups[fIdx].push(snapInfos[i]);
            }
        }

        for (const fIdxStr of Object.keys(groups)) {
            const fIdx = parseInt(fIdxStr);
            const snaps = groups[fIdx];
            const fCoords = coastlineCoords[fIdx];
            if (!fCoords || fCoords.length < 2) continue;

            const first = fCoords[0], last = fCoords[fCoords.length - 1];
            const dx = first[0] - last[0], dy = first[1] - last[1];
            const isClosed = dx * dx + dy * dy <= 0.0001;

            if (snaps.length === 1 && isClosed) {
                const snap = snaps[0];
                const islandVerts = walkFullIsland(fIdx, snap.segIdx, snap.t);
                if (islandVerts.length > 0) {
                    const sp = roundCoord(snap.point);
                    polylines.push([sp, ...islandVerts, sp]);
                    contIslandLoops++;
                }
            } else if (snaps.length >= 2) {
                snaps.sort((a, b) => (a.segIdx + a.t) - (b.segIdx + b.t));
                const pathCoords = [roundCoord(snaps[0].point)];
                for (let k = 1; k < snaps.length; k++) {
                    const intermediates = walkBetween(
                        fIdx,
                        snaps[k - 1].segIdx, snaps[k - 1].t,
                        snaps[k].segIdx, snaps[k].t
                    );
                    pathCoords.push(...intermediates);
                    pathCoords.push(roundCoord(snaps[k].point));
                }
                if (isClosed) {
                    const lastSnap = snaps[snaps.length - 1];
                    const firstSnap = snaps[0];
                    const numUnique = fCoords.length - 1;
                    const wrapIntermediates = [];
                    let wi = (lastSnap.segIdx + 1) % numUnique;
                    const wTarget = (firstSnap.segIdx + 1) % numUnique;
                    while (wi !== wTarget && wrapIntermediates.length < 500) {
                        wrapIntermediates.push(roundCoord(fCoords[wi]));
                        wi = (wi + 1) % numUnique;
                    }
                    pathCoords.push(...wrapIntermediates);
                    pathCoords.push(roundCoord(firstSnap.point));
                    contIslandLoops++;
                }
                polylines.push(pathCoords);
                contPolylines++;
            }
        }

        // 3) Gap markers: at each green↔blue transition, record endpoints
        //    Red = green (inland) side, Purple = blue (coast snap) side
        const gaps = [];
        for (let i = 0; i < n; i++) {
            const iBlue = cls[i] && snapInfos[i];
            const ni = (i + 1) % n;
            const nBlue = cls[ni] && snapInfos[ni];

            if (iBlue && !nBlue) {
                gaps.push({
                    p: roundCoord(snapInfos[i].point),  // purple: coast
                    r: roundCoord(ring[ni])              // red: inland
                });
                contGapCount++;
            } else if (!iBlue && nBlue) {
                gaps.push({
                    r: roundCoord(ring[i]),              // red: inland
                    p: roundCoord(snapInfos[ni].point)   // purple: coast
                });
                contGapCount++;
            }
        }

        territoryRings.push(polylines);
        if (gaps.length > 0) {
            if (!contGaps[name]) contGaps[name] = [];
            contGaps[name][r] = gaps;
        }
        if (polylines.length > 0) contRings++;
    }
    contOutput[name] = territoryRings;
}

const contFinal = { polylines: contOutput, gaps: contGaps };
const contPath = path.join(ROOT, 'data/walked_borders_continuous_1ce.json');
fs.writeFileSync(contPath, JSON.stringify(contFinal));
const contSize = fs.statSync(contPath).size;
console.log(`Continuous walked borders: ${contRings} rings, ${contPolylines} coast polylines, ${contIslandLoops} island loops, ${contGapCount} gap markers`);
console.log(`Computed in ${Date.now() - t5}ms`);
console.log(`Saved to ${contPath} (${(contSize / 1024).toFixed(0)} KB)`);
console.log('Done!');
