"""Builds data/grenoble/tiles/: 1 km tiles of ground shaped by the roads, carriageway outlines and bridges.

Usage:  uv run python tools/build_streets.py      (after build_terrain.py and build_roads.py)
Geometry: see tools/streets.py and ADR 0003. All coordinates in decimetres.

  tiles/index.json  { "x0", "y0", "size": 1000, "step": 10, "nx", "ny" }        tile (i, j) covers
                    [x0 + i size, x0 + (i+1) size] x [y0 + j size, y0 + (j+1) size]
  tiles/t_i_j.json  { "ground": [z, ...]          (n x n heights, row by row from south, n = size/step + 1),
                      "road": [[ring, hole, ...], ...]   (carriageway cut along the ground triangles;
                                                         rings [x, y, ...] relative to the tile origin),
                      "bridges": [[width, x, y, z, x, y, z, ...], ...] (x, y relative to the tile origin),
                      "buildings": [[height, kind, x, y, ...], ...]   (clipped off the carriageway, CCW),
                      "trees": [x, y, ...]   (OSM and seeded, off roads and buildings) }
"""

import glob
import math
import os
from collections import defaultdict
from typing import Any

import numpy as np
from geo import Point
from shapely import LineString, MultiPolygon, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapes import clip, coordinates, interpolate
from sources import ROOT, read_json, write_json
from streets import (
    BUILDING_CLEARANCE,
    PROFILE_STEP,
    TREE_CLEARANCE,
    Profile,
    RoadEdge,
    RoadHeights,
    TerrainGrid,
    carriageway,
    clear_trees,
    clip_building,
    keep_out_zone,
    load_edges,
    road_pieces,
    road_profiles,
    sample_positions,
    seeded_trees,
    shaped_ground,
)

DATA = os.path.join(ROOT, 'data', 'grenoble')
OUT = os.path.join(DATA, 'tiles')
TILE = 1000  # m
STEP = 10  # m between ground heights
TREE_SEED = 5


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


type TileKey = tuple[int, int]


def tile_of(x: float, y: float, bx0: float, by0: float) -> TileKey:
    return int((x - bx0) // TILE), int((y - by0) // TILE)


def buildings_and_trees(
    data: dict[str, Any], polys: dict[str, list[list[float]]], surface: BaseGeometry, bx0: float, by0: float
) -> tuple[dict[TileKey, list[tuple[int, int, list[Point]]]], dict[TileKey, list[Point]]]:
    """Buildings clipped off the carriageway and trees cleared of roads and buildings, grouped by tile."""
    buildings: defaultdict[TileKey, list[tuple[int, int, list[Point]]]] = defaultdict(list)
    footprints: list[Polygon] = []
    building_zone = keep_out_zone(surface, BUILDING_CLEARANCE)
    clipped = 0
    for rec in data['b']:
        h, kind, *flat = (int(v) for v in rec)
        ring = [(flat[k] / 10, flat[k + 1] / 10) for k in range(0, len(flat), 2)]
        parts = clip_building(ring, building_zone)
        clipped += parts != [ring]
        for part in parts:
            footprints.append(Polygon(part))
            c = Polygon(part).representative_point()
            buildings[tile_of(c.x, c.y, bx0, by0)].append((h, kind, part))
    osm = [(v[k] / 10, v[k + 1] / 10) for v in [data['trees']] for k in range(0, len(v), 2)]
    trees = clear_trees(
        osm + seeded_trees(polys, TREE_SEED), keep_out_zone(surface, TREE_CLEARANCE), footprints
    )
    by_tile: defaultdict[TileKey, list[Point]] = defaultdict(list)
    for x, y in trees:
        by_tile[tile_of(x, y, bx0, by0)].append((x, y))
    print(f'  {len(footprints)} batiments ({clipped} recoupes par la chaussee), {len(trees)} arbres')
    return buildings, by_tile


def main() -> None:
    terrain_data = read_json(os.path.join(DATA, 'terrain.json'))['fine']
    terrain = TerrainGrid(**terrain_data)
    map_data = read_json(os.path.join(DATA, 'map.json'))
    bx0, by0, bx1, by1 = (float(v) for v in map_data['bbox'])
    edges = load_edges(read_json(os.path.join(DATA, 'roads.json')))
    print(f'{len(edges)} troncons : profils en long...')
    profiles = road_profiles(edges, terrain)
    print('chaussee (union des troncons)...')
    surface = carriageway(edges)
    heights = RoadHeights(edges, profiles)
    bridges = [(e, p) for e, p in zip(edges, profiles, strict=True) if e.level == 'bridge']
    print('batiments et arbres...')
    by_tile_buildings, by_tile_trees = buildings_and_trees(
        read_json(os.path.join(DATA, 'buildings.json')), map_data['polys'], surface, bx0, by0
    )

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
                    'buildings': [
                        [h, kind, *(v for x, y in ring for v in (dm(x - ox), dm(y - oy)))]
                        for h, kind, ring in by_tile_buildings.get((i, j), [])
                    ],
                    'trees': [v for x, y in by_tile_trees.get((i, j), []) for v in (dm(x - ox), dm(y - oy))],
                },
            )
    write_json(
        os.path.join(OUT, 'index.json'),
        {'x0': bx0, 'y0': by0, 'size': TILE, 'step': STEP, 'nx': nx, 'ny': ny},
    )


if __name__ == '__main__':
    main()
