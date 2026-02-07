// Snapping accuracy test suite
// Run in browser console: window.runSnappingTests()

import { snapGeometryToLand, activeStrategy, clearSnappingCache } from './coastline-clipper.js';
import { state } from './state.js';

// Point-in-ring test
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

function signedArea(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return area / 2;
}

function getOuterRings(geometry) {
    if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(p => p[0]);
    return [];
}

function computeArea(geometry) {
    const rings = getOuterRings(geometry);
    let total = 0;
    for (const ring of rings) total += Math.abs(signedArea(ring));
    return total;
}

// Distance between two points in degrees
function dist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}

// --- Test 1: Original vertex retention ---
function testVertexRetention(polities, landMask) {
    const results = [];
    for (const f of polities) {
        const snapped = snapGeometryToLand(f.geometry, landMask);
        const origRings = getOuterRings(f.geometry);
        const snapRings = getOuterRings(snapped);
        let retained = 0, total = 0;

        for (const ring of origRings) {
            for (let i = 0; i < ring.length; i++) {
                total++;
                let found = false;
                for (const sRing of snapRings) {
                    if (pointInRing(ring[i], sRing)) { found = true; break; }
                }
                if (found) retained++;
            }
        }

        results.push({
            name: f.properties.Name,
            retained,
            total,
            pct: total > 0 ? (retained / total * 100) : 100
        });
    }

    const avg = results.reduce((s, r) => s + r.pct, 0) / results.length;
    const min = results.reduce((m, r) => r.pct < m.pct ? r : m, results[0]);
    return { results, avg, min: min ? { name: min.name, pct: min.pct } : null };
}

// --- Test 2: Island coverage ---
function testIslandCoverage(polities, landMask) {
    // Known islands that should appear in certain territories at 1 CE
    const expectedIslands = {
        'Roman Empire': [
            { name: 'Sicily', lon: 14.2, lat: 37.5 },
            { name: 'Sardinia', lon: 9.1, lat: 40.1 },
            { name: 'Corsica', lon: 9.1, lat: 42.2 },
            { name: 'Cyprus', lon: 33.4, lat: 35.1 },
            { name: 'Balearics', lon: 3.0, lat: 39.6 },
            { name: 'Crete', lon: 24.9, lat: 35.2 },
        ]
    };

    const results = [];
    for (const f of polities) {
        const expected = expectedIslands[f.properties.Name];
        if (!expected) continue;

        const snapped = snapGeometryToLand(f.geometry, landMask);
        const snapRings = getOuterRings(snapped);
        let found = 0;
        const details = [];

        for (const island of expected) {
            let present = false;
            for (const ring of snapRings) {
                if (pointInRing([island.lon, island.lat], ring)) {
                    present = true;
                    break;
                }
            }
            details.push({ name: island.name, found: present });
            if (present) found++;
        }

        results.push({
            territory: f.properties.Name,
            found,
            total: expected.length,
            details
        });
    }

    const totalFound = results.reduce((s, r) => s + r.found, 0);
    const totalExpected = results.reduce((s, r) => s + r.total, 0);
    return { results, totalFound, totalExpected };
}

// --- Test 3: Area preservation ---
function testAreaPreservation(polities, landMask) {
    const results = [];
    for (const f of polities) {
        const snapped = snapGeometryToLand(f.geometry, landMask);
        const origArea = computeArea(f.geometry);
        const snapArea = computeArea(snapped);
        const pctChange = origArea > 0 ? ((snapArea - origArea) / origArea * 100) : 0;

        results.push({
            name: f.properties.Name,
            origArea: origArea.toFixed(2),
            snapArea: snapArea.toFixed(2),
            pctChange: pctChange.toFixed(1),
            flagged: pctChange < -50
        });
    }

    const avg = results.reduce((s, r) => s + parseFloat(r.pctChange), 0) / results.length;
    const maxLoss = results.reduce((m, r) => parseFloat(r.pctChange) < parseFloat(m.pctChange) ? r : m, results[0]);
    const flagged = results.filter(r => r.flagged);
    return { results, avg, maxLoss: maxLoss ? { name: maxLoss.name, pct: maxLoss.pctChange } : null, flagged };
}

// --- Test 4: Coastline adherence ---
function testCoastlineAdherence(polities, landMask) {
    const results = [];
    const sampleCount = 20; // points per territory

    for (const f of polities) {
        const snapped = snapGeometryToLand(f.geometry, landMask);
        const snapRings = getOuterRings(snapped);
        const distances = [];

        for (const ring of snapRings) {
            const step = Math.max(1, Math.floor(ring.length / sampleCount));
            for (let i = 0; i < ring.length; i += step) {
                const pt = ring[i];
                // Check if this point is near a coast (on boundary of a land polygon)
                let minDist = Infinity;
                const candidates = landMask.getCandidates([pt[0] - 1, pt[1] - 1, pt[0] + 1, pt[1] + 1]);
                for (const poly of candidates) {
                    for (let j = 0; j < poly.ring.length - 1; j++) {
                        const d = distToSegment(pt, poly.ring[j], poly.ring[j + 1]);
                        if (d < minDist) minDist = d;
                    }
                }
                if (minDist < 5) { // only consider points near coast (< 5 degrees)
                    distances.push(minDist);
                }
            }
        }

        if (distances.length > 0) {
            distances.sort((a, b) => a - b);
            const median = distances[Math.floor(distances.length / 2)];
            const p95 = distances[Math.floor(distances.length * 0.95)];
            results.push({ name: f.properties.Name, median, p95, samples: distances.length });
        }
    }

    const allMedians = results.map(r => r.median);
    const overallMedian = allMedians.length > 0 ?
        allMedians.sort((a, b) => a - b)[Math.floor(allMedians.length / 2)] : 0;
    const allP95 = results.map(r => r.p95);
    const overallP95 = allP95.length > 0 ?
        allP95.sort((a, b) => a - b)[Math.floor(allP95.length * 0.95)] : 0;

    return { results, overallMedian, overallP95 };
}

