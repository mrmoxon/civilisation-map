#!/usr/bin/env node
/**
 * High-resolution heatmap for Britain only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HIGH RESOLUTION for Britain
const GRID_RESOLUTION = 0.1; // 0.1 degrees = ~11km at this latitude
const LAT_MIN = 49.5;
const LAT_MAX = 61;
const LON_MIN = -11;
const LON_MAX = 3;

function pointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function pointInGeometry(lon, lat, geometry) {
    const point = [lon, lat];
    if (geometry.type === 'Polygon') {
        return pointInPolygon(point, geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            if (pointInPolygon(point, poly[0])) return true;
        }
    }
    return false;
}

function getBoundingBox(geometry) {
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    function processCoords(coords) {
        for (const coord of coords) {
            if (Array.isArray(coord[0])) {
                processCoords(coord);
            } else {
                minLon = Math.min(minLon, coord[0]);
                maxLon = Math.max(maxLon, coord[0]);
                minLat = Math.min(minLat, coord[1]);
                maxLat = Math.max(maxLat, coord[1]);
            }
        }
    }
    processCoords(geometry.coordinates);
    return { minLon, maxLon, minLat, maxLat };
}

function pointInBoundingBox(lon, lat, bbox) {
    return lon >= bbox.minLon && lon <= bbox.maxLon &&
           lat >= bbox.minLat && lat <= bbox.maxLat;
}

async function main() {
    const dataDir = path.join(__dirname, '..', 'data');
    const politiesPath = path.join(dataDir, 'cliopatria_polities_only.geojson');
    const outputPath = path.join(dataDir, 'heatmap-britain.json');

    console.log('Loading polities data...');
    const politiesData = JSON.parse(fs.readFileSync(politiesPath, 'utf8'));
    
    // Pre-filter polities that could possibly intersect Britain
    const polities = politiesData.features.filter(p => {
        const bbox = getBoundingBox(p.geometry);
        return !(bbox.maxLon < LON_MIN || bbox.minLon > LON_MAX ||
                 bbox.maxLat < LAT_MIN || bbox.minLat > LAT_MAX);
    });
    console.log(`Filtered to ${polities.length} polities that intersect Britain region`);

    const polityBboxes = polities.map(p => ({
        polity: p,
        bbox: getBoundingBox(p.geometry)
    }));

    const contestedData = [];
    const settledData = [];
    let maxContested = 0;
    let maxSettled = 0;

    const totalLats = Math.ceil((LAT_MAX - LAT_MIN) / GRID_RESOLUTION);
    const totalLons = Math.ceil((LON_MAX - LON_MIN) / GRID_RESOLUTION);
    const totalPoints = totalLats * totalLons;

    console.log(`Sampling ${totalPoints} grid points at ${GRID_RESOLUTION}° resolution...`);

    let processedPoints = 0;
    const startTime = Date.now();

    for (let lat = LAT_MIN; lat <= LAT_MAX; lat += GRID_RESOLUTION) {
        for (let lon = LON_MIN; lon <= LON_MAX; lon += GRID_RESOLUTION) {
            let contestedCount = 0;
            let settledYears = 0;
            const seenPolities = new Set();

            for (const { polity, bbox } of polityBboxes) {
                if (!pointInBoundingBox(lon, lat, bbox)) continue;
                if (pointInGeometry(lon, lat, polity.geometry)) {
                    const name = polity.properties.Name;
                    const duration = polity.properties.ToYear - polity.properties.FromYear;
                    if (!seenPolities.has(name)) {
                        seenPolities.add(name);
                        contestedCount++;
                    }
                    settledYears += duration;
                }
            }

            if (contestedCount > 0) {
                contestedData.push([lat, lon, contestedCount]);
                settledData.push([lat, lon, settledYears]);
                maxContested = Math.max(maxContested, contestedCount);
                maxSettled = Math.max(maxSettled, settledYears);
            }

            processedPoints++;
            if (processedPoints % 1000 === 0) {
                const pct = Math.floor((processedPoints / totalPoints) * 100);
                process.stdout.write(`\rProgress: ${pct}%`);
            }
        }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nCompleted in ${totalTime}s`);
    console.log(`Found ${contestedData.length} data points`);
    console.log(`Max contested: ${maxContested}, Max settled: ${maxSettled} years`);

    const output = {
        metadata: {
            gridResolution: GRID_RESOLUTION,
            bounds: { latMin: LAT_MIN, latMax: LAT_MAX, lonMin: LON_MIN, lonMax: LON_MAX },
            dataPoints: contestedData.length,
            maxContested,
            maxSettled,
            region: 'britain',
            computedAt: new Date().toISOString()
        },
        contested: contestedData,
        settled: settledData
    };

    fs.writeFileSync(outputPath, JSON.stringify(output));
    const fileSize = (fs.statSync(outputPath).size / 1024).toFixed(1);
    console.log(`Saved to ${outputPath} (${fileSize} KB)`);
}

main().catch(console.error);
