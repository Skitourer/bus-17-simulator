"""Builds tools/cache/buildings.json: buildings along the lines (IGN BD TOPO, completed with OSM) and trees.

Usage:  uv run python tools/build_buildings.py      (after build_line.py)
An intermediate file of build_streets.py, which cuts it into the tiles: the game never loads it (ADR 0010).
Corridor of CORRIDOR m around every route of every line (tools/lines.py).
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
from geo import Point, Projection, make_proj
from lines import LINES_DIR, corridor, overpass_polys, read_lines, routes_xy
from shapely import LineString, box
from shapely import Point as ShapelyPoint
from shapely.geometry.base import BaseGeometry
from sources import CACHE, overpass, read_json, wfs_features, write_json

LINE_INDEX = os.path.join(LINES_DIR, 'index.json')
OUT = os.path.join(CACHE, 'buildings.json')
CORRIDOR = 450  # m on each side of the lines
TREE_CORRIDOR = CORRIDOR + 300  # m: trees a little farther, they fill the view beyond the buildings
WFS_BOX = 2000  # m: the BD TOPO is read by boxes of this side that touch the corridor
POLY_SIMPLIFY = 25  # m: corridor outline sent to Overpass (a shorter query)
BDTOPO_LAYER = 'BDTOPO_V3:batiment'


def osm_elements(selector: str, area: BaseGeometry, to_ll: Projection, output: str) -> list[dict[str, Any]]:
    """OSM elements matching `selector` in an area, one Overpass query per part, without duplicates."""
    seen: dict[int, dict[str, Any]] = {}
    for poly in overpass_polys(area, to_ll, POLY_SIMPLIFY):
        res = overpass(f'[out:json][timeout:300];{selector}(poly:"{poly}");out {output} qt;')
        for el in res['elements']:
            seen[el['id']] = el
    return list(seen.values())


def osm_buildings(
    area: BaseGeometry, to_xy: Projection, to_ll: Projection
) -> list[tuple[list[Point], dict[str, str]]]:
    """OSM building outlines and tags along the lines (they complete the BD TOPO attributes)."""
    print(f'Requete Overpass (batiments a {CORRIDOR} m des lignes)...')
    out: list[tuple[list[Point], dict[str, str]]] = []
    for el in osm_elements('way["building"]', area, to_ll, 'geom'):
        if 'geometry' in el and len(el['geometry']) >= 4:
            out.append(([to_xy(g['lat'], g['lon']) for g in el['geometry']], el.get('tags', {})))
    return out


def bdtopo_features(area: BaseGeometry, to_ll: Projection) -> list[dict[str, Any]]:
    """BD TOPO buildings of the boxes touching the area, each building once."""
    x0, y0, x1, y1 = area.bounds
    seen: dict[str, dict[str, Any]] = {}
    for j in range(int((y1 - y0) // WFS_BOX) + 1):
        for i in range(int((x1 - x0) // WFS_BOX) + 1):
            bx, by = x0 + i * WFS_BOX, y0 + j * WFS_BOX
            if not area.intersects(box(bx, by, bx + WFS_BOX, by + WFS_BOX)):
                continue
            south, west = to_ll(bx, by)
            north, east = to_ll(bx + WFS_BOX, by + WFS_BOX)
            for feature in wfs_features(BDTOPO_LAYER, (south, west, north, east)):
                seen[str(feature['properties']['cleabs'])] = feature
    return list(seen.values())


def main() -> None:
    to_xy, to_ll = make_proj(*read_json(LINE_INDEX)['origin'])
    routes = [route for line in read_lines() for route in routes_xy(line)]
    area = corridor(routes, CORRIDOR)
    print('WFS IGN (BD TOPO batiments)...')
    footprints: list[Footprint] = []
    for feature in bdtopo_features(area, to_ll):
        fp = footprint(feature, to_xy)
        if fp is not None and area.contains(ShapelyPoint(LineString(fp.ring).centroid)):
            footprints.append(fp)
    tags = osm_tags_for(footprints, osm_buildings(area, to_xy, to_ll))
    out = [building_record(fp, t) for fp, t in zip(footprints, tags, strict=True)]
    with_height = sum(fp.height is not None and fp.height >= 2 for fp in footprints)
    completed = sum(bool(t) for t in tags)
    print(f'{len(out)} batiments, {with_height} avec hauteur BD TOPO, {completed} completes par OSM')
    print('  styles :', dict(sorted(Counter(rec[2] for rec in out).items())))
    print(f'  toits en pente : {sum(rec[3] > 0 for rec in out)}')

    print('Requete Overpass (arbres)...')
    trees: list[int] = []
    for el in osm_elements('node["natural"="tree"]', corridor(routes, TREE_CORRIDOR), to_ll, 'skel'):
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
