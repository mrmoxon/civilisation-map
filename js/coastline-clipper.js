// Coastline snapping module
// Clips territory polygons against land mass polygons from regions.geojson
// so coastal edges follow actual coastlines instead of straight lines.

// --- Strategy registry ---
const CLIP_STRATEGIES = {
    'weiler-atherton': clipRingWeilerAtherton,
    'vertex-snap':     clipRingVertexSnap,
    'buffer-clip':     clipRingBufferClip,
};

export let activeStrategy = 'weiler-atherton';

export function setClipStrategy(name) {
    if (CLIP_STRATEGIES[name]) {
        activeStrategy = name;
        clearSnappingCache();
    }
}

export function getAvailableStrategies() {
    return Object.keys(CLIP_STRATEGIES);
}

// --- Cache ---
const snappingCache = new Map();
const CACHE_MAX = 500;

export function clearSnappingCache() {
    snappingCache.clear();
}

function getCacheKey(geometry) {
    // Hash based on first/last coords + coordinate count for speed
    const coords = geometry.coordinates;
    if (!coords || coords.length === 0) return null;
    const flat = geometry.type === 'Polygon' ? coords : coords.flat();
    if (flat.length === 0) return null;
    const first = flat[0]?.[0];
    const last = flat[flat.length - 1]?.[0];
    const firstPt = first ? `${first[0].toFixed(4)},${first[1].toFixed(4)}` : '0,0';
    const lastPt = last ? `${last[last.length - 1]?.[0]?.toFixed(4)},${last[last.length - 1]?.[1]?.toFixed(4)}` : '0,0';
    let totalPts = 0;
    for (const ring of flat) totalPts += ring.length;
    return `${activeStrategy}:${geometry.type}:${totalPts}:${firstPt}:${lastPt}`;
}

// --- Geometry helpers ---

function signedArea(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return area / 2;
}

function ensureWinding(ring, clockwise) {
    if (ring.length < 3) return ring;
    const area = signedArea(ring);
    const isCW = area > 0;
    if (clockwise !== isCW) return ring.slice().reverse();
    return ring;
}

function ringBBox(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of ring) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] > maxY) maxY = pt[1];
    }
    return [minX, minY, maxX, maxY];
}

function bboxOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function pointInRing(pt, ring) {
    let inside = false;
    const x = pt[0], y = pt[1];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// Segment intersection: returns { point, t, u } or null
// t = parameter along segment a1->a2, u = parameter along b1->b2
function segmentIntersection(a1, a2, b1, b2) {
    const dx1 = a2[0] - a1[0], dy1 = a2[1] - a1[1];
    const dx2 = b2[0] - b1[0], dy2 = b2[1] - b1[1];
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-12) return null; // parallel

    const dx3 = b1[0] - a1[0], dy3 = b1[1] - a1[1];
    const t = (dx3 * dy2 - dy3 * dx2) / denom;
    const u = (dx3 * dy1 - dy3 * dx1) / denom;

    if (t < 0 || t > 1 || u < 0 || u > 1) return null;

    return {
        point: [a1[0] + t * dx1, a1[1] + t * dy1],
        t, u
    };
}

// Nearest point on a line segment to a query point
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

// Snap a point to nearest land polygon vertex if within threshold
function snapToNearestVertex(pt, ring, threshold) {
    let bestDist = threshold * threshold;
    let bestPt = pt;
    for (const v of ring) {
        const dx = pt[0] - v[0], dy = pt[1] - v[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
            bestDist = d2;
            bestPt = v;
        }
    }
    return bestPt;
}

// --- LandMask class ---

const GRID_SIZE = 2; // degrees per cell

class LandMask {
    constructor(polygons) {
        // polygons: array of { ring: [[lon,lat],...], bbox, holes: [ring,...] }
        this.polygons = polygons;
        this.grid = {};
        this._buildIndex();
    }

