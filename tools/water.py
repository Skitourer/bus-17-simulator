"""Water geometry (ADR 0005): OSM water areas, their surface level derived from the terrain, and their cut
along the ground mesh triangles.

Pure functions on in-memory data (no network, no files). Coordinates in metres, local frame (x east, y north).
"""

from collections.abc import Callable, Sequence

import numpy as np
import shapely
from shapely import LineString, MultiLineString, MultiPolygon, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapes import FloatArray, clip, intersections, intersects
from streets import grid_triangles

MIN_AREA = 20.0  # m2: smaller OSM water areas (fountains, basins) are left painted on the ground
INTERIOR = 15.0  # m: terrain closer than this to the bank mixes water and bank on the 40 m IGN grid
LEVEL_SIGMA = 60.0  # m: gaussian smoothing of the terrain under the water (removes the 40 m grid facets)
SHORE_STEP = 5.0  # m between bank height samples
SHORE_RADIUS = 60.0  # m: the water stays below the lowest bank within this distance
# m between the water and the lowest nearby bank: the 40 m IGN grid blurs the river into its banks
# (1 to 2 m above the water in the data) while the Isere quays in Grenoble stand several metres high
FREEBOARD = 3.0
MIN_PIECE = 0.05  # m2: smaller slivers of the triangle cut are dropped, like road pieces

type Heights = Callable[[FloatArray, FloatArray], FloatArray]


def water_area(rings: Sequence[Sequence[float]], bounds: tuple[float, float, float, float]) -> BaseGeometry:
    """Union of the OSM water areas ([x, y, ...] rings) inside `bounds`, without the tiny ones."""
    parts: list[Polygon] = []
    for flat in rings:
        if len(flat) < 6:
            continue
        poly = Polygon([(flat[k], flat[k + 1]) for k in range(0, len(flat) - 1, 2)])
        # make_valid keeps every lobe of a self-intersecting ring (buffer(0) drops some)
        valid = poly if poly.is_valid else shapely.make_valid(poly)
        parts += [p for p in polygon_parts(valid) if p.area >= MIN_AREA]
    if not parts:
        return Polygon()
    return clip(shapely.union_all(parts), box(*bounds))


