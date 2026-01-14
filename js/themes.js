// Theme definitions and switching logic
import { state } from './state.js';

// Theme definitions
export const themes = {
    'light-modern': {
        name: 'Light Modern',
        variables: {
            // Surfaces
            '--surface-primary': '#FAFAFA',
            '--surface-secondary': '#F5F5F5',
            '--surface-tertiary': '#EFEFEF',
            '--surface-page': '#E8E8E8',

            // Text
            '--text-primary': '#1A1A1A',
            '--text-secondary': '#666666',
            '--text-tertiary': '#999999',
            '--text-on-accent': '#FFFFFF',

            // Borders
            '--border-subtle': 'rgba(0, 0, 0, 0.06)',
            '--border-light': 'rgba(0, 0, 0, 0.08)',
            '--border-medium': 'rgba(0, 0, 0, 0.12)',

            // Accent
            '--accent-dark': '#2D2D2D',
            '--accent-success': '#2E7D32',
            '--accent-error': '#C62828',

            // Inputs
            '--input-bg': '#FFFFFF',
            '--input-text': '#1A1A1A',

            // Shadows
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.04)',
            '--shadow-md': '0 2px 4px rgba(0, 0, 0, 0.06)',
            '--shadow-lg': '0 4px 8px rgba(0, 0, 0, 0.08)'
        }
    },

    'dark-modern': {
        name: 'Dark Modern',
        variables: {
            // Surfaces
            '--surface-primary': '#1E1E1E',
            '--surface-secondary': '#252525',
            '--surface-tertiary': '#2D2D2D',
            '--surface-page': '#141414',

            // Text
            '--text-primary': '#E8E8E8',
            '--text-secondary': '#A0A0A0',
            '--text-tertiary': '#707070',
            '--text-on-accent': '#1E1E1E',

            // Borders
            '--border-subtle': 'rgba(255, 255, 255, 0.06)',
            '--border-light': 'rgba(255, 255, 255, 0.08)',
            '--border-medium': 'rgba(255, 255, 255, 0.12)',

            // Accent
            '--accent-dark': '#E0E0E0',
            '--accent-success': '#66BB6A',
            '--accent-error': '#EF5350',

            // Inputs
            '--input-bg': '#2D2D2D',
            '--input-text': '#E8E8E8',

            // Shadows
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.2)',
            '--shadow-md': '0 2px 4px rgba(0, 0, 0, 0.3)',
            '--shadow-lg': '0 4px 8px rgba(0, 0, 0, 0.4)'
        }
    },

    'neutral-modern': {
        name: 'Neutral',
        variables: {
            // Surfaces - grey tones between light and dark
            '--surface-primary': '#D8D8D8',
            '--surface-secondary': '#CECECE',
            '--surface-tertiary': '#C4C4C4',
            '--surface-page': '#B8B8B8',

            // Text
            '--text-primary': '#1A1A1A',
            '--text-secondary': '#4A4A4A',
            '--text-tertiary': '#6A6A6A',
            '--text-on-accent': '#FFFFFF',

            // Borders
            '--border-subtle': 'rgba(0, 0, 0, 0.08)',
            '--border-light': 'rgba(0, 0, 0, 0.10)',
            '--border-medium': 'rgba(0, 0, 0, 0.15)',

            // Accent
            '--accent-dark': '#2D2D2D',
            '--accent-success': '#388E3C',
            '--accent-error': '#D32F2F',

            // Inputs
            '--input-bg': '#FFFFFF',
            '--input-text': '#1A1A1A',

            // Shadows
            '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.06)',
            '--shadow-md': '0 2px 4px rgba(0, 0, 0, 0.08)',
            '--shadow-lg': '0 4px 8px rgba(0, 0, 0, 0.10)'
        }
    },

    'offwhite-modern': {
        name: 'Offwhite',
        variables: {
            // Surfaces - warm offwhite tones
            '--surface-primary': '#F5F1E8',
            '--surface-secondary': '#EDE9E0',
            '--surface-tertiary': '#E5E0D6',
            '--surface-page': '#DDD8CE',

            // Text
            '--text-primary': '#2C2620',
            '--text-secondary': '#5C5650',
            '--text-tertiary': '#8C8680',
            '--text-on-accent': '#FFFFFF',

            // Borders
            '--border-subtle': 'rgba(60, 50, 40, 0.08)',
            '--border-light': 'rgba(60, 50, 40, 0.10)',
            '--border-medium': 'rgba(60, 50, 40, 0.15)',

            // Accent
            '--accent-dark': '#3C3228',
            '--accent-success': '#5D7E4A',
            '--accent-error': '#A05040',

            // Inputs
            '--input-bg': '#FFFFFF',
            '--input-text': '#2C2620',

            // Shadows
            '--shadow-sm': '0 1px 2px rgba(60, 50, 40, 0.06)',
            '--shadow-md': '0 2px 4px rgba(60, 50, 40, 0.08)',
            '--shadow-lg': '0 4px 8px rgba(60, 50, 40, 0.10)'
        }
    }
};

// Current theme
let currentTheme = 'light-modern';

// Apply theme to document
export function applyTheme(themeId) {
    const theme = themes[themeId];
    if (!theme) {
        console.warn(`Theme "${themeId}" not found`);
        return;
    }

    const root = document.documentElement;

    // Apply all CSS variables
    for (const [property, value] of Object.entries(theme.variables)) {
        root.style.setProperty(property, value);
    }

    // Update current theme
    currentTheme = themeId;

    // Store preference
    try {
        localStorage.setItem('map-theme', themeId);
    } catch (e) {
        // localStorage might not be available
    }

    // Update theme button states
    updateThemeButtons();
}

// Get current theme
export function getCurrentTheme() {
    return currentTheme;
}

// Update theme button active states
function updateThemeButtons() {
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
}

// Update crosshair button active states
function updateCrosshairButtons() {
    document.querySelectorAll('.crosshair-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.crosshair === state.crosshairStyle);
    });
}

// Setup settings panel functionality
export function setupSettings() {
    // Theme selection
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const themeId = btn.dataset.theme;
            if (themeId) {
                applyTheme(themeId);
            }
        });
    });

    // Crosshair selection
    document.querySelectorAll('.crosshair-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const crosshairId = btn.dataset.crosshair;
            if (crosshairId) {
                state.crosshairStyle = crosshairId;
                updateCrosshairButtons();
                // Save preference
                try {
                    localStorage.setItem('map-crosshair', crosshairId);
                } catch (e) {
                    // localStorage might not be available
                }
            }
        });
    });

    // Load saved theme preference
    try {
        const savedTheme = localStorage.getItem('map-theme');
        if (savedTheme && themes[savedTheme]) {
            applyTheme(savedTheme);
        }
    } catch (e) {
        // localStorage might not be available
    }

    // Load saved crosshair preference
    try {
        const savedCrosshair = localStorage.getItem('map-crosshair');
        if (savedCrosshair) {
            state.crosshairStyle = savedCrosshair;
            updateCrosshairButtons();
        }
    } catch (e) {
        // localStorage might not be available
    }
}
