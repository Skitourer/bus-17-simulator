"""Construit data/grenoble/terrain.json : grilles d'altitude reelles (IGN RGE ALTI) pour le prototype HD-2D.

Usage :  uv run python tools/build_terrain.py      (apres build_line.py et build_map.py)
  - grille fine (40 m) sur l'emprise de la carte (ligne + 1,5 km) : la ville ou l'on conduit ; seuls ses
    noeuds sur les tuiles du couloir des lignes sont demandes a l'IGN, les autres viennent de la grille large
    (#131 : le reseau entier couvrirait des millions de points) ;
  - grille large (300 m) sur au moins 36 km : Belledonne, Vercors, Chartreuse en vrai relief a l'horizon.
Altitudes en decimetres (entiers), ligne par ligne du sud au nord, d'ouest en est.
"""

import math
import os
from typing import Any

import numpy as np
import shapely
from geo import Projection, fill_missing, make_proj
from lines import LINES_DIR, TILE, corridor, read_lines, routes_xy, tiles_in
from shapely import box, union_all
from shapely.geometry.base import BaseGeometry
from sources import ROOT, elevations, read_json, write_json
from streets import TerrainGrid

LINE_INDEX = os.path.join(LINES_DIR, 'index.json')
MAP = os.path.join(ROOT, 'data', 'grenoble', 'map.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'terrain.json')
FINE_STEP = 40
COARSE_STEP, COARSE_N = 300, 121
COARSE_MARGIN = 9000  # m: relief seen beyond the fine grid on every side (36 km wide around the first line)
FINE_MARGIN = 2 * FINE_STEP  # m around the tiles: the bilinear heights of a tile node need its 4 neighbours


def grid(to_ll: Projection, x0: float, y0: float, nx: int, ny: int, step: int) -> dict[str, Any]:
    """Elevation grid in decimetres; points outside IGN coverage repeat the previous value."""
    pts = [to_ll(x0 + i * step, y0 + j * step) for j in range(ny) for i in range(nx)]
    values = fill_missing(elevations(pts), 200)
    return {'x0': x0, 'y0': y0, 'nx': nx, 'ny': ny, 'step': step, 'dm': [round(e * 10) for e in values]}


def fine_grid(
    to_ll: Projection, x0: float, y0: float, nx: int, ny: int, needed: BaseGeometry, coarse: TerrainGrid
) -> dict[str, Any]:
    """Fine grid: IGN elevations at the nodes inside `needed`, the coarse grid everywhere else."""
    xs = np.tile(x0 + np.arange(nx) * FINE_STEP, ny).astype(np.float64)
    ys = np.repeat(y0 + np.arange(ny) * FINE_STEP, nx).astype(np.float64)
    inside = np.asarray(shapely.contains_xy(needed, xs, ys))
    dm = [round(float(z) * 10) for z in coarse.heights(xs, ys)]
    wanted = np.flatnonzero(inside)
    values = fill_missing(elevations([to_ll(float(xs[k]), float(ys[k])) for k in wanted]), 200)
    for k, value in zip(wanted, values, strict=True):
        dm[k] = round(value * 10)
    return {'x0': x0, 'y0': y0, 'nx': nx, 'ny': ny, 'step': FINE_STEP, 'dm': dm}


def corridor_tiles(bx0: float, by0: float, bx1: float, by1: float) -> BaseGeometry:
    """The tiles of the corridor around the lines (as build_streets.py cuts them), with FINE_MARGIN."""
    nx, ny = math.ceil((bx1 - bx0) / TILE), math.ceil((by1 - by0) / TILE)
    area = corridor([route for line in read_lines() for route in routes_xy(line)])
    kept = tiles_in(area, bx0, by0, nx, ny, TILE)
    boxes = [box(bx0 + i * TILE, by0 + j * TILE, bx0 + (i + 1) * TILE, by0 + (j + 1) * TILE) for i, j in kept]
    return union_all(boxes).buffer(FINE_MARGIN, join_style='mitre')


def main() -> None:
    line = read_json(LINE_INDEX)
    mp = read_json(MAP)
    _, to_ll = make_proj(*line['origin'])
    bx0, by0, bx1, by1 = mp['bbox']
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    # at least COARSE_N nodes, more when the lines spread further than the first ones
    n = max(COARSE_N, math.ceil((max(bx1 - bx0, by1 - by0) + 2 * COARSE_MARGIN) / COARSE_STEP) + 1)
    n += (n + 1) % 2  # odd: a node on the centre
    print(f'grille large {n} x {n}')
    half = COARSE_STEP * (n - 1) / 2
    coarse = grid(to_ll, round(cx - half), round(cy - half), n, n, COARSE_STEP)
    nx, ny = int((bx1 - bx0) / FINE_STEP) + 2, int((by1 - by0) / FINE_STEP) + 2
    needed = corridor_tiles(bx0, by0, bx1, by1)
    print(f'grille fine {nx} x {ny} ({nx * ny} points, {needed.area / FINE_STEP**2:.0f} demandes a l IGN)')
    fine = fine_grid(to_ll, bx0, by0, nx, ny, needed, TerrainGrid(**coarse))
    write_json(OUT, {'fine': fine, 'coarse': coarse}, ensure_ascii=True)


if __name__ == '__main__':
    main()