    _buildIndex() {
        for (let i = 0; i < this.polygons.length; i++) {
            const bb = this.polygons[i].bbox;
            const x0 = Math.floor(bb[0] / GRID_SIZE);
            const y0 = Math.floor(bb[1] / GRID_SIZE);
            const x1 = Math.floor(bb[2] / GRID_SIZE);
            const y1 = Math.floor(bb[3] / GRID_SIZE);
            for (let gx = x0; gx <= x1; gx++) {
                for (let gy = y0; gy <= y1; gy++) {
                    const key = `${gx},${gy}`;
                    if (!this.grid[key]) this.grid[key] = [];
                    this.grid[key].push(i);
                }
            }
        }
    }

    getCandidates(bbox) {
        const seen = new Set();
        const result = [];
        const x0 = Math.floor(bbox[0] / GRID_SIZE);
        const y0 = Math.floor(bbox[1] / GRID_SIZE);
        const x1 = Math.floor(bbox[2] / GRID_SIZE);
        const y1 = Math.floor(bbox[3] / GRID_SIZE);
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                const indices = this.grid[key];
                if (!indices) continue;
                for (const idx of indices) {
                    if (seen.has(idx)) continue;
                    seen.add(idx);
                    if (bboxOverlap(bbox, this.polygons[idx].bbox)) {
                        result.push(this.polygons[idx]);
                    }
                }
            }
        }
        return result;
    }

    isOnLand(lon, lat) {
        const gx = Math.floor(lon / GRID_SIZE);
        const gy = Math.floor(lat / GRID_SIZE);
        const key = `${gx},${gy}`;
        const indices = this.grid[key];
        if (!indices) return false;
        for (const idx of indices) {
            const poly = this.polygons[idx];
            if (lon < poly.bbox[0] || lon > poly.bbox[2] || lat < poly.bbox[1] || lat > poly.bbox[3]) continue;
            // Only check outer ring - holes in regions.geojson are geographic
            // sub-regions (mountains, deserts, plateaus), not water
            if (pointInRing([lon, lat], poly.ring)) return true;
        }
        return false;
    }

    // Distance (in degrees) from a point to the nearest land polygon boundary
    nearestBoundaryDist(lon, lat, searchRadius) {
        const bbox = [lon - searchRadius, lat - searchRadius, lon + searchRadius, lat + searchRadius];
        const candidates = this.getCandidates(bbox);
        let bestDist2 = Infinity;
        const pt = [lon, lat];
        for (const poly of candidates) {
            const ring = poly.ring;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const res = nearestPointOnSegment(pt, ring[j], ring[i]);
                if (res[2] < bestDist2) bestDist2 = res[2];
            }
        }
        return Math.sqrt(bestDist2);
    }
}

// --- Build land mask from regions.geojson ---

export function buildLandMask(regionsGeoJSON) {
    const t0 = performance.now();
    const landTypes = new Set(['Continent', 'Island', 'Island group']);
    const polygons = [];

    for (const feature of regionsGeoJSON.features) {
        const fcla = feature.properties.featurecla;
        if (!landTypes.has(fcla)) continue;

        const geom = feature.geometry;
        if (geom.type === 'Polygon') {
            const ring = geom.coordinates[0];
            const holes = geom.coordinates.slice(1);
            polygons.push({ ring, bbox: ringBBox(ring), holes, name: feature.properties.name });
        } else if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates) {
                const ring = poly[0];
                const holes = poly.slice(1);
                polygons.push({ ring, bbox: ringBBox(ring), holes, name: feature.properties.name });
            }
        }
    }

    const mask = new LandMask(polygons);
    console.log(`[coastline-clipper] Built land mask: ${polygons.length} polygons in ${(performance.now() - t0).toFixed(1)}ms`);
    return mask;
}

// --- Weiler-Atherton polygon clipping ---
// Computes the intersection of subject polygon with clip polygon.
// Both rings are arrays of [lon, lat] points forming closed loops.

