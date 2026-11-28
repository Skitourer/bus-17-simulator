"""Landmarks drawn by hand in the game (#16): the Bastille cable car, the walls of the Bastille fort and the
Tour Perret, read from OpenStreetMap elements. Pure functions; local frame in metres."""

from collections.abc import Sequence
from typing import Any

from geo import Point, Projection

# OSM ways and node of the landmarks (stable identifiers, checked on 2026-11-28)
CABLE_CAR_WAY = 342018458  # aerialway=cable_car "Bastille", lower station first
TOWER_WAY = 28696571  # man_made=tower "Tour Perret", outline of its base
FORT_NODE = 2876574205  # historic=fort "Fort de la Bastille"
WALL_REACH = 700.0  # m around the fort where the city walls belong to the Bastille fortifications


def geometry(element: dict[str, Any], to_xy: Projection) -> list[Point]:
    """Local points of an Overpass element with `out geom` (a node gives one point)."""
    if 'geometry' in element:
        points = [(g['lat'], g['lon']) for g in element['geometry']]
    else:
        points = [(element['lat'], element['lon'])]
    return [(round(x, 1), round(y, 1)) for x, y in (to_xy(lat, lon) for lat, lon in points)]


def centroid(points: Sequence[Point]) -> Point:
    """Mean of the points of a ring (its closing point counted once)."""
    ring = list(points[:-1]) if len(points) > 1 and points[0] == points[-1] else list(points)
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def landmarks(elements: Sequence[dict[str, Any]], to_xy: Projection) -> dict[str, Any]:
    """The landmarks document: the cable car line (stations at its ends, pylons at its inner vertices more
    than 30 m from them), the tower (centre and base radius) and the walls of the fort."""
    by_key = {(e['type'], e['id']): e for e in elements}
    cable = geometry(by_key[('way', CABLE_CAR_WAY)], to_xy)
    inner = [p for p in cable[1:-1] if min(_dist(p, cable[0]), _dist(p, cable[-1])) > 30]
    base = geometry(by_key[('way', TOWER_WAY)], to_xy)
    cx, cy = centroid(base)
    radius = max(_dist(p, (cx, cy)) for p in base)
    fort = geometry(by_key[('node', FORT_NODE)], to_xy)[0]
    walls = [
        geometry(e, to_xy)
        for e in elements
        if e['type'] == 'way' and e.get('tags', {}).get('barrier') == 'city_wall'
    ]
    near = [w for w in walls if min(_dist(p, fort) for p in w) <= WALL_REACH and len(w) >= 2]
    return {
        'cable_car': {'name': 'Bastille', 'stations': [cable[0], cable[-1]], 'pylons': inner},
        'towers': [{'name': 'Tour Perret', 'x': round(cx, 1), 'y': round(cy, 1), 'radius': round(radius, 1)}],
        'walls': near,
    }


def _dist(a: Point, b: Point) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
