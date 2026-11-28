# ADR 0014: Data of the whole bus network

_[Français](0014-whole-network-data.fr.md)_ · Status: accepted · Date: 2026-11-28

## Context

The game will hold every bus line of the Grenoble area except the school lines (#132, #133). The
corridor around the lines grows from 74 km² to about 520 km², and the tiles take about 1 MB per
km² (road and sidewalk triangles, the 5 m ground grid). The builds were written for three lines:
one Overpass query for the whole map, a fine elevation grid over the whole bounding box (millions
of points), the elevation cache rewritten after every request, and the water level computed on a
5 m grid over the whole bounding box (hundreds of MB in memory).

## Decision

- The data stays plain JSON, versioned in git and served by GitHub Pages as before. The builds
  are deterministic: a tile that does not change keeps its blob and adds nothing to the history.
- The map, the roads, the buildings and the trees are queried by boxes of 8 km
  (`lines.QUERY_BOX`), each cached; the map keeps the elements of the corridor only.
- The fine elevation grid asks the IGN for the nodes on the tiles only; the others come from the
  coarse grid, which grows with the lines (at least 36 km wide). The elevation cache is written
  every 40 requests.
- The water level is computed tile by tile, with a margin as wide as its blur.

## Consequences

- About 500 MB of data for the whole network (about 150 MB compressed in git per full rebuild).
  GitHub Pages accepts 1 GB per site; the repository should stay under a few GB.
- A full rebuild needs about an hour of IGN elevation requests the first time; later runs reuse
  the caches.
- Outside the tiles, the fine grid is as smooth as the coarse one (never seen up close).

## Rejected alternatives

- **Data outside git** (separate branch, release archive): needs a deployment workflow and a
  force-pushed branch; kept for when the repository grows too big.
- **Compressed tiles** (`.json.gz` read with `DecompressionStream`): halves the published size but
  not the git history; kept for when the site nears 1 GB.
- **Git LFS**: GitHub Pages does not serve LFS files.
