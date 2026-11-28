"""Grade separation (#75, #86): headroom under the bridges that cross a road, and underpasses dug below the
roads they pass under.

The terrain model is too coarse to hold the embankments and cuttings of the road crossings: a bridge deck,
straight between its ends, often lay at the height of the road below it, and the two levels met. Where a
bridge crosses a ground-level road, the deck rises in a gentle hump and the road below dips in a cutting until
the deck stands CLEARANCE above it. Where a road passes under another one in a tunnel (an underpass), the
tunnel and the ramps leading to it dip in a trench until the road above stands CLEARANCE over it. Pure
functions; coordinates in metres.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from shapely import LineString, Point, STRtree
from shapes import FloatArray, coordinates, distances, interpolate, locate, points
from streets import Profile, RoadEdge

# headroom of the French roads (4.75 m, ICTAAL / ARP gauge for new structures) plus the depth of a deck as
# drawn by the game (0.8 m, world.js)
CLEARANCE = 5.55  # m from the road below up to the deck surface
HUMP_GRADE = 0.06  # m/m: the deck rises at most this steeply towards the crossing (bus-friendly ramps)
CUT_GRADE = 0.08  # m/m: the road below dips at most this steeply (French urban underpasses: 6 to 8 %)
MARGIN = 1.0  # m beyond the edges of the crossing roads kept at full height or depth
COVER_MARGIN = 2.0  # m of ground kept over an underpass beyond the sides of its road (the tunnel walls)


@dataclass(frozen=True)
class Crossing:
    """A bridge edge over a ground-level edge: where (x, y), how far along each, and the missing height."""

    bridge: int
    road: int
    x: float
    y: float
    s_bridge: float
    s_road: float
    missing: float


def bridge_groups(edges: Sequence[RoadEdge]) -> list[set[int]]:
    """Bridge edges joined end to end (one structure each)."""
    bridges = [k for k, e in enumerate(edges) if e.level == 'bridge']
    parent = {k: k for k in bridges}

    def root(k: int) -> int:
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    by_node: dict[int, list[int]] = {}
    for k in bridges:
        for node in (edges[k].a, edges[k].b):
            by_node.setdefault(node, []).append(k)
    for ks in by_node.values():
        for k in ks[1:]:
            parent[root(k)] = root(ks[0])
    groups: dict[int, set[int]] = {}
    for k in bridges:
        groups.setdefault(root(k), set()).add(k)
    return list(groups.values())


def crossings(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> list[Crossing]:
    """Every place where a bridge passes over a ground-level road that is not one of its approaches, with the
    height missing to CLEARANCE (0 when the deck is high enough)."""
    lines = [LineString(e.coords) for e in edges]
    tree = STRtree(lines)
    out: list[Crossing] = []
    for group in bridge_groups(edges):
        nodes = {n for k in group for n in (edges[k].a, edges[k].b)}
        for b in sorted(group):
            hits: list[int] = [int(v) for v in tree.query(lines[b], predicate='intersects')]
            for r in hits:
                road = edges[r]
                if road.level != 'ground' or road.a in nodes or road.b in nodes:
                    continue
                for point in points_of(lines[b].intersection(lines[r])):
                    s_b, s_r = lines[b].project(point), lines[r].project(point)
                    gap = profiles[b].at(s_b) - profiles[r].at(s_r)
                    out.append(Crossing(b, r, point.x, point.y, s_b, s_r, max(0.0, CLEARANCE - gap)))
    return out


def points_of(geom: object) -> list[Point]:
    """Points of an intersection (lines sharing a stretch count by its first point)."""
    if isinstance(geom, Point):
        return [geom]
    if isinstance(geom, LineString):
        return [Point(geom.coords[0])] if not geom.is_empty else []
    return [p for g in getattr(geom, 'geoms', []) for p in points_of(g)]


def plateau(distance: FloatArray, flat: float, height: float, grade: float) -> FloatArray:
    """`height` within `flat` of a place, then down at `grade` to 0."""
    if height <= 0:
        return np.zeros_like(distance)
    result: FloatArray = height * np.clip(1 - (distance - flat) * grade / height, 0.0, 1.0)
    return result


def separate_levels(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> list[Profile]:
    """Profiles with the headroom of every crossing: the deck rises as much as its length allows at
    HUMP_GRADE (its ends stay put, so the ramps keep meeting the streets), and the road below, with every road
    around it that is not an approach of the bridge, dips by the rest."""
    found = [c for c in crossings(edges, profiles) if c.missing > 0]
    if not found:
        return list(profiles)
    out = list(profiles)
    raises: dict[int, FloatArray] = {}
    cuts: list[tuple[Crossing, float]] = []
    for c in found:
        flat = edges[c.road].width / 2 + MARGIN
        length = float(profiles[c.bridge].s[-1])
        room = min(c.s_bridge, length - c.s_bridge) - flat
        lift = min(c.missing, max(0.0, room) * HUMP_GRADE)
        hump = plateau(np.abs(profiles[c.bridge].s - c.s_bridge), flat, lift, HUMP_GRADE)
        raises[c.bridge] = np.maximum(raises.get(c.bridge, 0.0), hump)
        cuts.append((c, c.missing - lift))
    for k, lift in raises.items():
        out[k] = Profile(profiles[k].s, profiles[k].z + lift)
    approaches = approach_edges(edges)
    for k, e in enumerate(edges):
        if e.level != 'ground' or k in approaches:
            continue
        line = LineString(e.coords)
        xs, ys = coordinates(interpolate(line, profiles[k].s))
        depth = np.zeros(len(xs))
        for c, cut in cuts:
            deck = edges[c.bridge]
            near = np.hypot(xs - c.x, ys - c.y)
            depth = np.maximum(depth, plateau(near, deck.width / 2 + MARGIN, cut, CUT_GRADE))
        if depth.any():
            out[k] = Profile(profiles[k].s, out[k].z - depth)
    return out


def underpass_crossings(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> list[Crossing]:
    """Every place where a tunnel passes under a ground-level road that does not join it, with the height
    missing to CLEARANCE (`bridge` is the road above, `road` the tunnel)."""
    lines = [LineString(e.coords) for e in edges]
    tree = STRtree(lines)
    out: list[Crossing] = []
    for t, tunnel in enumerate(edges):
        if tunnel.level != 'tunnel':
            continue
        hits: list[int] = [int(v) for v in tree.query(lines[t], predicate='intersects')]
        for r in hits:
            above = edges[r]
            if above.level != 'ground' or {above.a, above.b} & {tunnel.a, tunnel.b}:
                continue
            for point in points_of(lines[r].intersection(lines[t])):
                s_above, s_tunnel = lines[r].project(point), lines[t].project(point)
                gap = profiles[r].at(s_above) - profiles[t].at(s_tunnel)
                out.append(Crossing(r, t, point.x, point.y, s_above, s_tunnel, max(0.0, CLEARANCE - gap)))
    return out


def dig_underpasses(edges: Sequence[RoadEdge], profiles: Sequence[Profile]) -> list[Profile]:
    """Profiles with every underpass dug: the tunnel dips around each crossing by the missing height, at
    CUT_GRADE at most; each ramp (a ground-level edge joined to a tunnel end) climbs from the tunnel back to
    its other end, at CUT_GRADE or steeper when it is too short. The roads above and the streets beyond the
    ramps stay put."""
    found = [c for c in underpass_crossings(edges, profiles) if c.missing > 0]
    out = list(profiles)
    if not found:
        return out
    tunnel_depth: dict[int, FloatArray] = {}
    for c in found:
        line = LineString(edges[c.road].coords)
        xs, ys = coordinates(interpolate(line, profiles[c.road].s))
        flat = edges[c.bridge].width / 2 + MARGIN
        dip = plateau(np.hypot(xs - c.x, ys - c.y), flat, c.missing, CUT_GRADE)
        tunnel_depth[c.road] = np.maximum(tunnel_depth.get(c.road, 0.0), dip)
    ramp_depth: dict[int, FloatArray] = {}
    for t, dip in tunnel_depth.items():
        out[t] = Profile(profiles[t].s, profiles[t].z - dip)
        tunnel = edges[t]
        for node, portal in ((tunnel.a, float(dip[0])), (tunnel.b, float(dip[-1]))):
            for k, e in enumerate(edges):
                if e.level != 'ground' or node not in (e.a, e.b):
                    continue
                s = profiles[k].s
                along = s if e.a == node else s[-1] - s
                climb = min(float(s[-1]), portal / CUT_GRADE)
                ramp = portal * np.clip(1 - along / climb, 0.0, 1.0)
                ramp_depth[k] = np.maximum(ramp_depth.get(k, 0.0), ramp)
    for k, dip in ramp_depth.items():
        out[k] = Profile(profiles[k].s, profiles[k].z - dip)
    return out


def approach_edges(edges: Sequence[RoadEdge]) -> set[int]:
    """Ground-level edges that start or end at a bridge: they carry the traffic up to the deck."""
    nodes = {n for e in edges if e.level == 'bridge' for n in (e.a, e.b)}
    return {k for k, e in enumerate(edges) if e.level == 'ground' and (e.a in nodes or e.b in nodes)}


def covered_ground(
    xs: FloatArray,
    ys: FloatArray,
    ground: FloatArray,
    tunnels: Sequence[tuple[RoadEdge, Profile]],
    on_roads: npt.NDArray[np.bool_],
) -> FloatArray:
    """Ground heights with the covered part of every underpass under at least CLEARANCE of ground: the
    ground there was shaped by the ramps down into the trench, and the tunnel stuck out of it (#86). Between
    the two mouths, over the road and COVER_MARGIN beyond its sides, the ground rises to the floor plus
    CLEARANCE, except on the roads (`on_roads`): the road above keeps its own surface."""
    out = ground.copy()
    pts = points(xs, ys)
    for e, p in tunnels:
        line = LineString(e.coords)
        near = np.flatnonzero((distances(line, pts) <= e.width / 2 + COVER_MARGIN) & ~on_roads)
        if not len(near):
            continue
        s = locate(np.full(len(near), line, dtype=object), pts[near])
        inside = (s > 0) & (s < line.length)
        k, along = near[inside], s[inside]
        out[k] = np.maximum(out[k], np.interp(along, p.s, p.z) + CLEARANCE)
    return out
