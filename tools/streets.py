"""Streets v2 geometry (ADR 0003): road height profiles, carriageway polygons, terrain shaped by the roads.

Pure functions on in-memory data (no network, no files). Coordinates in metres, local frame (x east, y north).
"""

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import shapely
from geo import Point, gauss_smooth
from shapely import LineString, MultiPolygon, Polygon, STRtree, box, prepare
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapes import (
    FloatArray,
    GeometryArray,
    clip,
    contains,
    coordinates,
    distances,
    interpolate,
    intersections,
    intersects,
    locate,
    points,
    polygons,
)

PROFILE_STEP = 5.0  # m between height samples along a road
PROFILE_SMOOTH = 2.0  # gaussian sigma in samples (10 m): removes the 40 m terrain grid facets
SIDEWALK = 2.5  # m of flat ground kept beside the carriageway (future sidewalks)
BANK = 8.0  # m over which the ground blends from the road height back to the natural terrain


@dataclass(frozen=True)
class RoadEdge:
    """A road piece of roads.json in metres."""

    a: int
    b: int
    width: float
    flags: frozenset[str]
    coords: list[Point]

    @property
    def level(self) -> str:
        """'bridge', 'tunnel' or 'ground'."""
        if 'bridge' in self.flags:
            return 'bridge'
        if 'tunnel' in self.flags:
            return 'tunnel'
        return 'ground'


def load_edges(data: dict[str, Any]) -> list[RoadEdge]:
    """Edges of a roads.json document (see build_roads.py), converted to metres."""
    flags_table: list[str] = data['flags']
    edges: list[RoadEdge] = []
    for rec in data['edges']:
        a, b, _cls, width_dm, _layer, mask, *flat = (int(v) for v in rec)
        flags = frozenset(str(f) for i, f in enumerate(flags_table) if mask & (1 << i))
        coords = [(flat[i] / 10, flat[i + 1] / 10) for i in range(0, len(flat), 2)]
        edges.append(RoadEdge(a, b, width_dm / 10, flags, coords))
    return edges


class TerrainGrid:
    """Bilinear interpolation of a terrain.json grid (decimetres), vectorised."""

    def __init__(self, x0: float, y0: float, nx: int, ny: int, step: float, dm: Sequence[int]) -> None:
        self.x0, self.y0, self.nx, self.ny, self.step = x0, y0, nx, ny, step
        self.z = np.asarray(dm, dtype=np.float64).reshape(ny, nx) / 10

    def heights(self, xs: FloatArray, ys: FloatArray) -> FloatArray:
        fx = (xs - self.x0) / self.step
        fy = (ys - self.y0) / self.step
        i = np.clip(np.floor(fx).astype(np.int64), 0, self.nx - 2)
        j = np.clip(np.floor(fy).astype(np.int64), 0, self.ny - 2)
        tx = np.clip(fx - i, 0, 1)
        ty = np.clip(fy - j, 0, 1)
        z = self.z
        a = z[j, i] * (1 - tx) + z[j, i + 1] * tx
        b = z[j + 1, i] * (1 - tx) + z[j + 1, i + 1] * tx
        result: FloatArray = a * (1 - ty) + b * ty
        return result


@dataclass
class Profile:
    """Road height along an edge: z(s) by linear interpolation of samples at distances s."""

    s: FloatArray
    z: FloatArray

    def at(self, s: float) -> float:
        return float(np.interp(s, self.s, self.z))


def sample_positions(length: float, step: float) -> FloatArray:
    """Distances 0, step, 2 step, ..., length (always including both ends)."""
    n = max(1, math.ceil(length / step))
    return np.linspace(0.0, length, n + 1)


def natural_profiles(edges: Sequence[RoadEdge], terrain: TerrainGrid) -> list[Profile]:
    """Smoothed natural terrain height along every edge."""
    profiles: list[Profile] = []
    for e in edges:
        line = LineString(e.coords)
        s = sample_positions(line.length, PROFILE_STEP)
        z = terrain.heights(*coordinates(interpolate(line, s)))
        profiles.append(Profile(s, np.asarray(gauss_smooth(z.tolist(), PROFILE_SMOOTH))))
    return profiles


