// Formatting and geometry utility functions
import { state, colors, colorOverrides, colorPalettes, mixedPalettes } from './state.js';

// Hash functions for color mapping
function defaultHash(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
}

// DJB2 hash - different distribution pattern
function djb2Hash(name) {
    let hash = 5381;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
    }
    return Math.abs(hash);
}

// FNV-1a hash - yet another distribution pattern
function fnv1aHash(name) {
    let hash = 2166136261;
    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash;
}

// Color functions
export function getColor(name) {
    if (colorOverrides[name]) {
        return colorOverrides[name];
    }

    const paletteKey = state.territoryPalette;

    // Check if it's a mixed palette with alternate hash
    if (mixedPalettes[paletteKey]) {
        const mixed = mixedPalettes[paletteKey];
        const palette = mixed.colors;
        let hash;
        switch (mixed.hashMethod) {
            case 'djb2': hash = djb2Hash(name); break;
            case 'fnv1a': hash = fnv1aHash(name); break;
            default: hash = defaultHash(name);
        }
        return palette[hash % palette.length];
    }

    // Standard palette
    const palette = colorPalettes[paletteKey] || colors;
    const hash = defaultHash(name);
    return palette[hash % palette.length];
}

export function darkenColor(hex, amount = 0.3) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.floor((num >> 16) * (1 - amount));
    const g = Math.floor(((num >> 8) & 0x00FF) * (1 - amount));
    const b = Math.floor((num & 0x0000FF) * (1 - amount));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

export function lightenColor(hex, amount = 0.3) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * amount));
    const g = Math.min(255, Math.floor(((num >> 8) & 0x00FF) + (255 - ((num >> 8) & 0x00FF)) * amount));
    const b = Math.min(255, Math.floor((num & 0x0000FF) + (255 - (num & 0x0000FF)) * amount));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
}

// Formatting functions
export function formatYear(year) {
    if (year < 0) {
        return `${Math.abs(year)} BCE`;
    }
    return `${year} CE`;
}

export function formatPopulation(pop) {
    if (pop >= 1000000) {
        return (pop / 1000000).toFixed(1) + 'M';
    }
    if (pop >= 1000) {
        return (pop / 1000).toFixed(0) + 'k';
    }
    return pop.toLocaleString();
}

export function formatArea(area) {
    if (area >= 1000000) {
        return (area / 1000000).toFixed(2) + 'M km²';
    }
    if (area >= 1000) {
        return Math.round(area / 1000) + 'k km²';
    }
    return Math.round(area) + ' km²';
}

export function formatAge(years) {
    if (years >= 1000) {
        return (years / 1000).toFixed(1) + 'k yrs';
    }
    return years + ' yrs';
}

export function formatBillions(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'T';
    if (n >= 1) return n.toFixed(1) + 'B';
    return (n * 1000).toFixed(0) + 'M';
}

// Geometry functions
export function pointInPolygon(point, polygon) {
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

// Calculate minimum distance from a point to a polygon edge
function distanceToPolygonEdge(point, polygon) {
    const [px, py] = point;
    let minDist = Infinity;

    for (let i = 0; i < polygon.length; i++) {
        const [x1, y1] = polygon[i];
        const [x2, y2] = polygon[(i + 1) % polygon.length];

        // Point to line segment distance
        const dx = x2 - x1;
        const dy = y2 - y1;

        if (dx === 0 && dy === 0) {
            // Degenerate segment
            const dist = Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
            minDist = Math.min(minDist, dist);
        } else {
            // Project point onto line segment
            const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
            const projX = x1 + t * dx;
            const projY = y1 + t * dy;
            const dist = Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
            minDist = Math.min(minDist, dist);
        }
    }
    return minDist;
}

// Calculate minimum distance from a point to any polygon edge in a geometry
function distanceToGeometryEdge(lon, lat, geometry) {
    const point = [lon, lat];
    let minDist = Infinity;

    if (geometry.type === 'Polygon') {
        minDist = distanceToPolygonEdge(point, geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            const dist = distanceToPolygonEdge(point, poly[0]);
            minDist = Math.min(minDist, dist);
        }
    }
    return minDist;
}

export function pointInGeometry(lon, lat, geometry, tolerance = 0) {
    const point = [lon, lat];

    // First check exact point-in-polygon
    if (geometry.type === 'Polygon') {
        if (pointInPolygon(point, geometry.coordinates[0])) {
            return true;
        }
    } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) {
            if (pointInPolygon(point, poly[0])) {
                return true;
            }
        }
    }

    // If tolerance > 0, check if point is within tolerance of the edge
    // This helps with coastal cities that fall just outside low-res territory boundaries
    if (tolerance > 0) {
        const dist = distanceToGeometryEdge(lon, lat, geometry);
        if (dist <= tolerance) {
            return true;
        }
    }

    return false;
}

