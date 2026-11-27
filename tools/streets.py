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
    points,
    polygon_parts,
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
    cls: str = 'minor'

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

    def directions(self, xs: FloatArray, ys: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Unit direction (tx, ty) of the nearest ground-level edge at each point."""
        pts = points(xs, ys)
        nearest = np.asarray(self.tree.query_nearest(pts, all_matches=False)[1], dtype=np.int64)
        lines = self.line_array[nearest]
        s = locate(lines, pts)
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
        pieces += [g for g in parts if isinstance(g, Polygon) and g.area > 0.05]
    return pieces


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
