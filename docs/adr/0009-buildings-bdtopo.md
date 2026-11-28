# ADR 0009: Buildings from IGN BD TOPO, completed with OpenStreetMap

_[Français](0009-buildings-bdtopo.fr.md)_ · Status: accepted · Date: 2026-11-26

## Context

Building footprints and heights came from OpenStreetMap: most heights were missing and guessed,
and every building looked the same (#56). The IGN BD TOPO covers all of France with footprints,
a measured height, storeys, use, roof and wall materials and the lowest and highest roof points,
under Licence Ouverte 2.0.

## Decision

- `tools/build_buildings.py` reads the BD TOPO `batiment` layer through the Géoplateforme WFS
  (paged, cached in `tools/cache/`) and keeps the buildings within 450 m of the line.
- Footprints and heights come from the BD TOPO; storeys, then OSM tags, then the old estimate are
  the fallbacks. The OSM building covering at least half of a footprint lends its tags (kind,
  `roof:shape`).
- `tools/buildings.py` (pure, tested) derives a facade family (old town, slab, modern, house,
  shed, public) and a pitched roof height from the roof points (1.5 m or more, not concrete,
  at most about 30°), and a roof shape (#16): OSM `roof:shape` when known, else a stable draw
  between hipped and gabled by facade family. Records become
  `[height, kind, style, roof_rise, roof_shape, ring...]`.
- The game draws the families from one facade atlas (a shader picks the column), and hipped or
  gabled roofs along the long axis of each footprint (`src/hd2d/roofs.js`, tested), in clay tile,
  slate or zinc colours varied by building.

## Consequences

- Real heights almost everywhere (5,678 of 5,818 buildings), varied streets, pitched roofs.
- `buildings.json` mixes Licence Ouverte and ODbL data: it stays a derived database under ODbL,
  with both attributions.
- The data build needs the IGN WFS once (then the cache).

## Rejected alternatives

- **Matching BD TOPO heights onto OSM footprints**: two geometries to reconcile, and OSM misses
  buildings the BD TOPO has.
- **Buildings traced from the BD ORTHO aerial photos**: a computer-vision project of its own.
