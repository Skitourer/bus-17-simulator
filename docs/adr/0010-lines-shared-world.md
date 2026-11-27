# ADR 0010: Several lines in one shared world

_[Français](0010-lines-shared-world.fr.md)_ · Status: accepted · Date: 2026-11-27

## Context

The game knew one line: `data/grenoble/17.json` set the origin of the local frame and the extent
of every other file, and each direction had one route, even though most line 17 trips turn back
at Montfleury. Lines 18 (Poisat ⇄ Meylan) and N62 (Grenoble ⇄ Col de Porte, up to 1,330 m) are
wanted too (#88). They share streets with line 17, and the N62 goes 9 km north into the mountains.

## Decision

- One world for every line. The origin of the local frame is a constant (`tools/lines.py`,
  `ORIGIN`, the former origin of line 17), so adding a line does not move the others.
- `tools/build_line.py` writes one file per line, `data/grenoble/lines/<line>.json`, and
  `lines/index.json` (origin, extent, colours, termini). Each trip pattern of the GTFS (same
  direction, same stops) is a route of its own with its stops and departures: short turns and the
  N62 branches drive their real path.
- The map, the terrain and the tile grid cover the extent of all the lines; the roads and the
  tiles exist only within 1,500 m of a route (the corridor), the buildings within 450 m.
- The game loads the chosen line, then only the tiles within `tiles.lineMargin` of its routes. The
  menu chooses the line first; a day type shows the timetable of its next date, as the union of
  the GTFS services running that day.

## Consequences

- Data: 23 MB of tiles for line 17 alone, 29 MB (355 tiles) for the three lines, 34 MB of data in all; GitHub Pages
  accepts up to 1 GB per site and 100 MB per file, so the static site is enough for now.
- Tiles outside the corridor do not exist: the coarse IGN grid is drawn there.
- `buildings.json` grew past the 1 MB file limit; the game never loaded it, so it is now an
  intermediate file in `tools/cache/`, cut into the tiles by `build_streets.py`.
- The horizon ridge lines of the old line file were not used by the game any more; they are gone.

## Rejected alternatives

- **One world per line**: line 17 and 18 would each have a copy of the same streets, and a bus of
  another line could never be met.
- **The whole bounding box of the lines**: about 550 tiles, most of them empty mountainside.
- **Route variants as stop ranges of the longest route**: the N62 branch to Pont du Croz is not a
  part of the other routes.

If the data outgrows GitHub Pages, the tiles can move to a release asset or an object store
(Cloudflare R2, free egress), fetched by URL; the format stays the same.
