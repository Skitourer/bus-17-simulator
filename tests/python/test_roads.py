"""Unit tests of the road graph logic (fictitious ways only)."""

import pytest
from geo import Point
from roads import (
    BUS_ONE_WAY_MIN_WIDTH,
    BUS_TWO_WAY_MIN_WIDTH,
    LANE_WIDTH,
    TWO_WAY_MIN_WIDTH,
    Edge,
    Way,
    coverage_gaps,
    has_bus_lane,
    highway_base,
    is_oneway,
    parse_float,
    road_width,
    route_edges,
    signal_groups,
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
    assert road_width({'highway': 'primary', 'width': '500', 'lanes': '3'}) == 3 * LANE_WIDTH
    assert road_width({'highway': 'secondary'}) == 8.0
    assert road_width({'highway': 'residential', 'oneway': 'yes'}) == pytest.approx(3.6)
    assert road_width({'highway': 'service', 'oneway': 'yes'}) == 4.0
    assert road_width({'highway': 'unknown'}) == 6.0


def test_road_width_raises_narrow_two_way_streets() -> None:
    # OSM `lanes=1` on a two-way street means an unmarked street, not a 3.25 m carriageway
    assert road_width({'highway': 'secondary', 'lanes': '1'}) == TWO_WAY_MIN_WIDTH
    assert road_width({'highway': 'secondary', 'lanes': '1', 'oneway': 'yes'}) == LANE_WIDTH
    assert road_width({'highway': 'service'}) == 4.0
    assert road_width({'highway': 'living_street'}) == 5.0


def test_road_width_fits_a_bus_on_the_line() -> None:
    assert road_width({'highway': 'secondary', 'lanes': '1'}, on_bus_route=True) == BUS_TWO_WAY_MIN_WIDTH
    assert (
        road_width({'highway': 'residential', 'oneway': '-1', 'lanes': '1'}, on_bus_route=True)
        == BUS_ONE_WAY_MIN_WIDTH
    )
    assert road_width({'highway': 'service'}, on_bus_route=True) == BUS_TWO_WAY_MIN_WIDTH
    assert road_width({'highway': 'primary', 'width': '12'}, on_bus_route=True) == 12.0


def test_is_oneway() -> None:
    assert is_oneway({'oneway': 'yes'})
    assert is_oneway({'oneway': '-1'})
    assert is_oneway({'junction': 'roundabout'})
    assert not is_oneway({'oneway': 'no'})


def test_route_edges_keeps_the_edges_along_the_route() -> None:
    along = Edge(1, 2, [(0.0, 2.0), (100.0, 2.0)], 1, {})
    crossing = Edge(3, 4, [(50.0, -30.0), (50.0, 30.0)], 2, {})
    away = Edge(5, 6, [(0.0, 40.0), (100.0, 40.0)], 3, {})
    point = Edge(7, 8, [(0.0, 0.0), (0.0, 0.0)], 4, {})
    route = [(0.0, 0.0), (100.0, 0.0)]
    assert route_edges([along, crossing, away, point], [route], 6.0, 0.6) == {0}


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


def crossroads_edges(nodes: dict[int, Point], centre: int, arms: list[int]) -> list[Edge]:
    """Edges from a centre node to each arm node."""
    return [Edge(centre, a, [nodes[centre], nodes[a]], 1, {}) for a in arms]


def test_signal_groups_maps_signals_to_the_nearest_junction() -> None:
    nodes = {1: (0.0, 0.0), 2: (-100.0, 0.0), 3: (100.0, 0.0), 4: (0.0, 100.0), 5: (500.0, 0.0)}
    edges = [*crossroads_edges(nodes, 1, [2, 3, 4]), Edge(3, 5, [nodes[3], nodes[5]], 2, {})]
    # one signal before the stop line, one far from any junction (a pedestrian light), one on a bend
    signals = [(12.0, 3.0), (300.0, 0.0), (99.0, 2.0)]
    assert signal_groups(signals, nodes, edges, reach=25, gather=30) == [[1]]


def test_signal_groups_gathers_close_junctions_in_one_cycle() -> None:
    nodes = {
        1: (0.0, 0.0),
        2: (20.0, 0.0),
        3: (-100.0, 0.0),
        4: (0.0, 100.0),
        5: (120.0, 0.0),
        6: (20.0, 100.0),
        7: (200.0, 0.0),
        8: (200.0, 100.0),
        9: (300.0, 0.0),
    }
    edges = [
        *crossroads_edges(nodes, 1, [3, 4]),
        Edge(1, 2, [nodes[1], nodes[2]], 1, {}),
        *crossroads_edges(nodes, 2, [5, 6]),
        *crossroads_edges(nodes, 7, [5, 8, 9]),
    ]
    signals = [nodes[1], nodes[2], (201.0, 1.0)]
    assert signal_groups(signals, nodes, edges, reach=25, gather=30) == [[1, 2], [7]]


def test_signal_groups_without_junctions() -> None:
    nodes = {1: (0.0, 0.0), 2: (10.0, 0.0)}
    assert signal_groups([(0.0, 0.0)], nodes, [Edge(1, 2, [nodes[1], nodes[2]], 1, {})], 25, 30) == []
