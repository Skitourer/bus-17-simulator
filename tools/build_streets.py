"""Builds data/grenoble/tiles/: 1 km tiles of ground shaped by the roads, carriageway outlines and bridges.

Usage:  uv run python tools/build_streets.py      (after build_terrain.py and build_roads.py)
Geometry: see tools/streets.py and ADR 0003. All coordinates in decimetres.

  tiles/index.json  { "x0", "y0", "size": 1000, "step": 10, "nx", "ny" }        tile (i, j) covers
                    [x0 + i size, x0 + (i+1) size] x [y0 + j size, y0 + (j+1) size]
  tiles/t_i_j.json  { "ground": [z, ...]          (n x n heights, row by row from south, n = size/step + 1),
                      "road": [[ring, hole, ...], ...]   (carriageway cut along the ground triangles;
                                                         rings [x, y, ...] relative to the tile origin),
                      "bridges": [[width, x, y, z, x, y, z, ...], ...] (x, y relative to the tile origin) }
"""

import glob
import math
import os

import numpy as np
from shapely import LineString, MultiPolygon, Polygon, box
from shapes import clip, coordinates, interpolate
from sources import ROOT, read_json, write_json
from streets import (
    PROFILE_STEP,
    Profile,
    RoadEdge,
    RoadHeights,
    TerrainGrid,
    carriageway,
    load_edges,
    road_pieces,
    road_profiles,
    sample_positions,
    shaped_ground,
)

DATA = os.path.join(ROOT, 'data', 'grenoble')
OUT = os.path.join(DATA, 'tiles')
TILE = 1000  # m
STEP = 10  # m between ground heights


def dm(v: float) -> int:
    return round(v * 10)


def rings_of(geom: Polygon | MultiPolygon, ox: float, oy: float) -> list[list[list[int]]]:
    """Polygons as lists of rings [x, y, ...] in decimetres relative to (ox, oy), without closing point."""
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms)
    out: list[list[list[int]]] = []
    for p in polys:
        if p.is_empty or p.area < 1.0:
            continue
        rings = [p.exterior, *p.interiors]
        out.append([[v for x, y in list(r.coords)[:-1] for v in (dm(x - ox), dm(y - oy))] for r in rings])
    return out


def bridge_record(e: RoadEdge, prof: Profile, ox: float, oy: float) -> list[int]:
    line = LineString(e.coords)
    s = sample_positions(line.length, PROFILE_STEP)
    xs, ys = coordinates(interpolate(line, s))
    rec = [dm(e.width)]
    for x, y, si in zip(xs, ys, s, strict=True):
        rec += [dm(float(x) - ox), dm(float(y) - oy), dm(prof.at(float(si)))]
    return rec


def main() -> None:
    terrain_data = read_json(os.path.join(DATA, 'terrain.json'))['fine']
    terrain = TerrainGrid(**terrain_data)
    bx0, by0, bx1, by1 = (float(v) for v in read_json(os.path.join(DATA, 'map.json'))['bbox'])
    edges = load_edges(read_json(os.path.join(DATA, 'roads.json')))
    print(f'{len(edges)} troncons : profils en long...')
    profiles = road_profiles(edges, terrain)
    print('chaussee (union des troncons)...')
    surface = carriageway(edges)
    heights = RoadHeights(edges, profiles)
    bridges = [(e, p) for e, p in zip(edges, profiles, strict=True) if e.level == 'bridge']

    nx, ny = math.ceil((bx1 - bx0) / TILE), math.ceil((by1 - by0) / TILE)
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, 't_*.json')):
        os.remove(old)
    n = TILE // STEP + 1
    for j in range(ny):
        for i in range(nx):
            ox, oy = bx0 + i * TILE, by0 + j * TILE
            gx, gy = np.meshgrid(ox + np.arange(n) * STEP, oy + np.arange(n) * STEP)
            xs, ys = gx.ravel().astype(np.float64), gy.ravel().astype(np.float64)
            local = clip(surface, box(ox - 30, oy - 30, ox + TILE + 30, oy + TILE + 30))
            if isinstance(local, Polygon | MultiPolygon) and not local.is_empty:
                ground = shaped_ground(xs, ys, terrain.heights(xs, ys), local, heights)
            else:
                ground = terrain.heights(xs, ys)
            road = local if isinstance(local, Polygon | MultiPolygon) else Polygon()
            pieces = road_pieces(road, ox, oy, n, STEP)
            tile_bridges = [
                bridge_record(e, p, ox, oy)
                for e, p in bridges
                if ox <= LineString(e.coords).centroid.x < ox + TILE
                and oy <= LineString(e.coords).centroid.y < oy + TILE
            ]
            write_json(
                os.path.join(OUT, f't_{i}_{j}.json'),
                {
                    'ground': [dm(float(z)) for z in ground],
                    'road': rings_of(MultiPolygon(pieces), ox, oy) if pieces else [],
                    'bridges': tile_bridges,
                },
            )
    write_json(
        os.path.join(OUT, 'index.json'),
        {'x0': bx0, 'y0': by0, 'size': TILE, 'step': STEP, 'nx': nx, 'ny': ny},
    )


if __name__ == '__main__':
    main()
