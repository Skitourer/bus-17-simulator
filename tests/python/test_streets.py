"""Unit tests of the streets v2 geometry (fictitious terrain and roads only)."""

import numpy as np
import pytest
from shapely import MultiPolygon, Polygon
from streets import (
    BANK,
    SIDEWALK,
    RoadEdge,
    RoadHeights,
    TerrainGrid,
    carriageway,
    load_edges,
    natural_profiles,
    node_heights,
    road_pieces,
    road_profiles,
    sample_positions,
    shaped_ground,
    smoothstep,
)


def tilted(slope_x: float, slope_y: float = 0.0) -> TerrainGrid:
    """200 m + slope_x * x + slope_y * y on a 40 m grid covering [-400, 400]^2."""
    n = 21
    xs = -400 + np.arange(n) * 40.0
    z = [round((200 + slope_x * x + slope_y * y) * 10) for y in xs for x in xs]
    return TerrainGrid(-400, -400, n, n, 40, z)


def edge(
    a: int, b: int, coords: list[tuple[float, float]], flags: frozenset[str] = frozenset(), width: float = 6.0
) -> RoadEdge:
    return RoadEdge(a, b, width, flags, coords)


def test_load_edges_decodes_the_compact_format() -> None:
    data = {
        'flags': ['oneway', 'roundabout', 'bridge'],
        'edges': [[0, 1, 2, 65, 1, 0b101, 0, 0, 100, 50]],
    }
    (e,) = load_edges(data)
    assert (e.a, e.b, e.width) == (0, 1, 6.5)
    assert e.flags == {'oneway', 'bridge'}
    assert e.level == 'bridge'
    assert e.coords == [(0.0, 0.0), (10.0, 5.0)]
    assert edge(0, 1, [(0, 0), (1, 0)], frozenset({'tunnel'})).level == 'tunnel'


def test_terrain_grid_interpolates_and_clamps() -> None:
    grid = tilted(0.1)
    z = grid.heights(np.array([0.0, 20.0, 5000.0]), np.array([0.0, 0.0, 0.0]))
    assert z[0] == pytest.approx(200)
    assert z[1] == pytest.approx(202)
    assert z[2] == pytest.approx(240)  # clamped at the grid edge (x = 400)


def test_sample_positions_include_both_ends() -> None:
    assert list(sample_positions(12.0, 5.0)) == pytest.approx([0, 4, 8, 12])
    assert list(sample_positions(0.0, 5.0)) == [0.0, 0.0]


def test_profiles_follow_the_slope_and_share_node_heights() -> None:
    terrain = tilted(0.05)
    a = edge(1, 2, [(-100.0, 0.0), (0.0, 0.0)])
    b = edge(2, 3, [(0.0, 0.0), (0.0, 100.0)])
    natural = natural_profiles([a, b], terrain)
    nodes = node_heights([a, b], natural)
    assert nodes[2] == pytest.approx(200, abs=0.1)
    pa, pb = road_profiles([a, b], terrain)
    assert pa.at(0) == pytest.approx(nodes[1])
    assert pa.at(100) == pytest.approx(nodes[2])
    assert pb.at(0) == pytest.approx(nodes[2])  # both edges meet at the same height
    assert pa.at(50) == pytest.approx(197.5, abs=0.3)


def test_bridges_are_straight_between_their_ends() -> None:
    # a river valley 6 m deep under the bridge
    n = 21
    xs = -400 + np.arange(n) * 40.0
    z = [((200 - (6 if abs(x) < 50 else 0)) * 10) for _y in xs for x in xs]
    terrain = TerrainGrid(-400, -400, n, n, 40, z)
    left = edge(1, 2, [(-200.0, 0.0), (-80.0, 0.0)])
    deck = edge(2, 3, [(-80.0, 0.0), (80.0, 0.0)], frozenset({'bridge'}))
    right = edge(3, 4, [(80.0, 0.0), (200.0, 0.0)])
    profiles = road_profiles([left, deck, right], terrain)
    mid = profiles[1].at(80)
    assert mid == pytest.approx((profiles[1].at(0) + profiles[1].at(160)) / 2)
    assert mid > 198  # not down in the valley
    tunnel = edge(5, 6, [(0.0, -100.0), (0.0, 100.0)], frozenset({'tunnel'}))
    assert 5 not in node_heights([tunnel], natural_profiles([tunnel], terrain))


def test_carriageway_merges_edges_and_skips_bridges_and_tunnels() -> None:
    a = edge(1, 2, [(0.0, 0.0), (50.0, 0.0)])
    b = edge(2, 3, [(50.0, 0.0), (50.0, 50.0)])
    over = edge(4, 5, [(0.0, 30.0), (40.0, 30.0)], frozenset({'bridge'}))
    surface = carriageway([a, b, over])
    assert isinstance(surface, Polygon)
    assert surface.contains(Polygon([(49, -2), (51, -2), (51, 2), (49, 2)]))  # the junction is filled
    assert not surface.intersects(Polygon([(10, 29), (20, 29), (20, 31), (10, 31)]))


def test_shaped_ground_flattens_the_road_corridor_and_blends_back() -> None:
    terrain = tilted(0.0, 0.2)  # steep cross slope: 20 %
    road = edge(1, 2, [(-300.0, 0.0), (300.0, 0.0)], width=8.0)
    profiles = road_profiles([road], terrain)
    surface = carriageway([road])
    heights = RoadHeights([road], profiles)
    ys = np.array([0.0, 3.9, 4 + SIDEWALK, 4 + SIDEWALK + BANK / 2, 30.0])
    xs = np.zeros_like(ys)
    natural = terrain.heights(xs, ys)
    shaped = shaped_ground(xs, ys, natural, surface, heights)
    road_z = profiles[0].at(300)
    assert shaped[0] == pytest.approx(road_z, abs=0.05)
    assert shaped[1] == pytest.approx(road_z, abs=0.05)  # flat across the carriageway
    assert shaped[2] == pytest.approx(road_z, abs=0.05)  # and the sidewalk
    assert road_z < shaped[3] < natural[3]  # bank
    assert shaped[4] == pytest.approx(natural[4])  # untouched farther away
    assert list(smoothstep(np.array([-1.0, 0.5, 2.0]))) == [0.0, 0.5, 1.0]


def test_road_pieces_follow_the_ground_triangles() -> None:
    surface = Polygon([(2, 2), (18, 2), (18, 6), (2, 6)])
    pieces = road_pieces(surface, 0.0, 0.0, 3, 10.0)
    assert sum(p.area for p in pieces) == pytest.approx(surface.area)
    for p in pieces:
        # every piece lies in one cell, on one side of the cell diagonal
        minx, miny, maxx, maxy = p.bounds
        cell_x, cell_y = minx // 10 * 10, miny // 10 * 10
        assert maxx <= cell_x + 10 + 1e-9 and maxy <= cell_y + 10 + 1e-9
        sides = {np.sign(round((x - cell_x) - (y - cell_y), 9)) for x, y in p.exterior.coords}
        assert not ({1.0, -1.0} <= sides)
    assert road_pieces(MultiPolygon(), 0.0, 0.0, 3, 10.0) == []
