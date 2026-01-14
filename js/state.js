// Centralized state management
export const state = {
    // Data
    allPolities: [],
    allCities: [],
    worldStats: [],

    // Polity founding years lookup (name -> earliest FromYear)
    polityFoundingYears: {},

    // UI State
    currentYear: 1,
    showPolities: true,
    showCities: true,

    // Leaderboard & Stats
    leaderboardSort: 'all',
    leaderboardCollapsed: false,
    leaderboardExpanded: false,
    filterPanelOpen: false,
    statsCollapsed: true,

    // Info Panel
    infoPanelPinned: false,
    currentInfoData: null,

    // Selection tracking (compound selections supported)
    selectedLocation: null, // { type: 'point'|'city'|'river', coords: [lon, lat], city?: cityObject }
    selectedCity: null, // Currently selected city feature
    selectedPolityLayer: null, // Currently selected polity layer (for highlight persistence)
    selectedRiver: null, // Currently selected river feature
    selectedRiverSystem: null, // Array of connected river/lake centerline features
    selectedCoords: null, // [lon, lat] for territory lookup
    hoverPriority: null, // 'city' | 'river' | null - prevents territory hover from overriding
    historyExpanded: false,
    citiesExpanded: false,
    expandedComponent: null, // 'city' | 'territory' | 'river' | null - which component is expanded in compound view

    // City interaction settings
    cityHitLayer: null,

    // Graph
    currentMetric: 'population',
    graphWindowStart: -3400,
    windowSize: 2000,
    windowMode: 'flexible',
    graphData: {},
    graphDataLoaded: false,

    // Leaflet references
    map: null,
    baseLayer: null,
    polityLayer: null,
    cityLayer: null,
    civNamesLayer: null,
    cityHighlight: null,
    crosshairMarker: null,

    // Civilization name labels
    showCivNames: false,

    // Sort carousel
    sortCarouselIndex: 0,

    // Heatmap
    heatmapMode: 'off', // 'off' | 'contested' | 'settled'
    heatmapLayer: null,
    heatmapData: {
        contested: [],  // [[lat, lon, intensity], ...]
        settled: []
    },
    heatmapComputed: false,

    // Timeline jump tracking
    timelineJump: null, // { fromYear, toYear, empireName, empireColor } - tracks when user jumps via location history

    // Location history stack (for leaderboard navigation)
    locationHistory: [] // Array of { coords: [lat, lng], zoom, territoryName, territoryColor } - navigation history stack
};

// Color palette for polities
export const colors = [
    '#e94560', '#4da6ff', '#50c878', '#ffd700', '#ff6b35',
    '#9b59b6', '#1abc9c', '#e74c3c', '#3498db', '#2ecc71',
    '#f39c12', '#9b59b6', '#1abc9c', '#d35400', '#c0392b'
];

// Custom color overrides for specific polities
export const colorOverrides = {
    'Parthian Empire': '#228B22'
};

// Metric definitions
export const metricConfig = {
    population: { label: 'World Population', unit: 'millions', format: v => v + 'M', stackable: false },
    civilizations: { label: 'Civilizations', unit: 'count', format: v => v.toString(), stackable: false },
    landArea: { label: 'Total Land Area', unit: 'km²', format: null, stackable: true }, // format set in graph-panel
    cities: { label: 'Cities', unit: 'count', format: v => v.toString(), stackable: false },
    urbanPop: { label: 'Urban Population', unit: 'people', format: null, stackable: false }, // format set in graph-panel
    gdpPerCapita: { label: 'GDP per Capita', unit: '1990 $', format: v => '$' + v.toLocaleString(), stackable: false },
    largestEmpire: { label: 'Largest Empire', unit: 'km²', format: null, stackable: false }, // format set in graph-panel
    avgAge: { label: 'Avg Civilization Age', unit: 'years', format: null, stackable: false } // format set in graph-panel
};
