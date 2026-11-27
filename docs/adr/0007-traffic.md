# ADR 0007: Ambient traffic model

_[Français](0007-traffic.fr.md)_ · Status: accepted · Date: 2026-11-26

## Context

The streets were empty (#49). Cars and bikes must drive on the real road graph (ADR 0002),
keep their distance, cross junctions without driving through each other and stop for the
player's bus, for a few dozen vehicles at 60 steps per second in the browser.

## Decision

- `src/hd2d/traffic.js` (pure): each direction of a street of `roads.json` is a lane, driven
  on the right; bus ways, service roads and tunnels are left out.
- Car following with the **Intelligent Driver Model** (Treiber, Hennecke and Helbing, 2000):
  one formula for free driving, following and stopping, with documented parameters in
  `game.json`.
- Junctions: **one vehicle at a time** (a reservation per node, first come; vehicles already
  on a roundabout go first; only the first vehicle of a lane may ask; released once the junction
  is cleared, or after a timeout).
- Obstacles (the buses) are discs; a vehicle checks points of its path ahead.
- The player's bus is a **priority vehicle** (#95, 2026-11-28): the vehicles keep a larger
  gap from it (and from the room just before its nose) and leave it the junctions it drives
  to. A vehicle stuck against it, waiting for it across its way, or that the driver keeps
  pushing, **backs off** a few metres, or **is removed** (another one appears out of sight)
  when it has no room or is stuck again: no deadlock lasts more than a few seconds.
- Vehicles appear and disappear out of sight around the bus; their count is a player
  preference (none, light, normal, dense).
- Since #94 (2026-11-28) the count follows the roads near the bus: a **density per km of
  lane**, lower outside **built-up areas** (`built_up` flag of `roads.json`: enough buildings
  or built ground near the road, from the BD TOPO footprints), with the preference as a
  ceiling. Bikes and pedestrians stay in built-up areas.

## Consequences

- No physics engine and no lane changes: queues form behind a stopped bus, cars pass bikes
  only on wide roads.
- Junction capacity is lower than in reality; enough for the density of the game.
- Pedestrians (#50) walk on both sides of the same streets and cross at the zebra crossings
  of the street data: they wait for the moving vehicles, then step on (after a while, unless a
  vehicle is very close); a person on a crossing is an obstacle the vehicles stop for, and
  people let the waiting vehicles go between groups.

## Rejected alternatives

- **Traffic lights from OSM**: few are tagged, and timing them is guesswork (revisited in
  ADR 0008).
- **A traffic library (SUMO and the like)**: native, far too heavy for a browser game.
- **Gipps or Krauss models**: no simpler, and the IDM is the usual reference with
  published parameters.
