"""Downloads from the open-data sources (GTFS, IGN elevation, OSM Overpass), cached in tools/cache/."""

import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any

from geo import Point

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', 'cache')
UA = {'User-Agent': 'bus17-prototype/0.1 (local game prototype)'}

# IGN Geoplateforme (RGE ALTI, MNT metrique, France)
# (Open-Meteo / Copernicus 90 m etait limite a quelques milliers de points par heure.)
IGN_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json'
IGN_RES = 'ign_rge_alti_wld'
IGN_BATCH = 150  # points per request accepted by the API
OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

_elev_cache: dict[str, float | None] | None = None


def fetch(url: str, data: bytes | None = None, timeout: float = 120) -> bytes:
    """HTTP GET (or POST when `data` is given) with the project user agent."""
    if not url.startswith('https://'):
        raise ValueError(f'refusing non-HTTPS url: {url}')
    req = urllib.request.Request(url, data=data, headers=UA)  # noqa: S310 (scheme checked above)
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (scheme checked above)
        body: bytes = r.read()
        return body


def _save_elevation_cache(cpath: str, cache: dict[str, float | None]) -> None:
    tmp = cpath + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cache, f)
    os.replace(tmp, cpath)  # ecriture atomique : jamais de cache tronque


def _load_elevation_cache(cpath: str) -> dict[str, float | None]:
    global _elev_cache  # one cache per process, shared by every elevations() call
    cache = _elev_cache
    if cache is None:
        cache = _elev_cache = read_json(cpath) if os.path.exists(cpath) else {}
    return cache


def _query_elevations(chunk: list[str]) -> list[float]:
    q = urllib.parse.urlencode(
        {
            'lat': '|'.join(k.split(',')[0] for k in chunk),
            'lon': '|'.join(k.split(',')[1] for k in chunk),
            'resource': IGN_RES,
            'zonly': 'true',
        }
    )
    for attempt in range(6):
        try:
            res: list[float] = json.loads(fetch(IGN_URL + '?' + q))['elevations']
            return res
        except (OSError, ValueError, KeyError) as e:
            print(f'  altitude: nouvel essai ({e})')
            time.sleep(3 * (attempt + 1))
    raise SystemExit('API altimetrique IGN injoignable')


def elevations(latlons: list[Point]) -> list[float | None]:
    """Elevation (m) of each (lat, lon), None outside IGN coverage; results are cached on disk."""
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, 'elevation_ign.json')
    cache = _load_elevation_cache(cpath)
    keys = [f'{lat:.5f},{lon:.5f}' for lat, lon in latlons]
    todo = [k for k in dict.fromkeys(keys) if k not in cache]
    for i in range(0, len(todo), IGN_BATCH):
        chunk = todo[i : i + IGN_BATCH]
        for k, e in zip(chunk, _query_elevations(chunk), strict=True):
            cache[k] = e if e > -1000 else None  # -99999 = hors couverture
        print(f'  altitudes {min(i + IGN_BATCH, len(todo))}/{len(todo)}')
        time.sleep(0.25)
        _save_elevation_cache(cpath, cache)
    return [cache[k] for k in keys]


def overpass(query: str) -> Any:
    """Run an Overpass QL query (JSON output), cached on disk by query hash."""
    os.makedirs(CACHE, exist_ok=True)
    digest = hashlib.md5(query.encode(), usedforsecurity=False).hexdigest()[:10]
    cpath = os.path.join(CACHE, f'overpass_{digest}.json')
    if os.path.exists(cpath):
        with open(cpath, encoding='utf-8') as f:
            return json.load(f)
    data = urllib.parse.urlencode({'data': query}).encode()
    for attempt in range(6):
        url = OVERPASS_SERVERS[attempt % len(OVERPASS_SERVERS)]
        try:
            res = json.loads(fetch(url, data, timeout=300))
        except (OSError, ValueError) as e:
            print(f'  overpass: nouvel essai ({e})')
            time.sleep(10 * (attempt + 1))
            continue
        with open(cpath, 'w', encoding='utf-8') as f:
            json.dump(res, f)
        return res
    raise SystemExit('Overpass injoignable')


def write_json(path: str, value: object, ensure_ascii: bool = False) -> None:
    """Write compact UTF-8 JSON and report the file size."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=ensure_ascii, separators=(',', ':'))
    print('ecrit', os.path.relpath(path, ROOT), f'{os.path.getsize(path) / 1024:.0f} ko')


def read_json(path: str) -> Any:
    """Read a UTF-8 JSON file."""
    with open(path, encoding='utf-8') as f:
        return json.load(f)
