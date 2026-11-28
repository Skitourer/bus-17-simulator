"""Builds data/grenoble/lines/<line>.json and lines/index.json from the M reso GTFS and IGN elevations.

Usage:  uv run python tools/build_line.py [gtfs.zip]
  - without argument, downloads the GTFS from data.mobilites-m.fr (ODbL licence), cached in tools/cache/;
  - elevations: IGN Geoplateforme elevation API (RGE ALTI), cached in tools/cache/.
Lines: tools/lines.py (LINES); every trip pattern of a line is a route of its own (ADR 0010).

Output (local metres, x = east, y = north, origin = lines.ORIGIN shared by every data file):
  lines/<line>.json { "id": "17", "name": ..., "color": "#33A457", "text_color": "#FFFFFF", "step": 2,
      "routes": [ { "direction": 0, "headsign": ..., "length": m, "trips": n,
                    "pts": [x0, y0, z0, x1, y1, z1, ...],      # one point every `step` m, 10 cm precision
                    "stops": [ {"name": ..., "s": m, ...}, ... ],
                    "services": { service_id: ["06:32", ...] } }, ... ],
      "calendar": { service_id: {"days": "1111100", "start": "20261117", "end": "20261218"} } }
  lines/index.json { "origin": [lat, lon], "bbox": [x0, y0, x1, y1] (all routes),
      "lines": [ { "id", "name", "color", "text_color", "termini": [first stop, last stop] }, ... ] }
  lines/network.json { "step": 20, "lines": [ { "id", "color", "calendar",
      "routes": [ { "xy": [x0, y0, ...] (one point every `step` m), "stops": [s0, t0, s1, t1, ...],
                    "services": {...} }, ... ] }, ... ] }   (every line on the minimap, #130)
"""

import csv
import io
import os
import sys
import zipfile
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from geo import (
    Point,
    Projection,
    clock_hm,
    clock_seconds,
    close_dips,
    cumlen,
    gauss_smooth,
    make_proj,
    max_turn_curvature,
    project_on,
    resample,
)
from lines import (
    LINES,
    LINES_DIR,
    ORIGIN,
    Pattern,
    bounds_of,
    departures_by_service,
    network_of,
    trip_patterns,
)
from sources import CACHE, elevations, fetch, write_json

GTFS_URL = 'https://data.mobilites-m.fr/api/gtfs/SEM'
STEP = 2.0  # pas de reechantillonnage (m)
NETWORK_EVERY = 10  # one point in 10 of each route in network.json: 20 m, enough for the minimap
SMOOTH_M = 12.0  # demi-fenetre du lissage gaussien du trace (arrondit les angles droits)
ELEV_EVERY = 10.0  # un echantillon d'altitude tous les 10 m
ELEV_SMOOTH_M = 40.0  # lissage de l'altitude
BRIDGE_M = 60.0  # creux plus etroits que ca = pont (riviere sous la route) : comble
WEEKDAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')

type Row = dict[str, str]
type Table = Callable[[str], list[Row]]


def load_gtfs(path: str | None) -> Table:
    """Open the GTFS zip (downloaded into the cache when no path is given); returns a table reader."""
    if path is None:
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, 'gtfs_sem.zip')
        if not os.path.exists(path):
            print('Telechargement du GTFS...')
            with open(path, 'wb') as f:
                f.write(fetch(GTFS_URL))
    archive = zipfile.ZipFile(path)

    def table(name: str) -> list[Row]:
        with archive.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))

    return table


def known_elevations(latlons: list[Point]) -> list[float]:
    """Elevations that must all lie inside the IGN coverage (the line is in France)."""
    values = elevations(latlons)
    if any(v is None for v in values):
        raise SystemExit('altitude IGN manquante sur le trace')
    return [v for v in values if v is not None]


