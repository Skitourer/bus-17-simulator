"""Unit tests of the landmarks read from OpenStreetMap (fictitious elements)."""

from typing import Any

import pytest
from landmarks import (
    CABLE_CAR_WAY,
    DEFAULT_HEIGHT,
    FORT_NODE,
    PARTS,
    SITES,
    TOWER_WAY,
    WALL_REACH,
    Footprint,
    centroid,
    landmarks,
    monuments,
)
from shapely import Polygon


def flat(lat: float, lon: float) -> tuple[float, float]:
    """A fictitious projection: 1 degree = 1000 m."""
    return lon * 1000, lat * 1000


def way(ident: int, points: list[tuple[float, float]], **tags: str) -> dict[str, Any]:
    return {'type': 'way', 'id': ident, 'tags': tags, 'geometry': [{'lat': y, 'lon': x} for x, y in points]}


def test_landmarks_read_the_cable_car_the_tower_and_the_walls_near_the_fort() -> None:
    elements = [
        way(CABLE_CAR_WAY, [(0, 0), (0, 0.01), (0, 0.4), (0, 0.6)], aerialway='cable_car'),
        way(TOWER_WAY, [(1, 1), (1.01, 1), (1.01, 1.01), (1, 1.01), (1, 1)], man_made='tower'),
        {'type': 'node', 'id': FORT_NODE, 'lat': 0.6, 'lon': 0.0, 'tags': {'historic': 'fort'}},
        way(1, [(0.1, 0.6), (0.2, 0.6)], barrier='city_wall'),
        way(2, [(0.1 + WALL_REACH / 1000 + 0.1, 0.6), (2, 0.6)], barrier='city_wall'),
        way(3, [(0.1, 0.5), (0.1, 0.55)], barrier='fence'),
    ]
    doc = landmarks(elements, flat)
    # the vertex 10 m from the lower station is no pylon
    assert doc['cable_car'] == {'name': 'Bastille', 'stations': [(0, 0), (0, 600)], 'pylons': [(0, 400)]}
    [tower] = doc['towers']
    assert (tower['x'], tower['y']) == pytest.approx((1005, 1005))
    assert tower['radius'] == pytest.approx(7.1, abs=0.1)
    assert doc['walls'] == [[(100, 600), (200, 600)]]


def test_centroid_counts_the_closing_point_once() -> None:
    assert centroid([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)]) == (1, 1)
    assert centroid([(0, 0), (4, 0)]) == (2, 0)


def square(x: float, y: float, side: float) -> Polygon:
    return Polygon([(x, y), (x + side, y), (x + side, y + side), (x, y + side)])


def test_monuments_take_their_heights_and_towers_from_the_bd_topo() -> None:
    church, cathedral, hall, site = PARTS[0], PARTS[1], PARTS[3], SITES[0]
    assert cathedral.tower and hall.tower
    elements = [
        way(church.osm[1], [(0, 0), (0.05, 0), (0.05, 0.02), (0, 0.02), (0, 0)]),
        way(cathedral.osm[1], [(1, 0), (1.05, 0), (1.05, 0.02), (1, 0.02), (1, 0)]),
        way(cathedral.tower[1], [(1, 0), (1.01, 0), (1.01, 0.01), (1, 0.01), (1, 0)]),
        {
            'type': 'relation',
            'id': hall.osm[1],
            'members': [
                {
                    'role': 'outer',
                    'geometry': [{'lat': 0, 'lon': 2}, {'lat': 0, 'lon': 2.01}, {'lat': 0.01, 'lon': 2.01}],
                },
                {'role': 'outer', 'geometry': [{'lat': 0.01, 'lon': 2.01}, {'lat': 0, 'lon': 2}]},
            ],
        },
        way(site.osm[1], [(3, 0), (3.1, 0), (3.1, 0.1), (3, 0.1), (3, 0)]),
    ]
    bd = [
        Footprint(30.0, square(2, 2, 6)),  # church tower
        Footprint(18.0, square(20, 5, 10)),  # church nave
        Footprint(27.0, square(1002, 2, 5)),  # cathedral tower
        Footprint(16.0, square(1030, 5, 10)),  # cathedral nave
        Footprint(7.0, square(3010, 10, 20)),  # in the site
        Footprint(9.0, square(4010, 10, 20)),  # elsewhere
    ]
    blocks = monuments(elements, flat, bd)
    by_style = [(b['style'], b['height'], b['roof'], b['spire']) for b in blocks]
    assert by_style[:2] == [('brick', 18.0, 'gabled', 0.0), ('brick', 30.0, 'flat', church.spire)]
    assert by_style[2:4] == [('stone', 16.0, 'gabled', 0.0), ('brick', 27.0, 'flat', cathedral.spire)]
    assert ('concrete', DEFAULT_HEIGHT, 'flat', 0.0) in by_style
    assert ('render', 7.0, 'flat', 0.0) in by_style
    assert all(b['ring'][0] != b['ring'][-1] for b in blocks)
