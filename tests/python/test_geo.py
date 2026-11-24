"""Unit tests of the pure helpers used by the data build scripts (fictitious coordinates only)."""

import itertools
import math

import pytest
from geo import (
    Point,
    building_height,
    building_kind,
    clock_hm,
    clock_seconds,
    close_dips,
    cumlen,
    douglas_peucker,
    dp_ring,
    fill_missing,
    gauss_smooth,
    join_rings,
    make_proj,
    max_turn_curvature,
    project_on,
    resample,
    signed_area2,
)


def test_projection_round_trip_and_scale() -> None:
    to_xy, to_ll = make_proj(45.0, 5.0)
    x, y = to_xy(45.001, 5.001)
    assert y == pytest.approx(111.19, abs=0.01)  # 1/1000 degree of latitude
    assert x == pytest.approx(111.19 * math.cos(math.radians(45)), abs=0.01)
    lat, lon = to_ll(x, y)
    assert (lat, lon) == pytest.approx((45.001, 5.001))


def test_resample_gives_equidistant_points_and_keeps_the_end() -> None:
    pts = resample([(0.0, 0.0), (5.0, 0.0), (5.0, 5.0)], 2.0)
    gaps = [math.dist(a, b) for a, b in itertools.pairwise(pts)]
    assert all(g == pytest.approx(2.0, abs=0.6) for g in gaps[:-1])
    assert pts[0] == (0.0, 0.0)
    assert pts[-1] == (5.0, 5.0)


def test_resample_skips_duplicate_points() -> None:
    assert resample([(0.0, 0.0), (0.0, 0.0), (4.0, 0.0)], 2.0) == [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0)]


def test_gauss_smooth_keeps_constants_and_softens_steps() -> None:
    assert gauss_smooth([3.0] * 10, 2.0) == pytest.approx([3.0] * 10)
    assert gauss_smooth([1.0, 2.0], 0) == [1.0, 2.0]
    step = gauss_smooth([0.0] * 10 + [10.0] * 10, 2.0)
    assert 0 < step[9] < 5 < step[10] < 10


def test_cumlen_and_project_on() -> None:
    pts: list[Point] = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)]
    cum = cumlen(pts)
    assert cum == [0.0, 10.0, 20.0]
    s, d = project_on(pts, cum, 12.0, 4.0)
    assert s == pytest.approx(14.0)
    assert d == pytest.approx(2.0)


def test_close_dips_fills_narrow_valleys_only() -> None:
    bridge = [100.0, 100.0, 100.0, 80.0, 100.0, 100.0, 100.0]
    assert close_dips(bridge, 1) == [100.0] * 7
    valley = [100.0, 90.0, 80.0, 70.0, 70.0, 70.0, 70.0, 80.0, 90.0, 100.0]  # wider than the window
    assert close_dips(valley, 1) == valley


def test_douglas_peucker_removes_near_collinear_points() -> None:
    line: list[Point] = [(0.0, 0.0), (1.0, 0.05), (2.0, 0.0), (3.0, 2.0)]
    assert douglas_peucker(line, 0.1) == [(0.0, 0.0), (2.0, 0.0), (3.0, 2.0)]
    assert douglas_peucker(line[:2], 0.1) == line[:2]


def test_dp_ring_keeps_the_ring_closed() -> None:
    square: list[Point] = [(0.0, 0.0), (5.0, 0.01), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
    out = dp_ring(square, 0.1)
    assert out[0] == out[-1]
    assert (5.0, 0.01) not in out
    assert dp_ring([(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 0.0)], 0.1) == [
        (0.0, 0.0),
        (1.0, 0.0),
        (0.0, 1.0),
        (0.0, 0.0),
    ]


def test_join_rings_assembles_pieces_in_any_direction() -> None:
    a: Point = (0.0, 0.0)
    b: Point = (1.0, 0.0)
    c: Point = (1.0, 1.0)
    d: Point = (0.0, 1.0)
    rings = join_rings([[a, b], [c, b], [c, d], [a, d], [(9.0, 9.0)]])
    assert len(rings) == 1
    ring = rings[0]
    assert ring[0] == ring[-1]
    assert set(ring) == {a, b, c, d}


def test_join_rings_prepends_pieces() -> None:
    a: Point = (0.0, 0.0)
    b: Point = (1.0, 0.0)
    c: Point = (1.0, 1.0)
    rings = join_rings([[b, c], [a, b], [c, a]])
    assert len(rings) == 1
    assert rings[0][0] == rings[0][-1]
    rings = join_rings([[c, a], [b, a], [b, c]])
    assert rings[0][0] == rings[0][-1]


def test_signed_area_and_curvature() -> None:
    ccw: list[Point] = [(0.0, 0.0), (2.0, 0.0), (2.0, 3.0), (0.0, 3.0)]
    assert signed_area2(ccw) == pytest.approx(12.0)
    assert signed_area2(ccw[::-1]) == pytest.approx(-12.0)
    assert max_turn_curvature([(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)], 1.0) == 0.0
    assert max_turn_curvature([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)], 1.0) == pytest.approx(math.pi / 2)


def test_gtfs_clock_helpers() -> None:
    assert clock_hm('7:05:00') == '07:05'
    assert clock_hm('25:10:00') == '25:10'
    assert clock_seconds('07:05:30') == 7 * 3600 + 5 * 60 + 30


def test_fill_missing() -> None:
    assert fill_missing([None, 2.0, None, 3.0], 9.0) == [2.0, 2.0, 2.0, 3.0]
    assert fill_missing([None, None], 9.0) == [9.0, 9.0]


def test_building_kind() -> None:
    assert building_kind({'building': 'house'}) == 1
    assert building_kind({'building': 'retail'}) == 2
    assert building_kind({'building': 'yes', 'amenity': 'school'}) == 3
    assert building_kind({'building': 'yes'}) == 0
    assert building_kind({}) == 0


@pytest.mark.parametrize(
    ('tags', 'kind', 'expected'),
    [
        ({'height': '12 m'}, 0, 12.0),
        ({'building:height': '7.5'}, 0, 7.5),
        ({'height': 'tall', 'building:levels': '4'}, 0, 13.5),
        ({'building:levels': '2'}, 1, 7.0),
        ({'building': 'shed'}, 0, 3),
    ],
)
def test_building_height_from_tags(tags: dict[str, str], kind: int, expected: float) -> None:
    assert building_height(tags, kind, seed=1) == pytest.approx(expected)


def test_building_height_default_ranges_are_deterministic() -> None:
    for seed in range(50):
        assert 6 <= building_height({}, 1, seed) <= 9
        assert 7 <= building_height({}, 2, seed) <= 12
        assert 10 <= building_height({}, 0, seed) <= 19
    assert building_height({}, 0, 42) == building_height({}, 0, 42)
