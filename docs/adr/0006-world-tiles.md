# ADR 0006: World drawn by tiles around the bus

_[Français](0006-world-tiles.fr.md)_ · Status: accepted · Date: 2026-11-25

## Context

The whole city was built at start-up into a few merged meshes (ground, carriageways,
sidewalks, markings, buildings, trees): about 1.8 million triangles drawn at every frame,
and again for the shadows, whatever the camera saw (#12).

## Decision

- The data tiles (500 m, `data/grenoble/tiles/`) are also the drawing tiles. Each tile
  has a light ground (one point out of ten of its 5 m grid) built for all tiles at
  start-up, and detailed layers: fine ground, streets, trees, buildings.
- The detailed layers are built when the bus comes within `tiles.loadRadius`, nearest
  first and a few milliseconds per frame (`tiles.buildBudget`), and freed beyond
  `tiles.unloadRadius`. Fine ground, streets and trees are drawn within their own
  distances; the light ground stands in for the fine one farther away.
- Textures are shared by all the tiles; each tile has its own geometries and materials,
  freed with it. The building outlines for the collisions are still computed for the
  whole map at start-up (outlines only, no mesh).
- The choice of tiles and levels is pure logic (`src/hd2d/tiling.js`), tested.

## Consequences

- About 250 000 to 300 000 triangles drawn instead of 1.8 million; more draw calls
  (about 100 to 250 instead of 75), still a small number.
- Buildings farther than `unloadRadius` are not drawn; the ground texture keeps the
  street pattern far away. Small seams may show between a fine and a light ground tile,
  far from the camera.

## Rejected alternatives

- **Building the tiles in a Web Worker**: the builders use Three.js geometry helpers and
  the ground heights; moving them to a worker means rewriting them around transferable
  arrays. Time-sliced building keeps frames smooth for now; to revisit if loading stutters.
- **250 m tiles**: four times more meshes and draw calls for the same data; the data
  tiles would have to be cut again.
- **Hiding by distance only, everything built at start-up**: same memory use and
  start-up time as before.
