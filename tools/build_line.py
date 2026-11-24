"""Construit data/grenoble/17.json a partir du GTFS M reso et des altitudes Open-Meteo.

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
    "horizon": { "center": [x, y], "z": m, "az0": 0, "step": deg, "angles": [rad, ...] }  # ligne de crete reelle
  }
"""
import csv, io, json, math, os, sys, time, urllib.parse, urllib.request, zipfile
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
OUT = os.path.join(ROOT, 'data', 'grenoble', '17.json')
GTFS_URL = 'https://data.mobilites-m.fr/api/gtfs/SEM'
ROUTE_ID = '17'
STEP = 2.0            # pas de reechantillonnage (m)
SMOOTH_M = 12.0       # demi-fenetre du lissage gaussien du trace (arrondit les angles droits)
ELEV_EVERY = 10.0     # un echantillon d'altitude tous les 10 m
ELEV_SMOOTH_M = 40.0  # lissage de l'altitude
BRIDGE_M = 60.0       # creux plus etroits que ca = pont (riviere sous la route) : comble
UA = {'User-Agent': 'bus17-prototype/0.1 (local game prototype)'}
R_EARTH = 6371000.0


def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def load_gtfs(path):
    if path is None:
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, 'gtfs_sem.zip')
        if not os.path.exists(path):
            print('Telechargement du GTFS...')
            open(path, 'wb').write(fetch(GTFS_URL))
    z = zipfile.ZipFile(path)

    def table(name):
        with z.open(name) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))
    return table


# ---------- altitude : IGN Geoplateforme (RGE ALTI, MNT metrique, France), cache disque ----------
# (Open-Meteo / Copernicus 90 m etait limite a quelques milliers de points par heure.)
IGN_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
IGN_RES = 'ign_rge_alti_wld'
_elev_cache = None


def _save_cache(cpath):
    tmp = cpath + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(_elev_cache, f)
    os.replace(tmp, cpath)  # ecriture atomique : jamais de cache tronque


def elevations(latlons):
    global _elev_cache
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, 'elevation_ign.json')
    if _elev_cache is None:
        _elev_cache = json.load(open(cpath)) if os.path.exists(cpath) else {}
    keys = ['%.5f,%.5f' % p for p in latlons]
    todo = [k for k in dict.fromkeys(keys) if k not in _elev_cache]
    N = 150
    for i in range(0, len(todo), N):
        chunk = todo[i:i + N]
        q = urllib.parse.urlencode({
            'lat': '|'.join(k.split(',')[0] for k in chunk),
            'lon': '|'.join(k.split(',')[1] for k in chunk),
            'resource': IGN_RES, 'zonly': 'true'})
        for attempt in range(6):
            try:
                res = json.loads(fetch(IGN_URL + '?' + q))['elevations']
                break
            except Exception as e:
                print('  altitude: nouvel essai (%s)' % e)
                time.sleep(3 * (attempt + 1))
        else:
            raise SystemExit('API altimetrique IGN injoignable')
        for k, e in zip(chunk, res):
            _elev_cache[k] = e if e > -1000 else None   # -99999 = hors couverture
        print('  altitudes %d/%d' % (min(i + N, len(todo)), len(todo)))
        time.sleep(0.25)
        _save_cache(cpath)
    return [_elev_cache[k] for k in keys]


def close_dips(vals, width_n):
    """Fermeture morphologique (max puis min glissants) : supprime les creux etroits du MNT
    (riviere sous un pont, tranchee) sans toucher aux vraies cotes."""
    def run(v, fn):
        n = len(v)
        return [fn(v[max(0, i - width_n):min(n, i + width_n + 1)]) for i in range(n)]
    return run(run(vals, max), min)


# ---------- geometrie ----------
def make_proj(lat0, lon0):
    kx = math.cos(math.radians(lat0)) * R_EARTH * math.pi / 180
    ky = R_EARTH * math.pi / 180
    to_xy = lambda lat, lon: ((lon - lon0) * kx, (lat - lat0) * ky)
    to_ll = lambda x, y: (lat0 + y / ky, lon0 + x / kx)
    return to_xy, to_ll


def resample(pts, step):
    """Polyline -> points equidistants de `step` metres."""
    out = [pts[0]]
    need = step  # distance restant a parcourir avant le prochain echantillon
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        if d == 0:
            continue
        t = need
        while t <= d:
            out.append((x0 + (x1 - x0) * t / d, y0 + (y1 - y0) * t / d))
            t += step
        need = t - d
    if math.hypot(out[-1][0] - pts[-1][0], out[-1][1] - pts[-1][1]) > step * 0.3:
        out.append(pts[-1])
    return out


