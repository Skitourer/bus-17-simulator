"""Pure road-network logic: OSM ways -> graph of junctions and road pieces (no network, no files)."""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

from geo import Point
from shapely import LineString, STRtree
from shapely import Point as ShapelyPoint

# OSM highway values kept as drivable roads, with their class for rendering and default width (m).
# Widths: typical carriageway widths in French towns (CEREMA street design guides: 3 to 3.5 m per lane).
ROAD_CLASSES: dict[str, tuple[str, float]] = {
    'motorway': ('primary', 14.0),
    'trunk': ('primary', 12.0),
    'primary': ('primary', 10.0),
    'secondary': ('secondary', 8.0),
    'tertiary': ('secondary', 7.0),
    'unclassified': ('minor', 6.0),
    'residential': ('minor', 6.0),
    'living_street': ('minor', 5.0),
    'service': ('service', 4.0),
    'busway': ('busway', 3.5),
    'bus_guideway': ('busway', 3.5),
}
LANE_WIDTH = 3.25  # m, between the CEREMA urban lane widths of 3.0 and 3.5 m
HIGHWAY_REGEX = '^(' + '|'.join(ROAD_CLASSES) + ')(_link)?$'
EXCLUDED_SERVICE = ('parking_aisle', 'drive-through')  # private car park lanes, never driven by a bus


@dataclass(frozen=True)
class Way:
    """An OSM way with its node ids and projected coordinates (same length)."""

    id: int
    nodes: list[int]
    coords: list[Point]
    tags: dict[str, str]


@dataclass
class Edge:
    """A road piece between two graph nodes."""

    a: int
    b: int
    coords: list[Point]
    way: int
    tags: dict[str, str] = field(repr=False)


def highway_base(tags: dict[str, str]) -> str | None:
    """Kept highway value without its `_link` suffix, or None when the way is not a drivable road."""
    highway = tags.get('highway', '')
    base = highway.removesuffix('_link')
    if base not in ROAD_CLASSES:
        return None
    if base == 'service' and tags.get('service') in EXCLUDED_SERVICE:
        return None
    if tags.get('area') == 'yes':
        return None
    return base


def parse_float(value: str | None) -> float | None:
    """Leading number of an OSM value such as "7", "7.5 m" or "2;3", else None."""
    if not value:
        return None
    token = value.split(';')[0].replace(',', '.').replace('m', '').strip()
    try:
        return float(token)
    except ValueError:
        return None


def road_width(tags: dict[str, str]) -> float:
    """Carriageway width (m): `width` tag, else lanes x LANE_WIDTH, else the class default."""
    width = parse_float(tags.get('width'))
    if width is not None and 2.0 <= width <= 40.0:
        return width
    lanes = parse_float(tags.get('lanes'))
    if lanes is not None and 1 <= lanes <= 10:
        return lanes * LANE_WIDTH
    base = highway_base(tags) or 'residential'
    width = ROAD_CLASSES[base][1]
    if tags.get('oneway') == 'yes' and base not in ('service', 'busway', 'bus_guideway'):
        width *= 0.6  # one-way streets are usually one lane wide plus parking
    return round(width, 2)


def has_bus_lane(tags: dict[str, str]) -> bool:
    """True when the road carries a bus lane (OSM `busway`, `lanes:bus`, `bus:lanes`)."""
    if tags.get('busway', 'no') not in ('no', 'none') or any(
        tags.get(f'busway:{side}', 'no') not in ('no', 'none') for side in ('left', 'right', 'both')
    ):
        return True
    if parse_float(tags.get('lanes:bus')):
        return True
    return 'designated' in tags.get('bus:lanes', '') + tags.get('bus:lanes:forward', '')


def split_ways(ways: Sequence[Way]) -> tuple[dict[int, Point], list[Edge]]:
    """Graph of the ways: nodes = way ends and nodes used several times; edges = pieces between them."""
    uses = Counter(n for w in ways for n in w.nodes)
    ends = {n for w in ways for n in (w.nodes[0], w.nodes[-1])}
    junction_ids = {n for n, c in uses.items() if c > 1} | ends
    nodes: dict[int, Point] = {}
    edges: list[Edge] = []
    for w in ways:
        start = 0
        for i in range(1, len(w.nodes)):
            if w.nodes[i] in junction_ids or i == len(w.nodes) - 1:
                piece = w.coords[start : i + 1]
                a, b = w.nodes[start], w.nodes[i]
                nodes[a] = w.coords[start]
                nodes[b] = w.coords[i]
                if len(piece) >= 2:
                    edges.append(Edge(a, b, piece, w.id, w.tags))
                start = i
    return nodes, edges


def coverage_gaps(
    route: Sequence[Point], edges: Sequence[Edge], max_dist: float, step: float
) -> list[tuple[float, float]]:
    """Stretches [s0, s1] (m along `route`) farther than `max_dist` from every edge, sampled every `step`."""
    tree = STRtree([LineString(e.coords) for e in edges])
    line = LineString(route)
    gaps: list[tuple[float, float]] = []
    s = 0.0
    start: float | None = None
    while s <= line.length:
        p = line.interpolate(s)
        nearest = tree.nearest(p)
        far = nearest is None or tree.geometries[nearest].distance(ShapelyPoint(p.x, p.y)) > max_dist
        if far and start is None:
            start = s
        elif not far and start is not None:
            gaps.append((start, s))
            start = None
        s += step
    if start is not None:
        gaps.append((start, line.length))
    return gaps
