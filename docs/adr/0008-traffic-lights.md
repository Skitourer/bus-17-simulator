# ADR 0008: Traffic lights from OpenStreetMap with fixed two-phase cycles

_[Français](0008-traffic-lights.fr.md)_ · Status: accepted · Date: 2026-11-26

## Context

ADR 0007 rejected traffic lights because few seemed tagged and their timing would be guesswork.
In fact 679 `highway=traffic_signals` nodes lie in the map area (#77), and a city drive without
lights feels wrong. Real signal plans are not published as open data.

## Decision

- `tools/build_roads.py` maps each OSM signal to the nearest junction within 25 m and gathers the
  signalised junctions closer than 30 m (dual carriageways) into groups with one cycle:
  `signals` in `roads.json` (221 groups).
- `src/hd2d/signals.js` (pure): two phases per group, split by approach direction (the main axis
  and the cross axis); fixed times from the French rules (IISR part 6): green, 3 s amber, all-red
  gap. Each group starts at a different point of its cycle.
- Cars and bikes stop at the stop line on red, and on amber when they can brake comfortably;
  they do not hold the junction while waiting. The player is told when the bus enters a
  junction on red.

## Consequences

- Queues at the lights; the timings are plausible, not the real ones.
- No turning phases, pedestrian lights or actuated signals; the autopilot and the other line 17
  buses do not stop at red yet.

## Rejected alternatives

- **Lights at every big junction** without OSM data: wrong places, and the data exists.
- **Real signal plans**: not available as open data.
