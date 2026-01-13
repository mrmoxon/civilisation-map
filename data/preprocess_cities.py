#!/usr/bin/env python3
"""
Preprocess city population data from Chandler and Modelski datasets.
Outputs a normalized JSON file for the map application.
"""

import csv
import json
import re
from collections import defaultdict

def parse_year_column(col):
    """Convert column name like 'BC_3700' or 'AD_100' to integer year."""
    match = re.match(r'(BC|AD)_(\d+)', col)
    if not match:
        return None
    era, year = match.groups()
    year = int(year)
    return -year if era == 'BC' else year

def process_wide_csv(filepath, encoding='cp1252'):
    """Process wide-format CSV where each year is a column.

    Note: Source CSVs are Windows-1252/Latin-1 encoded, not UTF-8.
    """
    cities = {}

    with open(filepath, 'r', encoding=encoding) as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames

        # Find year columns
        year_cols = [(col, parse_year_column(col)) for col in headers if parse_year_column(col) is not None]
        year_cols.sort(key=lambda x: x[1])

        for row in reader:
            city_name = row['City']
            lat = row.get('Latitude', '')
            lon = row.get('Longitude', '')
            country = row.get('Country', '')
            certainty = row.get('Certainty', '1')
            other_name = row.get('OtherName', '')

            # Skip if no coordinates
            if not lat or not lon:
                continue

            try:
                lat = float(lat)
                lon = float(lon)
            except ValueError:
                continue

            # Create unique key for city
            key = f"{city_name}_{lat}_{lon}"

            if key not in cities:
                cities[key] = {
                    'name': city_name,
                    'otherName': other_name,
                    'country': country,
                    'lat': lat,
                    'lon': lon,
                    'certainty': int(certainty) if certainty else 1,
                    'populations': {}
                }

            # Extract population for each year
            for col_name, year in year_cols:
                pop = row.get(col_name, '').strip()
                if pop and pop.isdigit():
                    pop = int(pop)
                    if pop > 0:
                        cities[key]['populations'][year] = pop

    return cities

def merge_datasets(chandler, modelski):
    """Merge two city datasets, preferring Modelski for ancient data."""
    merged = {}

    # Start with Chandler
    for key, city in chandler.items():
        merged[key] = city.copy()
        merged[key]['populations'] = city['populations'].copy()

    # Add/merge Modelski data
    for key, city in modelski.items():
        if key in merged:
            # Merge populations, preferring Modelski for overlapping years < 1000
            for year, pop in city['populations'].items():
                if year not in merged[key]['populations'] or year < 1000:
                    merged[key]['populations'][year] = pop
        else:
            merged[key] = city.copy()
            merged[key]['populations'] = city['populations'].copy()

    return merged

def create_geojson(cities):
    """Convert cities dict to GeoJSON FeatureCollection."""
    features = []

    for key, city in cities.items():
        if not city['populations']:
            continue

        years = sorted(city['populations'].keys())
        min_year = min(years)
        max_year = max(years)
        max_pop = max(city['populations'].values())

        feature = {
            'type': 'Feature',
            'geometry': {
                'type': 'Point',
                'coordinates': [city['lon'], city['lat']]
            },
            'properties': {
                'name': city['name'],
                'otherName': city['otherName'],
                'country': city['country'],
                'certainty': city['certainty'],
                'minYear': min_year,
                'maxYear': max_year,
                'maxPopulation': max_pop,
                'populations': city['populations']
            }
        }
        features.append(feature)

    return {
        'type': 'FeatureCollection',
        'features': features
    }

def print_stats(cities):
    """Print statistics about the dataset."""
    total_cities = len(cities)
    all_years = set()
    total_datapoints = 0

    for city in cities.values():
        all_years.update(city['populations'].keys())
        total_datapoints += len(city['populations'])

    if all_years:
        print(f"Total cities: {total_cities}")
        print(f"Total data points: {total_datapoints}")
        print(f"Year range: {min(all_years)} to {max(all_years)}")

        # Top 10 cities by max population
        top_cities = sorted(
            [(c['name'], max(c['populations'].values())) for c in cities.values() if c['populations']],
            key=lambda x: -x[1]
        )[:10]
        print("\nTop 10 cities by max population:")
        for name, pop in top_cities:
            print(f"  {name}: {pop:,}")

if __name__ == '__main__':
    print("Processing Chandler dataset (2250 BC - 1975 AD)...")
    chandler = process_wide_csv('chandler.csv', encoding='cp1252')
    print(f"  Found {len(chandler)} cities")

    print("Processing Modelski dataset (3700 BC - 1000 AD)...")
    modelski = process_wide_csv('modelski.csv', encoding='latin-1')
    print(f"  Found {len(modelski)} cities")

    print("\nMerging datasets...")
    merged = merge_datasets(chandler, modelski)

    print("\nDataset statistics:")
    print_stats(merged)

    print("\nCreating GeoJSON...")
    geojson = create_geojson(merged)

    output_file = 'cities.geojson'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False)

    print(f"\nSaved to {output_file}")
    print(f"File size: {len(json.dumps(geojson)) / 1024:.1f} KB")