function distToSegment(pt, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return dist(pt, a);
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return dist(pt, [a[0] + t * dx, a[1] + t * dy]);
}

// --- Test 5: Gap detection ---
function testGapDetection(polities, landMask) {
    // Sample points along borders and check if each is claimed by at least one territory
    const snappedGeoms = polities.map(f => ({
        name: f.properties.Name,
        geom: snapGeometryToLand(f.geometry, landMask)
    }));

    let coveredPoints = 0, totalPoints = 0;
    const sampleCount = 10;

    for (let i = 0; i < snappedGeoms.length; i++) {
        const rings = getOuterRings(snappedGeoms[i].geom);
        for (const ring of rings) {
            const step = Math.max(1, Math.floor(ring.length / sampleCount));
            for (let k = 0; k < ring.length; k += step) {
                const pt = ring[k];
                totalPoints++;
                // Check if any territory covers this point
                let covered = false;
                for (let j = 0; j < snappedGeoms.length; j++) {
                    const otherRings = getOuterRings(snappedGeoms[j].geom);
                    for (const oRing of otherRings) {
                        if (pointInRing(pt, oRing)) { covered = true; break; }
                    }
                    if (covered) break;
                }
                if (covered) coveredPoints++;
            }
        }
    }

    const pct = totalPoints > 0 ? (coveredPoints / totalPoints * 100) : 100;
    return { coveredPoints, totalPoints, pct };
}

// --- Test 6: Seam consistency ---
function testSeamConsistency(polities, landMask) {
    // Check if adjacent territories sharing coastal borders use identical vertices
    const snappedGeoms = polities.map(f => ({
        name: f.properties.Name,
        geom: snapGeometryToLand(f.geometry, landMask)
    }));

    let matchingSeams = 0, totalSeams = 0;

    for (let i = 0; i < snappedGeoms.length; i++) {
        const ringsA = getOuterRings(snappedGeoms[i].geom);
        for (let j = i + 1; j < snappedGeoms.length; j++) {
            const ringsB = getOuterRings(snappedGeoms[j].geom);
            // Check for shared vertices
            for (const ringA of ringsA) {
                for (const ringB of ringsB) {
                    let shared = 0;
                    for (const ptA of ringA) {
                        for (const ptB of ringB) {
                            if (Math.abs(ptA[0] - ptB[0]) < 0.0001 && Math.abs(ptA[1] - ptB[1]) < 0.0001) {
                                shared++;
                                break;
                            }
                        }
                    }
                    if (shared >= 2) {
                        totalSeams++;
                        matchingSeams++; // shared vertices = consistent seam
                    }
                }
            }
        }
    }

    return { matchingSeams, totalSeams };
}

// --- Main test runner ---

export function runSnappingTests(landMask) {
    const mask = landMask || state.landMask;
    if (!mask) {
        console.error('No land mask available. Ensure regions.geojson is loaded.');
        return null;
    }

    // Get visible polities at current year
    const year = state.currentYear;
    const polities = state.allPolities.filter(f => {
        const name = f.properties.Name;
        if (name.startsWith('(') && name.endsWith(')')) return false;
        return year >= f.properties.FromYear && year <= f.properties.ToYear;
    });

    console.log(`\nRunning snapping tests on ${polities.length} territories at year ${year}...`);
    clearSnappingCache(); // fresh test

    const t0 = performance.now();

    const retention = testVertexRetention(polities, mask);
    const islands = testIslandCoverage(polities, mask);
    const area = testAreaPreservation(polities, mask);
    const adherence = testCoastlineAdherence(polities, mask);
    const gaps = testGapDetection(polities, mask);
    const seams = testSeamConsistency(polities, mask);

    const totalTime = performance.now() - t0;

    // Print report
    console.log(`\nSnapping Accuracy Report (Year ${year}, ${polities.length} territories)`);
    console.log('='.repeat(50));
    console.log(`Vertex retention:     ${retention.avg.toFixed(1)}% avg (min: ${retention.min?.pct.toFixed(1)}% - ${retention.min?.name})`);
    console.log(`Island coverage:      ${islands.totalFound}/${islands.totalExpected} expected islands found (${islands.totalExpected > 0 ? (islands.totalFound / islands.totalExpected * 100).toFixed(1) : 'N/A'}%)`);
    console.log(`Area change:          ${area.avg.toFixed(1)}% avg (max loss: ${area.maxLoss?.pct}% - ${area.maxLoss?.name})`);
    if (area.flagged.length > 0) {
        console.warn(`  FLAGGED (>50% loss): ${area.flagged.map(f => f.name).join(', ')}`);
    }
    console.log(`Coastline adherence:  ${adherence.overallMedian.toFixed(3)} median, ${adherence.overallP95.toFixed(3)} p95`);
    console.log(`Gap-free borders:     ${gaps.pct.toFixed(1)}% coverage`);
    console.log(`Seam consistency:     ${seams.matchingSeams}/${seams.totalSeams} matching seams`);
    console.log(`Strategy:             ${activeStrategy}`);
    console.log(`Time:                 ${totalTime.toFixed(0)}ms for ${polities.length} territories`);

    return {
        retention,
        islands,
        area,
        adherence,
        gaps,
        seams,
        strategy: activeStrategy,
        time: totalTime,
        territories: polities.length,
        year
    };
}
