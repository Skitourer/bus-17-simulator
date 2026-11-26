"""Builds data/grenoble/buildings.json: buildings along the line (IGN BD TOPO, completed with OSM) and trees.

Usage:  uv run python tools/build_buildings.py      (after build_line.py)
Data: IGN BD TOPO (Licence Ouverte 2.0) through the Geoplateforme WFS; (c) OpenStreetMap contributors, ODbL.
Output (local frame, decimetres):
  { "attribution": ...,
    "b": [[height, kind, style, roof_rise, x0, y0, x1, y1, ...], ...],   # counter-clockwise footprints
    "trees": [x, y, ...] }
  height: walls; kind: see geo.building_kind; style: facade family (tools/buildings.py); roof_rise: height of
  a pitched roof above the walls, 0 when flat.
"""

import os
from collections import Counter
from typing import Any

from buildings import Footprint, building_record, footprint, osm_tags_for
from geo import Point, make_proj
from shapely import LineString, MultiLineString
from shapely import Point as ShapelyPoint
from sources import ROOT, overpass, read_json, wfs_features, write_json

LINE = os.path.join(ROOT, 'data', 'grenoble', '17.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'buildings.json')
CORRIDOR = 450  # m on each side of the line
BDTOPO_LAYER = 'BDTOPO_V3:batiment'


def osm_buildings(around: str, to_xy: Any) -> list[tuple[list[Point], dict[str, str]]]:
    """OSM building outlines and tags along the line (they complete the BD TOPO attributes)."""
    print(f'Requete Overpass (batiments a {CORRIDOR} m de la ligne)...')
    res = overpass(f'[out:json][timeout:300];way["building"](around:{CORRIDOR},{around});out geom qt;')
    out: list[tuple[list[Point], dict[str, str]]] = []
    for el in res['elements']:
        if 'geometry' in el and len(el['geometry']) >= 4:
            out.append(([to_xy(g['lat'], g['lon']) for g in el['geometry']], el.get('tags', {})))
    return out


def main() -> None:
    line = read_json(LINE)
    to_xy, to_ll = make_proj(*line['origin'])
    routes = MultiLineString(
        [[(d['pts'][i], d['pts'][i + 1]) for i in range(0, len(d['pts']), 3)] for d in line['directions']]
    )
    pts: list[float] = line['directions'][0]['pts']
    poly: list[str] = []
    for i in range(0, len(pts) // 3, 40):  # one point every 80 m
        la, lo = to_ll(pts[i * 3], pts[i * 3 + 1])
        poly += [f'{la:.5f}', f'{lo:.5f}']
    around = ','.join(poly)

    x0, y0, x1, y1 = routes.buffer(CORRIDOR).bounds
    south, west = to_ll(x0, y0)
    north, east = to_ll(x1, y1)
    print('WFS IGN (BD TOPO batiments)...')
    features = wfs_features(BDTOPO_LAYER, (south, west, north, east))
    footprints: list[Footprint] = []
    for feature in features:
        fp = footprint(feature, to_xy)
        if fp is not None and routes.distance(ShapelyPoint(LineString(fp.ring).centroid)) <= CORRIDOR:
            footprints.append(fp)
    tags = osm_tags_for(footprints, osm_buildings(around, to_xy))
    out = [building_record(fp, t) for fp, t in zip(footprints, tags, strict=True)]
    with_height = sum(fp.height is not None and fp.height >= 2 for fp in footprints)
    completed = sum(bool(t) for t in tags)
    print(f'{len(out)} batiments, {with_height} avec hauteur BD TOPO, {completed} completes par OSM')
    print('  styles :', dict(sorted(Counter(rec[2] for rec in out).items())))
    print(f'  toits en pente : {sum(rec[3] > 0 for rec in out)}')

    print('Requete Overpass (arbres)...')
    trees: list[int] = []
    tree_query = (
        f'[out:json][timeout:300];node["natural"="tree"](around:{CORRIDOR + 300},{around});out skel qt;'
    )
    for el in overpass(tree_query)['elements']:
        x, y = to_xy(el['lat'], el['lon'])
        trees += [round(x * 10), round(y * 10)]
    print(f'{len(trees) // 2} arbres')
    write_json(
        OUT,
        {
            'attribution': 'IGN BD TOPO (Licence Ouverte 2.0) ; © contributeurs OpenStreetMap (ODbL)',
            'b': out,
            'trees': trees,
        },
        ensure_ascii=True,
    )


if __name__ == '__main__':
    main()