def gauss_smooth(vals, sigma_n):
    if sigma_n <= 0:
        return list(vals)
    r = int(sigma_n * 3)
    w = [math.exp(-0.5 * (i / sigma_n) ** 2) for i in range(-r, r + 1)]
    n = len(vals)
    out = []
    for i in range(n):
        s = ws = 0.0
        for j, wj in enumerate(w):
            k = min(n - 1, max(0, i + j - r))
            s += vals[k] * wj
            ws += wj
        out.append(s / ws)
    return out


def project_on(pts, cum, x, y):
    """Abscisse curviligne du point du trace le plus proche de (x, y)."""
    best = (1e18, 0.0)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / L2))
        px, py = x0 + dx * t, y0 + dy * t
        d = (px - x) ** 2 + (py - y) ** 2
        if d < best[0]:
            best = (d, cum[i] + t * math.sqrt(L2))
    return best[1], math.sqrt(best[0])


def cumlen(pts):
    c = [0.0]
    for a, b in zip(pts, pts[1:]):
        c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return c


def hms(t):
    h, m, _ = t.split(':')
    return '%02d:%s' % (int(h), m)


def main():
    table = load_gtfs(sys.argv[1] if len(sys.argv) > 1 else None)
    routes = {r['route_id']: r for r in table('routes.txt')}
    route = routes[ROUTE_ID]
    trips = [t for t in table('trips.txt') if t['route_id'] == ROUTE_ID]
    trip_ids = {t['trip_id'] for t in trips}
    print('%d trajets ligne %s' % (len(trips), ROUTE_ID))

    st = defaultdict(list)
    for r in table('stop_times.txt'):
        if r['trip_id'] in trip_ids:
            st[r['trip_id']].append(r)
    for v in st.values():
        v.sort(key=lambda r: int(r['stop_sequence']))
    stops = {s['stop_id']: s for s in table('stops.txt')}

    # trajet de reference par sens = celui qui a le plus d'arrets (parcours complet)
    ref = {}
    for t in trips:
        d = int(t['direction_id'])
        if d not in ref or len(st[t['trip_id']]) > len(st[ref[d]['trip_id']]):
            ref[d] = t
    shape_ids = {t['shape_id'] for t in ref.values()}
    shapes = defaultdict(list)
    for r in table('shapes.txt'):
        if r['shape_id'] in shape_ids:
            shapes[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))

    first = sorted(shapes[ref[0]['shape_id']])[0]
    origin = (first[1], first[2])
    to_xy, to_ll = make_proj(*origin)

    out = {'origin': list(origin), 'color': '#' + route['route_color'], 'step': STEP,
           'name': route['route_long_name'], 'directions': [], 'calendar': {}}
    allx, ally = [], []

    for d in sorted(ref):
        t = ref[d]
        raw = [to_xy(la, lo) for _, la, lo in sorted(shapes[t['shape_id']])]
        # nettoyage des doublons puis reechantillonnage fin + lissage gaussien (arrondi des angles)
        pts = resample(raw, STEP)
        sig = SMOOTH_M / STEP
        xs = gauss_smooth([p[0] for p in pts], sig)
        ys = gauss_smooth([p[1] for p in pts], sig)
        pts = resample(list(zip(xs, ys)), STEP)
        cum = cumlen(pts)
        L = cum[-1]

        # altitude : echantillons tous les ELEV_EVERY m, interpolation, lissage
        n_e = int(L // ELEV_EVERY) + 1
        e_idx = [min(len(pts) - 1, round(i * ELEV_EVERY / STEP)) for i in range(n_e)] + [len(pts) - 1]
        e_val = elevations([to_ll(*pts[i]) for i in e_idx])
        e_val = close_dips(e_val, int(BRIDGE_M / ELEV_EVERY / 2))
        zs = []
        j = 0
        for i in range(len(pts)):
            while j < len(e_idx) - 2 and e_idx[j + 1] < i:
                j += 1
            i0, i1 = e_idx[j], e_idx[j + 1]
            f = 0 if i1 == i0 else (i - i0) / (i1 - i0)
            zs.append(e_val[j] + (e_val[j + 1] - e_val[j]) * max(0, min(1, f)))
        zs = gauss_smooth(zs, ELEV_SMOOTH_M / STEP)

        # arrets du trajet de reference
        sl = []
        secs = lambda hh: sum(int(v) * m for v, m in zip(hh.split(':'), (3600, 60, 1)))
        t0 = secs(st[t['trip_id']][0]['departure_time'])
        for r in st[t['trip_id']]:
            s = stops[r['stop_id']]
            sx, sy = to_xy(float(s['stop_lat']), float(s['stop_lon']))
            pos, dist = project_on(pts, cum, sx, sy)
            name = s['stop_name'].split(', ', 1)[-1]
            sl.append({'name': name, 'commune': s['stop_name'].split(', ', 1)[0], 's': round(pos, 1),
                       'off': round(dist, 1), 'x': round(sx, 1), 'y': round(sy, 1),
                       't': secs(r['arrival_time']) - t0})   # horaire theorique (s depuis le depart)
        services = defaultdict(list)
        for tt in trips:
            if int(tt['direction_id']) == d and st[tt['trip_id']]:
                services[tt['service_id']].append(hms(st[tt['trip_id']][0]['departure_time']))
        for k in services:
            services[k].sort()

        # stats
        curv = []
        for i in range(1, len(pts) - 1):
            a1 = math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])
            a2 = math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
            da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
            curv.append(abs(da) / STEP)
        rmin = 1 / max(curv) if curv and max(curv) > 0 else 1e9
        slope = max(abs(zs[i + 25] - zs[i]) / 50 for i in range(len(zs) - 25))
        print('sens %d -> %s : %.0f m, %d arrets, alt %.0f-%.0f m, pente max %.1f %%, rayon min %.1f m'
              % (d, t['trip_headsign'], L, len(sl), min(zs), max(zs), slope * 100, rmin))

        if d == min(ref):
            first_track = ([p[0] for p in pts], [p[1] for p in pts], zs)
        flat = []
        for (x, y), z in zip(pts, zs):
            flat += [round(x, 2), round(y, 2), round(z, 2)]
            allx.append(x)
            ally.append(y)
        out['directions'].append({'id': d, 'headsign': t['trip_headsign'], 'length': round(L, 1),
                                  'pts': flat, 'stops': sl, 'services': services})

    for c in table('calendar.txt'):
        if c['service_id'].startswith('PROD2627-17') or any(c['service_id'] in dd['services'] for dd in out['directions']):
            days = ''.join(c[k] for k in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'))
            out['calendar'][c['service_id']] = {'days': days, 'start': c['start_date'], 'end': c['end_date']}

    out['bbox'] = [min(allx), min(ally), max(allx), max(ally)]
    out['horizon'] = build_horizon(to_xy, to_ll, allx, ally, first_track)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('ecrit', OUT, '%.0f ko' % (os.path.getsize(OUT) / 1024))


def build_horizon(to_xy, to_ll, allx, ally, track_pts):
    """Lignes de crete reelles (angle d'elevation max par azimut, 0 = nord, sens horaire).
    - plan lointain (>= 7 km : Belledonne, Vercors, Chartreuse) : un seul point de vue, au centre ;
    - plan proche (< 7 km : Bastille, Rachais, Saint-Eynard...) : un point de vue tous les VIEW_EVERY m
      le long du trace, interpole en jeu selon la position du bus (vraie parallaxe des collines)."""
    AZ_STEP = 3
    NEAR_D = [350, 550, 800, 1100, 1500, 2000, 2600, 3300, 4200, 5200, 6400]
    FAR_D = [7600, 9200, 11000, 13000, 15500, 18500, 22000, 26000, 31000]
    VIEW_EVERY = 400

    def ridge(cx, cy, z0, dists):
        pts = []
        for a in range(0, 360, AZ_STEP):
            az = math.radians(a)
            for d in dists:
                pts.append(to_ll(cx + math.sin(az) * d, cy + math.cos(az) * d))
        el = elevations(pts)
        out, k = [], 0
        for a in range(0, 360, AZ_STEP):
            best = 0.0
            for d in dists:
                e = el[k] if el[k] is not None else z0
                h = e - z0 - d * d / (2 * R_EARTH) * 0.87   # courbure terrestre + refraction
                best = max(best, math.atan2(h, d))
                k += 1
            out.append(round(best, 4))
        return out

    cx, cy = (min(allx) + max(allx)) / 2, (min(ally) + max(ally)) / 2
    z0 = elevations([to_ll(cx, cy)])[0] + 3
    print('ligne de crete lointaine depuis le centre (alt %.0f m)' % z0)
    far = ridge(cx, cy, z0, FAR_D)
    views = []
    xs, ys, zs = track_pts
    n = len(xs)
    step_n = max(1, int(VIEW_EVERY / STEP))
    idx = list(range(0, n, step_n))
    if idx[-1] != n - 1:
        idx.append(n - 1)
    for j, i in enumerate(idx):
        print('  point de vue %d/%d' % (j + 1, len(idx)))
        views.append({'x': round(xs[i], 1), 'y': round(ys[i], 1), 'z': round(zs[i] + 3, 1),
                      'near': ridge(xs[i], ys[i], zs[i] + 3, NEAR_D)})
    return {'step': AZ_STEP, 'far': far, 'z': round(z0, 1), 'views': views}


if __name__ == '__main__':
    main()
