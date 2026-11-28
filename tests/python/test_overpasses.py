"""Unit tests of the headroom under the bridges (fictitious roads only)."""

import numpy as np
import pytest
from overpasses import (
    CLEARANCE,
    CUT_GRADE,
    HUMP_GRADE,
    approach_edges,
    bridge_groups,
    covered_ground,
    crossings,
    dig_underpasses,
    opened_triangles,
    plateau,
    separate_levels,
    tunnel_openings,
    underpass_crossings,
)
from shapely import Polygon
from shapes import polygons
from streets import Profile, RoadEdge


def flat(e: RoadEdge, z: float) -> Profile:
    length = float(np.hypot(e.coords[-1][0] - e.coords[0][0], e.coords[-1][1] - e.coords[0][1]))
    s = np.linspace(0.0, length, max(2, round(length / 5) + 1))
    return Profile(s, np.full(len(s), z))


def overpass(deck_length: float = 200.0) -> tuple[list[RoadEdge], list[Profile]]:
    """A bridge along x (length L) at 101 m, its two approaches, and a road along y below it at 100 m."""
    half = deck_length / 2
    edges = [
        RoadEdge(1, 2, 8.0, frozenset({'bridge'}), [(-half, 0.0), (half, 0.0)]),
        RoadEdge(3, 1, 8.0, frozenset(), [(-half - 100, 0.0), (-half, 0.0)]),
        RoadEdge(2, 4, 8.0, frozenset(), [(half, 0.0), (half + 100, 0.0)]),
        RoadEdge(5, 6, 8.0, frozenset(), [(0.0, -150.0), (0.0, 150.0)]),
    ]
    return edges, [flat(edges[0], 101.0), flat(edges[1], 101.0), flat(edges[2], 101.0), flat(edges[3], 100.0)]


def test_bridge_groups_join_bridges_end_to_end() -> None:
    edges = [
        RoadEdge(1, 2, 8.0, frozenset({'bridge'}), [(0.0, 0.0), (10.0, 0.0)]),
        RoadEdge(2, 3, 8.0, frozenset({'bridge'}), [(10.0, 0.0), (20.0, 0.0)]),
        RoadEdge(3, 4, 8.0, frozenset(), [(20.0, 0.0), (30.0, 0.0)]),
        RoadEdge(7, 8, 8.0, frozenset({'bridge'}), [(0.0, 50.0), (10.0, 50.0)]),
    ]
    assert sorted(sorted(g) for g in bridge_groups(edges)) == [[0, 1], [3]]
    assert approach_edges(edges) == {2}


def test_crossings_find_the_missing_headroom_under_a_bridge() -> None:
    edges, profiles = overpass()
    [c] = crossings(edges, profiles)
    assert (c.bridge, c.road) == (0, 3)
    assert (c.x, c.y, c.s_bridge, c.s_road) == pytest.approx((0.0, 0.0, 100.0, 150.0))
    assert c.missing == pytest.approx(CLEARANCE - 1.0)


def test_a_long_bridge_rises_over_the_road_and_keeps_its_ends() -> None:
    edges, profiles = overpass(400.0)
    deck, before, after, below = separate_levels(edges, profiles)
    assert deck.at(200.0) - below.at(150.0) == pytest.approx(CLEARANCE)
    assert (deck.z[0], deck.z[-1]) == (101.0, 101.0)
    assert np.max(np.abs(np.diff(deck.z) / np.diff(deck.s))) <= HUMP_GRADE + 1e-9
    assert below.at(150.0) == pytest.approx(100.0)
    assert before is profiles[1] and after is profiles[2]


def test_a_short_bridge_rises_what_it_can_and_the_road_below_dips_by_the_rest() -> None:
    edges, profiles = overpass(40.0)
    deck, _, _, below = separate_levels(edges, profiles)
    lift = (20.0 - 4.0 - 1.0) * HUMP_GRADE
    assert deck.at(20.0) == pytest.approx(101.0 + lift)
    assert below.at(150.0) == pytest.approx(100.0 - (CLEARANCE - 1.0 - lift))
    assert deck.at(20.0) - below.at(150.0) == pytest.approx(CLEARANCE)
    assert np.max(np.abs(np.diff(below.z) / np.diff(below.s))) <= CUT_GRADE + 1e-9
    assert (below.z[0], below.z[-1]) == (100.0, 100.0)


def test_high_bridges_and_bridges_over_nothing_stay_as_they_are() -> None:
    edges, profiles = overpass()
    high = [Profile(profiles[0].s, profiles[0].z + 10), *profiles[1:]]
    assert crossings(edges, high)[0].missing == 0.0
    assert separate_levels(edges, high) == high
    assert separate_levels(edges[:3], profiles[:3]) == profiles[:3]


