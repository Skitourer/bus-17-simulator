"""Construit data/grenoble/17.json a partir du GTFS M reso et des altitudes IGN.

Usage :  python tools/build_line.py [chemin_gtfs.zip]
  - sans argument, telecharge le GTFS depuis data.mobilites-m.fr (licence ODbL).
  - altitudes : API altimetrique IGN Geoplateforme (RGE ALTI), mises en cache dans tools/cache/.

Sortie (coordonnees locales en metres, x = est, y = nord, origine = ORIGIN) :
  {
    "origin": [lat, lon], "color": "#33A457", "step": 2,
    "directions": [ { "id": 0, "headsign": ..., "length": m,
                      "pts": [x0, y0, z0, x1, y1, z1, ...],      # un point tous les `step` metres
                      "stops": [ {"name":..., "s": m}, ... ],
                      "services": { service_id: ["06:32", ...] } }, ... ],
    "calendar": { service_id: {"days": "1111100", "start": "20261117", "end": "20261218"} },
    "horizon": { "step": deg, "far": [rad, ...], "z": m, "views": [...] }  # ligne de crete reelle
  }
"""

import csv
import io
import math
import os
import sys
import zipfile
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from geo import (
    R_EARTH,
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
from sources import CACHE, ROOT, elevations, fetch, write_json

OUT = os.path.join(ROOT, 'data', 'grenoble', '17.json')
GTFS_URL = 'https://data.mobilites-m.fr/api/gtfs/SEM'
ROUTE_ID = '17'
STEP = 2.0  # pas de reechantillonnage (m)
SMOOTH_M = 12.0  # demi-fenetre du lissage gaussien du trace (arrondit les angles droits)
ELEV_EVERY = 10.0  # un echantillon d'altitude tous les 10 m
ELEV_SMOOTH_M = 40.0  # lissage de l'altitude
BRIDGE_M = 60.0  # creux plus etroits que ca = pont (riviere sous la route) : comble
WEEKDAYS = ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')

type Row = dict[str, str]
type Table = Callable[[str], list[Row]]
type TrackPoints = tuple[list[float], list[float], list[float]]


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


def main() -> None:
    table = load_gtfs(sys.argv[1] if len(sys.argv) > 1 else None)
    routes = {r['route_id']: r for r in table('routes.txt')}
    route = routes[ROUTE_ID]
    trips = [t for t in table('trips.txt') if t['route_id'] == ROUTE_ID]
    trip_ids = {t['trip_id'] for t in trips}
    print(f'{len(trips)} trajets ligne {ROUTE_ID}')

    st: defaultdict[str, list[Row]] = defaultdict(list)
    for r in table('stop_times.txt'):
        if r['trip_id'] in trip_ids:
            st[r['trip_id']].append(r)
    for v in st.values():
        v.sort(key=lambda r: int(r['stop_sequence']))
    stops = {s['stop_id']: s for s in table('stops.txt')}

    # trajet de reference par sens = celui qui a le plus d'arrets (parcours complet)
    ref: dict[int, Row] = {}
    for t in trips:
        d = int(t['direction_id'])
        if d not in ref or len(st[t['trip_id']]) > len(st[ref[d]['trip_id']]):
            ref[d] = t
    shape_ids = {t['shape_id'] for t in ref.values()}
    shapes: defaultdict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for r in table('shapes.txt'):
        if r['shape_id'] in shape_ids:
            shapes[r['shape_id']].append(
                (int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon']))
            )

    first = sorted(shapes[ref[0]['shape_id']])[0]
    origin = (first[1], first[2])
    to_xy, to_ll = make_proj(*origin)

    directions: list[dict[str, Any]] = []
    allx: list[float] = []
    ally: list[float] = []
    first_track: TrackPoints = ([], [], [])

    for d in sorted(ref):
        t = ref[d]
        raw = [to_xy(la, lo) for _, la, lo in sorted(shapes[t['shape_id']])]
        # nettoyage des doublons puis reechantillonnage fin + lissage gaussien (arrondi des angles)
        pts = resample(raw, STEP)
        sig = SMOOTH_M / STEP
        xs = gauss_smooth([p[0] for p in pts], sig)
        ys = gauss_smooth([p[1] for p in pts], sig)
        pts = resample(list(zip(xs, ys, strict=True)), STEP)
        length = cumlen(pts)[-1]
        zs = route_altitudes(pts, to_ll)
        sl = route_stops(st[t['trip_id']], stops, pts, to_xy)

        services: defaultdict[str, list[str]] = defaultdict(list)
        for tt in trips:
            if int(tt['direction_id']) == d and st[tt['trip_id']]:
                services[tt['service_id']].append(clock_hm(st[tt['trip_id']][0]['departure_time']))
        for k in services:
            services[k].sort()

        kmax = max_turn_curvature(pts, STEP)
        rmin = 1 / kmax if kmax > 0 else 1e9
        slope = max(abs(zs[i + 25] - zs[i]) / 50 for i in range(len(zs) - 25))
        print(
            f'sens {d} -> {t["trip_headsign"]} : {length:.0f} m, {len(sl)} arrets, '
            f'alt {min(zs):.0f}-{max(zs):.0f} m, pente max {slope * 100:.1f} %, rayon min {rmin:.1f} m'
        )

        if d == min(ref):
            first_track = ([p[0] for p in pts], [p[1] for p in pts], zs)
        flat: list[float] = []
        for (x, y), z in zip(pts, zs, strict=True):
            flat += [round(x, 2), round(y, 2), round(z, 2)]
            allx.append(x)
            ally.append(y)
        directions.append(
            {
                'id': d,
                'headsign': t['trip_headsign'],
                'length': round(length, 1),
                'pts': flat,
                'stops': sl,
                'services': services,
            }
        )

    calendar: dict[str, dict[str, str]] = {}
    for c in table('calendar.txt'):
        sid = c['service_id']
        if sid.startswith('PROD2627-17') or any(sid in dd['services'] for dd in directions):
            days = ''.join(c[k] for k in WEEKDAYS)
            calendar[sid] = {'days': days, 'start': c['start_date'], 'end': c['end_date']}

    out: dict[str, Any] = {
        'origin': list(origin),
        'color': '#' + route['route_color'],
        'step': STEP,
        'name': route['route_long_name'],
        'directions': directions,
        'calendar': calendar,
        'bbox': [min(allx), min(ally), max(allx), max(ally)],
        'horizon': build_horizon(to_ll, allx, ally, first_track),
    }
    write_json(OUT, out)


AZ_STEP = 3
NEAR_D = [350, 550, 800, 1100, 1500, 2000, 2600, 3300, 4200, 5200, 6400]
FAR_D = [7600, 9200, 11000, 13000, 15500, 18500, 22000, 26000, 31000]
VIEW_EVERY = 400


def ridge(to_ll: Projection, cx: float, cy: float, z0: float, dists: list[int]) -> list[float]:
    """Highest elevation angle (rad) seen from (cx, cy, z0) for each azimuth (0 = north, clockwise)."""
    pts: list[Point] = []
    for a in range(0, 360, AZ_STEP):
        az = math.radians(a)
        for d in dists:
            pts.append(to_ll(cx + math.sin(az) * d, cy + math.cos(az) * d))
    el = elevations(pts)
    out: list[float] = []
    k = 0
    for _ in range(0, 360, AZ_STEP):
        best = 0.0
        for d in dists:
            ek = el[k]
            e = ek if ek is not None else z0
            h = e - z0 - d * d / (2 * R_EARTH) * 0.87  # courbure terrestre + refraction
            best = max(best, math.atan2(h, d))
            k += 1
        out.append(round(best, 4))
    return out


def build_horizon(
    to_ll: Projection, allx: list[float], ally: list[float], track_pts: TrackPoints
) -> dict[str, Any]:
    """Lignes de crete reelles (angle d'elevation max par azimut, 0 = nord, sens horaire).
    - plan lointain (>= 7 km : Belledonne, Vercors, Chartreuse) : un seul point de vue, au centre ;
    - plan proche (< 7 km : Bastille, Rachais, Saint-Eynard...) : un point de vue tous les VIEW_EVERY m
      le long du trace, interpole en jeu selon la position du bus (vraie parallaxe des collines)."""
    cx, cy = (min(allx) + max(allx)) / 2, (min(ally) + max(ally)) / 2
    z0 = known_elevations([to_ll(cx, cy)])[0] + 3
    print(f'ligne de crete lointaine depuis le centre (alt {z0:.0f} m)')
    far = ridge(to_ll, cx, cy, z0, FAR_D)
    views: list[dict[str, Any]] = []
    xs, ys, zs = track_pts
    n = len(xs)
    step_n = max(1, int(VIEW_EVERY / STEP))
    idx = list(range(0, n, step_n))
    if idx[-1] != n - 1:
        idx.append(n - 1)
    for j, i in enumerate(idx):
        print(f'  point de vue {j + 1}/{len(idx)}')
        views.append(
            {
                'x': round(xs[i], 1),
                'y': round(ys[i], 1),
                'z': round(zs[i] + 3, 1),
                'near': ridge(to_ll, xs[i], ys[i], zs[i] + 3, NEAR_D),
            }
        )
    return {'step': AZ_STEP, 'far': far, 'z': round(z0, 1), 'views': views}


if __name__ == '__main__':
    main()