def route_altitudes(pts: list[Point], to_ll: Projection) -> list[float]:
    """Altitude of every route point: IGN samples every ELEV_EVERY m, bridges filled, smoothed."""
    length = cumlen(pts)[-1]
    n_e = int(length // ELEV_EVERY) + 1
    e_idx = [min(len(pts) - 1, round(i * ELEV_EVERY / STEP)) for i in range(n_e)] + [len(pts) - 1]
    e_val = known_elevations([to_ll(*pts[i]) for i in e_idx])
    e_val = close_dips(e_val, int(BRIDGE_M / ELEV_EVERY / 2))
    zs: list[float] = []
    j = 0
    for i in range(len(pts)):
        while j < len(e_idx) - 2 and e_idx[j + 1] < i:
            j += 1
        i0, i1 = e_idx[j], e_idx[j + 1]
        f = 0 if i1 == i0 else (i - i0) / (i1 - i0)
        zs.append(e_val[j] + (e_val[j + 1] - e_val[j]) * max(0, min(1, f)))
    return gauss_smooth(zs, ELEV_SMOOTH_M / STEP)


def route_stops(
    times: list[Row], stops: dict[str, Row], pts: list[Point], to_xy: Projection
) -> list[dict[str, Any]]:
    """Stops of the reference trip, projected on the route, with their theoretical times."""
    cum = cumlen(pts)
    t0 = clock_seconds(times[0]['departure_time'])
    out: list[dict[str, Any]] = []
    for r in times:
        s = stops[r['stop_id']]
        sx, sy = to_xy(float(s['stop_lat']), float(s['stop_lon']))
        pos, dist = project_on(pts, cum, sx, sy)
        out.append(
            {
                'name': s['stop_name'].split(', ', 1)[-1],
                'commune': s['stop_name'].split(', ', 1)[0],
                's': round(pos, 1),
                'off': round(dist, 1),
                'x': round(sx, 1),
                'y': round(sy, 1),
                't': clock_seconds(r['arrival_time']) - t0,  # horaire theorique (s depuis le depart)
            }
        )
    return out


type Shapes = dict[str, list[Point]]


def route_path(raw: list[Point]) -> list[Point]:
    """GTFS shape resampled every STEP m and smoothed (rounds the right angles of the shape)."""
    pts = resample(raw, STEP)
    sig = SMOOTH_M / STEP
    xs = gauss_smooth([p[0] for p in pts], sig)
    ys = gauss_smooth([p[1] for p in pts], sig)
    return resample(list(zip(xs, ys, strict=True)), STEP)


def decimetre(value: float) -> float | int:
    """Value rounded to 10 cm, written without ".0" when whole (a smaller file)."""
    rounded = round(value, 1)
    return int(rounded) if rounded.is_integer() else rounded


def build_route(
    pattern: Pattern,
    shapes: Shapes,
    times: dict[str, list[Row]],
    stops: dict[str, Row],
    to_xy: Projection,
    to_ll: Projection,
) -> dict[str, Any]:
    """One route of a line: smoothed path with altitudes, stops and departures of its trips."""
    ref = pattern.reference
    pts = route_path(shapes[ref['shape_id']])
    length = cumlen(pts)[-1]
    zs = route_altitudes(pts, to_ll)
    route_stop_list = route_stops(times[ref['trip_id']], stops, pts, to_xy)
    first = {t['trip_id']: clock_hm(times[t['trip_id']][0]['departure_time']) for t in pattern.trips}
    kmax = max_turn_curvature(pts, STEP)
    rmin = 1 / kmax if kmax > 0 else 1e9
    slope = max((abs(zs[i + 25] - zs[i]) / 50 for i in range(len(zs) - 25)), default=0.0)
    print(
        f'  sens {pattern.direction} -> {ref["trip_headsign"]} : {length:.0f} m, '
        f'{len(route_stop_list)} arrets, '
        f'{len(pattern.trips)} courses, alt {min(zs):.0f}-{max(zs):.0f} m, pente max {slope * 100:.1f} %, '
        f'rayon min {rmin:.1f} m'
    )
    return {
        'direction': pattern.direction,
        'headsign': ref['trip_headsign'],
        'length': round(length, 1),
        'trips': len(pattern.trips),
        # 10 cm: far below a lane width, and it keeps the longest line file under the 1 MB file limit
        'pts': [decimetre(v) for (x, y), z in zip(pts, zs, strict=True) for v in (x, y, z)],
        'stops': route_stop_list,
        'services': departures_by_service(pattern.trips, first),
    }


def line_calendar(table: Table, routes: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Calendar of the services that run at least one trip of the line."""
    used = {sid for r in routes for sid in r['services']}
    return {
        c['service_id']: {
            'days': ''.join(c[k] for k in WEEKDAYS),
            'start': c['start_date'],
            'end': c['end_date'],
        }
        for c in table('calendar.txt')
        if c['service_id'] in used
    }


def read_shapes(table: Table, shape_ids: set[str], to_xy: Projection) -> Shapes:
    """Shapes in the local frame, points in sequence order."""
    raw: defaultdict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for r in table('shapes.txt'):
        if r['shape_id'] in shape_ids:
            raw[r['shape_id']].append(
                (int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon']))
            )
    return {sid: [to_xy(la, lo) for _, la, lo in sorted(pts)] for sid, pts in raw.items()}


def main() -> None:
    table = load_gtfs(sys.argv[1] if len(sys.argv) > 1 else None)
    routes_by_name = {r['route_short_name']: r for r in table('routes.txt')}
    missing = [name for name in LINES if name not in routes_by_name]
    if missing:
        raise SystemExit(f'lignes absentes du GTFS : {missing}')
    route_ids = {routes_by_name[name]['route_id']: name for name in LINES}
    trips = [t for t in table('trips.txt') if t['route_id'] in route_ids]
    trip_ids = {t['trip_id'] for t in trips}
    times: defaultdict[str, list[Row]] = defaultdict(list)
    for r in table('stop_times.txt'):
        if r['trip_id'] in trip_ids:
            times[r['trip_id']].append(r)
    for v in times.values():
        v.sort(key=lambda r: int(r['stop_sequence']))
    stops = {s['stop_id']: s for s in table('stops.txt')}
    to_xy, to_ll = make_proj(*ORIGIN)
    shapes = read_shapes(table, {t['shape_id'] for t in trips}, to_xy)

    index: list[dict[str, Any]] = []
    built: list[dict[str, Any]] = []
    every_route: list[list[Point]] = []
    for name in LINES:
        gtfs_route = routes_by_name[name]
        line_trips = [t for t in trips if t['route_id'] == gtfs_route['route_id']]
        patterns = trip_patterns(line_trips, {k: [r['stop_id'] for r in v] for k, v in times.items()})
        print(f'ligne {name} : {len(line_trips)} courses, {len(patterns)} parcours')
        routes = [build_route(p, shapes, times, stops, to_xy, to_ll) for p in patterns]
        every_route += [[(r['pts'][i], r['pts'][i + 1]) for i in range(0, len(r['pts']), 3)] for r in routes]
        line: dict[str, Any] = {
            'id': name,
            'name': gtfs_route['route_long_name'],
            'color': '#' + gtfs_route['route_color'],
            'text_color': '#' + gtfs_route['route_text_color'],
            'step': STEP,
            'routes': routes,
            'calendar': line_calendar(table, routes),
        }
        write_json(os.path.join(LINES_DIR, f'{name}.json'), line)
        built.append(line)
        main_route = routes[0]
        index.append(
            {
                'id': name,
                'name': line['name'],
                'color': line['color'],
                'text_color': line['text_color'],
                'termini': [main_route['stops'][0]['name'], main_route['stops'][-1]['name']],
            }
        )
    write_json(
        os.path.join(LINES_DIR, 'index.json'),
        {'origin': list(ORIGIN), 'bbox': [round(v, 1) for v in bounds_of(every_route)], 'lines': index},
    )
    write_json(os.path.join(LINES_DIR, 'network.json'), network_of(built, NETWORK_EVERY))


if __name__ == '__main__':
    main()
