// Async data fetching
import { state } from './state.js';

export async function loadAllData(onProgress, onComplete) {
    let loadedCount = 0;
    const totalToLoad = 3;

    function checkLoaded() {
        loadedCount++;
        if (loadedCount === totalToLoad && onComplete) {
            onComplete();
        }
    }

    // Load polities (split across multiple files for GitHub size limits)
    const polityFiles = [
        'data/cliopatria_polities_part1.geojson',
        'data/cliopatria_polities_part2.geojson',
        'data/cliopatria_polities_part3.geojson'
    ];

    Promise.all(polityFiles.map(file => fetch(file).then(r => r.json())))
        .then(parts => {
            // Merge all features from all parts
            state.allPolities = parts.flatMap(part => part.features);

            // Build founding years lookup (earliest FromYear for each polity name)
            state.polityFoundingYears = {};
            for (const polity of state.allPolities) {
                const name = polity.properties.Name;
                // Skip parenthetical entries
                if (name.startsWith('(') && name.endsWith(')')) continue;
                const fromYear = polity.properties.FromYear;
                if (!(name in state.polityFoundingYears) || fromYear < state.polityFoundingYears[name]) {
                    state.polityFoundingYears[name] = fromYear;
                }
            }

            if (onProgress) {
                onProgress('polities', `Polities loaded: ${state.allPolities.length.toLocaleString()}`);
            }
            checkLoaded();
        })
        .catch(error => {
            if (onProgress) {
                onProgress('polities', `Error loading polities: ${error.message}`);
            }
            checkLoaded();
        });

    // Load cities (filter to only show cities that reach 100k+ population)
    fetch('data/cities.geojson?v=2')
        .then(response => response.json())
        .then(data => {
            // Only include cities that reached at least 100k population at some point
            // Calculate actual max from populations data to ensure accuracy
            state.allCities = data.features.filter(city => {
                const pops = city.properties.populations;
                if (!pops) return false;
                const maxPop = Math.max(...Object.values(pops));
                return maxPop >= 100000;
            });
            if (onProgress) {
                onProgress('cities', `Cities loaded: ${state.allCities.length.toLocaleString()}`);
            }
            checkLoaded();
        })
        .catch(error => {
            if (onProgress) {
                onProgress('cities', `Error loading cities: ${error.message}`);
            }
            checkLoaded();
        });

    // Load world stats
    fetch('data/world_stats.json')
        .then(response => response.json())
        .then(data => {
            state.worldStats = data.data;
            checkLoaded();
        })
        .catch(error => {
            console.warn('Could not load world stats:', error);
            checkLoaded();
        });
}
