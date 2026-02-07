// Performance monitoring — logs to console
// All output uses a [perf] prefix so you can filter in DevTools

const TAG = 'color: #0bf; font-weight: bold';
const NORMAL = 'color: inherit';
const DIM = 'color: #888';

const _marks = {};
const mapUpdateHistory = [];
const zoomHistory = [];

function fmt(ms) {
    if (ms === null || ms === undefined) return '--';
    if (ms < 1) return '<1ms';
    if (ms < 1000) return ms.toFixed(1) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
}

function avg(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Start a named timer
export function markStart(name) {
    _marks[name] = performance.now();
}

// End a named timer, returns duration in ms
export function markEnd(name) {
    const start = _marks[name];
    if (start === undefined) return null;
    const duration = performance.now() - start;
    delete _marks[name];
    return duration;
}

// Record a map update duration
export function recordMapUpdate(durationMs) {
    mapUpdateHistory.push(durationMs);
    if (mapUpdateHistory.length > 50) mapUpdateHistory.shift();
    console.log(
        `%c[perf]%c Map update: ${fmt(durationMs)}  %c(avg ${fmt(avg(mapUpdateHistory))} / worst ${fmt(Math.max(...mapUpdateHistory))} over ${mapUpdateHistory.length} samples)`,
        TAG, NORMAL, DIM
    );
}

// Record a map zoom duration
export function recordMapZoom(durationMs) {
    zoomHistory.push(durationMs);
    if (zoomHistory.length > 50) zoomHistory.shift();
    console.log(
        `%c[perf]%c Map zoom (marker resize): ${fmt(durationMs)}  %c(avg ${fmt(avg(zoomHistory))})`,
        TAG, NORMAL, DIM
    );
}

// Record timeline zoom duration
export function recordTimelineZoom(durationMs) {
    console.log(`%c[perf]%c Timeline zoom: ${fmt(durationMs)}`, TAG, NORMAL);
}

// Record page load milestones
export function recordDataLoad(ms) {
    console.log(`%c[perf]%c Data fetch complete: ${fmt(ms)}`, TAG, NORMAL);
}

export function recordFirstRender(ms) {
    console.log(`%c[perf]%c First render: ${fmt(ms)}`, TAG, NORMAL);
}

// Log Navigation Timing on page load
window.addEventListener('load', () => {
    setTimeout(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
            console.group('%c[perf]%c Page load breakdown', TAG, NORMAL);
            console.log(`DNS lookup:    ${fmt(nav.domainLookupEnd - nav.domainLookupStart)}`);
            console.log(`TCP connect:   ${fmt(nav.connectEnd - nav.connectStart)}`);
            console.log(`Request:       ${fmt(nav.responseStart - nav.requestStart)}`);
            console.log(`Response:      ${fmt(nav.responseEnd - nav.responseStart)}`);
            console.log(`DOM parse:     ${fmt(nav.domContentLoadedEventEnd - nav.responseEnd)}`);
            console.log(`Total load:    ${fmt(nav.loadEventEnd - nav.startTime)}`);
            console.groupEnd();
        }
    }, 200);
});
