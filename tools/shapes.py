"""Typed wrappers of the vectorised shapely functions used by the data scripts.

shapely's stubs declare `**kwargs` without a type, which pyright strict reports on every call; the ignores
are kept here, in one place, instead of in the geometry code.
"""

from typing import cast

import numpy as np
import numpy.typing as npt
import shapely
from shapely import LineString, Polygon
from shapely.geometry.base import BaseGeometry

type FloatArray = npt.NDArray[np.float64]
type GeometryArray = npt.NDArray[np.object_]


def points(xs: FloatArray, ys: FloatArray) -> GeometryArray:
    """Point geometries from coordinate arrays."""
    return cast(GeometryArray, shapely.points(xs, ys))


def coordinates(pts: GeometryArray) -> tuple[FloatArray, FloatArray]:
    """x and y arrays of point geometries."""
    xs = shapely.get_x(pts)  # pyright: ignore[reportUnknownMemberType]
    ys = shapely.get_y(pts)  # pyright: ignore[reportUnknownMemberType]
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)


def interpolate(line: LineString, distances: FloatArray) -> GeometryArray:
    """Points at the given distances along a line."""
    pts = shapely.line_interpolate_point(line, distances)  # pyright: ignore[reportUnknownMemberType]
    return cast(GeometryArray, np.asarray(pts, dtype=object))


def locate(lines: GeometryArray, pts: GeometryArray) -> FloatArray:
    """Distance along each line of the projection of the matching point."""
    s = shapely.line_locate_point(lines, pts)  # pyright: ignore[reportUnknownMemberType]
    return np.asarray(s, dtype=np.float64)


def distances(geom: BaseGeometry, pts: GeometryArray) -> FloatArray:
    """Distance from one geometry to each point."""
    d = shapely.distance(geom, pts)  # pyright: ignore[reportUnknownMemberType]
    return np.asarray(d, dtype=np.float64)


def polygons(rings: FloatArray) -> GeometryArray:
    """Polygons from an array of closed rings, shape (n, k, 2)."""
    return cast(GeometryArray, np.asarray(shapely.polygons(rings), dtype=object))


def intersects(geom: BaseGeometry, others: GeometryArray) -> npt.NDArray[np.bool_]:
    """Which geometries of `others` intersect `geom`."""
    return np.asarray(shapely.intersects(geom, others), dtype=np.bool_)


def intersections(geoms: GeometryArray, geom: BaseGeometry) -> list[BaseGeometry]:
    """Intersection of each geometry with `geom`."""
    return list(np.asarray(shapely.intersection(geoms, geom), dtype=object))


def clip(geom: BaseGeometry, area: Polygon) -> BaseGeometry:
    """Intersection of two single geometries."""
    return shapely.intersection(geom, area)


def contains(geom: BaseGeometry, pts: GeometryArray) -> npt.NDArray[np.bool_]:
    """Which points lie inside `geom`."""
    return np.asarray(shapely.contains(geom, pts), dtype=np.bool_)