def test_plateau() -> None:
    d = np.array([0.0, 5.0, 10.0, 30.0])
    assert plateau(d, 5.0, 2.0, 0.1).tolist() == pytest.approx([2.0, 2.0, 1.5, 0.0])
    assert plateau(d, 5.0, 0.0, 0.1).tolist() == [0.0] * 4


def underpass() -> tuple[list[RoadEdge], list[Profile]]:
    """A street along x at 100 m over a 30 m tunnel along y, its two ramps, and a street beyond a ramp."""
    edges = [
        RoadEdge(1, 2, 10.0, frozenset(), [(-200.0, 0.0), (200.0, 0.0)]),
        RoadEdge(3, 4, 8.0, frozenset({'tunnel'}), [(0.0, -15.0), (0.0, 15.0)]),
        RoadEdge(5, 3, 8.0, frozenset(), [(0.0, -100.0), (0.0, -15.0)]),
        RoadEdge(4, 6, 8.0, frozenset(), [(0.0, 15.0), (0.0, 100.0)]),
        RoadEdge(6, 7, 8.0, frozenset(), [(0.0, 100.0), (0.0, 300.0)]),
    ]
    return edges, [flat(e, 100.0) for e in edges]


def test_underpasses_dig_the_tunnel_and_its_ramps_and_keep_the_road_above() -> None:
    edges, profiles = underpass()
    [c] = underpass_crossings(edges, profiles)
    assert (c.bridge, c.road, c.missing) == (0, 1, pytest.approx(CLEARANCE))
    above, tunnel, ramp_in, ramp_out, beyond = dig_underpasses(edges, profiles)
    assert above is profiles[0]
    assert above.at(200.0) - tunnel.at(15.0) == pytest.approx(CLEARANCE)
    assert ramp_in.z[0] == pytest.approx(100.0)
    assert ramp_out.at(0.0) == pytest.approx(tunnel.z[-1])
    assert np.max(np.abs(np.diff(ramp_in.z) / np.diff(ramp_in.s))) <= CUT_GRADE + 1e-9
    assert beyond is profiles[4]


def test_deep_enough_underpasses_stay_as_they_are() -> None:
    edges, profiles = underpass()
    deep = [profiles[0], Profile(profiles[1].s, profiles[1].z - 10), *profiles[2:]]
    assert underpass_crossings(edges, deep)[0].missing == 0.0
    assert dig_underpasses(edges, deep) == deep


def test_the_ground_covers_the_underpass_between_its_mouths() -> None:
    edges, profiles = underpass()
    dug = dig_underpasses(edges, profiles)
    xs = np.array([0.0, 0.0, 0.0, 30.0])
    ys = np.array([5.0, -14.0, -20.0, 5.0])
    ground = np.full(4, 97.0)
    out = covered_ground(xs, ys, ground, [(edges[1], dug[1])], np.zeros(4, dtype=bool))
    assert covered_ground(xs, ys, ground, [(edges[1], dug[1])], np.ones(4, dtype=bool)).tolist() == [97.0] * 4
    # over the tunnel: floor + CLEARANCE; in the trench before the mouth and away from it: unchanged
    assert out[0] == pytest.approx(dug[1].at(20.0) + CLEARANCE)
    assert out[1] == pytest.approx(dug[1].at(1.0) + CLEARANCE)
    assert out[2:].tolist() == [97.0, 97.0]


def test_the_ground_opens_over_the_tunnel_mouths_but_not_under_the_road_above() -> None:
    edges, profiles = underpass()
    dug = dig_underpasses(edges, profiles)
    openings = tunnel_openings([edges[1]], [edges[0]], 2.5)
    assert openings.contains(Polygon([(-1, -12), (1, -12), (1, -10), (-1, -10)]))
    assert not openings.intersects(Polygon([(-1, -1), (1, -1), (1, 1), (-1, 1)]))
    tris = polygons(
        np.array(
            [
                [[-2.0, -14.0], [2.0, -14.0], [0.0, -11.0], [-2.0, -14.0]],
                [[-2.0, -12.0], [2.0, -12.0], [0.0, -9.0], [-2.0, -12.0]],
                [[50.0, 50.0], [52.0, 50.0], [51.0, 52.0], [50.0, 50.0]],
            ]
        )
    )
    cover = dug[1].at(3.0) + CLEARANCE
    corners = np.array([[95.0, 95.0, cover], [cover, cover, cover], [95.0, 95.0, 95.0]])
    assert opened_triangles(tris, corners, openings, [(edges[1], dug[1])]) == [0]
    assert opened_triangles(tris, corners, Polygon(), [(edges[1], dug[1])]) == []
