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
    territoryPalette: 'default',

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
    crosshairStyle: 'cross',

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

    // Timeline history stack (for location history navigation)
    timelineHistory: [], // Array of { year, empireName, empireColor } - timeline navigation history stack

    // Location history stack (for leaderboard navigation)
    locationHistory: [], // Array of { coords: [lat, lng], zoom, territoryName, territoryColor } - navigation history stack

    // Pinned toggles
    pinnedToggles: [] // Array of toggle IDs that are pinned (e.g., ['rivers', 'oceans'])
};

// Color palettes for polities
export const colorPalettes = {
    default: [
        '#e94560', '#4da6ff', '#50c878', '#ffd700', '#ff6b35',
        '#9b59b6', '#1abc9c', '#e74c3c', '#3498db', '#2ecc71',
        '#f39c12', '#9b59b6', '#1abc9c', '#d35400', '#c0392b'
    ],
    warm: [
        '#e94560', '#ff6b35', '#ffd700', '#ff8c42', '#d35400',
        '#c0392b', '#e74c3c', '#f39c12', '#ff5722', '#ff7043',
        '#ffab40', '#ff6e40', '#ff8a65', '#ffccbc', '#d84315'
    ],
    cool: [
        '#4da6ff', '#3498db', '#1abc9c', '#00bcd4', '#0097a7',
        '#00acc1', '#26c6da', '#4dd0e1', '#80deea', '#006064',
        '#0288d1', '#039be5', '#03a9f4', '#29b6f6', '#4fc3f7'
    ],
    vivid: [
        '#ff0055', '#00aaff', '#00ff88', '#ffdd00', '#ff6600',
        '#aa00ff', '#00ffdd', '#ff0000', '#0066ff', '#00ff00',
        '#ffaa00', '#ff00aa', '#00ffaa', '#ff3300', '#cc0000'
    ],
    earth: [
        '#8b7355', '#6b8e23', '#cd853f', '#daa520', '#a0522d',
        '#556b2f', '#8fbc8f', '#d2691e', '#bc8f8f', '#9acd32',
        '#b8860b', '#228b22', '#808000', '#bdb76b', '#696969'
    ]
};

// Mixed palettes use different hash algorithms - marked with hashMethod
export const mixedPalettes = {
    mixed1: { colors: colorPalettes.default, hashMethod: 'djb2' },
    mixed2: { colors: colorPalettes.default, hashMethod: 'fnv1a' }
};

// Default color palette (for backwards compatibility)
export const colors = colorPalettes.default;

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
