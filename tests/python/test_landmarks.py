"""Unit tests of the landmarks read from OpenStreetMap (fictitious elements)."""

from typing import Any

import pytest
from landmarks import CABLE_CAR_WAY, FORT_NODE, TOWER_WAY, WALL_REACH, centroid, landmarks


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
