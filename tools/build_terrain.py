"""Construit data/grenoble/terrain.json : grilles d'altitude reelles (IGN RGE ALTI) pour le prototype HD-2D.

Usage :  python tools/build_terrain.py      (apres build_line.py et build_map.py)
  - grille fine (40 m) sur l'emprise de la carte (ligne + 1,5 km) : la ville ou l'on conduit ;
  - grille large (300 m) sur 36 km : Belledonne, Vercors, Chartreuse en vrai relief a l'horizon.
Altitudes en decimetres (entiers), ligne par ligne du sud au nord, d'ouest en est.
"""
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_line import elevations, make_proj, ROOT  # meme cache et meme API

LINE = os.path.join(ROOT, 'data', 'grenoble', '17.json')
MAP = os.path.join(ROOT, 'data', 'grenoble', 'map.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'terrain.json')


def grid(to_ll, x0, y0, nx, ny, step):
    pts = [to_ll(x0 + i * step, y0 + j * step) for j in range(ny) for i in range(nx)]
    el = elevations(pts)
    fill = next((e for e in el if e is not None), 200)
    out = []
    for e in el:
        if e is None:
            e = fill
        fill = e
        out.append(int(round(e * 10)))
    return {'x0': x0, 'y0': y0, 'nx': nx, 'ny': ny, 'step': step, 'dm': out}


def main():
    line = json.load(open(LINE, encoding='utf-8'))
    mp = json.load(open(MAP, encoding='utf-8'))
    _, to_ll = make_proj(*line['origin'])
    bx0, by0, bx1, by1 = mp['bbox']
    STEP = 40
    nx, ny = int((bx1 - bx0) / STEP) + 2, int((by1 - by0) / STEP) + 2
    print('grille fine %d x %d (%d points)' % (nx, ny, nx * ny))
    fine = grid(to_ll, bx0, by0, nx, ny, STEP)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    CSTEP, CN = 300, 121
    print('grille large %d x %d' % (CN, CN))
    coarse = grid(to_ll, round(cx - CSTEP * (CN - 1) / 2), round(cy - CSTEP * (CN - 1) / 2), CN, CN, CSTEP)
    json.dump({'fine': fine, 'coarse': coarse}, open(OUT, 'w'), separators=(',', ':'))
    print('ecrit', OUT, '%.0f ko' % (os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
