# ADR 0011: Terraces and retaining walls between close roads

_[Français](0011-terraces.fr.md)_ · Status: accepted · Date: 2026-11-28

## Context

The ground is a 5 m grid and the carriageway is cut along its triangles (ADR 0003). Where two
roads closer than a ground triangle lie at different heights (the legs of a hairpin, a road above
another one on a hillside), one triangle held both roads and the carriageway was tilted across,
up to 120 % (#92, #108). A bank cannot separate them: there is no room between the roads.

## Decision

- `tools/terraces.py` finds the stretches of road more than 0.5 m above a road less than 7.5 m
  beside it, and keeps those where the build check finds a tilted road triangle. Each one, with
  10 m more at both ends and out of the junctions, becomes a **terrace**.
- A terrace keeps the heights of its road profile, flat across. The ground under it and between
  it and the lower road is shaped by the other roads alone, and never rises above the terrace.
- Tiles get a `terraces` list in the format of the bridges (`[width, x, y, z, ...]`), the width
  covering the carriageway and its sidewalks. Road and sidewalk pieces are cut along its edges.
- In the game, `Ground.h()` returns the terrace height inside a terrace, so the bus, the traffic,
  the markings and the road pieces sit on it. A stone retaining wall with a low parapet stands
  along its sides where the ground is lower (`world.retainingWall*` settings).

## Consequences

- Road triangles tilted more than 7 % across: 824 before, 219 after, 1 on the routes of the
  lines (7 %); 258 terraces, 8.3 km of walls; tiles grow by 0.3 %.
- The build runs in two passes: the first shapes the ground of every tile and finds the tilted
  triangles, the second reshapes it around the terraces; it still takes about 3 minutes.

## Rejected alternatives

- **A finer ground grid where roads are close**: about 2 m would be needed between hairpin legs,
  a varying grid everywhere in the data and the game.
- **Bridges over the lower road**: decks have piers and parapets, and the vehicles use their
  height only when close to it; a terrace is ground.
- **Terraces wherever two close roads differ in height**: 39 km of walls, mostly along service
  roads and in towns where the shared ground already fits.
