// Async data fetching — instant initial load + background full load
import { state } from './state.js';

const TAG = 'color: #0bf; font-weight: bold';
const NORMAL = 'color: inherit';

function fmt(ms) {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return ms.toFixed(0) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
}

// Fetch + parse in a Web Worker (off main thread)
function workerFetch(url) {
    return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const worker = new Worker('js/parse-worker.js');

        worker.onmessage = (e) => {
            const totalMs = performance.now() - t0;
            const name = url.split('/').pop();
            worker.terminate();

            if (e.data.error) {
                console.log(`%c[perf]%c   ${name}: FAILED (${e.data.error})`, TAG, NORMAL);
                reject(new Error(e.data.error));
                return;
            }

            console.log(
                `%c[perf]%c   ${name}: %c${fmt(totalMs)}%c  (worker: fetch+parse+transfer)`,
                TAG, NORMAL, 'font-weight: bold', NORMAL
            );

            resolve(e.data.data);
        };

        worker.onerror = (err) => {
            worker.terminate();
            reject(err);
        };

        // Resolve to absolute URL so the worker fetches from the right path
        const absoluteUrl = new URL(url, window.location.href).href;
        worker.postMessage({ url: absoluteUrl });
    });
}

function rebuildFoundingYears() {
    state.polityFoundingYears = {};
    for (const polity of state.allPolities) {
        const name = polity.properties.Name;
        if (name.startsWith('(') && name.endsWith(')')) continue;
        const fromYear = polity.properties.FromYear;
        if (!(name in state.polityFoundingYears) || fromYear < state.polityFoundingYears[name]) {
            state.polityFoundingYears[name] = fromYear;
        }
    }
}

// Build temporal index: sorted by FromYear, parenthetical entries pre-filtered
function buildTemporalIndex() {
    const t0 = performance.now();

    const sorted = state.allPolities
        .filter(f => {
            const name = f.properties.Name;
            return !(name.startsWith('(') && name.endsWith(')'));
        })
        .sort((a, b) => a.properties.FromYear - b.properties.FromYear);

    const fromYears = new Int16Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) {
        fromYears[i] = sorted[i].properties.FromYear;
    }

    state.polityIndex = { sorted, fromYears };

    console.log(
        `%c[perf]%c Temporal index built: ${sorted.length.toLocaleString()} entries in ${fmt(performance.now() - t0)}`,
        TAG, NORMAL
    );
}

export async function loadAllData(onProgress, onComplete) {
    let otherLoaded = 0;
    const otherTotal = 2; // cities + world_stats
    let politiesComplete = false;

    function checkAllDone() {
        if (politiesComplete && otherLoaded === otherTotal && onComplete) {
            onComplete();
        }
    }

    function checkOther() {
        otherLoaded++;
        checkAllDone();
    }

    // --- Phase 1: Load tiny initial snapshot (features near 1 CE) ---
    const t0 = performance.now();
    console.log('%c[perf]%c Phase 1: Loading initial snapshot...', TAG, NORMAL);

    workerFetch('data/polities_initial.geojson')
        .then(data => {
            state.allPolities = data.features;
            rebuildFoundingYears();
            buildTemporalIndex();

            console.log(
                `%c[perf]%c Initial snapshot ready: ${data.features.length} features in %c${fmt(performance.now() - t0)}`,
                TAG, NORMAL, 'font-weight: bold'
            );

            // Render immediately
            onProgress('polities-ready', null);

            // --- Phase 2: Load full files in background ---
            loadFullPolities(onProgress, () => {
                politiesComplete = true;
                checkAllDone();
            });
        })
        .catch(error => {
            console.log(`%c[perf]%c Initial snapshot failed, falling back to full load`, TAG, NORMAL);
            // Fallback: load full files directly
            loadFullPolities(onProgress, () => {
                politiesComplete = true;
                checkAllDone();
            });
        });

    // --- Cities (worker) ---
    workerFetch('data/cities.geojson?v=2')
        .then(data => {
            const tFilter = performance.now();
            state.allCities = data.features.filter(city => {
                const pops = city.properties.populations;
                if (!pops) return false;
                const maxPop = Math.max(...Object.values(pops));
                return maxPop >= 100000;
            });
            console.log(
                `%c[perf]%c Cities ready: ${state.allCities.length.toLocaleString()} / ${data.features.length.toLocaleString()} features  (filter ${fmt(performance.now() - tFilter)})`,
                TAG, NORMAL
            );
            if (onProgress) {
                onProgress('cities', `Cities loaded: ${state.allCities.length.toLocaleString()}`);
            }
            checkOther();
        })
        .catch(error => {
            if (onProgress) {
                onProgress('cities', `Error loading cities: ${error.message}`);
            }
            checkOther();
        });

    // --- World stats (worker) ---
    workerFetch('data/world_stats.json')
        .then(data => {
            state.worldStats = data.data;
            checkOther();
        })
        .catch(error => {
            console.warn('Could not load world stats:', error);
            checkOther();
        });
}

// Phase 2: Load all 3 full polity files in background, replace initial snapshot
function loadFullPolities(onProgress, onDone) {
    const polityFiles = [
        'data/cliopatria_polities_part1.geojson',
        'data/cliopatria_polities_part2.geojson',
        'data/cliopatria_polities_part3.geojson'
    ];

    const t0 = performance.now();
    console.log('%c[perf]%c Phase 2: Loading full polity data in background...', TAG, NORMAL);

    // Collect all features from all files, then replace in one go
    const allParts = new Array(polityFiles.length).fill(null);
    let filesLoaded = 0;

    polityFiles.forEach((file, index) => {
        workerFetch(file).then(data => {
            allParts[index] = data.features;
            filesLoaded++;

            if (onProgress) {
                const totalSoFar = allParts.reduce((sum, p) => sum + (p ? p.length : 0), 0);
                onProgress('polities', `Polities: ${totalSoFar.toLocaleString()} (${filesLoaded}/${polityFiles.length})`);
            }

            // Once all files are in, replace the initial snapshot
            if (filesLoaded === polityFiles.length) {
                const tMerge = performance.now();
                state.allPolities = allParts.flat();
                rebuildFoundingYears();
                buildTemporalIndex();

                const totalMs = performance.now() - t0;
                const mergeMs = performance.now() - tMerge;
                console.log(
                    `%c[perf]%c All polities ready: ${state.allPolities.length.toLocaleString()} features in %c${fmt(totalMs)}%c  (merge ${fmt(mergeMs)})`,
                    TAG, NORMAL, 'font-weight: bold', NORMAL
                );

                // Re-render with full data
                onProgress('polities-update', null);
                onDone();
            }
        }).catch(error => {
            console.warn(`Failed to load ${file}:`, error);
            filesLoaded++;
            if (filesLoaded === polityFiles.length) {
                onDone();
            }
        });
    });
}