// Calculate approximate area of a polygon (for finding largest in MultiPolygon)
function polygonArea(coords) {
    let area = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        area += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1]);
    }
    return area / 2;
}

// Get centroid of a geometry (for label placement)
export function getCentroid(geometry) {
    let coords;
    if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0];
    } else if (geometry.type === 'MultiPolygon') {
        // Use the largest polygon for the centroid
        let maxArea = 0;
        for (const poly of geometry.coordinates) {
            const area = Math.abs(polygonArea(poly[0]));
            if (area > maxArea) {
                maxArea = area;
                coords = poly[0];
            }
        }
    }
    if (!coords || coords.length === 0) return null;

    // Simple centroid calculation (average of all points)
    let sumLat = 0, sumLng = 0;
    for (const [lng, lat] of coords) {
        sumLat += lat;
        sumLng += lng;
    }
    return {
        lat: sumLat / coords.length,
        lng: sumLng / coords.length
    };
}

// Distance from point to line segment
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
        return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const nearestX = x1 + t * dx;
    const nearestY = y1 + t * dy;

    return Math.sqrt((px - nearestX) * (px - nearestX) + (py - nearestY) * (py - nearestY));
}

// Distance from point to polygon boundary
function pointToPolygonDistance(px, py, coords) {
    let minDist = Infinity;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const dist = pointToSegmentDistance(px, py, coords[j][0], coords[j][1], coords[i][0], coords[i][1]);
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}

// Get visual center (pole of inaccessibility) - point furthest from edges
export function getVisualCenter(geometry) {
    let coords;
    if (geometry.type === 'Polygon') {
        coords = geometry.coordinates[0];
    } else if (geometry.type === 'MultiPolygon') {
        // Use the largest polygon
        let maxArea = 0;
        for (const poly of geometry.coordinates) {
            const area = Math.abs(polygonArea(poly[0]));
            if (area > maxArea) {
                maxArea = area;
                coords = poly[0];
            }
        }
    }
    if (!coords || coords.length === 0) return null;

    // Find bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    // Grid resolution (more samples for better accuracy, but slower)
    const gridSize = 8;
    const stepX = (maxX - minX) / gridSize;
    const stepY = (maxY - minY) / gridSize;

    let bestPoint = null;
    let bestDist = -1;

    // Sample grid points
    for (let gx = 0; gx <= gridSize; gx++) {
        for (let gy = 0; gy <= gridSize; gy++) {
            const px = minX + gx * stepX;
            const py = minY + gy * stepY;

            // Check if point is inside polygon
            if (!pointInPolygon([px, py], coords)) continue;

            // Calculate distance to nearest edge
            const dist = pointToPolygonDistance(px, py, coords);
            if (dist > bestDist) {
                bestDist = dist;
                bestPoint = { lng: px, lat: py };
            }
        }
    }

    // Fallback to centroid if no point found inside
    if (!bestPoint) {
        return getCentroid(geometry);
    }

    return bestPoint;
}

