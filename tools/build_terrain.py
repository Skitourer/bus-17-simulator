"""Construit data/grenoble/terrain.json : grilles d'altitude reelles (IGN RGE ALTI) pour le prototype HD-2D.

Usage :  uv run python tools/build_terrain.py      (apres build_line.py et build_map.py)
  - grille fine (40 m) sur l'emprise de la carte (ligne + 1,5 km) : la ville ou l'on conduit ;
  - grille large (300 m) sur 36 km : Belledonne, Vercors, Chartreuse en vrai relief a l'horizon.
Altitudes en decimetres (entiers), ligne par ligne du sud au nord, d'ouest en est.
"""

import os
from typing import Any

from geo import Projection, fill_missing, make_proj
from lines import LINES_DIR
from sources import ROOT, elevations, read_json, write_json

LINE_INDEX = os.path.join(LINES_DIR, 'index.json')
MAP = os.path.join(ROOT, 'data', 'grenoble', 'map.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'terrain.json')
FINE_STEP = 40
COARSE_STEP, COARSE_N = 300, 121


def grid(to_ll: Projection, x0: float, y0: float, nx: int, ny: int, step: int) -> dict[str, Any]:
    """Elevation grid in decimetres; points outside IGN coverage repeat the previous value."""
    pts = [to_ll(x0 + i * step, y0 + j * step) for j in range(ny) for i in range(nx)]
    values = fill_missing(elevations(pts), 200)
    return {'x0': x0, 'y0': y0, 'nx': nx, 'ny': ny, 'step': step, 'dm': [round(e * 10) for e in values]}


def main() -> None:
    line = read_json(LINE_INDEX)
    mp = read_json(MAP)
    _, to_ll = make_proj(*line['origin'])
    bx0, by0, bx1, by1 = mp['bbox']
    nx, ny = int((bx1 - bx0) / FINE_STEP) + 2, int((by1 - by0) / FINE_STEP) + 2
    print(f'grille fine {nx} x {ny} ({nx * ny} points)')
    fine = grid(to_ll, bx0, by0, nx, ny, FINE_STEP)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    print(f'grille large {COARSE_N} x {COARSE_N}')
    half = COARSE_STEP * (COARSE_N - 1) / 2
    coarse = grid(to_ll, round(cx - half), round(cy - half), COARSE_N, COARSE_N, COARSE_STEP)
    write_json(OUT, {'fine': fine, 'coarse': coarse}, ensure_ascii=True)


if __name__ == '__main__':
    main()
