"""Unit tests of the terraces held up by retaining walls (fictitious roads only)."""

import numpy as np
import pytest
from shapely import LineString, MultiPoint, Polygon
from streets import SIDEWALK, Profile, RoadEdge
from terraces import (
    TERRACE_PAD,
    Terrace,
    footprint,
    footprint_half_width,
    runs_of,
    split_edges,
    terrace_record,
    terrace_runs,
    terraced_ground,
)


def straight(a: int, b: int, y: float, z0: float, z1: float, cls: str = 'minor') -> tuple[RoadEdge, Profile]:
    """A 6 m wide road from x = -100 to x = 100 at height y, climbing from z0 to z1."""
    e = RoadEdge(a, b, 6.0, frozenset(), [(-100.0, y), (100.0, y)], cls)
    s = np.linspace(0.0, 200.0, 41)
    return e, Profile(s, z0 + (z1 - z0) * s / 200)


def two_roads(gap: float, rise: float) -> tuple[list[RoadEdge], list[Profile]]:
    """A lower road along y = 0 and a road `rise` m higher with `gap` m between their carriageways."""
    low, high = straight(1, 2, 0.0, 100.0, 100.0), straight(3, 4, 6.0 + gap, 100 + rise, 100 + rise)
    return [low[0], high[0]], [low[1], high[1]]


def test_the_upper_of_two_close_roads_becomes_a_terrace() -> None:
    edges, profiles = two_roads(4.0, 2.0)
    runs = terrace_runs(edges, profiles, Polygon())
    assert [r.edge for r in runs] == [1]
    assert runs[0].start == pytest.approx(0.0)
    assert runs[0].end == pytest.approx(200.0)


@pytest.mark.parametrize(('gap', 'rise'), [(20.0, 2.0), (4.0, 0.2)])
def test_distant_or_level_roads_get_no_terrace(gap: float, rise: float) -> None:
    edges, profiles = two_roads(gap, rise)
    assert terrace_runs(edges, profiles, Polygon()) == []


def test_terraces_stop_before_junctions_and_stay_where_the_roads_are_close() -> None:
    low, high = straight(1, 2, 0.0, 100.0, 100.0), straight(3, 4, 10.0, 102.0, 102.0)
    # the lower road only runs beside the middle of the upper one: samples less than 9.8 m from its ends
    # (13.5 m between centre lines) are too close
    low = (
        RoadEdge(1, 2, 6.0, frozenset(), [(-20.0, 0.0), (20.0, 0.0)]),
        Profile(np.linspace(0, 40, 9), np.full(9, 100.0)),
    )
    junction = Polygon([(-5, 0), (5, 0), (5, 20), (-5, 20)])
    runs = terrace_runs([low[0], high[0]], [low[1], high[1]], junction)
    assert [(r.start, r.end) for r in runs] == [
        pytest.approx((75 - TERRACE_PAD, 95.0), abs=1.0),
        pytest.approx((105.0, 125 + TERRACE_PAD), abs=1.0),
    ]


def test_runs_merge_and_stay_on_the_road() -> None:
    s = np.array([0.0, 5.0, 10.0, 50.0, 95.0, 100.0])
    flags = np.array([True, False, True, False, False, True])
    assert runs_of(flags, s, 10.0, 100.0) == [(0.0, 20.0), (90.0, 100.0)]


def test_split_edges_cut_the_terraces_out_with_their_heights() -> None:
    e, p = straight(1, 2, 0.0, 100.0, 110.0)
    ground_edges, ground_profiles, terrace_edges, terrace_profiles = split_edges(
        [e], [p], [Terrace(0, 50.0, 120.0)]
    )
    assert [LineString(g.coords).length for g in ground_edges] == pytest.approx([50.0, 80.0])
    assert ground_edges[0].a == 1 and ground_edges[1].b == 2
    # cut ends join nothing of the graph, but each piece meets the terrace at the same new node
    assert ground_edges[0].b == terrace_edges[0].a < 0
    assert terrace_edges[0].b == ground_edges[1].a < 0
    assert terrace_profiles[0].z[0] == pytest.approx(102.5)
    assert terrace_profiles[0].at(70.0) == pytest.approx(106.0)
    assert ground_profiles[1].s[0] == 0.0 and ground_profiles[1].z[0] == pytest.approx(106.0)


def test_footprint_and_record_cover_the_road_and_its_sidewalks() -> None:
    street, p = straight(1, 2, 0.0, 100.0, 100.0)
    service = RoadEdge(1, 2, 6.0, frozenset(), street.coords, 'service')
    assert footprint_half_width(street) == 3.0 + SIDEWALK
    assert footprint_half_width(service) == 3.0
    assert footprint([street]).area == pytest.approx(200 * 11 + np.pi * 5.5**2, rel=0.01)
    rec = terrace_record(street, p, -100.0, 0.0)
    assert rec[:4] == [110, 0, 0, 1000]
    assert len(rec) == 1 + 3 * len(p.s)


def test_terraced_ground_follows_the_lower_road_and_stays_below_the_terrace() -> None:
    shaped = np.array([104.0, 104.0, 104.0, 99.0, 120.0])
    without = np.array([100.0, 100.0, 120.0, 98.0, 120.0])
    to_roads = np.array([0.0, 2.0, 20.0, 1.0, 20.0])
    to_terraces = np.array([3.0, 0.0, 0.0, 1.5, 4.0])
    terrace_z = np.array([104.0, 104.0, 104.0, 104.0, 104.0])
    out = terraced_ground(shaped, without, to_roads, to_terraces, terrace_z)
    # between the roads and under the terrace: the lower road; far from the lower road under the terrace:
    # the shaped ground; a lower ground is kept; a high bank next to the terrace is cut down to it
    assert out.tolist() == [100.0, 100.0, 104.0, 98.0, 104.0]


def test_only_the_stretches_that_tilt_a_road_become_terraces() -> None:
    edges, profiles = two_roads(4.0, 2.0)
    assert terrace_runs(edges, profiles, Polygon(), MultiPoint([(0.0, 12.0)])) == [Terrace(1, 0.0, 200.0)]
    assert terrace_runs(edges, profiles, Polygon(), MultiPoint([(0.0, 300.0)])) == []
    assert terrace_runs(edges, profiles, Polygon(), MultiPoint()) == []
