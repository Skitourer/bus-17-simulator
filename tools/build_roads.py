"""Builds data/grenoble/roads.json: the drivable road graph from OpenStreetMap (Overpass).

Usage:  uv run python tools/build_roads.py      (after build_line.py and build_map.py)
Data (c) OpenStreetMap contributors, ODbL.

Output (local frame, coordinates in decimetres, compact arrays to keep the file small):
  { "attribution": ...,
    "classes": ["primary", ...],                          # class index -> name
    "flags": ["oneway", ...],                             # bit i of the flag mask -> name
    "nodes": [x0, y0, x1, y1, ...],                       # graph node i at (x[2i], y[2i+1])
    "edges": [ [a, b, class, width_dm, layer, flag_mask, x, y, x, y, ...], ... ] }
"""

import os
from typing import Any

from geo import douglas_peucker, make_proj
from roads import (
    HIGHWAY_REGEX,
    ROAD_CLASSES,
    Edge,
    Way,
    coverage_gaps,
    has_bus_lane,
    highway_base,
    road_width,
    split_ways,
)
from sources import ROOT, overpass, read_json, write_json

LINE = os.path.join(ROOT, 'data', 'grenoble', '17.json')
MAP = os.path.join(ROOT, 'data', 'grenoble', 'map.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'roads.json')
GAP_DIST = 8.0  # m: a route sample farther than this from every road is a coverage gap
GAP_STEP = 5.0  # m between route samples
SIMPLIFY_M = 0.3  # Douglas-Peucker tolerance: well below a lane width, halves the file size


def edge_flags(tags: dict[str, str]) -> list[str]:
    """Rendering and driving flags of a road piece."""
    flags: list[str] = []
    if tags.get('oneway') in ('yes', '1', 'true') or tags.get('junction') in ('roundabout', 'circular'):
        flags.append('oneway')
    if tags.get('oneway') == '-1':
        flags.append('oneway_reverse')
    if tags.get('junction') in ('roundabout', 'circular'):
        flags.append('roundabout')
    if tags.get('bridge', 'no') != 'no':
        flags.append('bridge')
    if tags.get('tunnel', 'no') != 'no' or tags.get('covered') == 'yes':
        flags.append('tunnel')
    if has_bus_lane(tags):
        flags.append('bus_lane')
    if tags.get('highway', '').endswith('_link'):
        flags.append('link')
    return flags


CLASSES = sorted({cls for cls, _ in ROAD_CLASSES.values()})
FLAGS = ['oneway', 'oneway_reverse', 'roundabout', 'bridge', 'tunnel', 'bus_lane', 'link']


def edge_record(e: Edge, index: dict[int, int]) -> list[int]:
    """[a, b, class, width_dm, layer, flag_mask, x, y, ...] (see the module docstring)."""
    base = highway_base(e.tags) or 'residential'
    layer = e.tags.get('layer', '0')
    mask = sum(1 << FLAGS.index(f) for f in edge_flags(e.tags))
    return [
        index[e.a],
        index[e.b],
        CLASSES.index(ROAD_CLASSES[base][0]),
        round(road_width(e.tags) * 10),
        int(layer) if layer.lstrip('-').isdigit() else 0,
        mask,
        *(round(v * 10) for xy in douglas_peucker(e.coords, SIMPLIFY_M) for v in xy),
    ]


def main() -> None:
    line = read_json(LINE)
    bx0, by0, bx1, by1 = read_json(MAP)['bbox']
    to_xy, to_ll = make_proj(*line['origin'])
    s, w = to_ll(bx0, by0)
    n, e = to_ll(bx1, by1)
    bbox = f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'
    query = f'[out:json][timeout:300];way["highway"~"{HIGHWAY_REGEX}"]({bbox});out geom qt;'
    print('Requete Overpass (graphe routier)...')
    elements: list[dict[str, Any]] = overpass(query)['elements']
    ways = [
        Way(el['id'], el['nodes'], [to_xy(g['lat'], g['lon']) for g in el['geometry']], el.get('tags', {}))
        for el in elements
        if el['type'] == 'way' and 'geometry' in el and highway_base(el.get('tags', {}))
    ]
    nodes, edges = split_ways(ways)
    index = {nid: i for i, nid in enumerate(nodes)}
    print(f'{len(ways)} voies, {len(nodes)} noeuds, {len(edges)} troncons')

    for d in line['directions']:
        pts = d['pts']
        route = [(pts[i], pts[i + 1]) for i in range(0, len(pts), 3)]
        gaps = coverage_gaps(route, edges, GAP_DIST, GAP_STEP)
        total = sum(b - a for a, b in gaps)
        print(f'  sens {d["id"]} : {len(gaps)} trous, {total:.0f} m hors reseau')
        for a, b in gaps:
            print(f'    {a:6.0f} - {b:6.0f} m')

    write_json(
        OUT,
        {
            'attribution': '© contributeurs OpenStreetMap (ODbL)',
            'classes': CLASSES,
            'flags': FLAGS,
            'nodes': [round(v * 10) for xy in nodes.values() for v in xy],
            'edges': [edge_record(e, index) for e in edges],
        },
    )


if __name__ == '__main__':
    main()
