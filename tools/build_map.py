"""Construit data/grenoble/map.json (fond de la mini-carte) depuis OpenStreetMap via Overpass.

Usage :  uv run python tools/build_map.py      (after build_line.py, which writes the lines and their extent)
Donnees (c) contributeurs OpenStreetMap, licence ODbL : l'attribution est affichee sur la mini-carte.

Sortie : coordonnees locales en metres (memes axes que lines/*.json), arrondies au metre,
  { "polys": { "water": [[x,y,x,y,...], ...], "park": [...], "forest": [...] },
    "lines": { "river": [...], "primary": [...], "secondary": [...], "minor": [...], "tram": [...],
               "rail": [...] } }
"""

import os
from typing import Any

from geo import Point, Projection, douglas_peucker, dp_ring, join_rings, make_proj
from lines import CORRIDOR, LINES_DIR
from sources import ROOT, overpass, read_json, write_json

LINE_INDEX = os.path.join(LINES_DIR, 'index.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'map.json')
MARGIN = CORRIDOR  # m around the lines

ROAD_CLASS = {
    'motorway': 'primary',
    'trunk': 'primary',
    'primary': 'primary',
    'motorway_link': 'primary',
    'trunk_link': 'primary',
    'primary_link': 'primary',
    'secondary': 'secondary',
    'secondary_link': 'secondary',
    'tertiary': 'secondary',
    'tertiary_link': 'secondary',
    'residential': 'minor',
    'unclassified': 'minor',
    'living_street': 'minor',
    'pedestrian': 'minor',
}

HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian'
QUERY = """[out:json][timeout:240];
(
  way["highway"~"^({highways})(_link)?$"]({bb});
  way["railway"~"^(tram|rail)$"]({bb});
  way["waterway"~"^(river|canal)$"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["leisure"~"^(park|garden)$"]({bb});
  relation["leisure"="park"]({bb});
  way["landuse"~"^(forest|grass|meadow|recreation_ground)$"]({bb});
  way["natural"="wood"]({bb});
  relation["landuse"="forest"]({bb});
  relation["natural"="wood"]({bb});
);
out geom qt;"""


def poly_kind(tags: dict[str, str]) -> str | None:
    """Land use class drawn on the map for an OSM area, or None."""
    if tags.get('natural') == 'water':
        return 'water'
    if tags.get('leisure') in ('park', 'garden') or tags.get('landuse') in (
        'grass',
        'meadow',
        'recreation_ground',
    ):
        return 'park'
    if tags.get('landuse') == 'forest' or tags.get('natural') == 'wood':
        return 'forest'
    return None


def pack(shapes: list[list[Point]], eps: float, closed: bool = False) -> list[list[int]]:
    """Simplify each shape and flatten it to [x, y, x, y, ...] rounded to the metre."""
    out: list[list[int]] = []
    for p in shapes:
        p = dp_ring(p, eps) if closed else douglas_peucker(p, eps)
        if len(p) >= 2:
            out.append([round(v) for xy in p for v in xy])
    return out


def classify(
    elements: list[dict[str, Any]], to_xy: Projection
) -> tuple[dict[str, list[list[Point]]], dict[str, list[list[Point]]]]:
    """Sort the OSM elements into map areas and lines."""
    polys: dict[str, list[list[Point]]] = {'water': [], 'park': [], 'forest': []}
    lines: dict[str, list[list[Point]]] = {
        'river': [],
        'primary': [],
        'secondary': [],
        'minor': [],
        'tram': [],
        'rail': [],
    }

    def conv(geom: list[dict[str, float]]) -> list[Point]:
        return [
            (round(to_xy(g['lat'], g['lon'])[0], 1), round(to_xy(g['lat'], g['lon'])[1], 1)) for g in geom
        ]

    for el in elements:
        t: dict[str, str] = el.get('tags', {})
        if el['type'] == 'way' and 'geometry' in el:
            pts = conv(el['geometry'])
            k = poly_kind(t)
            if k and len(pts) > 3 and pts[0] == pts[-1]:
                polys[k].append(pts)
            elif t.get('highway') in ROAD_CLASS:
                lines[ROAD_CLASS[t['highway']]].append(pts)
            elif t.get('railway') in ('tram', 'rail'):
                lines[t['railway']].append(pts)
            elif t.get('waterway') in ('river', 'canal'):
                lines['river'].append(pts)
        elif el['type'] == 'relation':
            k = poly_kind(t)
            if not k:
                continue
            outers = [
                conv(m['geometry'])
                for m in el.get('members', [])
                if m.get('role') == 'outer' and 'geometry' in m
            ]
            for ring in join_rings(outers):
                if len(ring) > 3:
                    polys[k].append(ring)
    return polys, lines


def main() -> None:
    line = read_json(LINE_INDEX)
    lat0, lon0 = line['origin']
    to_xy, to_ll = make_proj(lat0, lon0)
    x0, y0, x1, y1 = line['bbox']
    x0, y0, x1, y1 = x0 - MARGIN, y0 - MARGIN, x1 + MARGIN, y1 + MARGIN
    s, w = to_ll(x0, y0)
    n, e = to_ll(x1, y1)
    bb = f'{s:.5f},{w:.5f},{n:.5f},{e:.5f}'
    print(f'Requete Overpass ({bb})...')
    els = overpass(QUERY.format(highways=HIGHWAYS, bb=bb))['elements']
    print(f'  {len(els)} elements')
    polys, lines = classify(els, to_xy)

    out: dict[str, Any] = {
        'attribution': '© contributeurs OpenStreetMap (ODbL)',
        'bbox': [round(x0), round(y0), round(x1), round(y1)],
        'polys': {k: pack(v, 2.0, True) for k, v in polys.items()},
        'lines': {k: pack(v, 1.5) for k, v in lines.items()},
    }
    for k, v in list(out['polys'].items()) + list(out['lines'].items()):
        print(f'  {k:<9} {len(v):5d}')
    write_json(OUT, out)


if __name__ == '__main__':
    main()