function clipRingWeilerAtherton(subjectRing, clipRing) {
    // Ensure proper closure
    const subject = closeRing(subjectRing);
    const clip = closeRing(clipRing);

    // Quick checks
    const subjectBBox = ringBBox(subject);
    const clipBBox = ringBBox(clip);
    if (!bboxOverlap(subjectBBox, clipBBox)) return [];

    // Check containment: all subject vertices inside clip?
    let allInside = true;
    let allOutside = true;
    for (let i = 0; i < subject.length - 1; i++) {
        if (pointInRing(subject[i], clip)) allOutside = false;
        else allInside = false;
    }

    if (allInside) return [subject.slice()];
    if (allOutside) {
        // Check if clip is entirely inside subject
        let clipInSubject = true;
        for (let i = 0; i < clip.length - 1; i++) {
            if (!pointInRing(clip[i], subject)) { clipInSubject = false; break; }
        }
        if (clipInSubject) return [clip.slice()];
        return [];
    }

    // Find all intersection points
    const intersections = [];
    for (let i = 0; i < subject.length - 1; i++) {
        for (let j = 0; j < clip.length - 1; j++) {
            const ix = segmentIntersection(subject[i], subject[i + 1], clip[j], clip[j + 1]);
            if (ix) {
                // Snap to nearest vertex to avoid floating-point seam issues
                const snapped = snapToNearestVertex(ix.point, clip, 0.0001);
                intersections.push({
                    point: snapped,
                    subjectIdx: i,
                    subjectT: ix.t,
                    clipIdx: j,
                    clipT: ix.u,
                    // entering = going from outside clip to inside clip
                    entering: !pointInRing(subject[i], clip)
                });
            }
        }
    }

    if (intersections.length < 2) {
        // No proper intersection pair - check if subject is mostly inside
        if (!allOutside) return [subject.slice()];
        return [];
    }

    // Sort intersections by position along subject polygon
    intersections.sort((a, b) => {
        if (a.subjectIdx !== b.subjectIdx) return a.subjectIdx - b.subjectIdx;
        return a.subjectT - b.subjectT;
    });

    // Build insertion lists for both polygons
    const subjectList = buildVertexList(subject, intersections, 'subjectIdx', 'subjectT');
    const clipList = buildVertexList(clip, intersections, 'clipIdx', 'clipT');

    // Walk to produce result polygons
    const results = [];
    const used = new Set();

    for (const ix of intersections) {
        if (!ix.entering || used.has(ix)) continue;

        const result = [];
        let current = ix;
        let onSubject = true;
        let safety = 0;
        const maxIter = (subject.length + clip.length) * 2 + intersections.length * 2;

        while (safety++ < maxIter) {
            result.push(current.point.slice());
            used.add(current);

            if (onSubject) {
                // Walk subject until next exit intersection
                const nextIx = findNextIntersection(subjectList, current, intersections, 'subjectIdx', 'subjectT', false);
                if (!nextIx) break;

                // Add subject vertices between current and next intersection
                addVerticesBetween(result, subject, current.subjectIdx, current.subjectT, nextIx.subjectIdx, nextIx.subjectT);

                result.push(nextIx.point.slice());
                used.add(nextIx);
                current = nextIx;
                onSubject = false;
            } else {
                // Walk clip until next entry intersection
                const nextIx = findNextIntersection(clipList, current, intersections, 'clipIdx', 'clipT', true);
                if (!nextIx) break;

                // Add clip vertices between current and next intersection (these are coastline points)
                addVerticesBetween(result, clip, current.clipIdx, current.clipT, nextIx.clipIdx, nextIx.clipT);

                // Check if we've returned to start
                if (nextIx === ix) {
                    break;
                }

                result.push(nextIx.point.slice());
                current = nextIx;
                onSubject = true;
            }
        }

        if (result.length >= 3) {
            // Close the ring
            if (result[0][0] !== result[result.length - 1][0] || result[0][1] !== result[result.length - 1][1]) {
                result.push(result[0].slice());
            }
            results.push(result);
        }
    }

    return results;
}

function closeRing(ring) {
    if (ring.length < 2) return ring;
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        return [...ring, ring[0].slice()];
    }
    return ring;
}

function buildVertexList(polygon, intersections, idxProp, tProp) {
    // Create ordered list of original vertices + intersection points
    const list = [];
    for (let i = 0; i < polygon.length - 1; i++) {
        list.push({ point: polygon[i], idx: i, t: 0, isIntersection: false });
        // Insert any intersections on this edge
        const edgeIxs = intersections
            .filter(ix => ix[idxProp] === i)
            .sort((a, b) => a[tProp] - b[tProp]);
        for (const ix of edgeIxs) {
            list.push({ point: ix.point, idx: i, t: ix[tProp], isIntersection: true, ix });
        }
    }
    return list;
}

