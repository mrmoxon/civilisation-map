#!/usr/bin/env python3
"""Split a large GeoJSON FeatureCollection into parts under a size limit."""

import json
import os

INPUT_FILE = 'data/cliopatria_polities_only.geojson'
OUTPUT_DIR = 'data'
MAX_SIZE_MB = 90  # Target max size per file

def main():
    print(f"Loading {INPUT_FILE}...")
    with open(INPUT_FILE, 'r') as f:
        data = json.load(f)

    features = data['features']
    total = len(features)

    print(f"Total features: {total}")
    print(f"Target max size per file: {MAX_SIZE_MB} MB")

    # Calculate size of each feature
    print("Calculating feature sizes...")
    feature_sizes = []
    for feat in features:
        size = len(json.dumps(feat))
        feature_sizes.append(size)

    # Split into parts based on cumulative size
    max_bytes = MAX_SIZE_MB * 1024 * 1024
    overhead = 50  # JSON structure overhead per file

    parts = []
    current_part = []
    current_size = overhead

    for i, feat in enumerate(features):
        feat_size = feature_sizes[i]
        if current_size + feat_size > max_bytes and current_part:
            parts.append(current_part)
            current_part = [feat]
            current_size = overhead + feat_size
        else:
            current_part.append(feat)
            current_size += feat_size

    if current_part:
        parts.append(current_part)

    print(f"Split into {len(parts)} parts")

    # Write each part
    for i, part_features in enumerate(parts):
        part_data = {
            "type": "FeatureCollection",
            "features": part_features
        }

        output_file = os.path.join(OUTPUT_DIR, f'cliopatria_polities_part{i + 1}.geojson')
        print(f"Writing {output_file} ({len(part_features)} features)...")

        with open(output_file, 'w') as f:
            json.dump(part_data, f)

        size_mb = os.path.getsize(output_file) / (1024 * 1024)
        print(f"  Size: {size_mb:.2f} MB")

    print(f"\nCreated {len(parts)} files. You can now delete the original.")

if __name__ == '__main__':
    main()
