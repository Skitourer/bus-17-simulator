# ADR 0002: Road graph data and shapely

_[Français](0002-road-graph.fr.md)_ · Status: accepted · Date: 2026-11-24

## Context

The HD-2D world draws each OpenStreetMap way as an isolated ribbon with a fixed width per
class. There are no junctions, no bridges, no real widths, and some roads the bus uses
are missing: `map.json` only keeps the main classes, so the service road and bus loop at
the Lycée du Grésivaudan terminus are absent (the route leaves the drawn roads for about
50 m). Junction surfaces, road clipping and embankments need polygon operations.

## Decision

- `tools/build_roads.py` writes `data/grenoble/roads.json`: a graph whose nodes are way
  ends and shared OSM nodes, and whose edges are road pieces with class, width (`width`
  tag, else `lanes` × 3.25 m, else a class default; raised to 5.5 m for two-way streets,
  and to 6.5 m two-way or 4 m one-way on the edges driven by line 17, #45), layer and
  flags (one-way,
  roundabout, bridge, tunnel, bus lane, link). Service roads and busways are included;
  car-park aisles are not.
- Compact arrays (class and flag tables in the file header, decimetre coordinates) keep
  the file under the 1 MB pre-commit limit (840 kB for the current area).
- The build checks that every metre of both directions of the line is within 8 m of a
  road and lists the gaps.
- **shapely** (BSD-3-Clause) is the geometry library of the data scripts only; the game
  does not load it.

## Consequences

- The renderer can build junctions, widths, bridges and tunnels from one data source
  (issues #10 to #14).
- The data scripts gain a compiled dependency (shapely and numpy wheels, installed by uv).

## Rejected alternatives

- **Writing polygon operations by hand**: buffers, unions and clipping are easy to get
  wrong; shapely is the standard.
- **Building the graph in the browser**: slower start-up and the same code in every
  session; the data is static.
- **osmnx**: heavier (pandas, networkx, its own downloads) for what a small graph split
  does.
