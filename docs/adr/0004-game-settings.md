# ADR 0004: Game parameters in one documented JSON file

_[Français](0004-game-settings.fr.md)_ · Status: accepted · Date: 2026-11-25

## Context

The tunable values of the game (bus physics, cameras, rendering, stop rules, street
geometry) were constants spread across `src/hd2d/`, some inline, few documented, and
the pure modules imported the bus size from a rendering module (#28).

## Decision

- Every tunable value lives in `src/settings/game.json`, grouped by topic. Each entry
  carries its documentation: `{value, unit, doc, source?, min, max, integer?}` for
  numbers, `{value, unit, doc}` for `#rrggbb` colours.
- `src/settings/settings.js` validates the file at start-up (type, range, integer,
  required fields, unknown fields) and returns plain values; a broken file stops the
  loading screen with one message listing every problem.
- The game modules receive their group as an argument, e.g.
  `new Drive(settings.drive, settings.bus)`, so the pure modules stay testable without
  fetching anything.
- The type of the settings is derived from the JSON file, so `tsc` rejects a read of a
  parameter that does not exist. A unit test checks that every parameter is read by the
  code and that no numeric `UPPER_CASE` constant is left in `src/`.
- Build constants of `tools/` stay in Python: the game only sees their result in `data/`.

## Consequences

- Tuning needs no code change, and each value states its unit, meaning and source.
- One more file fetched at start-up, before the city data.
- Art palettes (building, roof and bus colours) and texture coordinates stay in the code.

## Rejected alternatives

- **JavaScript module of constants**: no validation of hand edits, and comments are not
  data a test can check.
- **Values only in the JSON, documentation in a separate page**: the two would drift.
- **JSON imported as a module** (`import … with { type: 'json' }`): a broken file fails
  silently, before any error can be shown.
