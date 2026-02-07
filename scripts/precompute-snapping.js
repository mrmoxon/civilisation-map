#!/usr/bin/env node
// Pre-compute coastline-snapped territory geometries
//
// Strategy: For each territory polygon vertex that falls in water (outside
// all land polygons), project it to the nearest point on the nearest land
// polygon boundary. Inland vertices pass through unchanged.
//
// This preserves the territory shape while pulling coastal vertices onto
// the actual coastline.
//
// Usage: node scripts/precompute-snapping.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// --- Geometry helpers ---

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

function dist2(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function nearestPointOnSegment(pt, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { point: a.slice(), dist2: dist2(pt, a) };
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj = [a[0] + t * dx, a[1] + t * dy];
    return { point: proj, dist2: dist2(pt, proj) };
}

function signedArea(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return area / 2;
}

// --- Spatial index ---

const GRID_SIZE = 2;

class LandMask {
    constructor(polygons) {
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

    // Check if a point is on land (inside any land polygon, not in a hole)
    isOnLand(lon, lat) {
        const gx = Math.floor(lon / GRID_SIZE);
        const gy = Math.floor(lat / GRID_SIZE);
        const key = `${gx},${gy}`;
        const indices = this.grid[key];
        if (!indices) return false;
        for (const idx of indices) {
            const poly = this.polygons[idx];
            if (lon < poly.bbox[0] || lon > poly.bbox[2] || lat < poly.bbox[1] || lat > poly.bbox[3]) continue;
            if (pointInRing([lon, lat], poly.ring)) {
                let inHole = false;
                for (const hole of poly.holes) {
                    if (pointInRing([lon, lat], hole)) { inHole = true; break; }
                }
                if (!inHole) return true;
            }
        }
        return false;
    }

    // Get candidate land polygons that overlap a bounding box
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

    // Find nearest point on any land polygon boundary to the given point
    // Search within a radius (degrees)
    nearestCoastPoint(lon, lat, searchRadius) {
        const bbox = [lon - searchRadius, lat - searchRadius, lon + searchRadius, lat + searchRadius];
        const candidates = this.getCandidates(bbox);

        let bestDist = Infinity;
        let bestPoint = null;

        for (const poly of candidates) {
            // Check outer ring
            for (let i = 0; i < poly.ring.length - 1; i++) {
                const result = nearestPointOnSegment([lon, lat], poly.ring[i], poly.ring[i + 1]);
                if (result.dist2 < bestDist) {
                    bestDist = result.dist2;
                    bestPoint = result.point;
                }
            }
        }

        return bestPoint;
    }
}

// --- Build land mask ---

function buildLandMask(regionsGeoJSON) {
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

    return new LandMask(polygons);
}

// --- Core snapping: project water vertices onto nearest coastline ---

function snapRing(ring, landMask) {
    const result = [];
    let snappedCount = 0;

    for (let i = 0; i < ring.length; i++) {
        const pt = ring[i];
        const onLand = landMask.isOnLand(pt[0], pt[1]);

        if (onLand) {
            // Vertex is on land - keep as-is
            result.push(pt.slice());
        } else {
            // Vertex is in water - snap to nearest coastline
            const nearest = landMask.nearestCoastPoint(pt[0], pt[1], 5);
            if (nearest) {
                result.push(nearest);
                snappedCount++;
            } else {
                // No coastline found nearby - keep original
                result.push(pt.slice());
            }
        }
    }

    // Also: for edges that cross from land to water, insert coastline
    // intersection points to add detail along the coast
    const detailed = addCoastlineDetail(result, landMask);

    return { ring: detailed, snappedCount };
}

// For consecutive vertices where one is on land and the other was snapped,
// insert intermediate coastline points to add detail
function addCoastlineDetail(ring, landMask) {
    if (ring.length < 3) return ring;

    const result = [];
    for (let i = 0; i < ring.length; i++) {
        result.push(ring[i]);

        const next = ring[(i + 1) % ring.length];
        const curr = ring[i];

        // If both points are close together, no need for detail
        const edgeLen = Math.sqrt(dist2(curr, next));
        if (edgeLen < 0.5) continue; // less than 0.5 degrees

        // Check if this edge runs along a coastline (both endpoints near coast)
        const currOnLand = landMask.isOnLand(curr[0], curr[1]);
        const nextOnLand = landMask.isOnLand(next[0], next[1]);

        // Only add detail for edges where at least one end is coastal
        if (currOnLand && nextOnLand) continue; // fully inland edge
        if (!currOnLand && !nextOnLand && edgeLen < 2) continue; // both in water, short edge

        // Sample along the edge and snap intermediate points
        const numSamples = Math.min(20, Math.ceil(edgeLen / 0.3));
        if (numSamples <= 1) continue;

        for (let s = 1; s < numSamples; s++) {
            const t = s / numSamples;
            const midLon = curr[0] + t * (next[0] - curr[0]);
            const midLat = curr[1] + t * (next[1] - curr[1]);

            if (!landMask.isOnLand(midLon, midLat)) {
                const nearest = landMask.nearestCoastPoint(midLon, midLat, 3);
                if (nearest) {
                    result.push(nearest);
                }
            } else {
                result.push([midLon, midLat]);
            }
        }
    }

    return result;
}

// --- Snap a full geometry ---

function snapGeometry(geometry, landMask) {
    if (!geometry) return geometry;

    function snapPolygonCoords(coords) {
        const outerRing = coords[0];
        const holes = coords.slice(1);

        const { ring: snappedOuter, snappedCount } = snapRing(outerRing, landMask);

        // Only snap holes that are meaningful
        const snappedHoles = holes.map(h => snapRing(h, landMask).ring);

        return { coords: [snappedOuter, ...snappedHoles], snappedCount };
    }

    if (geometry.type === 'Polygon') {
        const { coords, snappedCount } = snapPolygonCoords(geometry.coordinates);
        return { geometry: { type: 'Polygon', coordinates: coords }, snappedCount };
    } else if (geometry.type === 'MultiPolygon') {
        let totalSnapped = 0;
        const newCoords = geometry.coordinates.map(polyCoords => {
            const { coords, snappedCount } = snapPolygonCoords(polyCoords);
            totalSnapped += snappedCount;
            return coords;
        });
        return { geometry: { type: 'MultiPolygon', coordinates: newCoords }, snappedCount: totalSnapped };
    }

    return { geometry, snappedCount: 0 };
}

function computeArea(geometry) {
    if (geometry.type === 'Polygon') {
        return Math.abs(signedArea(geometry.coordinates[0]));
    } else if (geometry.type === 'MultiPolygon') {
        let total = 0;
        for (const poly of geometry.coordinates) total += Math.abs(signedArea(poly[0]));
        return total;
    }
    return 0;
}

// =====================
//        MAIN
// =====================

console.log('Loading data...');
const t0 = Date.now();

const regionsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/terrain/regions.geojson'), 'utf8'));
const politiesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/polities_initial.geojson'), 'utf8'));
console.log(`  Loaded in ${Date.now() - t0}ms`);

console.log('Building land mask...');
const t1 = Date.now();
const landMask = buildLandMask(regionsData);
console.log(`  ${landMask.polygons.length} land polygons indexed in ${Date.now() - t1}ms`);

// Filter for 1 CE
const year = 1;
const allAt1CE = politiesData.features.filter(f => {
    const name = f.properties.Name;
    if (name.startsWith('(') && name.endsWith(')')) return false;
    return f.properties.FromYear <= year && f.properties.ToYear >= year;
});
console.log(`\n${allAt1CE.length} territories visible at ${year} CE`);

// --- Roman Empire only ---
const roman = allAt1CE.filter(f => f.properties.Name === 'Roman Empire');
if (roman.length > 0) {
    console.log('\nSnapping Roman Empire...');
    const t2 = Date.now();
    const { geometry: snappedGeom, snappedCount } = snapGeometry(roman[0].geometry, landMask);
    const elapsed = Date.now() - t2;

    const origArea = computeArea(roman[0].geometry);
    const snapArea = computeArea(snappedGeom);
    const origPts = countPoints(roman[0].geometry);
    const snapPts = countPoints(snappedGeom);

    console.log(`  Done in ${elapsed}ms`);
    console.log(`  Vertices snapped: ${snappedCount}`);
    console.log(`  Points: ${origPts} -> ${snapPts}`);
    console.log(`  Area change: ${((snapArea - origArea) / origArea * 100).toFixed(1)}%`);

    const romanGeoJSON = {
        type: 'FeatureCollection',
        features: [{ ...roman[0], geometry: snappedGeom }]
    };
    const romanPath = path.join(ROOT, 'data/snapped_roman_1ce.geojson');
    fs.writeFileSync(romanPath, JSON.stringify(romanGeoJSON));
    console.log(`  Saved to ${romanPath} (${(fs.statSync(romanPath).size / 1024).toFixed(0)} KB)`);
}

// --- All territories ---
console.log('\nSnapping all territories...');
const t3 = Date.now();

const snappedAll = allAt1CE.map(f => {
    const name = f.properties.Name;
    const ft = Date.now();
    const { geometry: snappedGeom, snappedCount } = snapGeometry(f.geometry, landMask);
    const felapsed = Date.now() - ft;

    const origPts = countPoints(f.geometry);
    const snapPts = countPoints(snappedGeom);

    if (snappedCount > 0) {
        console.log(`  ${name}: ${felapsed}ms, ${snappedCount} vertices snapped, ${origPts}->${snapPts} pts`);
    } else {
        console.log(`  ${name}: ${felapsed}ms (fully inland, unchanged)`);
    }

    return { ...f, geometry: snappedGeom };
});

const totalElapsed = Date.now() - t3;
console.log(`\n  ${snappedAll.length} territories in ${totalElapsed}ms`);

const worldGeoJSON = {
    type: 'FeatureCollection',
    features: snappedAll
};
const worldPath = path.join(ROOT, 'data/snapped_world_1ce.geojson');
fs.writeFileSync(worldPath, JSON.stringify(worldGeoJSON));
console.log(`  Saved to ${worldPath} (${(fs.statSync(worldPath).size / 1024).toFixed(0)} KB)`);

console.log('\nDone!');

function countPoints(geometry) {
    let total = 0;
    if (geometry.type === 'Polygon') {
        for (const ring of geometry.coordinates) total += ring.length;
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates)
            for (const ring of poly) total += ring.length;
    }
    return total;
}