def polygon_parts(geom: BaseGeometry) -> list[Polygon]:
    """Polygons of a geometry (empty for lines and points)."""
    if isinstance(geom, Polygon):
        return [] if geom.is_empty else [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [p for g in getattr(geom, 'geoms', []) for p in polygon_parts(g)]


def gaussian_blur(grid: FloatArray, sigma: float) -> FloatArray:
    """Separable gaussian blur (sigma in cells), zero outside the grid."""
    r = max(1, int(3 * sigma))
    kernel = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    rows = np.apply_along_axis(lambda v: np.convolve(v, kernel, mode='same'), 1, grid)
    out: FloatArray = np.apply_along_axis(lambda v: np.convolve(v, kernel, mode='same'), 0, rows)
    return out


def min_filter(grid: FloatArray, radius: int) -> FloatArray:
    """Smallest value within `radius` cells along x and y (square window); +inf outside the grid."""
    out = grid
    ny, nx = grid.shape
    rows = np.pad(out, [(0, 0), (radius, radius)], constant_values=np.inf)
    out = np.minimum.reduce([rows[:, k : k + nx] for k in range(2 * radius + 1)])
    cols = np.pad(out, [(radius, radius), (0, 0)], constant_values=np.inf)
    result: FloatArray = np.minimum.reduce([cols[k : k + ny, :] for k in range(2 * radius + 1)])
    return result


def shore_heights(
    area: BaseGeometry, heights: Heights, x0: float, y0: float, nx: int, ny: int, step: float
) -> FloatArray:
    """Lowest bank height near each grid node (+inf far from any bank)."""
    grid = np.full((ny, nx), np.inf)
    for line in boundary_lines(area):
        s = np.arange(0.0, line.length, SHORE_STEP)
        xy = shapely.get_coordinates(shapely.line_interpolate_point(line, s))  # pyright: ignore[reportUnknownMemberType]
        xs, ys = np.asarray(xy[:, 0], dtype=np.float64), np.asarray(xy[:, 1], dtype=np.float64)
        i = np.clip(np.round((xs - x0) / step).astype(np.int64), 0, nx - 1)
        j = np.clip(np.round((ys - y0) / step).astype(np.int64), 0, ny - 1)
        np.minimum.at(grid, (j, i), heights(xs, ys))
    return min_filter(grid, round(SHORE_RADIUS / step))


def water_level(
    area: BaseGeometry, heights: Heights, x0: float, y0: float, nx: int, ny: int, step: float
) -> FloatArray:
    """Water surface height at the nodes of a grid, shape (ny, nx).

    The smoothed terrain under the water (the IGN terrain gives the water surface there), kept FREEBOARD below
    the lowest nearby bank. Far from any water the result is the terrain itself (never drawn).
    """
    gx, gy = np.meshgrid(x0 + np.arange(nx) * step, y0 + np.arange(ny) * step)
    xs, ys = gx.ravel().astype(np.float64), gy.ravel().astype(np.float64)
    h = heights(xs, ys).reshape(ny, nx)
    wet = np.asarray(shapely.contains_xy(area, xs, ys)).reshape(ny, nx)
    interior = np.asarray(shapely.contains_xy(area.buffer(-INTERIOR), xs, ys)).reshape(ny, nx)
    # narrow water without an interior still gets a level from its own (bank-mixed) heights
    weight = np.where(interior, 1.0, np.where(wet, 0.05, 0.0))
    num = gaussian_blur(h * weight, LEVEL_SIGMA / step)
    den = gaussian_blur(weight, LEVEL_SIGMA / step)
    smooth = np.where(den > 1e-6, num / np.maximum(den, 1e-6), h)
    shore = shore_heights(area, heights, x0, y0, nx, ny, step)
    level: FloatArray = np.where(np.isfinite(shore), np.minimum(smooth, shore - FREEBOARD), smooth)
    return level


def boundary_lines(geom: BaseGeometry) -> list[LineString]:
    """Bank lines of a water geometry (outer and inner rings)."""
    edge = geom.boundary
    if isinstance(edge, LineString):
        return [] if edge.is_empty else [edge]
    if isinstance(edge, MultiLineString):
        return list(edge.geoms)
    return []


def shore_lines(area: BaseGeometry, ox: float, oy: float, size: float) -> list[list[tuple[float, float]]]:
    """Bank lines inside a tile (the tile edges themselves are not banks)."""
    tile = box(ox, oy, ox + size, oy + size)
    out: list[list[tuple[float, float]]] = []
    for line in boundary_lines(area):
        for part in boundary_parts(clip(line, tile)):
            out.append([(float(x), float(y)) for x, y in part.coords])
    return out


def boundary_parts(geom: BaseGeometry) -> list[LineString]:
    """Line parts of a clipped boundary, merged where they touch."""
    if isinstance(geom, LineString):
        return [] if geom.is_empty or geom.length < 0.1 else [geom]
    lines = [g for g in getattr(geom, 'geoms', []) if isinstance(g, LineString) and g.length >= 0.1]
    if not lines:
        return []
    merged = shapely.line_merge(MultiLineString(lines))  # pyright: ignore[reportUnknownMemberType]
    return [merged] if isinstance(merged, LineString) else list(getattr(merged, 'geoms', []))


def water_cut(
    area: BaseGeometry, ox: float, oy: float, n: int, step: float
) -> tuple[list[int], list[Polygon], list[Polygon]]:
    """Ground triangles of a tile under water, and their cut along the banks.

    Returns the wet triangle indices (in grid_triangles order: every cell's first triangle, then every
    cell's second), the water pieces, and the dry pieces of the wet triangles (drawn instead of them).
    """
    tris = grid_triangles(ox, oy, n, step)
    shapely.prepare(area)
    hit = np.flatnonzero(intersects(area, tris))
    wet: list[int] = []
    water: list[Polygon] = []
    dry: list[Polygon] = []
    for k, geom in zip(hit, intersections(tris[hit], area), strict=True):
        wet_parts = [p for p in polygon_parts(geom) if p.area > MIN_PIECE]
        if not wet_parts:
            continue
        wet.append(int(k))
        water += wet_parts
        rest = tris[k].difference(area)
        dry += [p for p in polygon_parts(rest) if p.area > MIN_PIECE]
    return wet, water, dry
