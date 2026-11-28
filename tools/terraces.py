"""Terraces (#108): stretches of road held up by a retaining wall above a lower road too close to them.

Where two roads closer than the ground grid lie at different heights (the legs of a hairpin, a road above
another one on a hillside), one ground triangle held both and the road was tilted across. The upper road
there becomes a terrace: it keeps its own heights (flat across), the ground under it follows the lower road,
and a retaining wall stands along its edge. Pure functions; coordinates in metres.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace

import numpy as np
from shapely import LineString, STRtree, union_all
from shapely.geometry.base import BaseGeometry
from shapely.ops import substring
from shapes import FloatArray, coordinates, distances, interpolate, points
from streets import BANK, NO_SIDEWALK, SIDEWALK, Profile, RoadEdge, sample_frames, straight_ends

# a road this much higher than a road beside it gets a wall: a step of 0.5 m over a 5 m ground triangle tilts
# it by about 10 %, beyond the 7 % of superelevation of French roads (SETRA, ARP 1994)
TERRACE_RISE = 0.5  # m
# gap between the two carriageway edges under which one ground triangle (5 m side, 7 m diagonal) and the
# flat sidewalk margin beside the roads can hold both roads
TERRACE_GAP = 7.5  # m
# a terrace starts and ends this far beyond the last place where the roads are too close, so that the ground
# eases from one road to the other under it
TERRACE_PAD = 10.0  # m
# two places of the same road this far apart along it can be the two legs of one hairpin
SAME_ROAD_APART = 30.0  # m
# ground vertices this close to a terrace stay below it: the ground triangles across its edge would otherwise
# rise above the road (one cell diagonal of the 5 m grid)
BELOW_REACH = 7.5  # m
# a road sample this close to a tilted ground triangle (its centre) is the cause of the tilt
DEFECT_REACH = 10.0  # m


@dataclass(frozen=True)
class Terrace:
    """Part [start, end] (m along the edge) of the ground-level edge `edge`, on a terrace."""

    edge: int
    start: float
    end: float


def footprint_half_width(e: RoadEdge) -> float:
    """Half width of the terrace of an edge: the carriageway and its sidewalks."""
    return e.width / 2 + (0.0 if e.cls in NO_SIDEWALK else SIDEWALK)


def upper_samples(edges: Sequence[RoadEdge], profiles: Sequence[Profile], kept: Sequence[int]) -> np.ndarray:
    """Whether each profile sample of the edges `kept` (edge after edge) lies higher than TERRACE_RISE above
    a sample of another road (or of a far part of the same road) less than TERRACE_GAP beside it."""
    xs, ys, _, _ = sample_frames([edges[k] for k in kept], [profiles[k] for k in kept])
    z = np.concatenate([profiles[k].z for k in kept])
    s = np.concatenate([profiles[k].s for k in kept])
    owner = np.concatenate([np.full(len(profiles[k].s), n) for n, k in enumerate(kept)])
    half = np.array([edges[k].width / 2 for k in kept])[owner]
    reach = 2 * float(half.max()) + TERRACE_GAP
    i, j = STRtree(points(xs, ys)).query(points(xs, ys), predicate='dwithin', distance=reach)
    gap = np.hypot(xs[j] - xs[i], ys[j] - ys[i]) - half[i] - half[j]
    other = (owner[i] != owner[j]) | (np.abs(s[i] - s[j]) > SAME_ROAD_APART)
    above = other & (gap < TERRACE_GAP) & (z[i] - z[j] > TERRACE_RISE)
    upper = np.zeros(len(z), dtype=bool)
    upper[i[above]] = True
    return upper


def runs_of(flags: np.ndarray, s: np.ndarray, pad: float, length: float) -> list[tuple[float, float]]:
    """Intervals [start, end] around the flagged positions s, widened by `pad` and merged."""
    runs: list[tuple[float, float]] = []
    for si in s[flags].tolist():
        start, end = max(0.0, si - pad), min(length, si + pad)
        if runs and start <= runs[-1][1]:
            runs[-1] = (runs[-1][0], max(runs[-1][1], end))
        else:
            runs.append((start, end))
    return runs


def terrace_runs(
    edges: Sequence[RoadEdge],
    profiles: Sequence[Profile],
    junctions: BaseGeometry,
    defects: BaseGeometry | None = None,
) -> list[Terrace]:
    """The terraces of the ground-level roads, kept out of the `junctions` areas (a wall there would cut
    the junction surface); with `defects` (the places where the ground under a road is tilted across it),
    only where the road is tilted: elsewhere the close roads already share a fitting ground."""
    kept = [k for k, e in enumerate(edges) if e.level == 'ground']
    if len(kept) < 2:
        return []
    upper = upper_samples(edges, profiles, kept)
    tilted = upper.copy()
    if defects is not None:
        xs, ys, _, _ = sample_frames([edges[k] for k in kept], [profiles[k] for k in kept])
        tilted[:] = False
        if not defects.is_empty:
            tilted[upper] = distances(defects, points(xs[upper], ys[upper])) < DEFECT_REACH
    out: list[Terrace] = []
    start = 0
    for k in kept:
        p, line = profiles[k], LineString(edges[k].coords)
        flags, causes = upper[start : start + len(p.s)], p.s[tilted[start : start + len(p.s)]]
        start += len(p.s)
        # the whole stretch above the lower road, wherever part of it tilts the ground: a shorter terrace
        # would move the tilt to its ends
        for s0, s1 in runs_of(flags, p.s, TERRACE_PAD, line.length):
            if not np.any((causes >= s0) & (causes <= s1)):
                continue
            for a, b in outside(line, s0, s1, junctions):
                out.append(Terrace(k, a, b))
    return out


def outside(line: LineString, s0: float, s1: float, zone: BaseGeometry) -> list[tuple[float, float]]:
    """Parts [a, b] of the interval [s0, s1] of a line that stay out of `zone`, at least 1 m long."""
    s = np.linspace(s0, s1, max(2, int((s1 - s0) / 1.0) + 1))
    clear = distances(zone, interpolate(line, s)) > 0 if not zone.is_empty else np.ones(len(s), dtype=bool)
    out: list[tuple[float, float]] = []
    begin: float | None = None
    for si, ok in zip(s.tolist(), clear.tolist(), strict=True):
        if ok and begin is None:
            begin = si
        if not ok and begin is not None:
            out.append((begin, si))
            begin = None
    if begin is not None:
        out.append((begin, s1))
    return [(a, b) for a, b in out if b - a >= 1.0]


def sub_edge(e: RoadEdge, p: Profile, s0: float, s1: float, a: int, b: int) -> tuple[RoadEdge, Profile]:
    """The part [s0, s1] of an edge, as an edge between nodes a and b, with its profile."""
    line = substring(LineString(e.coords), s0, s1)
    coords = [(float(x), float(y)) for x, y in line.coords]
    inner = p.s[(p.s > s0) & (p.s < s1)]
    s = np.concatenate([[s0], inner, [s1]])
    z = np.interp(s, p.s, p.z)
    return replace(e, a=a, b=b, coords=coords), Profile(s - s0, z)


def split_edges(
    edges: Sequence[RoadEdge], profiles: Sequence[Profile], terraces: Sequence[Terrace]
) -> tuple[list[RoadEdge], list[Profile], list[RoadEdge], list[Profile]]:
    """The edges without their terraces (which shape the ground), then the terraces as edges. Cut ends get
    new node numbers, below every node of the graph, so that they join nothing."""
    by_edge: dict[int, list[Terrace]] = {}
    for t in terraces:
        by_edge.setdefault(t.edge, []).append(t)
    free = min([0, *(n for e in edges for n in (e.a, e.b))]) - 1
    # the pieces keep the rank of their road among the roads that give the ground its height
    on_ground = [k for k, e in enumerate(edges) if e.level == 'ground']
    through = dict(zip(on_ground, straight_ends([edges[k] for k in on_ground]), strict=True))
    ground_edges: list[RoadEdge] = []
    ground_profiles: list[Profile] = []
    terrace_edges: list[RoadEdge] = []
    terrace_profiles: list[Profile] = []
    for k, (e, p) in enumerate(zip(edges, profiles, strict=True)):
        runs = sorted(by_edge.get(k, []), key=lambda t: t.start)
        e = replace(e, through=through.get(k))
        if not runs:
            ground_edges.append(e)
            ground_profiles.append(p)
            continue
        length = float(p.s[-1])
        cursor, node = 0.0, e.a
        for t in runs:
            cut_a, cut_b = free, free - 1
            free -= 2
            if t.start - cursor >= 1.0:
                piece = sub_edge(e, p, cursor, t.start, node, cut_a)
                ground_edges.append(piece[0])
                ground_profiles.append(piece[1])
            piece = sub_edge(e, p, t.start, t.end, cut_a, cut_b)
            terrace_edges.append(piece[0])
            terrace_profiles.append(piece[1])
            cursor, node = t.end, cut_b
        if length - cursor >= 1.0:
            piece = sub_edge(e, p, cursor, length, node, e.b)
            ground_edges.append(piece[0])
            ground_profiles.append(piece[1])
    return ground_edges, ground_profiles, terrace_edges, terrace_profiles


def footprint(terrace_edges: Sequence[RoadEdge]) -> BaseGeometry:
    """Area of the terraces (carriageway and sidewalks), with round ends like the carriageway."""
    return union_all(
        [LineString(e.coords).buffer(footprint_half_width(e), quad_segs=4) for e in terrace_edges]
    )


def terrace_record(e: RoadEdge, p: Profile, ox: float, oy: float) -> list[int]:
    """[width, x, y, z, ...] in decimetres (x, y relative to (ox, oy)), like the bridge records."""
    xs, ys = coordinates(interpolate(LineString(e.coords), p.s))
    rec = [round(2 * footprint_half_width(e) * 10)]
    for x, y, z in zip(xs.tolist(), ys.tolist(), p.z.tolist(), strict=True):
        rec += [round((x - ox) * 10), round((y - oy) * 10), round(z * 10)]
    return rec


def terraced_ground(
    shaped: FloatArray,
    shaped_without: FloatArray,
    to_roads: FloatArray,
    to_terraces: FloatArray,
    terrace_z: FloatArray,
) -> FloatArray:
    """Ground heights around the terraces. `shaped` is the ground shaped by every road, `shaped_without` the
    ground shaped by the roads without their terraces, `to_roads` the distance to those roads (0 on their
    flat vertices), `to_terraces` the distance to the terraces, `terrace_z` the terrace height. Within
    BELOW_REACH of a terrace (and nowhere else), under it and between it and a lower road, the ground follows
    the lower road, and it never rises above the terrace except on another road beside it."""
    close = to_terraces < BELOW_REACH
    inside = to_terraces <= 0
    nearer_road = to_roads <= to_terraces
    lower = close & (to_roads < SIDEWALK + BANK) & (inside | nearer_road)
    out = np.where(lower, np.minimum(shaped, shaped_without), shaped)
    # the ground of another road beside the terrace keeps its height, even above the terrace
    on_road = nearer_road & ~inside & (to_roads <= SIDEWALK)
    below = close & ~on_road
    result: FloatArray = np.where(below, np.minimum(out, np.where(below, terrace_z, np.inf)), out)
    return result
