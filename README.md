# Civilisation Map

An interactive historical world map showing territorial boundaries, cities, and polities from 3400 BCE to present day.

![Historical World Map](https://img.shields.io/badge/Timeline-3400%20BCE%20to%20Present-blue)

## Features

- **Year-by-year timeline** - Scrub through 5,000+ years of history
- **15,000+ polity records** - Empires, kingdoms, and states from the Cliopatria/Seshat database
- **Historical cities** - Population data for major cities through time
- **Interactive map** - Click on territories to see details, Wikipedia links, and metadata
- **Leaderboard** - See the largest empires for any given year
- **Graph panel** - Visualize trends over time

## Data Sources

| Dataset | Coverage | Description |
|---------|----------|-------------|
| [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) | 3400 BCE – 2024 CE | 15,000+ polity boundary records |
| [Reba/Seto Cities](https://sedac.ciesin.columbia.edu) | 3700 BCE – 2000 CE | Historical city populations |
| [Pleiades](https://atlantides.org/downloads/pleiades/dumps/) | 1000 BCE – 640 CE | Ancient world places |

## Getting Started

1. Clone the repository
2. Serve locally with any static file server:
   ```bash
   python3 -m http.server 8000
   # or
   npx serve .
   ```
3. Open `http://localhost:8000` in your browser

## Project Structure

```
├── index.html          # Main application
├── js/
│   ├── app.js          # Application entry point
│   ├── data-loader.js  # Async data fetching
│   ├── map.js          # Leaflet map setup
│   ├── timeline.js     # Year slider controls
│   └── ...
├── css/                # Stylesheets
├── data/               # GeoJSON and CSV data files
└── scripts/            # Data processing utilities
```

## Tech Stack

- [Leaflet](https://leafletjs.com/) - Interactive maps
- Vanilla JavaScript - No framework dependencies
- GeoJSON - Territorial boundary data

## License

Data sources retain their original licenses. See individual dataset pages for details.