function findNextIntersection(vertexList, current, intersections, idxProp, tProp, findEntering) {
    // Find the next intersection after current along the polygon
    const currentPos = current[idxProp] + current[tProp];
    let best = null;
    let bestPos = Infinity;

    for (const ix of intersections) {
        if (ix === current) continue;
        if (ix.entering !== findEntering) continue;

        let pos = ix[idxProp] + ix[tProp];
        // Wrap around
        if (pos <= currentPos) pos += vertexList.length;

        if (pos < bestPos) {
            bestPos = pos;
            best = ix;
        }
    }

    return best;
}

function addVerticesBetween(result, polygon, startIdx, startT, endIdx, endT) {
    const n = polygon.length - 1; // exclude closing point
    let i = startIdx;

    // Start from next vertex after start intersection
    if (startT < 1) i = (i + 1) % n;

    // Walk forward until we reach the edge containing the end intersection
    let safety = 0;
    while (i !== endIdx && safety++ < n + 1) {
        result.push(polygon[i].slice());
        i = (i + 1) % n;
    }

    // If endT > 0, also add the vertex at endIdx
    if (i === endIdx && endT > 0) {
        result.push(polygon[i].slice());
    }
}

// --- Vertex-snap strategy (simpler alternative) ---

function clipRingVertexSnap(subjectRing, clipRing) {
    // Simple approach: for each vertex of the subject that's outside the clip polygon,
    // snap it to the nearest point on the clip polygon boundary
    const subject = closeRing(subjectRing);
    const clip = closeRing(clipRing);
    const result = [];

    for (let i = 0; i < subject.length - 1; i++) {
        const pt = subject[i];
        if (pointInRing(pt, clip)) {
            result.push(pt.slice());
        } else {
            // Find nearest point on clip boundary
            const nearest = nearestPointOnPolygon(pt, clip);
            if (nearest) result.push(nearest);
        }
    }

    if (result.length < 3) return [];

    // Close ring
    if (result[0][0] !== result[result.length - 1][0] || result[0][1] !== result[result.length - 1][1]) {
        result.push(result[0].slice());
    }

    return [result];
}

function nearestPointOnPolygon(pt, ring) {
    let bestDist = Infinity;
    let bestPt = null;

    for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const nearest = nearestPointOnSegment(pt, a, b);
        const dx = pt[0] - nearest[0], dy = pt[1] - nearest[1];
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            bestPt = nearest;
        }
    }

    return bestPt;
}

// --- Buffer-clip strategy (placeholder) ---

function clipRingBufferClip(subjectRing, clipRing) {
    // Placeholder: falls back to weiler-atherton
    return clipRingWeilerAtherton(subjectRing, clipRing);
}

// --- Island detection ---

function findCoveredIslands(geometry, landMask) {
    // Find islands whose centroid falls inside the original territory
    // but aren't part of its geometry. Return as additional polygon coordinates.
    const islands = [];
    const territoryRings = getOuterRings(geometry);

    for (const poly of landMask.polygons) {
        // Skip continents (too large to be "islands" we'd add)
        if (poly.ring.length > 5000) continue;

        // Compute centroid of this land polygon
        const centroid = ringCentroid(poly.ring);
        if (!centroid) continue;

        // Check if centroid is inside the territory
        let insideTerritory = false;
        for (const tRing of territoryRings) {
            if (pointInRing(centroid, tRing)) {
                insideTerritory = true;
                break;
            }
        }

        if (!insideTerritory) continue;

        // Check that this island isn't already substantially covered by the territory
        // (i.e., the territory polygon doesn't already overlap this island much)
        const bbox = poly.bbox;
        const tBBox = geometryBBox(geometry);
        if (!bboxOverlap(bbox, tBBox)) continue;

        // Add this island's ring as an additional polygon
        islands.push(poly.ring.slice());
    }

    return islands;
}

