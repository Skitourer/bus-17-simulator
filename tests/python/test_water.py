"""Unit tests of the water geometry (fictitious terrain and water areas only)."""

import numpy as np
import pytest
from shapely import MultiPolygon, Polygon, box
from streets import TerrainGrid
from water import (
    FREEBOARD,
    MIN_AREA,
    boundary_lines,
    gaussian_blur,
    min_filter,
    polygon_parts,
    shore_lines,
    water_area,
    water_cut,
    water_level,
)


def flat(height: float) -> TerrainGrid:
    """Flat terrain at `height` on a 40 m grid covering [-400, 400]^2."""
    return TerrainGrid(x0=-400, y0=-400, nx=21, ny=21, step=40, dm=[round(height * 10)] * 441)


def ring(x0: float, y0: float, x1: float, y1: float) -> list[float]:
    return [x0, y0, x1, y0, x1, y1, x0, y1]


def test_water_area_unites_clips_and_drops_tiny_areas() -> None:
    area = water_area(
        [ring(0, 0, 100, 50), ring(50, 0, 150, 50), ring(300, 300, 303, 303), [1, 2]],
        (0, 0, 120, 200),
    )
    assert area.area == pytest.approx(120 * 50)
    assert MIN_AREA > 3 * 3  # the 3 m square pond is dropped


def test_water_area_repairs_self_intersecting_rings() -> None:
    bowtie = [0, 0, 100, 100, 100, 0, 0, 100]
    assert water_area([bowtie], (-10, -10, 110, 110)).area == pytest.approx(5000)


def test_water_area_is_empty_without_water() -> None:
    assert water_area([], (0, 0, 10, 10)).is_empty


def test_polygon_parts_of_every_geometry_kind() -> None:
    a, b = box(0, 0, 1, 1), box(2, 0, 3, 1)
    assert polygon_parts(a) == [a]
    assert len(polygon_parts(MultiPolygon([a, b]))) == 2
    assert polygon_parts(Polygon()) == []
    assert polygon_parts(a.boundary) == []
    assert len(polygon_parts(a.union(box(0, 2, 1, 3)).union(a.boundary))) == 2


def test_gaussian_blur_spreads_and_keeps_the_total() -> None:
    grid = np.zeros((21, 21))
    grid[10, 10] = 1.0
    out = gaussian_blur(grid, 2.0)
    kernel_sum = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2).sum()
    assert out.sum() == pytest.approx(kernel_sum**2)
    assert out[10, 10] == out.max()
    assert out[10, 12] == pytest.approx(out[12, 10])


def test_min_filter_takes_the_smallest_value_in_a_square_window() -> None:
    grid = np.full((7, 7), 5.0)
    grid[3, 3] = 1.0
    out = min_filter(grid, 1)
    assert out[2:5, 2:5].tolist() == [[1.0] * 3] * 3
    assert out[0, 0] == 5.0


def test_water_level_stays_below_the_banks() -> None:
    river = box(-100, -40, 100, 40)
    level = water_level(river, flat(200).heights, -200, -200, 41, 41, 10)
    centre = level[20, 20]
    assert centre == pytest.approx(200 - FREEBOARD)
    # far from the water the level is the terrain (never drawn)
    assert level[0, 0] == pytest.approx(200)


def test_water_level_follows_the_terrain_under_the_water() -> None:
    sloped = TerrainGrid(
        x0=-400, y0=-400, nx=21, ny=21, step=40, dm=[round((200 + i) * 10) for i in range(21)] * 21
    )
    river = box(-300, -40, 300, 40)
    level = water_level(river, sloped.heights, -400, -400, 81, 81, 10)
    west, east = level[40, 20], level[40, 60]
    assert east > west  # the terrain rises eastwards by 1 m per 40 m
    assert east - west == pytest.approx(10, abs=1.5)


def test_shore_lines_skip_the_tile_edges() -> None:
    lake = box(-50, 100, 200, 300)
    lines = shore_lines(lake, 0, 0, 500)
    assert len(lines) == 1
    xs = [x for x, _ in lines[0]]
    assert min(xs) == pytest.approx(0) and max(xs) == pytest.approx(200)
    assert shore_lines(box(10, 10, 20, 20), 100, 100, 50) == []


def test_boundary_lines_of_lakes_with_islands() -> None:
    lake = box(0, 0, 100, 100).difference(box(40, 40, 60, 60))
    assert len(boundary_lines(lake)) == 2
    assert len(boundary_lines(box(0, 0, 1, 1))) == 1
    assert boundary_lines(Polygon()) == []


def test_water_cut_splits_the_wet_triangles() -> None:
    # 20 m tile, 10 m grid; water covers x in [0, 15]: cells (0, *) fully, cells (1, *) half
    lake = box(-5, -5, 15, 25)
    wet, water, dry = water_cut(lake, 0, 0, 3, 10)
    assert sorted(wet) == list(range(8))  # every triangle of the 4 cells touches the water
    assert sum(p.area for p in water) == pytest.approx(15 * 20)
    assert sum(p.area for p in dry) == pytest.approx(5 * 20)


def test_water_cut_ignores_triangles_only_touched_by_the_water() -> None:
    wet, water, dry = water_cut(box(-5, -5, 10, 30), 0, 0, 3, 10)
    assert len(wet) == 4  # the cells at x in [0, 10]
    assert sum(p.area for p in water) == pytest.approx(200)
    assert dry == []
