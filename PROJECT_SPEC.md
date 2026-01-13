# Historical World Map Project Specification

## Goal

Build a comprehensive historical map application with year-by-year territorial boundaries from antiquity to present, using open-source data augmented by procedural generation to fill gaps.

---

## Phase 1: Load Base Data

### 1.1 Regions (Polygons)

| Source | Coverage | Records | Format | URL |
|--------|----------|---------|--------|-----|
| aourednik/historical-basemaps | ~50 discrete years, prehistory–2000s | ~50 GeoJSON files | GeoJSON | github.com/aourednik/historical-basemaps |
| Cliopatria (Seshat) | 3400 BCE – 2024 CE | 15,000+ records, 1,800+ polities | Single GeoJSON | github.com/Seshat-Global-History-Databank/cliopatria |
| CShapes 2.0 | 1886–2019 (daily precision) | All modern states | Shapefile/GeoJSON/R | icr.ethz.ch/data/cshapes/ |
| GREG (ethnic background) | Single snapshot (~1964) | 8,969 polygons, 928 groups | Shapefile | icr.ethz.ch/data/greg/ |

**Strategy:** Use aourednik for initial discrete snapshots, overlay Cliopatria for documented polities, CShapes for modern period, GREG as fallback ethnic layer for undocumented regions.

### 1.2 Cities/Settlements (Points)

| Source | Coverage | Key Fields | URL |
|--------|----------|------------|-----|
| Reba/Seto (SEDAC) | 3700 BCE – 2000 CE (~1,700 cities, 10,000+ data points) | name, lat, lon, year, population, reliability | sedac.ciesin.columbia.edu |
| Pleiades | ~1000 BCE – 640 CE (36,000+ places) | name, coordinates, time period, place type | atlantides.org/downloads/pleiades/dumps/ |
| CHGIS (China) | 221 BCE – 1911 CE | name, coordinates, dynasty | chgis.fairbank.fas.harvard.edu |

### 1.3 Infrastructure (Lines/Points)

| Source | Type | Coverage | URL |
|--------|------|----------|-----|
| Itiner-e (2025) | Roads | Roman Empire, 299,171 km | itiner-e.org / Zenodo |
| AWMC geodata | Roads, aqueducts, rivers | Roman world | github.com/AWMC/geodata |
| DARMC | Roads, ports, shipwrecks | Roman/Medieval | darmc.harvard.edu/data-availability |

### 1.4 Demographic Data Available

| Dataset | Demographic Fields | Notes |
|---------|-------------------|-------|
| Reba/Seto | City population by year | Best source — 6,000 years of urban pop estimates |
| Cliopatria | Area (km²) per polity | Can proxy for relative power/size |
| Pleiades | Place type (settlement, fort, etc.) | No population |
| GREG | Ethnic group name | No population, static snapshot |
| Seshat Databank (parent of Cliopatria) | Population estimates, social complexity variables | Requires separate access: seshatdatabank.info |

**Gap:** No comprehensive historical population-by-region dataset exists. Reba/Seto gives city populations; extrapolating regional populations would require modeling (e.g., assume X% urbanization rate by era).

---

## Phase 2: Data Cleanup

### 2.1 Geometry Issues

- [ ] Align coastlines to consistent baseline (Natural Earth or GSHHG)
- [ ] Fix topology errors (gaps, overlaps) — aourednik acknowledges some deliberate overlaps for disputed territories
- [ ] Snap boundaries to rivers/mountain ranges where historically appropriate
- [ ] Handle antimeridian wrapping (Pacific crossings)

### 2.2 Temporal Normalization

- [ ] Standardize year format (BCE as negative integers)
- [ ] Interpolate between discrete snapshots (aourednik has ~50 years; need to decide interpolation strategy)
- [ ] Align city population dates with region dates

### 2.3 Projection

- All sources use WGS84 (EPSG:4326) — maintain this for web compatibility
- Consider equal-area projection (Mollweide) for area calculations

---

## Phase 3: Procedural Generation

### 3.1 Fill Empty Regions

Where Cliopatria/aourednik have gaps (most of pre-colonial world):

1. **City-anchored Voronoi:** Generate territory polygons from city points, weighted by population
2. **Geographic constraints:**
   - Rivers as boundaries (need river dataset — Natural Earth or HydroSHEDS)
   - Mountain ranges as barriers (need elevation/terrain)
   - Coastlines as hard edges
3. **Ethnic layer fallback:** Use GREG polygons where no cities exist
4. **Confidence styling:** Procedurally-generated regions get fuzzy/transparent borders (BORDERPRECISION = 1)

### 3.2 Temporal Interpolation

- Linear interpolation of boundaries between known snapshots
- Or: boundaries static until next known change (step function)

### 3.3 AI Augmentation

- Use LLM to fill in historically plausible polities for documented-but-unmapped regions
- **Feed:** known cities, ethnic groups, historical texts
- **Output:** approximate boundary polygons with low confidence

---

## Data Stack Summary

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR APPLICATION                     │
├─────────────────────────────────────────────────────────┤
│  Procedural Generation Layer (Voronoi + AI)             │
├─────────────────────────────────────────────────────────┤
│  Infrastructure: Itiner-e roads, AWMC, DARMC            │
├─────────────────────────────────────────────────────────┤
│  Cities: Reba/Seto (population) + Pleiades (ancient)    │
├─────────────────────────────────────────────────────────┤
│  Regions: aourednik + Cliopatria + CShapes + GREG       │
└─────────────────────────────────────────────────────────┘
```

---

## Data Sources Quick Reference

| # | Dataset | URL |
|---|---------|-----|
| 1 | aourednik/historical-basemaps | github.com/aourednik/historical-basemaps |
| 2 | Cliopatria | github.com/Seshat-Global-History-Databank/cliopatria |
| 3 | Reba/Seto cities | sedac.ciesin.columbia.edu |
| 4 | Pleiades | atlantides.org/downloads/pleiades/dumps/ |
| 5 | Itiner-e roads | itiner-e.org (Zenodo link) |
| 6 | CShapes 2.0 | icr.ethz.ch/data/cshapes/ |
| 7 | GREG ethnic | icr.ethz.ch/data/greg/ |
| 8 | Natural Earth | naturalearthdata.com |

---

## Open Questions

1. **Interpolation strategy:** Step function or linear morph between known years?
2. **Conflict handling:** When Cliopatria and aourednik disagree, which wins?
3. **Procedural confidence:** How to visually distinguish AI-generated vs. documented regions?
4. **Regional population:** Model from city populations, or treat as unknown?