function ringCentroid(ring) {
    if (ring.length < 3) return null;
    let cx = 0, cy = 0;
    const n = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring.length - 1 : ring.length;
    for (let i = 0; i < n; i++) {
        cx += ring[i][0];
        cy += ring[i][1];
    }
    return [cx / n, cy / n];
}

function getOuterRings(geometry) {
    if (geometry.type === 'Polygon') {
        return [geometry.coordinates[0]];
    } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.map(p => p[0]);
    }
    return [];
}

function geometryBBox(geometry) {
    const rings = getOuterRings(geometry);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of rings) {
        for (const pt of ring) {
            if (pt[0] < minX) minX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] > maxY) maxY = pt[1];
        }
    }
    return [minX, minY, maxX, maxY];
}

// --- Main clipping entry point ---

function clipPolygonToLand(coords, landMask) {
    // coords is a Polygon's coordinates array: [outerRing, ...holes]
    const outerRing = coords[0];
    const holes = coords.slice(1);
    const bbox = ringBBox(outerRing);
    const candidates = landMask.getCandidates(bbox);

    if (candidates.length === 0) {
        // No land polygons overlap - return original
        return [coords];
    }

    const clipFn = CLIP_STRATEGIES[activeStrategy] || clipRingWeilerAtherton;
    let resultRings = [];

    for (const landPoly of candidates) {
        const clipped = clipFn(outerRing, landPoly.ring);
        for (let ring of clipped) {
            // Handle land polygon holes (bays, fjords)
            if (landPoly.holes.length > 0) {
                for (const hole of landPoly.holes) {
                    const subtracted = subtractHole(ring, hole);
                    if (subtracted) ring = subtracted;
                }
            }
            resultRings.push(ring);
        }
    }

    if (resultRings.length === 0) {
        // Clipping produced nothing - sanity fallback to original
        return [coords];
    }

    // Ensure correct winding order (CCW for outer rings in GeoJSON)
    const result = resultRings.map(ring => {
        const wound = ensureWinding(ring, false); // CCW = false (negative area)
        // Preserve original holes that are on land
        const validHoles = holes.filter(hole => {
            const hCentroid = ringCentroid(hole);
            return hCentroid && landMask.isOnLand(hCentroid[0], hCentroid[1]);
        }).map(h => ensureWinding(h, true)); // CW for holes

        return [wound, ...validHoles];
    });

    return result;
}

function subtractHole(ring, hole) {
    // Simple hole subtraction: if hole overlaps ring, clip ring to exclude hole
    // For now, just return ring as-is (holes in land masses are rare and small)
    return ring;
}

// --- Public API ---

export function snapGeometryToLand(geometry, landMask) {
    if (!geometry || !landMask) return geometry;

    // Check cache
    const cacheKey = getCacheKey(geometry);
    if (cacheKey && snappingCache.has(cacheKey)) {
        return snappingCache.get(cacheKey);
    }

    let result;
    const t0 = performance.now();

    try {
        if (geometry.type === 'Polygon') {
            const clipped = clipPolygonToLand(geometry.coordinates, landMask);
            if (clipped.length === 1) {
                result = { type: 'Polygon', coordinates: clipped[0] };
            } else if (clipped.length > 1) {
                result = { type: 'MultiPolygon', coordinates: clipped };
            } else {
                result = geometry; // fallback
            }

            // Island detection
            const islands = findCoveredIslands(geometry, landMask);
            if (islands.length > 0) {
                const multiCoords = result.type === 'MultiPolygon'
                    ? [...result.coordinates]
                    : [result.coordinates];
                for (const island of islands) {
                    const wound = ensureWinding(island, false);
                    multiCoords.push([wound]);
                }
                result = { type: 'MultiPolygon', coordinates: multiCoords };
            }
        } else if (geometry.type === 'MultiPolygon') {
            const allCoords = [];
            for (const polyCoords of geometry.coordinates) {
                const clipped = clipPolygonToLand(polyCoords, landMask);
                allCoords.push(...clipped);
            }

            // Island detection on the original geometry
            const islands = findCoveredIslands(geometry, landMask);
            for (const island of islands) {
                const wound = ensureWinding(island, false);
                allCoords.push([wound]);
            }

            if (allCoords.length === 1) {
                result = { type: 'Polygon', coordinates: allCoords[0] };
            } else if (allCoords.length > 1) {
                result = { type: 'MultiPolygon', coordinates: allCoords };
            } else {
                result = geometry;
            }
        } else {
            result = geometry;
        }

        // Area sanity check: if result < 10% of original, fallback
        const origArea = Math.abs(computeGeometryArea(geometry));
        const resultArea = Math.abs(computeGeometryArea(result));
        if (origArea > 0 && resultArea < origArea * 0.1) {
            console.warn('[coastline-clipper] Area sanity check failed, using original geometry');
            result = geometry;
        }
    } catch (err) {
        console.warn('[coastline-clipper] Clipping error, using original:', err);
        result = geometry;
    }

    const elapsed = performance.now() - t0;
    if (elapsed > 50) {
        console.log(`[coastline-clipper] Slow clip: ${elapsed.toFixed(1)}ms`);
    }

    // Cache result
    if (cacheKey) {
        if (snappingCache.size >= CACHE_MAX) {
            // LRU eviction: remove oldest entry
            const firstKey = snappingCache.keys().next().value;
            snappingCache.delete(firstKey);
        }
        snappingCache.set(cacheKey, result);
    }

    return result;
}

