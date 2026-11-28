"""Streets v2 geometry (ADR 0003): road height profiles, carriageway polygons, terrain shaped by the roads.

Pure functions on in-memory data (no network, no files). Coordinates in metres, local frame (x east, y north).
"""

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt
import shapely
from geo import Point, gauss_smooth
from shapely import (
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
    STRtree,
    box,
    prepare,
)
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.ops import substring
from shapes import (
    BoolArray,
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
    pair_distances,
    points,
    polygon_parts,
    polygons,
)

PROFILE_STEP = 5.0  # m between height samples along a road
PROFILE_SMOOTH = 2.0  # gaussian sigma in samples (10 m): removes the 40 m terrain grid facets
SIDEWALK = 2.5  # m of flat ground kept beside the carriageway (future sidewalks)
MIN_PIECE_AREA = 0.05  # m², smallest carriageway or sidewalk piece kept in a ground triangle
BANK = 8.0  # m over which the ground blends from the road height back to the natural terrain
# two one-way carriageways of the same road (#92): at most this gap between their edges (central reserve,
# tram tracks), heading the same way or opposite within about 37 degrees
DUAL_MEDIAN = 8.0  # m
DUAL_PARALLEL = 0.8  # cosine of the angle between the two carriageways
# at a junction the road of the higher class keeps its surface and the others start on it (#92), then ease
# into their own profile over this length
APPROACH = 15.0  # m
CLASS_RANK = {'service': 0, 'busway': 1, 'minor': 1, 'secondary': 2, 'primary': 3}
STRAIGHT_ON = (
    0.85  # cosine: a road leaving a node within about 30 degrees of straight on carries on through it
)
BEYOND_END = 1.0  # m past the end of a road where a point no longer lies beside it


@dataclass(frozen=True)
class RoadEdge:
    """A road piece of roads.json in metres."""

    a: int
    b: int
    width: float
    flags: frozenset[str]
    coords: list[Point]
    cls: str = 'minor'
    # ends where another edge carries on straight from it, when known from a longer road this edge is a part
    # of (terraces, #108); else counted from the graph (straight_ends)
    through: int | None = None

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
    classes: list[str] = data['classes']
    edges: list[RoadEdge] = []
    for rec in data['edges']:
        a, b, cls, width_dm, _layer, mask, *flat = (int(v) for v in rec)
        flags = frozenset(str(f) for i, f in enumerate(flags_table) if mask & (1 << i))
        coords = [(flat[i] / 10, flat[i + 1] / 10) for i in range(0, len(flat), 2)]
        edges.append(RoadEdge(a, b, width_dm / 10, flags, coords, classes[cls]))
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


def sample_frames(
    edges: Sequence[RoadEdge], profiles: Sequence[Profile]
) -> tuple[FloatArray, FloatArray, FloatArray, FloatArray]:
    """Position (x, y) and unit direction (tx, ty) of every profile sample, edge after edge."""
    xs: list[FloatArray] = []
    ys: list[FloatArray] = []
    txs: list[FloatArray] = []
    tys: list[FloatArray] = []
    for e, p in zip(edges, profiles, strict=True):
        line = LineString(e.coords)
        x, y = coordinates(interpolate(line, p.s))
        ax, ay = coordinates(interpolate(line, np.maximum(p.s - 1.0, 0.0)))
        bx, by = coordinates(interpolate(line, p.s + 1.0))
        norm = np.maximum(np.hypot(bx - ax, by - ay), 1e-9)
        xs.append(x)
        ys.append(y)
        txs.append((bx - ax) / norm)
        tys.append((by - ay) / norm)
    return np.concatenate(xs), np.concatenate(ys), np.concatenate(txs), np.concatenate(tys)


