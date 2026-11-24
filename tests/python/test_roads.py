"""Unit tests of the road graph logic (fictitious ways only)."""

import pytest
from geo import Point
from roads import (
    LANE_WIDTH,
    Edge,
    Way,
    coverage_gaps,
    has_bus_lane,
    highway_base,
    parse_float,
    road_width,
    split_ways,
)


def test_highway_base_keeps_drivable_roads_only() -> None:
    assert highway_base({'highway': 'primary_link'}) == 'primary'
    assert highway_base({'highway': 'busway'}) == 'busway'
    assert highway_base({'highway': 'service'}) == 'service'
    assert highway_base({'highway': 'service', 'service': 'parking_aisle'}) is None
    assert highway_base({'highway': 'footway'}) is None
    assert highway_base({'highway': 'pedestrian'}) is None
    assert highway_base({'highway': 'residential', 'area': 'yes'}) is None
    assert highway_base({}) is None


@pytest.mark.parametrize(
    ('value', 'expected'),
    [('7', 7.0), ('7.5 m', 7.5), ('6,5', 6.5), ('2;3', 2.0), ('wide', None), (None, None), ('', None)],
)
def test_parse_float(value: str | None, expected: float | None) -> None:
    assert parse_float(value) == expected


def test_road_width_prefers_width_then_lanes_then_class() -> None:
    assert road_width({'highway': 'primary', 'width': '12'}) == 12.0
    assert road_width({'highway': 'primary', 'width': '500', 'lanes': '2'}) == 2 * LANE_WIDTH
    assert road_width({'highway': 'secondary'}) == 8.0
    assert road_width({'highway': 'residential', 'oneway': 'yes'}) == pytest.approx(3.6)
    assert road_width({'highway': 'service', 'oneway': 'yes'}) == 4.0
    assert road_width({'highway': 'unknown'}) == 6.0


def test_has_bus_lane() -> None:
    assert has_bus_lane({'busway': 'lane'})
    assert has_bus_lane({'busway:right': 'lane'})
    assert has_bus_lane({'lanes:bus': '1'})
    assert has_bus_lane({'bus:lanes': 'designated|yes'})
    assert not has_bus_lane({'busway': 'no', 'lanes:bus': '0'})
    assert not has_bus_lane({})


def way(wid: int, nodes: list[int], coords: list[Point]) -> Way:
    return Way(wid, nodes, coords, {'highway': 'residential'})


def test_split_ways_cuts_at_shared_nodes() -> None:
    # a T junction: way 1 runs west-east through node 2, way 2 starts at node 2 going north
    w1 = way(1, [1, 2, 3], [(0.0, 0.0), (10.0, 0.0), (20.0, 0.0)])
    w2 = way(2, [2, 4, 5], [(10.0, 0.0), (10.0, 5.0), (10.0, 10.0)])
    nodes, edges = split_ways([w1, w2])
    assert set(nodes) == {1, 2, 3, 5}
    assert [(e.a, e.b) for e in edges] == [(1, 2), (2, 3), (2, 5)]
    assert edges[2].coords == [(10.0, 0.0), (10.0, 5.0), (10.0, 10.0)]


def test_split_ways_handles_closed_loops() -> None:
    ring = way(7, [1, 2, 3, 1], [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 0.0)])
    spur = way(8, [2, 9], [(10.0, 0.0), (20.0, 0.0)])
    nodes, edges = split_ways([ring, spur])
    assert set(nodes) == {1, 2, 9}
    assert [(e.a, e.b) for e in edges] == [(1, 2), (2, 1), (2, 9)]


def test_coverage_gaps_finds_stretches_away_from_roads() -> None:
    road = Edge(1, 2, [(0.0, 0.0), (100.0, 0.0)], 1, {})
    route: list[Point] = [(0.0, 0.0), (100.0, 0.0), (100.0, 50.0)]
    gaps = coverage_gaps(route, [road], max_dist=5.0, step=1.0)
    assert len(gaps) == 1
    start, end = gaps[0]
    assert start == pytest.approx(106.0)
    assert end == pytest.approx(150.0)
    assert coverage_gaps([(10.0, 1.0), (90.0, 1.0)], [road], 5.0, 1.0) == []


def test_coverage_gap_inside_the_route() -> None:
    a = Edge(1, 2, [(0.0, 0.0), (40.0, 0.0)], 1, {})
    b = Edge(3, 4, [(60.0, 0.0), (100.0, 0.0)], 2, {})
    gaps = coverage_gaps([(0.0, 0.0), (100.0, 0.0)], [a, b], 5.0, 1.0)
    assert gaps == [(46.0, 55.0)]
