# ADR 0003: Streets v2, precomputed ground and road tiles

_[Français](0003-streets-v2.fr.md)_ · Status: accepted · Date: 2026-11-24

## Context

Roads were ribbons draped on a 40 m terrain grid: tilted sideways on slopes, overlapping
at junctions, painted on rivers at bridges, and the bus, the camera, buildings and trees
each read a terrain that did not match what was drawn.

## Decision

- `tools/build_streets.py` precomputes, with shapely, 500 m tiles (each file under 1 MB) in
  `data/grenoble/tiles/`:
  - road heights: the natural terrain smoothed along each road, tied to a common height
    at every junction, the two carriageways of a dual road at their mean height, and a side street
    starting on the surface of the road it joins (higher class, then the road carrying on straight, then
    the wider) before easing into its own profile over 15 m (#92); bridges straight between their ends;
    tunnels left out (a concrete
    mouth is drawn where they meet an open road; building passages are streets, the building
    part above them drawn from 4.5 m, #14);
  - a 5 m ground grid (10 m until #92) set to the road height on the carriageway and 2.5 m beside it,
    then blended back to the natural terrain over 8 m (banks); every corner of a triangle
    touching the carriageway is at the road height, so the road is flat across (#76), and the
    build lists the road triangles still steeper than 7 % across (roads closer than the grid
    at different heights, such as tight hairpins);
  - the carriageway: union of all road pieces at their real width (junctions and
    roundabouts come out clean), cut along the ground triangles so every piece is
    coplanar with the ground;
  - bridge decks as centrelines with heights;
  - 2.5 m sidewalks (raised 15 cm, kerb faces) along streets other than service roads
    and busways, dashed centre lines on two-way streets of 5.5 m or more, and zebra
    crossings on main roads next to junctions;
  - buildings clipped 0.3 m off the carriageway, and trees (OSM and seeded in parks and
    woods) kept 1 m off the carriageway and outside buildings. Buildings stand on a stone
    plinth from their lowest ground point, so no wall is cut by the slope.
- In the game, `Ground` (`src/hd2d/ground.js`) is the single height source: ground
  triangles exactly as rendered, bridge decks when the vehicle is at deck level, the
  coarse IGN grid outside the tiles.
- All tiles are loaded at start for now (182 files, 20 MB, about a fifth once
  compressed by the web server); loading around the bus comes with #12.

## Consequences

- Flat road cross-sections, clean junctions, bridges above the water, and objects sitting
  on what is drawn.
- About 75 MB of generated tiles in the repository (21 MB compressed as served), rebuilt by
  the script after any change to roads or terrain. The 5 m grid (#92, 2026-11-28) doubled
  them and the ground triangles drawn near the bus (1.5 to 2 times), and cut the area of
  road steeper than 7 % across by about 60 %; dual carriageways at a common height and side streets
  starting on the main road (#92) halved it again (824 triangles, about half of the junction ones
  too); what remains is where two legs of a hairpin or
  two stacked roads are closer than the width of a road, which a finer grid cannot separate.

## Rejected alternatives

- **Computing the geometry in the browser** on every start: slower and much harder without
  a polygon library.
- **Road meshes triangulated only on their outline**: their long triangles cut through
  the ground on slopes (tried, visible artefacts).
- **Roads painted in the ground texture**: too blurry at 1 px per 1.7 m, no bridges.
