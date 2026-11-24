"""Construit data/grenoble/buildings.json : batiments OSM (emprise + hauteur) le long de la ligne.

Usage :  python tools/build_buildings.py      (apres build_line.py)
Donnees (c) contributeurs OpenStreetMap, licence ODbL.
Sortie : { "b": [[hauteur_dm, type, x0, y0, x1, y1, ...], ...], "trees": [x, y, ...] }  coordonnees locales en dm.
  type : 0 = immeuble/autre, 1 = maison, 2 = commerce/industrie, 3 = edifice public/religieux
"""
import json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_line import make_proj, ROOT
from build_map import overpass, dp_ring

LINE = os.path.join(ROOT, 'data', 'grenoble', '17.json')
OUT = os.path.join(ROOT, 'data', 'grenoble', 'buildings.json')
CORRIDOR = 450   # m de part et d'autre de la ligne

KIND = {'house': 1, 'detached': 1, 'semidetached_house': 1, 'terrace': 1, 'bungalow': 1, 'garage': 1, 'garages': 1,
        'shed': 1, 'commercial': 2, 'retail': 2, 'industrial': 2, 'warehouse': 2, 'supermarket': 2,
        'church': 3, 'chapel': 3, 'cathedral': 3, 'public': 3, 'civic': 3, 'school': 3, 'university': 3,
        'hospital': 3, 'government': 3, 'college': 3}


def height(tags, kind, seed):
    for k in ('height', 'building:height'):
        try:
            return float(tags[k].replace('m', '').strip())
        except (KeyError, ValueError):
            pass
    try:
        lv = float(tags['building:levels'])
        return lv * 3.0 + (1.5 if kind != 1 else 1.0)
    except (KeyError, ValueError):
        pass
    r = (math.sin(seed * 12.9898) * 43758.5453) % 1
    if kind == 1:
        return 6 + r * 3
    if kind == 2:
        return 7 + r * 5
    if tags.get('building') in ('garage', 'garages', 'shed', 'roof', 'carport'):
        return 3
    return 10 + r * 9   # immeuble grenoblois typique : R+3 a R+6


def main():
    line = json.load(open(LINE, encoding='utf-8'))
    to_xy, to_ll = make_proj(*line['origin'])
    pts = line['directions'][0]['pts']
    poly = []
    for i in range(0, len(pts) // 3, 40):   # un point tous les 80 m
        la, lo = to_ll(pts[i * 3], pts[i * 3 + 1])
        poly += ['%.5f' % la, '%.5f' % lo]
    q = '[out:json][timeout:300];way["building"](around:%d,%s);out geom qt;' % (CORRIDOR, ','.join(poly))
    print('Requete Overpass (batiments a %d m de la ligne)...' % CORRIDOR)
    res = overpass(q)
    out = []
    for el in res['elements']:
        if 'geometry' not in el:
            continue
        tags = el.get('tags', {})
        if tags.get('building') in ('roof', 'carport', 'no'):
            continue
        ring = [to_xy(g['lat'], g['lon']) for g in el['geometry']]
        if len(ring) < 4:
            continue
        ring = dp_ring(ring, 0.4)[:-1]
        if len(ring) < 3:
            continue
        # orientation anti-horaire (aire signee > 0)
        a = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
        if abs(a) < 2 * 12:   # < 12 m2 : on ignore
            continue
        if a < 0:
            ring.reverse()
        kind = KIND.get(tags.get('building'), 0)
        if tags.get('amenity') in ('place_of_worship', 'townhall', 'school', 'university', 'hospital'):
            kind = 3
        h = height(tags, kind, el['id'])
        rec = [int(h * 10), kind]
        for x, y in ring:
            rec += [int(round(x * 10)), int(round(y * 10))]
        out.append(rec)
    # arbres reels (alignements, parcs) : natural=tree
    qt = '[out:json][timeout:300];node["natural"="tree"](around:%d,%s);out skel qt;' % (CORRIDOR + 300, ','.join(poly))
    print('Requete Overpass (arbres)...')
    trees = []
    for el in overpass(qt)['elements']:
        x, y = to_xy(el['lat'], el['lon'])
        trees += [int(round(x * 10)), int(round(y * 10))]
    print('%d arbres' % (len(trees) // 2))
    json.dump({'attribution': '© contributeurs OpenStreetMap (ODbL)', 'b': out, 'trees': trees}, open(OUT, 'w'), separators=(',', ':'))
    print('%d batiments, ecrit %s (%.0f ko)' % (len(out), OUT, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
