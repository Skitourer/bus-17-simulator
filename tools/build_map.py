"""Construit data/grenoble/map.json (fond de la mini-carte) depuis OpenStreetMap via Overpass.

Usage :  python tools/build_map.py      (a lancer apres build_line.py, qui fixe l'origine et l'emprise)
Donnees (c) contributeurs OpenStreetMap, licence ODbL : l'attribution est affichee sur la mini-carte.

Sortie : coordonnees locales en metres (memes axes que 17.json), arrondies au metre,
  { "polys": { "water": [[x,y,x,y,...], ...], "park": [...], "forest": [...] },
    "lines": { "river": [...], "primary": [...], "secondary": [...], "minor": [...], "tram": [...], "rail": [...] } }
"""
import hashlib, json, math, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
LINE = os.path.join(ROOT, 'data', 'grenoble', '17.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'map.json')
MARGIN = 1500  # m autour de la ligne
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
UA = {'User-Agent': 'bus17-prototype/0.1 (local game prototype)'}
R_EARTH = 6371000.0

ROAD_CLASS = {
    'motorway': 'primary', 'trunk': 'primary', 'primary': 'primary', 'motorway_link': 'primary', 'trunk_link': 'primary',
    'primary_link': 'primary', 'secondary': 'secondary', 'secondary_link': 'secondary', 'tertiary': 'secondary',
    'tertiary_link': 'secondary', 'residential': 'minor', 'unclassified': 'minor', 'living_street': 'minor',
    'pedestrian': 'minor',
}


def overpass(q):
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, 'overpass_%s.json' % hashlib.md5(q.encode()).hexdigest()[:10])
    if os.path.exists(cpath):
        return json.load(open(cpath, encoding='utf-8'))
    data = urllib.parse.urlencode({'data': q}).encode()
    for attempt in range(6):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=300) as r:
                res = json.loads(r.read())
            json.dump(res, open(cpath, 'w', encoding='utf-8'))
            return res
        except Exception as e:
            print('  overpass: nouvel essai (%s)' % e)
            time.sleep(10 * (attempt + 1))
    raise SystemExit('Overpass injoignable')


def dp(pts, eps):
    """Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-9
        best, bi = 0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - x0) - dx * (pts[i][1] - y0)) / L
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def dp_ring(ring, eps):
    """Douglas-Peucker sur un anneau ferme (premier point == dernier) : traite en 2 moities."""
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 4:
        return ring + ring[:1]
    h = len(ring) // 2
    return dp(ring[:h + 1], eps)[:-1] + dp(ring[h:] + ring[:1], eps)


def join_rings(parts):
    """Assemble des morceaux de ways (membres 'outer' d'un multipolygone) en anneaux fermes."""
    parts = [list(p) for p in parts if len(p) > 1]
    rings = []
    while parts:
        ring = parts.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, p in enumerate(parts):
                if p[0] == ring[-1]:
                    ring += p[1:]
                elif p[-1] == ring[-1]:
                    ring += p[::-1][1:]
                elif p[-1] == ring[0]:
                    ring = p[:-1] + ring
                elif p[0] == ring[0]:
                    ring = p[::-1][:-1] + ring
                else:
                    continue
                parts.pop(i)
                changed = True
                break
        rings.append(ring)
    return rings


def main():
    line = json.load(open(LINE, encoding='utf-8'))
    lat0, lon0 = line['origin']
    kx = math.cos(math.radians(lat0)) * R_EARTH * math.pi / 180
    ky = R_EARTH * math.pi / 180
    to_xy = lambda lat, lon: ((lon - lon0) * kx, (lat - lat0) * ky)
    x0, y0, x1, y1 = line['bbox']
    x0 -= MARGIN; y0 -= MARGIN; x1 += MARGIN; y1 += MARGIN
    s, w = lat0 + y0 / ky, lon0 + x0 / kx
    n, e = lat0 + y1 / ky, lon0 + x1 / kx
    bb = '%.5f,%.5f,%.5f,%.5f' % (s, w, n, e)
    q = f"""[out:json][timeout:240];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)(_link)?$"]({bb});
  way["railway"~"^(tram|rail)$"]({bb});
  way["waterway"~"^(river|canal)$"]({bb});
  way["natural"="water"]({bb});
  relation["natural"="water"]({bb});
  way["leisure"~"^(park|garden)$"]({bb});
  relation["leisure"="park"]({bb});
  way["landuse"~"^(forest|grass|meadow|recreation_ground)$"]({bb});
  way["natural"="wood"]({bb});
  relation["landuse"="forest"]({bb});
  relation["natural"="wood"]({bb});
);
out geom qt;"""
    print('Requete Overpass (%s)...' % bb)
    res = overpass(q)
    els = res['elements']
    print('  %d elements' % len(els))

    polys = {'water': [], 'park': [], 'forest': []}
    lines = {'river': [], 'primary': [], 'secondary': [], 'minor': [], 'tram': [], 'rail': []}

    def conv(geom):
        return [(round(to_xy(g['lat'], g['lon'])[0], 1), round(to_xy(g['lat'], g['lon'])[1], 1)) for g in geom]

    def poly_kind(t):
        if t.get('natural') == 'water':
            return 'water'
        if t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'meadow', 'recreation_ground'):
            return 'park'
        if t.get('landuse') == 'forest' or t.get('natural') == 'wood':
            return 'forest'
        return None

    for el in els:
        t = el.get('tags', {})
        if el['type'] == 'way' and 'geometry' in el:
            pts = conv(el['geometry'])
            k = poly_kind(t)
            if k and len(pts) > 3 and pts[0] == pts[-1]:
                polys[k].append(pts)
            elif t.get('highway') in ROAD_CLASS:
                lines[ROAD_CLASS[t['highway']]].append(pts)
            elif t.get('railway') in ('tram', 'rail'):
                lines[t['railway']].append(pts)
            elif t.get('waterway') in ('river', 'canal'):
                lines['river'].append(pts)
        elif el['type'] == 'relation':
            k = poly_kind(t)
            if not k:
                continue
            outers = [conv(m['geometry']) for m in el.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
            for ring in join_rings(outers):
                if len(ring) > 3:
                    polys[k].append(ring)

    def pack(lst, eps, closed=False):
        out = []
        for p in lst:
            p = dp_ring(p, eps) if closed else dp(p, eps)
            if len(p) >= 2:
                out.append([round(v) for xy in p for v in xy])
        return out

    out = {'attribution': '© contributeurs OpenStreetMap (ODbL)',
           'bbox': [round(x0), round(y0), round(x1), round(y1)],
           'polys': {k: pack(v, 2.0, True) for k, v in polys.items()},
           'lines': {k: pack(v, 1.5) for k, v in lines.items()}}
    for k, v in list(out['polys'].items()) + list(out['lines'].items()):
        print('  %-9s %5d' % (k, len(v)))
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('ecrit', OUT, '%.0f ko' % (os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
