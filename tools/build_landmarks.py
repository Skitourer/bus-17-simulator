"""Builds data/grenoble/landmarks.json: the Bastille cable car, the walls of the Bastille fort and the Tour
Perret, from OpenStreetMap (Overpass, cached in tools/cache/), drawn by hand in the game (#16).

Usage:  uv run python tools/build_landmarks.py
Data (c) OpenStreetMap contributors, ODbL.

Output (local frame of the lines, metres):
  { "cable_car": { "name", "stations": [[x, y], [x, y]] (lower, upper), "pylons": [[x, y], ...] },
    "towers": [ { "name", "x", "y", "radius" } ],   (radius of the base)
    "walls": [ [[x, y], ...], ... ] }   (fortification walls around the fort)
"""

import os

from geo import make_proj
from landmarks import CABLE_CAR_WAY, FORT_NODE, TOWER_WAY, landmarks
from lines import ORIGIN
from sources import ROOT, overpass, write_json

OUT = os.path.join(ROOT, 'data', 'grenoble', 'landmarks.json')
QUERY = f"""[out:json][timeout:90];
(
  way({CABLE_CAR_WAY});
  way({TOWER_WAY});
  node({FORT_NODE});
  way["barrier"="city_wall"](45.188,5.712,45.206,5.738);
);
out tags geom;"""


def main() -> None:
    to_xy, _ = make_proj(*ORIGIN)
    doc = landmarks(overpass(QUERY)['elements'], to_xy)
    print(f'{len(doc["walls"])} murs, {len(doc["cable_car"]["pylons"])} pylones')
    write_json(OUT, {'attribution': '(c) OpenStreetMap contributors, ODbL', **doc})


if __name__ == '__main__':
    main()