// Population functions
export function getPopulationForYear(city, year) {
    const pops = city.properties.populations;
    const years = Object.keys(pops).map(Number).sort((a, b) => a - b);
    const minYear = city.properties.minYear;

    if (year < minYear) {
        return null;
    }

    let exactMatch = pops[year];
    if (exactMatch !== undefined) {
        return { pop: exactMatch, year: year, status: 'recorded' };
    }

    let pastYear = null;
    let futureYear = null;

    for (const y of years) {
        if (y < year) pastYear = y;
        if (y > year && futureYear === null) futureYear = y;
    }

    if (pastYear !== null) {
        const gap = year - pastYear;
        let status = 'projected';
        if (gap <= 50) status = 'interpolated';
        else if (gap <= 200) status = 'estimated';
        let pop = pops[pastYear];
        if (gap > 500) {
            pop = Math.max(1000, Math.floor(pop * Math.pow(0.999, gap - 500)));
        }
        return { pop: pop, year: pastYear, status: status, gap: gap };
    }

    if (futureYear !== null) {
        const gap = futureYear - year;
        let pop = Math.floor(pops[futureYear] * 0.5);
        return { pop: Math.max(500, pop), year: futureYear, status: 'prehistoric', gap: gap };
    }

    return null;
}

export function getCityRadius(pop) {
    if (pop >= 1000000) return 5;
    if (pop >= 100000) return 4;
    if (pop >= 10000) return 3;
    return 2;
}

// World stats interpolation
export function getWorldStatsForYear(year) {
    if (state.worldStats.length === 0) return null;

    let before = null, after = null;
    for (const s of state.worldStats) {
        if (s.year <= year) before = s;
        if (s.year >= year && !after) after = s;
    }

    if (!before && !after) return null;
    if (!before) return { ...after };
    if (!after) return { ...before };
    if (before.year === after.year) return { ...before };

    const t = (year - before.year) / (after.year - before.year);
    return {
        year: year,
        population: Math.round(before.population + t * (after.population - before.population)),
        gdp_per_capita: Math.round(before.gdp_per_capita + t * (after.gdp_per_capita - before.gdp_per_capita))
    };
}

// City-polity matching
// Tolerance for coastal cities that fall just outside low-resolution territory boundaries
// 0.15° ≈ 16km, enough to catch most coastal cities missed due to coastline resolution mismatch
export const CITY_TERRITORY_TOLERANCE = 0.15;

// Lightness presets for city colors
const cityLightnessPresets = {
    dark: { amount: 0, defaultColor: '#2a2a3e' },
    normal: { amount: 0.3, defaultColor: '#5a5a7e' },
    light: { amount: 0.5, defaultColor: '#8a8aa8' },
    pale: { amount: 0.75, defaultColor: '#b8b8c8' },
    pastel: { amount: 0.88, defaultColor: '#d8d8e8' }
};

export function getCityColor(city, visiblePolities, lightness = 'pale') {
    const [lon, lat] = city.geometry.coordinates;
    const preset = cityLightnessPresets[lightness] || cityLightnessPresets.pale;

    for (const polity of visiblePolities) {
        if (pointInGeometry(lon, lat, polity.geometry, CITY_TERRITORY_TOLERANCE)) {
            const baseColor = getColor(polity.properties.Name);
            if (preset.amount === 0) {
                return baseColor;
            }
            return lightenColor(baseColor, preset.amount);
        }
    }
    return preset.defaultColor;
}

export function countCitiesInPolity(polity, cities, year) {
    let count = 0;
    for (const city of cities) {
        const popData = getPopulationForYear(city, year);
        if (!popData) continue;
        const [lon, lat] = city.geometry.coordinates;
        if (pointInGeometry(lon, lat, polity.geometry, CITY_TERRITORY_TOLERANCE)) {
            count++;
        }
    }
    return count;
}

// River helper functions

