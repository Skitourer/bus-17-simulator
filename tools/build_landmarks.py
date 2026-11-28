"""Builds data/grenoble/landmarks.json: the landmarks drawn by hand in the game (#16), from OpenStreetMap
(Overpass, cached in tools/cache/) with heights from the IGN BD TOPO (tools/cache/buildings.json).

Usage:  uv run python tools/build_landmarks.py      (after build_buildings.py)
Data (c) OpenStreetMap contributors, ODbL; IGN BD TOPO, Licence Ouverte 2.0.

Output (local frame of the lines, metres):
  { "cable_car": { "name", "stations": [[x, y], [x, y]] (lower, upper), "pylons": [[x, y], ...] },
    "towers": [ { "name", "x", "y", "radius" } ],   (radius of the base)
    "walls": [ [[x, y], ...], ... ],   (fortification walls around the fort)
    "monuments": [ { "style", "ring": [[x, y], ...], "height", "roof": "flat" | "gabled", "rise",
                     "spire" } ] }
                  (buildings drawn by hand; the game leaves out the BD TOPO buildings inside them)
"""

import os

from geo import make_proj
from landmarks import CABLE_CAR_WAY, FORT_NODE, PARTS, SITES, TOWER_WAY, Footprint, landmarks, monuments
from lines import ORIGIN
from shapely import Polygon
from sources import CACHE, ROOT, overpass, read_json, write_json

OUT = os.path.join(ROOT, 'data', 'grenoble', 'landmarks.json')
ELEMENTS = sorted(
    {p.osm for p in PARTS}
    | {p.tower for p in PARTS if p.tower}
    | {s.osm for s in SITES}
    | {('way', CABLE_CAR_WAY), ('way', TOWER_WAY), ('node', FORT_NODE)}
)
QUERY = (
    '[out:json][timeout:90];\n(\n'
    + ''.join(f'  {kind}({ident});\n' for kind, ident in ELEMENTS)
    + '  way["barrier"="city_wall"](45.188,5.712,45.206,5.738);\n);\nout geom;'
)


def bd_topo() -> list[Footprint]:
    """The BD TOPO buildings of tools/cache/buildings.json (wall height and outline)."""
    out: list[Footprint] = []
    for rec in read_json(os.path.join(CACHE, 'buildings.json'))['b']:
        ring = [(rec[k] / 10, rec[k + 1] / 10) for k in range(5, len(rec), 2)]
        out.append(Footprint(rec[0] / 10, Polygon(ring)))
    return out


def main() -> None:
    to_xy, _ = make_proj(*ORIGIN)
    elements = overpass(QUERY)['elements']
    doc = landmarks(elements, to_xy)
    doc['monuments'] = monuments(elements, to_xy, bd_topo())
    print(
        f'{len(doc["walls"])} murs, {len(doc["cable_car"]["pylons"])} pylones, {len(doc["monuments"])} blocs'
    )
    attribution = '(c) OpenStreetMap contributors, ODbL; IGN BD TOPO, Licence Ouverte 2.0'
    write_json(OUT, {'attribution': attribution, **doc})


if __name__ == '__main__':
    main()
