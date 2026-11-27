"""Builds data/grenoble/roads.json: the drivable road graph from OpenStreetMap (Overpass).

Usage:  uv run python tools/build_roads.py      (after build_line.py and build_map.py)
Only the roads of the corridor around the lines are kept (tools/lines.py, ADR 0010).
Data (c) OpenStreetMap contributors, ODbL.

Output (local frame, coordinates in decimetres, compact arrays to keep the file small):
  { "attribution": ...,
    "classes": ["primary", ...],                          # class index -> name
    "flags": ["oneway", ...],                             # bit i of the flag mask -> name
    "nodes": [x0, y0, x1, y1, ...],                       # graph node i at (x[2i], y[2i+1])
    "edges": [ [a, b, class, width_dm, layer, flag_mask, x, y, x, y, ...], ... ],
    "signals": [ [node, node, ...], ... ] }   # junctions with traffic lights, one cycle per group
"""

import os
from typing import Any

from geo import douglas_peucker, make_proj
from lines import LINES_DIR, corridor, overpass_polys, read_lines, routes_xy
from roads import (
    HIGHWAY_REGEX,
    ROAD_CLASSES,
    Edge,
    Way,
    coverage_gaps,
    has_bus_lane,
    highway_base,
    road_width,
    route_edges,
    signal_groups,
    split_ways,
)
from shapely import LineString
from sources import ROOT, overpass, read_json, write_json

LINE_INDEX = os.path.join(LINES_DIR, 'index.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'roads.json')
GAP_DIST = 8.0  # m: a route sample farther than this from every road is a coverage gap
GAP_STEP = 5.0  # m between route samples
SIMPLIFY_M = 0.3  # Douglas-Peucker tolerance: well below a lane width, halves the file size
POLY_SIMPLIFY = 25.0  # m: corridor outline sent to Overpass (a shorter query)
ROUTE_TOLERANCE = 6.0  # m: the GTFS shape drifts up to a few metres from the OSM centre line
ROUTE_SHARE = 0.6  # share of an edge length along the route for the edge to carry the line
# OSM signals stand on the junction node or a few metres before the stop line of each approach
SIGNAL_REACH = 25.0  # m from a signal to the junction it controls
SIGNAL_GATHER = 30.0  # m: signalised junctions this close (dual carriageways crossing) share one cycle


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
    tunnel = tags.get('tunnel', 'no')
    if tunnel == 'building_passage' or (tunnel == 'no' and tags.get('covered') == 'yes'):
        flags.append('passage')  # at street level under a building: drawn and driven like a street
    elif tunnel != 'no':
        flags.append('tunnel')
    if has_bus_lane(tags):
        flags.append('bus_lane')
    if tags.get('highway', '').endswith('_link'):
        flags.append('link')
    return flags


CLASSES = sorted({cls for cls, _ in ROAD_CLASSES.values()})
FLAGS = ['oneway', 'oneway_reverse', 'roundabout', 'bridge', 'tunnel', 'bus_lane', 'link', 'passage']


def edge_record(e: Edge, index: dict[int, int], on_bus_route: bool) -> list[int]:
    """[a, b, class, width_dm, layer, flag_mask, x, y, ...] (see the module docstring)."""
    base = highway_base(e.tags) or 'residential'
    layer = e.tags.get('layer', '0')
    mask = sum(1 << FLAGS.index(f) for f in edge_flags(e.tags))
    return [
        index[e.a],
        index[e.b],
        CLASSES.index(ROAD_CLASSES[base][0]),
        round(road_width(e.tags, on_bus_route) * 10),
        int(layer) if layer.lstrip('-').isdigit() else 0,
        mask,
        *(round(v * 10) for xy in douglas_peucker(e.coords, SIMPLIFY_M) for v in xy),
    ]


def main() -> None:
    lines = read_lines()
    routes = [route for line in lines for route in routes_xy(line)]
    area = corridor(routes)
    to_xy, to_ll = make_proj(*read_json(LINE_INDEX)['origin'])
    # one query per part of the corridor, smaller than the whole bounding box of the lines
    polys = overpass_polys(area, to_ll, POLY_SIMPLIFY)
    print(f'Requete Overpass (graphe routier, {len(polys)} zone(s))...')
    by_id: dict[int, dict[str, Any]] = {}
    for poly in polys:
        query = f'[out:json][timeout:300];way["highway"~"{HIGHWAY_REGEX}"](poly:"{poly}");out geom qt;'
        by_id.update((el['id'], el) for el in overpass(query)['elements'])
    elements = list(by_id.values())
    ways = [
        Way(el['id'], el['nodes'], [to_xy(g['lat'], g['lon']) for g in el['geometry']], el.get('tags', {}))
        for el in elements
        if el['type'] == 'way' and 'geometry' in el and highway_base(el.get('tags', {}))
    ]
    all_nodes, all_edges = split_ways(ways)
    # only the roads of the corridor around the lines, like the tiles (ADR 0010)
    edges = [e for e in all_edges if area.intersects(LineString(e.coords))]
    used = {n for e in edges for n in (e.a, e.b)}
    nodes = {nid: xy for nid, xy in all_nodes.items() if nid in used}
    index = {nid: i for i, nid in enumerate(nodes)}
    print(f'{len(ways)} voies, {len(nodes)} noeuds, {len(edges)} troncons ({len(all_edges)} dans l emprise)')

    print('Requete Overpass (feux)...')
    signal_nodes: dict[int, dict[str, Any]] = {}
    for poly in polys:
        query = f'[out:json][timeout:120];node["highway"="traffic_signals"](poly:"{poly}");out qt;'
        signal_nodes.update((el['id'], el) for el in overpass(query)['elements'] if el['type'] == 'node')
    signals = [to_xy(el['lat'], el['lon']) for el in signal_nodes.values()]
    groups = signal_groups(signals, nodes, edges, SIGNAL_REACH, SIGNAL_GATHER)
    print(f'{len(signals)} feux, {len(groups)} carrefours a feux')

    on_route = route_edges(edges, routes, ROUTE_TOLERANCE, ROUTE_SHARE)
    print(f'{len(on_route)} troncons parcourus par les lignes')
    for line in lines:
        for k, route in enumerate(routes_xy(line)):
            gaps = coverage_gaps(route, edges, GAP_DIST, GAP_STEP)
            total = sum(b - a for a, b in gaps)
            print(f'  ligne {line["id"]} parcours {k} : {len(gaps)} trous, {total:.0f} m hors reseau')
            for a, b in gaps:
                print(f'    {a:6.0f} - {b:6.0f} m')

    write_json(
        OUT,
        {
            'attribution': '© contributeurs OpenStreetMap (ODbL)',
            'classes': CLASSES,
            'flags': FLAGS,
            'nodes': [round(v * 10) for xy in nodes.values() for v in xy],
            'edges': [edge_record(e, index, i in on_route) for i, e in enumerate(edges)],
            'signals': [[index[n] for n in group] for group in groups],
        },
    )


if __name__ == '__main__':
    main()