// Haversine distance between two points in km
function haversineDistance(lon1, lat1, lon2, lat2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Calculate total river length from geometry
export function calculateRiverLength(geometry) {
    let totalLength = 0;

    const processLine = (coords) => {
        for (let i = 1; i < coords.length; i++) {
            totalLength += haversineDistance(
                coords[i - 1][0], coords[i - 1][1],
                coords[i][0], coords[i][1]
            );
        }
    };

    if (geometry.type === 'LineString') {
        processLine(geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
        for (const line of geometry.coordinates) {
            processLine(line);
        }
    }

    return Math.round(totalLength);
}

// Get river endpoints (source and mouth approximations)
export function getRiverEndpoints(geometry) {
    let firstPoint = null;
    let lastPoint = null;

    if (geometry.type === 'LineString') {
        firstPoint = geometry.coordinates[0];
        lastPoint = geometry.coordinates[geometry.coordinates.length - 1];
    } else if (geometry.type === 'MultiLineString') {
        // Use first point of first line and last point of last line
        const lines = geometry.coordinates;
        if (lines.length > 0) {
            firstPoint = lines[0][0];
            lastPoint = lines[lines.length - 1][lines[lines.length - 1].length - 1];
        }
    }

    return { source: firstPoint, mouth: lastPoint };
}

// Get bounding box of a geometry
function getBoundingBox(geometry) {
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    const processCoords = (coords) => {
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
    };

    processCoords(geometry.coordinates);
    return { minLon, maxLon, minLat, maxLat };
}

// Check if two bounding boxes overlap
function bboxOverlap(box1, box2) {
    return !(box1.maxLon < box2.minLon || box1.minLon > box2.maxLon ||
             box1.maxLat < box2.minLat || box1.minLat > box2.maxLat);
}

// Get all points from a river geometry
function getRiverPoints(geometry) {
    const points = [];

    if (geometry.type === 'LineString') {
        points.push(...geometry.coordinates);
    } else if (geometry.type === 'MultiLineString') {
        for (const line of geometry.coordinates) {
            points.push(...line);
        }
    }

    return points;
}

// Find all polities a river passes through
export function getRiverPolities(riverGeometry, visiblePolities) {
    const riverBbox = getBoundingBox(riverGeometry);
    const riverPoints = getRiverPoints(riverGeometry);
    const result = [];

    // Sample every Nth point for performance (check ~20 points max)
    const sampleRate = Math.max(1, Math.floor(riverPoints.length / 20));

    for (const polity of visiblePolities) {
        const polityBbox = getBoundingBox(polity.geometry);

        // Quick bounding box check
        if (!bboxOverlap(riverBbox, polityBbox)) continue;

        // Check if any sampled river point is inside this polity
        for (let i = 0; i < riverPoints.length; i += sampleRate) {
            const [lon, lat] = riverPoints[i];
            if (pointInGeometry(lon, lat, polity.geometry)) {
                result.push({
                    name: polity.properties.Name,
                    color: getColor(polity.properties.Name),
                    polity: polity
                });
                break; // Found match, no need to check more points
            }
        }
    }

    return result;
}

// Get perimeter points from a polygon geometry (ocean/sea boundary)
function getPolygonPerimeter(geometry) {
    const points = [];

    if (geometry.type === 'Polygon') {
        // Outer ring only (first array)
        points.push(...geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        // Get outer ring from each polygon
        for (const polygon of geometry.coordinates) {
            points.push(...polygon[0]);
        }
    }

    return points;
}

// Find all polities that border a marine feature (ocean, sea, etc.)
export function getMarinePolities(marineGeometry, visiblePolities) {
    const marineBbox = getBoundingBox(marineGeometry);
    const perimeterPoints = getPolygonPerimeter(marineGeometry);
    const result = [];
    const foundPolities = new Set();

    // Sample perimeter points for performance (check ~50 points max for larger features)
    const sampleRate = Math.max(1, Math.floor(perimeterPoints.length / 50));

    // Small buffer distance to check for nearby polities (degrees, ~10km)
    const bufferDistance = 0.1;

    for (const polity of visiblePolities) {
        if (foundPolities.has(polity.properties.Name)) continue;

        const polityBbox = getBoundingBox(polity.geometry);

        // Quick bounding box check with buffer
        const expandedMarineBbox = {
            minLon: marineBbox.minLon - bufferDistance,
            maxLon: marineBbox.maxLon + bufferDistance,
            minLat: marineBbox.minLat - bufferDistance,
            maxLat: marineBbox.maxLat + bufferDistance
        };
        if (!bboxOverlap(expandedMarineBbox, polityBbox)) continue;

        // Check if any sampled perimeter point is inside or near this polity
        for (let i = 0; i < perimeterPoints.length; i += sampleRate) {
            const [lon, lat] = perimeterPoints[i];

            // Check if perimeter point is inside the polity (coastal territory)
            if (pointInGeometry(lon, lat, polity.geometry)) {
                result.push({
                    name: polity.properties.Name,
                    color: getColor(polity.properties.Name),
                    polity: polity
                });
                foundPolities.add(polity.properties.Name);
                break;
            }

            // Also check points slightly inland from the coast
            // Sample a few offset directions to catch nearby polities
            const offsets = [
                [bufferDistance, 0], [-bufferDistance, 0],
                [0, bufferDistance], [0, -bufferDistance]
            ];
            let found = false;
            for (const [dLon, dLat] of offsets) {
                if (pointInGeometry(lon + dLon, lat + dLat, polity.geometry)) {
                    result.push({
                        name: polity.properties.Name,
                        color: getColor(polity.properties.Name),
                        polity: polity
                    });
                    foundPolities.add(polity.properties.Name);
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
    }

    return result;
}

// Format coordinates for display
export function formatCoordinate(lon, lat) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(1)}°${latDir}, ${Math.abs(lon).toFixed(1)}°${lonDir}`;
}

// Find a city at or very near given coordinates
export function findCityAtPoint(lon, lat, year) {
    const threshold = 0.15; // degrees (~15km at equator)

    for (const city of state.allCities) {
        const popData = getPopulationForYear(city, year);
        if (!popData) continue;

        const [cityLon, cityLat] = city.geometry.coordinates;
        const dLon = Math.abs(cityLon - lon);
        const dLat = Math.abs(cityLat - lat);

        if (dLon < threshold && dLat < threshold) {
            return city;
        }
    }
    return null;
}

// Find river(s) near a given point
export function findRiverNearPoint(lon, lat, allRiversData, rivernumIndex, detailLevel = 6) {
    if (!allRiversData || !allRiversData.features) return null;

    const threshold = 0.08; // degrees (~8km) - rivers should be close

    // Filter to visible rivers
    const features = allRiversData.features.filter(f =>
        (f.properties.scalerank || 0) <= detailLevel
    );

    for (const feature of features) {
        const geom = feature.geometry;
        if (!geom) continue; // Skip features without geometry
        let coords = [];

        if (geom.type === 'LineString') {
            coords = [geom.coordinates];
        } else if (geom.type === 'MultiLineString') {
            coords = geom.coordinates;
        }

        // Check distance to each line segment
        for (const line of coords) {
            for (let i = 1; i < line.length; i++) {
                const dist = pointToSegmentDistance(
                    lon, lat,
                    line[i - 1][0], line[i - 1][1],
                    line[i][0], line[i][1]
                );

                if (dist < threshold) {
                    // Found a nearby river - get connected features
                    const rivernum = feature.properties.rivernum;
                    const connectedFeatures = (rivernum !== undefined && rivernumIndex)
                        ? (rivernumIndex[rivernum] || [feature])
                        : [feature];

                    return {
                        river: feature,
                        connectedFeatures: connectedFeatures
                    };
                }
            }
        }
    }

    return null;
}