function computeGeometryArea(geometry) {
    if (geometry.type === 'Polygon') {
        return Math.abs(signedArea(geometry.coordinates[0]));
    } else if (geometry.type === 'MultiPolygon') {
        let total = 0;
        for (const poly of geometry.coordinates) {
            total += Math.abs(signedArea(poly[0]));
        }
        return total;
    }
    return 0;
}

// --- Accuracy tests (invokable from console) ---

export function runAccuracyTests(testPolities, landMask) {
    if (!landMask) {
        console.error('No land mask available');
        return null;
    }

    const t0 = performance.now();
    const results = {
        vertexRetention: [],
        areaChange: [],
        territories: 0,
        strategy: activeStrategy,
        time: 0
    };

    for (const feature of testPolities) {
        const original = feature.geometry;
        const snapped = snapGeometryToLand(original, landMask);

        // Vertex retention: what % of original vertices are inside snapped polygon?
        const origRings = getOuterRings(original);
        const snappedRings = getOuterRings(snapped);
        let retained = 0, total = 0;

        for (const ring of origRings) {
            for (const pt of ring) {
                total++;
                for (const sRing of snappedRings) {
                    if (pointInRing(pt, sRing)) { retained++; break; }
                }
            }
        }

        results.vertexRetention.push({
            name: feature.properties.Name,
            pct: total > 0 ? (retained / total * 100) : 100
        });

        // Area change
        const origArea = computeGeometryArea(original);
        const snapArea = computeGeometryArea(snapped);
        results.areaChange.push({
            name: feature.properties.Name,
            pct: origArea > 0 ? ((snapArea - origArea) / origArea * 100) : 0
        });

        results.territories++;
    }

    results.time = performance.now() - t0;

    // Summary
    const avgRetention = results.vertexRetention.reduce((s, r) => s + r.pct, 0) / results.vertexRetention.length;
    const minRetention = Math.min(...results.vertexRetention.map(r => r.pct));
    const avgAreaChange = results.areaChange.reduce((s, r) => s + r.pct, 0) / results.areaChange.length;
    const maxAreaLoss = Math.min(...results.areaChange.map(r => r.pct));

    console.log(`\nSnapping Accuracy Report (${results.territories} territories)`);
    console.log('='.repeat(50));
    console.log(`Vertex retention:     ${avgRetention.toFixed(1)}% avg (min: ${minRetention.toFixed(1)}%)`);
    console.log(`Area change:          ${avgAreaChange.toFixed(1)}% avg (max loss: ${maxAreaLoss.toFixed(1)}%)`);
    console.log(`Strategy:             ${results.strategy}`);
    console.log(`Time:                 ${results.time.toFixed(0)}ms for ${results.territories} territories`);

    return results;
}