def node_heights(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> dict[int, float]:
    """Height of each graph node: mean of the profile ends of its non-tunnel edges."""
    ends: defaultdict[int, list[float]] = defaultdict(list)
    for e, p in zip(edges, profiles, strict=True):
        if e.level != 'tunnel':
            ends[e.a].append(float(p.z[0]))
            ends[e.b].append(float(p.z[-1]))
    return {n: sum(v) / len(v) for n, v in ends.items()}


def road_profiles(edges: Sequence[RoadEdge], terrain: TerrainGrid) -> list[Profile]:
    """Road heights: natural profiles tied to shared node heights; bridges straight between their ends."""
    natural = natural_profiles(edges, terrain)
    nodes = node_heights(edges, natural)
    out: list[Profile] = []
    for e, p in zip(edges, natural, strict=True):
        za = nodes.get(e.a, float(p.z[0]))
        zb = nodes.get(e.b, float(p.z[-1]))
        t = p.s / p.s[-1] if p.s[-1] > 0 else np.zeros_like(p.s)
        straight = za + (zb - za) * t
        tied = p.z + (za - p.z[0]) * (1 - t) + (zb - p.z[-1]) * t
        z = straight if e.level == 'bridge' else tied
        out.append(Profile(p.s, z))
    return out


def carriageway(edges: Sequence[RoadEdge]) -> Polygon | MultiPolygon:
    """Union of the ground-level road surfaces (round ends close junctions and roundabouts)."""
    shapes = [LineString(e.coords).buffer(e.width / 2, quad_segs=4) for e in edges if e.level == 'ground']
    union = shapely.union_all(shapes)
    if not isinstance(union, Polygon | MultiPolygon):
        raise ValueError(f'unexpected carriageway geometry: {union.geom_type}')
    return union


class RoadHeights:
    """Road height at any point: height of the nearest ground-level edge at the projected distance."""

    def __init__(self, edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> None:
        kept = [(e, p) for e, p in zip(edges, profiles, strict=True) if e.level == 'ground']
        self.lines = [LineString(e.coords) for e, _ in kept]
        self.profiles = [p for _, p in kept]
        self.tree = STRtree(self.lines)
        self.line_array = np.asarray(self.lines, dtype=object)

    def heights(self, xs: FloatArray, ys: FloatArray) -> FloatArray:
        pts = points(xs, ys)
        nearest = np.asarray(self.tree.query_nearest(pts, all_matches=False)[1], dtype=np.int64)
        s = locate(self.line_array[nearest], pts)
        return np.array([self.profiles[int(k)].at(float(si)) for k, si in zip(nearest, s, strict=True)])


def smoothstep(t: FloatArray) -> FloatArray:
    t = np.clip(t, 0.0, 1.0)
    result: FloatArray = t * t * (3 - 2 * t)
    return result


def shaped_ground(
    xs: FloatArray,
    ys: FloatArray,
    natural: FloatArray,
    surface: Polygon | MultiPolygon,
    roads: RoadHeights,
) -> FloatArray:
    """Ground heights: road height on the carriageway and SIDEWALK beside it, then a BANK back to nature."""
    dist = distances(surface, points(xs, ys))
    near = dist < SIDEWALK + BANK
    out = natural.copy()
    if near.any():
        road = roads.heights(xs[near], ys[near])
        blend = smoothstep((dist[near] - SIDEWALK) / BANK)
        out[near] = road + (natural[near] - road) * blend
    return out


def grid_triangles(ox: float, oy: float, n: int, step: float) -> GeometryArray:
    """The ground mesh triangles of a tile: each cell split along its south-west to north-east diagonal."""
    xs = ox + np.arange(n - 1) * step
    ys = oy + np.arange(n - 1) * step
    gx, gy = (a.ravel() for a in np.meshgrid(xs, ys))
    a = np.stack([gx, gy], axis=1)
    b, c, d = a + np.array([step, 0]), a + np.array([0, step]), a + np.array([step, step])
    first = np.stack([a, b, d, a], axis=1)
    second = np.stack([a, d, c, a], axis=1)
    rings = np.concatenate([first, second])
    return polygons(rings.astype(np.float64))


def road_pieces(surface: Polygon | MultiPolygon, ox: float, oy: float, n: int, step: float) -> list[Polygon]:
    """Carriageway cut along the ground mesh triangles: each piece lies in one plane of the ground."""
    tris = grid_triangles(ox, oy, n, step)
    shapely.prepare(surface)
    hit = tris[intersects(surface, tris)]
    pieces: list[Polygon] = []
    for geom in intersections(hit, surface):
        parts = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
        pieces += [g for g in parts if isinstance(g, Polygon) and g.area > 0.05]
    return pieces


MIN_BUILDING_AREA = 12.0  # m2, same threshold as build_buildings.py
BUILDING_CLEARANCE = 0.3  # m kept between a clipped building and the carriageway
TREE_CLEARANCE = 1.0  # m: no tree trunk closer than this to the carriageway
TREE_DENSITY = {'park': 1 / 700, 'forest': 1 / 160}  # trees per m2 seeded in OSM parks and woods
MAX_SEEDED_TREES = 800  # per OSM area, keeps big forests cheap to draw


def keep_out_zone(surface: BaseGeometry, clearance: float) -> BaseGeometry:
    """Carriageway grown by `clearance`, prepared for many intersection tests."""
    zone = surface.buffer(clearance, quad_segs=2)
    prepare(zone)
    return zone


def clip_building(ring: Sequence[Point], keep_out: BaseGeometry) -> list[list[Point]]:
    """Footprint minus `keep_out` (see keep_out_zone): CCW rings of the parts big enough to keep."""
    footprint = Polygon(ring)
    if not footprint.is_valid:
        footprint = footprint.buffer(0)
    if not footprint.intersects(keep_out):
        return [list(ring)]
    local = clip(keep_out, box(*footprint.buffer(1.0).bounds))
    rest = footprint.difference(local)
    parts = list(rest.geoms) if isinstance(rest, MultiPolygon) else [rest]
    out: list[list[Point]] = []
    for part in parts:
        if isinstance(part, Polygon) and part.area >= MIN_BUILDING_AREA:
            exterior = orient(part).exterior
            out.append([(float(x), float(y)) for x, y in list(exterior.coords)[:-1]])
    return out


def seeded_trees(polys: dict[str, list[list[float]]], seed: int) -> list[Point]:
    """Random trees inside OSM parks and woods, deterministic for a given seed."""
    rnd = np.random.default_rng(seed)
    out: list[Point] = []
    for kind, density in TREE_DENSITY.items():
        for flat in polys.get(kind, []):
            ring = [(flat[i], flat[i + 1]) for i in range(0, len(flat) - 1, 2)]
            if len(ring) < 3:
                continue
            area = Polygon(ring)
            x0, y0, x1, y1 = area.bounds
            count = min(MAX_SEEDED_TREES, round((x1 - x0) * (y1 - y0) * density))
            xs = rnd.uniform(x0, x1, count)
            ys = rnd.uniform(y0, y1, count)
            if count:
                inside = contains(area, points(xs, ys))
                out += [(float(x), float(y)) for x, y in zip(xs[inside], ys[inside], strict=True)]
    return out


def clear_trees(trees: Sequence[Point], keep_out: BaseGeometry, footprints: Sequence[Polygon]) -> list[Point]:
    """Trees outside `keep_out` (carriageway + TREE_CLEARANCE, see keep_out_zone) and every building."""
    if not trees:
        return []
    xs = np.array([t[0] for t in trees])
    ys = np.array([t[1] for t in trees])
    pts = points(xs, ys)
    keep = ~intersects(keep_out, pts)
    if footprints:
        hit, _ = STRtree(list(footprints)).query(pts, predicate='within')
        keep[np.asarray(hit, dtype=np.int64)] = False
    return [(float(x), float(y)) for x, y in zip(xs[keep], ys[keep], strict=True)]