def dual_carriageways(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> list[Profile]:
    """Profiles where the two one-way carriageways of a road run side by side (#92) take the mean height of
    both, facing sample by facing sample: each was the natural ground under its own centre line, so on a side
    slope the ground triangles between them were tilted across the road. The correction is smoothed along
    each edge so that the road eases into it."""
    kept = [k for k, e in enumerate(edges) if e.level == 'ground' and 'oneway' in e.flags]
    out = list(profiles)
    if len(kept) < 2:
        return out
    xs, ys, tx, ty = sample_frames([edges[k] for k in kept], [profiles[k] for k in kept])
    z = np.concatenate([profiles[k].z for k in kept])
    owner = np.concatenate([np.full(len(profiles[k].s), n) for n, k in enumerate(kept)])
    half = np.array([edges[k].width / 2 for k in kept])[owner]
    tree = STRtree(points(xs, ys))
    reach = 2 * float(half.max()) + DUAL_MEDIAN
    i, j = tree.query(points(xs, ys), predicate='dwithin', distance=reach)
    dx, dy = xs[j] - xs[i], ys[j] - ys[i]
    facing = (
        (owner[i] != owner[j])
        & (np.abs(dx * tx[i] + dy * ty[i]) <= PROFILE_STEP / 2)
        & (np.abs(dx * -ty[i] + dy * tx[i]) <= half[i] + half[j] + DUAL_MEDIAN)
        & (np.abs(tx[i] * tx[j] + ty[i] * ty[j]) >= DUAL_PARALLEL)
    )
    i, j = i[facing], j[facing]
    total = np.bincount(i, weights=z[j], minlength=len(z))
    count = np.bincount(i, minlength=len(z))
    correction = np.where(count > 0, (total / np.maximum(count, 1) - z) / 2, 0.0)
    start = 0
    for k in kept:
        size = len(profiles[k].s)
        smooth = np.asarray(gauss_smooth(correction[start : start + size].tolist(), PROFILE_SMOOTH))
        out[k] = Profile(profiles[k].s, profiles[k].z + smooth)
        start += size
    return out


def road_profiles(edges: Sequence[RoadEdge], terrain: TerrainGrid) -> list[Profile]:
    """Road heights: natural profiles, dual carriageways at a common height, tied to shared node heights;
    bridges straight between their ends."""
    natural = dual_carriageways(edges, natural_profiles(edges, terrain))
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
    return junction_approaches(edges, out)


def carriageway(edges: Sequence[RoadEdge]) -> Polygon | MultiPolygon:
    """Union of the ground-level road surfaces (round ends close junctions and roundabouts)."""
    shapes = [LineString(e.coords).buffer(e.width / 2, quad_segs=4) for e in edges if e.level == 'ground']
    union = shapely.union_all(shapes)
    if not isinstance(union, Polygon | MultiPolygon):
        raise ValueError(f'unexpected carriageway geometry: {union.geom_type}')
    return union


def straight_ends(edges: Sequence[RoadEdge]) -> list[int]:
    """Number of ends (0 to 2) of every edge where another edge carries on straight from it."""
    leaving: defaultdict[int, list[tuple[int, float, float]]] = defaultdict(list)
    for k, e in enumerate(edges):
        for node, (x0, y0), (x1, y1) in ((e.a, e.coords[0], e.coords[1]), (e.b, e.coords[-1], e.coords[-2])):
            norm = max(math.hypot(x1 - x0, y1 - y0), 1e-9)
            leaving[node].append((k, (x1 - x0) / norm, (y1 - y0) / norm))
    count = [0] * len(edges)
    for out in leaving.values():
        for k, dx, dy in out:
            if any(m != k and dx * ex + dy * ey <= -STRAIGHT_ON for m, ex, ey in out):
                count[k] += 1
    return count


class RoadChooser:
    """The ground-level edge that gives its height to a point: among the edges whose carriageway and
    sidewalk hold the point, the one of the highest rank (the nearest of them on a tie), so that a side
    street meets a main road on the main road's surface (#92); elsewhere the nearest edge. Rank: class,
    then roads that carry on straight through their junctions, then width."""

    def __init__(self, edges: Sequence[RoadEdge]) -> None:
        self.indices = [k for k, e in enumerate(edges) if e.level == 'ground']
        self.lines = [LineString(edges[k].coords) for k in self.indices]
        self.line_array = np.asarray(self.lines, dtype=object)
        self.tree = STRtree(self.lines)
        self.reach = np.array([edges[k].width / 2 + SIDEWALK for k in self.indices])
        ground = [edges[k] for k in self.indices]
        through = [
            t if e.through is None else e.through for e, t in zip(ground, straight_ends(ground), strict=True)
        ]
        self.rank = np.array(
            [
                CLASS_RANK.get(e.cls, 1) * 1000 + t * 100 + round(e.width * 2)
                for e, t in zip(ground, through, strict=True)
            ]
        )
        self.length = np.array([line.length for line in self.lines])

    def choose(self, pts: GeometryArray) -> tuple[npt.NDArray[np.int64], FloatArray]:
        """Chosen edge (index among the ground-level edges) and distance along it for every point."""
        chosen = np.asarray(self.tree.query_nearest(pts, all_matches=False)[1], dtype=np.int64)
        if len(self.lines) and len(pts):
            i, j = self.tree.query(pts, predicate='dwithin', distance=float(self.reach.max()))
            lines = self.line_array[j]
            beside = pair_distances(lines, pts[i]) <= self.reach[j]
            beside &= self.beyond_end(lines, j, pts[i]) < BEYOND_END
            i, j = i[beside], j[beside]
            if not len(i):
                return chosen, locate(self.line_array[chosen], pts)
            distance = pair_distances(self.line_array[j], pts[i])
            # best last: highest class, then nearest
            order = np.lexsort((-distance, self.rank[j], i))
            last = np.r_[i[order][1:] != i[order][:-1], True]
            chosen[i[order][last]] = j[order][last]
        return chosen, locate(self.line_array[chosen], pts)

    def beyond_end(self, lines: GeometryArray, j: npt.NDArray[np.int64], pts: GeometryArray) -> FloatArray:
        """How far each point lies past the end of its line, along the line (0 beside it): a road that
        carries on from another one is not beside it."""
        s = locate(lines, pts)
        at_start = s <= 1e-6
        at_end = s >= self.length[j] - 1e-6
        px, py = coordinates(pts)
        ex, ey = coordinates(interpolate(lines, s))
        ix, iy = coordinates(interpolate(lines, np.where(at_start, 1.0, s - 1.0)))
        dx, dy = np.where(at_start, ix - ex, ex - ix), np.where(at_start, iy - ey, ey - iy)
        norm = np.maximum(np.hypot(dx, dy), 1e-9)
        past = ((px - ex) * dx + (py - ey) * dy) / norm
        result: FloatArray = np.where(at_start, -past, np.where(at_end, past, 0.0))
        return result


def junction_approaches(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> list[Profile]:
    """Profiles where a road enters the carriageway of a road of a higher class: there it takes the height
    of that road, then eases back into its own profile over APPROACH metres (#92). Without it, the corner of a
    junction on a slope was tilted between the two profiles."""
    chooser = RoadChooser(edges)
    out = list(profiles)
    for n, k in enumerate(chooser.indices):
        p = profiles[k]
        x, y = coordinates(interpolate(chooser.lines[n], p.s))
        chosen, along = chooser.choose(points(x, y))
        inside = np.flatnonzero((chosen != n) & (chooser.rank[chosen] > chooser.rank[n]))
        if not len(inside):
            continue
        target = np.array(
            [
                profiles[chooser.indices[int(c)]].at(float(a))
                for c, a in zip(chosen[inside].tolist(), along[inside].tolist(), strict=True)
            ],
            dtype=np.float64,
        )
        gap = np.abs(p.s[:, None] - p.s[inside][None, :])
        weight = np.clip(1 - gap / APPROACH, 0.0, 1.0)
        nearest = np.argmax(weight, axis=1)
        correction = (target - p.z[inside])[nearest] * weight[np.arange(len(p.s)), nearest]
        out[k] = Profile(p.s, p.z + correction)
    return out


class RoadHeights:
    """Road height at any point: height of the edge chosen by RoadChooser at the projected distance."""

    def __init__(self, edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> None:
        self.chooser = RoadChooser(edges)
        self.lines = self.chooser.lines
        self.profiles = [profiles[k] for k in self.chooser.indices]
        self.tree = self.chooser.tree
        self.line_array = self.chooser.line_array

    def heights(self, xs: FloatArray, ys: FloatArray) -> FloatArray:
        chosen, s = self.chooser.choose(points(xs, ys))
        return np.array([self.profiles[int(k)].at(float(si)) for k, si in zip(chosen, s, strict=True)])

    def directions(self, xs: FloatArray, ys: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Unit direction (tx, ty) of the chosen ground-level edge at each point."""
        chosen, s = self.chooser.choose(points(xs, ys))
        lines = self.line_array[chosen]
        ax, ay = coordinates(interpolate(lines, np.maximum(s - 1.0, 0.0)))
        bx, by = coordinates(interpolate(lines, s + 1.0))
        dx, dy = bx - ax, by - ay
        norm = np.maximum(np.hypot(dx, dy), 1e-9)
        return dx / norm, dy / norm


def smoothstep(t: FloatArray) -> FloatArray:
    t = np.clip(t, 0.0, 1.0)
    result: FloatArray = t * t * (3 - 2 * t)
    return result


def flat_vertices(zone: BaseGeometry, ox: float, oy: float, n: int, step: float) -> BoolArray:
    """Vertices of an n x n ground grid (row by row from the south) that belong to a triangle touching
    `zone`, the triangles of the cells around the grid included: set to the road height, they make every
    triangle under the carriageway flat across the road (#76), the same on both sides of a tile edge."""
    m = n + 2  # the grid with one more cell all around
    tris = grid_triangles(ox - step, oy - step, m, step)
    prepare(zone)
    hit = intersects(zone, tris)
    cells = (m - 1) * (m - 1)
    flags = np.zeros((m, m), dtype=bool)
    for k in np.flatnonzero(hit):
        cell = int(k) % cells
        j, i = divmod(cell, m - 1)
        # corners (row, column): first triangle south-west, south-east, north-east; second south-west,
        # north-east, north-west
        corners = ((0, 0), (0, 1), (1, 1)) if k < cells else ((0, 0), (1, 1), (1, 0))
        for dj, di in corners:
            flags[j + dj, i + di] = True
    inner: BoolArray = flags[1:-1, 1:-1].ravel()
    return inner


def shaped_ground(
    xs: FloatArray,
    ys: FloatArray,
    natural: FloatArray,
    surface: Polygon | MultiPolygon,
    roads: RoadHeights,
    flat: BoolArray | None = None,
) -> FloatArray:
    """Ground heights: road height on the carriageway and SIDEWALK beside it (and on the `flat` vertices),
    then a BANK back to nature."""
    dist = distances(surface, points(xs, ys))
    if flat is not None:
        dist = np.where(flat, 0.0, dist)
    near = dist < SIDEWALK + BANK
    out = natural.copy()
    if near.any():
        road = roads.heights(xs[near], ys[near])
        blend = smoothstep((dist[near] - SIDEWALK) / BANK)
        out[near] = road + (natural[near] - road) * blend
    return out


def triangle_gradients(ground: FloatArray, n: int, step: float) -> tuple[FloatArray, FloatArray]:
    """Slope (dz/dx, dz/dy) of every ground triangle of an n x n grid, in the order of grid_triangles."""
    z = ground.reshape(n, n)
    sw, se = z[:-1, :-1].ravel(), z[:-1, 1:].ravel()
    nw, ne = z[1:, :-1].ravel(), z[1:, 1:].ravel()
    # first triangle (sw, se, ne), second (sw, ne, nw)
    gx = np.concatenate([(se - sw) / step, (ne - nw) / step])
    gy = np.concatenate([(ne - se) / step, (nw - sw) / step])
    return gx, gy


def road_cross_slopes(
    ground: FloatArray,
    ox: float,
    oy: float,
    n: int,
    step: float,
    surface: Polygon | MultiPolygon,
    roads: RoadHeights,
    junctions: BaseGeometry,
) -> list[tuple[float, float, float]]:
    """(x, y, cross slope) of the ground triangles centred on the carriageway, away from the junctions (where
    the slope of a side street is no cross slope): the slope across the nearest road, in m/m."""
    centres = shapely.centroid(grid_triangles(ox, oy, n, step))
    prepare(surface)
    prepare(junctions)
    hit = np.flatnonzero(contains(surface, centres) & ~contains(junctions, centres))
    if not len(hit):
        return []
    gx, gy = triangle_gradients(ground, n, step)
    cx, cy = coordinates(centres[hit])
    tx, ty = roads.directions(cx, cy)
    cross = np.abs(gx[hit] * -ty + gy[hit] * tx)
    return [(float(x), float(y), float(c)) for x, y, c in zip(cx, cy, cross, strict=True)]


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
        pieces += [g for g in parts if isinstance(g, Polygon) and g.area > MIN_PIECE_AREA]
    return pieces


def rings_of(geom: Polygon | MultiPolygon, ox: float, oy: float) -> list[list[list[int]]]:
    """Polygons as lists of rings [x, y, ...] in decimetres relative to (ox, oy), without closing point.
    Pieces down to MIN_PIECE_AREA are kept: on the 5 m grid many carriageway and sidewalk pieces are smaller
    than 1 m², and dropping them left holes where the ground showed through (#92). A ring that rounding to
    decimetres flattens to fewer than 3 points is dropped."""
    polys = [geom] if isinstance(geom, Polygon) else list(geom.geoms)
    out: list[list[list[int]]] = []
    for p in polys:
        if p.is_empty or p.area <= MIN_PIECE_AREA:
            continue
        rings: list[list[int]] = []
        for k, ring in enumerate([p.exterior, *p.interiors]):
            corners: list[tuple[int, int]] = []
            for x, y in list(ring.coords)[:-1]:
                corner = (round((x - ox) * 10), round((y - oy) * 10))
                if not corners or corners[-1] != corner:
                    corners.append(corner)
            if len(corners) > 1 and corners[0] == corners[-1]:
                corners.pop()
            if len(set(corners)) >= 3:
                rings.append([v for corner in corners for v in corner])
            elif k == 0:
                break
        else:
            out.append(rings)
    return out


MIN_BUILDING_AREA = 12.0  # m2, same threshold as build_buildings.py
BUILDING_CLEARANCE = 0.3  # m kept between a clipped building and the carriageway
TREE_CLEARANCE = 1.0  # m: no tree trunk closer than this to the carriageway
# The part of a building above a passage is drawn from this height: room for a bus (3.2 m tall, plus the
# roof equipment) with a margin
PASSAGE_CLEARANCE = 4.5  # m
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


def passage_zone(edges: Sequence[RoadEdge]) -> BaseGeometry:
    """Ground under the building passages: their carriageway grown by the building clearance."""
    shapes = [
        LineString(e.coords).buffer(e.width / 2 + BUILDING_CLEARANCE, quad_segs=2)
        for e in edges
        if 'passage' in e.flags
    ]
    zone = shapely.union_all(shapes)
    prepare(zone)
    return zone


def lintels(ring: Sequence[Point], zone: BaseGeometry, height: float) -> list[list[Point]]:
    """Parts of a footprint over a passage (CCW rings), drawn above it when the building is tall enough."""
    if height < PASSAGE_CLEARANCE + 1.0:
        return []
    footprint = Polygon(ring)
    if not footprint.is_valid:
        footprint = footprint.buffer(0)
    if not footprint.intersects(zone):
        return []
    return [
        [(float(x), float(y)) for x, y in list(orient(part).exterior.coords)[:-1]]
        for part in polygon_parts(footprint.intersection(zone))
        if part.area >= 1.0
    ]


def tunnel_portals(edges: Sequence[RoadEdge]) -> list[tuple[float, float, float, float]]:
    """Mouths of the tunnels (x, y, heading into the tunnel, width): tunnel ends joining an open road."""
    open_nodes = {n for e in edges if e.level != 'tunnel' for n in (e.a, e.b)}
    out: list[tuple[float, float, float, float]] = []
    for e in edges:
        if e.level != 'tunnel' or len(e.coords) < 2:
            continue
        for node, (x0, y0), (x1, y1) in ((e.a, e.coords[0], e.coords[1]), (e.b, e.coords[-1], e.coords[-2])):
            if node in open_nodes:
                out.append((x0, y0, math.atan2(y1 - y0, x1 - x0), e.width))
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


NO_SIDEWALK = ('service', 'busway')  # classes without sidewalks (yards, bus-only links)
CENTRE_LINE_MIN_WIDTH = 5.5  # m: narrower two-way streets have no centre line (French practice)
CROSSING_CLASSES = ('primary', 'secondary')
CROSSING_DEPTH = 2.5  # m along the road (zebra stripes of French crossings: 0.5 m wide, 0.5 m apart)
STRIPE, STRIPE_GAP = 0.5, 0.5


def sidewalk_zone(edges: Sequence[RoadEdge], surface: BaseGeometry) -> BaseGeometry:
    """SIDEWALK-wide strips beside the carriageway of the streets that have sidewalks."""
    shapes = [
        LineString(e.coords).buffer(e.width / 2 + SIDEWALK, quad_segs=4)
        for e in edges
        if e.level == 'ground' and e.cls not in NO_SIDEWALK
    ]
    return shapely.union_all(shapes).difference(surface)


def kerb_lines(surface: BaseGeometry, sidewalks: BaseGeometry) -> list[list[Point]]:
    """Parts of the carriageway outline that border a sidewalk (where a kerb is drawn)."""
    edge = surface.boundary.intersection(sidewalks.buffer(0.05))
    lines = list(edge.geoms) if isinstance(edge, MultiLineString) else [edge]
    return [
        [(float(x), float(y)) for x, y in line.coords]
        for line in lines
        if isinstance(line, LineString) and line.length > 0.5
    ]


def junction_radii(edges: Sequence[RoadEdge]) -> dict[int, float]:
    """Nodes joining three ground roads or more, with their junction radius (half the widest road + 1 m)."""
    widths: defaultdict[int, list[float]] = defaultdict(list)
    for e in edges:
        if e.level == 'ground':
            widths[e.a].append(e.width)
            widths[e.b].append(e.width)
    return {n: max(w) / 2 + 1.0 for n, w in widths.items() if len(w) >= 3}


def trimmed(e: RoadEdge, radii: dict[int, float], extra: float = 0.0) -> LineString | None:
    """Centreline without its ends inside junction areas (plus `extra` metres), or None if nothing is left."""
    line = LineString(e.coords)
    start = radii.get(e.a, 0.0) + (extra if e.a in radii else 0.0)
    end = line.length - radii.get(e.b, 0.0) - (extra if e.b in radii else 0.0)
    if end - start < 1.0:
        return None
    piece = substring(line, start, end)
    return piece if isinstance(piece, LineString) else None


def centre_lines(edges: Sequence[RoadEdge], radii: dict[int, float]) -> list[list[Point]]:
    """Dashed centre lines of two-way streets, stopped before junctions."""
    out: list[list[Point]] = []
    for e in edges:
        if (
            e.level == 'tunnel'
            or 'oneway' in e.flags
            or e.cls in NO_SIDEWALK
            or e.width < CENTRE_LINE_MIN_WIDTH
        ):
            continue
        line = trimmed(e, radii)
        if line is not None:
            out.append([(float(x), float(y)) for x, y in line.coords])
    return out


def crossings(edges: Sequence[RoadEdge], radii: dict[int, float]) -> list[list[Point]]:
    """Zebra stripes (4-corner polygons) across main roads just outside their junctions."""
    out: list[list[Point]] = []
    for e in edges:
        if e.level != 'ground' or e.cls not in CROSSING_CLASSES:
            continue
        line = LineString(e.coords)
        for node, at_start in ((e.a, True), (e.b, False)):
            if node not in radii or line.length < radii[node] + CROSSING_DEPTH + 2:
                continue
            s0 = radii[node] + 1.0 if at_start else line.length - radii[node] - 1.0 - CROSSING_DEPTH
            p0, p1 = line.interpolate(s0), line.interpolate(s0 + CROSSING_DEPTH)
            dx, dy = p1.x - p0.x, p1.y - p0.y
            length = math.hypot(dx, dy) or 1.0
            ux, uy = dx / length, dy / length  # along the road
            nx, ny = uy, -ux  # across
            half = e.width / 2 - 0.5
            offset = -half
            while offset + STRIPE <= half:
                corners = [
                    (offset, 0.0),
                    (offset + STRIPE, 0.0),
                    (offset + STRIPE, CROSSING_DEPTH),
                    (offset, CROSSING_DEPTH),
                ]
                out.append([(p0.x + nx * a + ux * b, p0.y + ny * a + uy * b) for a, b in corners])
                offset += STRIPE + STRIPE_GAP
    return out
