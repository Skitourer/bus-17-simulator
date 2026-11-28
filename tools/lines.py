"""Lines of the game: trip patterns of the GTFS, shared world frame and the corridor around the lines.

Pure logic (no network, no files) except `read_lines`, which reads the line files written by build_line.py.
"""

import math
import os
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from geo import Point, Projection
from shapely import MultiLineString, box
from shapely.geometry.base import BaseGeometry
from shapes import polygon_parts
from sources import ROOT, read_json

# M réso route_short_name of every line of the game, in menu order
LINES = ('17', '18', 'N62')
# Fixed origin of the local frame (first point of the line 17 shape in the 2026 GTFS): every data file shares
# it, so adding a line does not move the others (ADR 0010).
ORIGIN: Point = (45.2134, 5.78085)
LINES_DIR = os.path.join(ROOT, 'data', 'grenoble', 'lines')
# m around every route: the world (map, terrain, roads, tiles) is built in this corridor (ADR 0010)
CORRIDOR = 1500.0
QUERY_BOX = 8000.0  # m: side of the boxes of one Overpass query
TILE = 500  # m side of the world tiles (keeps every tile file under the 1 MB pre-commit limit)

type Row = dict[str, str]


@dataclass
class Pattern:
    """Trips of one direction that serve the same stops in the same order: one route of the game."""

    direction: int
    stop_ids: tuple[str, ...]
    trips: list[Row] = field(default_factory=lambda: list[Row]())

    @property
    def reference(self) -> Row:
        """Trip whose shape and times describe the route (the first one in the GTFS order)."""
        return self.trips[0]


def trip_patterns(trips: list[Row], stop_ids: dict[str, list[str]]) -> list[Pattern]:
    """Trips grouped by direction and stop sequence; per direction, the longest pattern first, then the
    most frequent. Trips without stop times are left out."""
    groups: dict[tuple[int, tuple[str, ...]], Pattern] = {}
    for trip in trips:
        stops = tuple(stop_ids.get(trip['trip_id'], []))
        if not stops:
            continue
        key = (int(trip['direction_id']), stops)
        if key not in groups:
            groups[key] = Pattern(key[0], stops)
        groups[key].trips.append(trip)
    return sorted(groups.values(), key=lambda p: (p.direction, -len(p.stop_ids), -len(p.trips)))


def routes_xy(line: dict[str, Any]) -> list[list[Point]]:
    """(x, y) points of every route of a line file."""
    return [[(r['pts'][i], r['pts'][i + 1]) for i in range(0, len(r['pts']), 3)] for r in line['routes']]


def corridor(routes: list[list[Point]], margin: float = CORRIDOR) -> BaseGeometry:
    """Area within `margin` metres of any route."""
    return MultiLineString(routes).simplify(2.0).buffer(margin, quad_segs=4)


def tiles_in(
    area: BaseGeometry, x0: float, y0: float, nx: int, ny: int, size: float
) -> list[tuple[int, int]]:
    """Tiles (i, j) of a regular grid that touch `area`, row by row from the south."""
    return [
        (i, j)
        for j in range(ny)
        for i in range(nx)
        if area.intersects(box(x0 + i * size, y0 + j * size, x0 + (i + 1) * size, y0 + (j + 1) * size))
    ]


def overpass_polys(
    area: BaseGeometry, to_ll: Projection, simplify: float, size: float = QUERY_BOX
) -> list[str]:
    """Overpass `poly:` filters ("lat lon lat lon ...") of the outer rings of an area cut into boxes of `size`
    m (one query over the whole network runs out of time, #131), simplified by `simplify` m (holes filled: a
    superset is enough)."""
    x0, y0, x1, y1 = area.bounds
    out: list[str] = []
    for j in range(math.ceil((y1 - y0) / size)):
        for i in range(math.ceil((x1 - x0) / size)):
            piece = area.intersection(
                box(x0 + i * size, y0 + j * size, x0 + (i + 1) * size, y0 + (j + 1) * size)
            )
            for part in polygon_parts(piece.simplify(simplify)):
                coords = list(part.exterior.coords)[:-1]
                out.append(' '.join(f'{la:.5f} {lo:.5f}' for la, lo in (to_ll(x, y) for x, y in coords)))
    return out


def bounds_of(routes: list[list[Point]]) -> tuple[float, float, float, float]:
    """Bounding box (x0, y0, x1, y1) of the routes."""
    xs = [p[0] for r in routes for p in r]
    ys = [p[1] for r in routes for p in r]
    return min(xs), min(ys), max(xs), max(ys)


def departures_by_service(trips: list[Row], first_departure: dict[str, str]) -> dict[str, list[str]]:
    """Departure times ("HH:MM", sorted) of the trips by GTFS service id."""
    out: defaultdict[str, list[str]] = defaultdict(list)
    for trip in trips:
        out[trip['service_id']].append(first_departure[trip['trip_id']])
    return {sid: sorted(times) for sid, times in out.items()}


def network_of(lines: list[dict[str, Any]], every: int) -> dict[str, Any]:
    """Compact timetable of every line for the minimap (#130): colour, calendar and, by route, one point of
    the route in `every` ([x, y, ...], every `every` * step metres), its stops [s, t, ...] (m along the route,
    s from the departure) and its departures by service."""
    out: list[dict[str, Any]] = []
    for line in lines:
        routes: list[dict[str, Any]] = []
        for route in line['routes']:
            pts = route['pts']
            count = len(pts) // 3
            keep = [*range(0, count - 1, every), count - 1]
            routes.append(
                {
                    'xy': [v for k in keep for v in (pts[3 * k], pts[3 * k + 1])],
                    'stops': [v for stop in route['stops'] for v in (stop['s'], stop['t'])],
                    'services': route['services'],
                }
            )
        out.append({'id': line['id'], 'color': line['color'], 'calendar': line['calendar'], 'routes': routes})
    step = lines[0]['step'] * every if lines else 0
    return {'step': step, 'lines': out}


def read_lines() -> list[dict[str, Any]]:
    """Every line file written by build_line.py, in menu order."""
    return [read_json(os.path.join(LINES_DIR, f'{name}.json')) for name in LINES]
