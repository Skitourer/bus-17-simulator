"""Construit data/grenoble/buildings.json : batiments OSM (emprise + hauteur) le long de la ligne.

Usage :  python tools/build_buildings.py      (apres build_line.py)
Donnees (c) contributeurs OpenStreetMap, licence ODbL.
Sortie (coordonnees locales en dm) :
  { "b": [[hauteur_dm, type, x0, y0, x1, y1, ...], ...], "trees": [x, y, ...] }
  type : voir geo.building_kind
"""

import os
from typing import Any

from geo import Projection, building_height, building_kind, dp_ring, make_proj, signed_area2
from sources import ROOT, overpass, read_json, write_json

LINE = os.path.join(ROOT, 'data', 'grenoble', '17.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'buildings.json')
CORRIDOR = 450  # m de part et d'autre de la ligne
MIN_AREA_M2 = 12  # plus petit : abri, local technique... on ignore


def building_record(el: dict[str, Any], to_xy: Projection) -> list[int] | None:
    """[height_dm, kind, x0, y0, ...] for an OSM building way (counter-clockwise ring), or None to skip it."""
    if 'geometry' not in el:
        return None
    tags: dict[str, str] = el.get('tags', {})
    if tags.get('building') in ('roof', 'carport', 'no'):
        return None
    ring = [to_xy(g['lat'], g['lon']) for g in el['geometry']]
    if len(ring) < 4:
        return None
    ring = dp_ring(ring, 0.4)[:-1]
    if len(ring) < 3:
        return None
    a = signed_area2(ring)
    if abs(a) < 2 * MIN_AREA_M2:
        return None
    if a < 0:
        ring.reverse()
    kind = building_kind(tags)
    rec = [int(building_height(tags, kind, el['id']) * 10), kind]
    for x, y in ring:
        rec += [round(x * 10), round(y * 10)]
    return rec


def main() -> None:
    line = read_json(LINE)
    to_xy, to_ll = make_proj(*line['origin'])
    pts: list[float] = line['directions'][0]['pts']
    poly: list[str] = []
    for i in range(0, len(pts) // 3, 40):  # un point tous les 80 m
        la, lo = to_ll(pts[i * 3], pts[i * 3 + 1])
        poly += [f'{la:.5f}', f'{lo:.5f}']
    around = ','.join(poly)
    print(f'Requete Overpass (batiments a {CORRIDOR} m de la ligne)...')
    res = overpass(f'[out:json][timeout:300];way["building"](around:{CORRIDOR},{around});out geom qt;')
    out = [rec for el in res['elements'] if (rec := building_record(el, to_xy)) is not None]
    # arbres reels (alignements, parcs) : natural=tree
    print('Requete Overpass (arbres)...')
    trees: list[int] = []
    tree_query = (
        f'[out:json][timeout:300];node["natural"="tree"](around:{CORRIDOR + 300},{around});out skel qt;'
    )
    for el in overpass(tree_query)['elements']:
        x, y = to_xy(el['lat'], el['lon'])
        trees += [round(x * 10), round(y * 10)]
    print(f'{len(trees) // 2} arbres, {len(out)} batiments')
    write_json(
        OUT,
        {'attribution': '© contributeurs OpenStreetMap (ODbL)', 'b': out, 'trees': trees},
        ensure_ascii=True,
    )


if __name__ == '__main__':
    main()
