"""Unit tests of the streets v2 geometry (fictitious terrain and roads only)."""

import numpy as np
import pytest
from shapely import LineString, MultiPolygon, Point, Polygon
from streets import (
    BANK,
    BUILDING_CLEARANCE,
    CROSSING_DEPTH,
    PASSAGE_CLEARANCE,
    SIDEWALK,
    STRIPE,
    TREE_CLEARANCE,
    TREE_DENSITY,
    RoadEdge,
    RoadHeights,
    TerrainGrid,
    carriageway,
    centre_lines,
    clear_trees,
    clip_building,
    crossings,
    junction_radii,
    keep_out_zone,
    kerb_lines,
    lintels,
    load_edges,
    natural_profiles,
    node_heights,
    passage_zone,
    road_pieces,
    road_profiles,
    sample_positions,
    seeded_trees,
    shaped_ground,
    sidewalk_zone,
    smoothstep,
    trimmed,
    tunnel_portals,
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
        'classes': ['busway', 'minor', 'primary'],
        'edges': [[0, 1, 2, 65, 1, 0b101, 0, 0, 100, 50]],
    }
    (e,) = load_edges(data)
    assert (e.a, e.b, e.width) == (0, 1, 6.5)
    assert e.flags == {'oneway', 'bridge'}
    assert e.level == 'bridge'
    assert e.coords == [(0.0, 0.0), (10.0, 5.0)]
    assert e.cls == 'primary'
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


def test_clip_building_removes_the_part_on_the_carriageway() -> None:
    road = carriageway([edge(1, 2, [(-50.0, 0.0), (50.0, 0.0)], width=8.0)])  # y in [-4, 4]
    zone = keep_out_zone(road, BUILDING_CLEARANCE)
    overlapping = [(0.0, 2.0), (10.0, 2.0), (10.0, 12.0), (0.0, 12.0)]
    (part,) = clip_building(overlapping, zone)
    assert min(y for _, y in part) == pytest.approx(4 + BUILDING_CLEARANCE, abs=0.05)
    assert Polygon(part).exterior.is_ccw
    away = [(0.0, 20.0), (10.0, 20.0), (10.0, 30.0), (0.0, 30.0)]
    assert clip_building(away, zone) == [away]
    sliver = [(0.0, 3.0), (10.0, 3.0), (10.0, 5.0), (0.0, 5.0)]  # what is left is under 12 m2
    assert clip_building(sliver, zone) == []
    bowtie = [(20.0, 2.0), (40.0, 22.0), (40.0, 2.0), (20.0, 22.0)]  # invalid ring on the road: repaired
    assert sum(Polygon(p).area for p in clip_building(bowtie, zone)) > 0


def test_trees_are_seeded_in_parks_and_kept_off_roads_and_buildings() -> None:
    park = [0.0, 0.0, 100.0, 0.0, 100.0, 100.0, 0.0, 100.0]
    trees = seeded_trees({'park': [park], 'forest': [[0.0, 0.0, 1.0, 1.0]]}, seed=5)
    assert len(trees) == round(100 * 100 * TREE_DENSITY['park'])
    assert all(0 <= x <= 100 and 0 <= y <= 100 for x, y in trees)
    assert seeded_trees({'park': [park]}, seed=5) == trees  # deterministic
    road = carriageway([edge(1, 2, [(-50.0, 50.0), (150.0, 50.0)], width=8.0)])
    house = Polygon([(10, 10), (30, 10), (30, 30), (10, 30)])
    kept = clear_trees(trees, keep_out_zone(road, TREE_CLEARANCE), [house])
    assert 0 < len(kept) < len(trees)
    assert all(abs(y - 50) > 4 + TREE_CLEARANCE - 1e-6 for _, y in kept)
    assert not any(house.contains(Point(x, y)) for x, y in kept)
    assert clear_trees([], road, []) == []


def cross_junction() -> list[RoadEdge]:
    """Four 8 m roads meeting at node 0 (origin): west, east, south (primary) and north (service)."""
    return [
        edge(1, 0, [(-100.0, 0.0), (0.0, 0.0)], width=8.0),
        edge(0, 2, [(0.0, 0.0), (100.0, 0.0)], width=8.0),
        RoadEdge(3, 0, 8.0, frozenset(), [(0.0, -100.0), (0.0, 0.0)], 'primary'),
        RoadEdge(0, 4, 4.0, frozenset(), [(0.0, 0.0), (0.0, 100.0)], 'service'),
    ]


