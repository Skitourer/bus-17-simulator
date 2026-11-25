# ADR 0005: Water surfaces cut out of the ground

_[Français](0005-water.fr.md)_ · Status: accepted · Date: 2026-11-25

## Context

The Isère and the other OSM water areas were only painted on the ground texture (#15). The
IGN terrain under a river gives its surface, but its 40 m grid blurs the river into its
banks, and roads along the quays are shaped into the same ground grid.

## Decision

- `tools/water.py` precomputes, in the street tiles (`tools/build_streets.py`):
  - the union of the OSM water areas of at least 20 m²;
  - a water level per node of the 10 m grid: the terrain under the water smoothed over
    60 m (from the points at least 15 m from a bank), kept 3 m below the lowest bank
    within 60 m (quays);
  - the ground triangles that touch the water (`wet`), the water cut along them
    (`water`), their dry parts (`dry`) and the banks (`banks`).
- In the game, wet ground triangles are not drawn and their dry parts are drawn instead,
  so no ground or road shows through the water. The water is drawn at its level with a
  pixel-art shader (sky reflection with Fresnel, ripples, foam within `foamWidth` of a
  bank); stone quay walls stand along the banks, from the ground down below the water.
- Bridge piers reach below the water surface.

## Consequences

- Flat water bounded by quays; roads and buildings beside the river are unchanged.
- The tiles grow by about 2.5 MB (level grids and pieces in 80 of the 182 tiles).
- The bus can still drive onto the water (the ground under it is not drawn): blocking it
  needs the water areas in the collision index, left for later.

## Rejected alternatives

- **Lowering the ground under the water**: the triangles across a bank would slope from
  the quay to the bed and show through the water near the banks, and the quay roads
  share those grid nodes.
- **One flat level per water area**: the Isère drops about 5 m across the map.
- **Hiding the ground with the depth or stencil buffer**: hides ground that stands in
  front of the water on screen.
