# ADR 0012: Headroom under the bridges that cross a road

_[Français](0012-grade-separation.fr.md)_ · Status: accepted · Date: 2026-11-28

## Context

The terrain grid is too coarse to hold the embankments and cuttings of the road crossings. A
bridge deck, straight between its ends, often lay at the height of the road below it: the two
levels met, cars on the road below were caught by the deck, and the bus on the deck was blocked
by the cars under it (#75).

## Decision

- `tools/overpasses.py` finds every bridge edge over a ground-level road that is not one of its
  approaches, and the height missing for 5.55 m between the road below and the deck (4.75 m of
  headroom for French roads plus the 0.8 m deck drawn by the game).
- The deck rises in a hump at 6 % at most, its ends unchanged so the ramps still meet the
  streets; the road below, with the roads around it except the approaches of the bridge, dips by
  the rest in a cutting at 8 % at most. The ground follows both profiles as usual.
- In the game, traffic lanes on a bridge drive on the deck (`Ground.deckAt`), the others on the
  ground; cars ignore obstacles more than `traffic.levelGap` (3 m) above or below them, and the
  bus neither hits nor pushes cars on another level.

## Consequences

- 51 crossings, none with the headroom before. More tilted road triangles before the terraces
  (892 instead of 824); after them, 218, 1 on the routes of the lines.

## Rejected alternatives

- **Raising the whole bridge and its approaches**: the approaches are edges of any length joined
  to other streets; raising their ends moves junctions, often in town.
- **Lowering only the road below**: up to 5 m of cutting, below the water level along the quays.
- **A finer terrain model (1 m RGE ALTI) along the roads**: heavy, and it still lacks the bridge
  decks the cuttings and embankments are built for.