def test_sidewalks_and_kerbs_follow_streets_with_sidewalks() -> None:
    edges = cross_junction()
    surface = carriageway(edges)
    walks = sidewalk_zone(edges, surface)
    assert not walks.intersects(surface.buffer(-0.01))
    assert walks.contains(Point(-50, 5.5))  # beside the west road
    assert not walks.contains(Point(3.5, 60))  # the service road has none
    kerbs = kerb_lines(surface, walks)
    assert kerbs and all(len(k) >= 2 for k in kerbs)
    assert sum(LineString(k).length for k in kerbs) > 300


def test_junction_radii_and_trimmed_lines() -> None:
    edges = cross_junction()
    radii = junction_radii(edges)
    assert radii == {0: 5.0}
    west = trimmed(edges[0], radii)
    assert west is not None and west.length == pytest.approx(95.0)
    assert trimmed(edge(0, 0, [(0.0, 0.0), (6.0, 0.0)]), radii) is None


def test_centre_lines_skip_one_way_narrow_and_service_roads() -> None:
    edges = [
        *cross_junction(),
        edge(5, 6, [(0.0, 200.0), (100.0, 200.0)], frozenset({'oneway'})),
        edge(7, 8, [(0.0, 300.0), (100.0, 300.0)], width=4.0),
        edge(9, 10, [(0.0, 400.0), (100.0, 400.0)], frozenset({'tunnel'})),
    ]
    lines = centre_lines(edges, junction_radii(edges))
    assert len(lines) == 3  # west, east and south (primary) of the junction
    assert all(LineString(line).length == pytest.approx(95.0) for line in lines)


def test_crossings_cross_main_roads_next_to_junctions() -> None:
    stripes = crossings(cross_junction(), junction_radii(cross_junction()))
    assert len(stripes) == 7  # 8 m road: 0.5 m stripes every metre across the 7 m painted width
    for s in stripes:
        poly = Polygon(s)
        assert poly.area == pytest.approx(STRIPE * CROSSING_DEPTH)
        assert -10 < poly.centroid.y < -5  # just south of the junction, on the primary road
    assert crossings([RoadEdge(0, 1, 8.0, frozenset(), [(0.0, 0.0), (0.0, 5.0)], 'primary')], {0: 5.0}) == []


def test_lintels_keep_the_part_of_a_tall_building_over_a_passage() -> None:
    passage = RoadEdge(1, 2, 4.0, frozenset({'passage'}), [(0.0, -20.0), (0.0, 20.0)])
    street = RoadEdge(2, 3, 6.0, frozenset(), [(0.0, 20.0), (0.0, 60.0)])
    zone = passage_zone([passage, street])
    block = [(-10.0, -5.0), (10.0, -5.0), (10.0, 5.0), (-10.0, 5.0)]
    parts = lintels(block, zone, PASSAGE_CLEARANCE + 10)
    assert len(parts) == 1
    assert Polygon(parts[0]).area == pytest.approx((4.0 + 2 * BUILDING_CLEARANCE) * 10, rel=0.02)
    assert Polygon(parts[0]).exterior.is_ccw
    # too low to span the passage, or away from it
    assert lintels(block, zone, PASSAGE_CLEARANCE) == []
    assert lintels([(x + 50, y) for x, y in block], zone, 20) == []


def test_tunnel_portals_stand_where_a_tunnel_meets_an_open_road() -> None:
    road = RoadEdge(1, 2, 6.0, frozenset(), [(-50.0, 0.0), (0.0, 0.0)])
    tunnel = RoadEdge(2, 3, 7.0, frozenset({'tunnel'}), [(0.0, 0.0), (0.0, 100.0)])
    blind = RoadEdge(4, 5, 7.0, frozenset({'tunnel'}), [(300.0, 0.0), (300.0, 100.0)])
    portals = tunnel_portals([road, tunnel, blind])
    assert portals == [(0.0, 0.0, pytest.approx(np.pi / 2), 7.0)]
    out = RoadEdge(3, 6, 6.0, frozenset(), [(0.0, 100.0), (0.0, 150.0)])
    ends = tunnel_portals([road, tunnel, out])
    assert [round(h, 3) for _, _, h, _ in ends] == [round(np.pi / 2, 3), round(-np.pi / 2, 3)]
