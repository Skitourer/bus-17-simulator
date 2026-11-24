"""Pure helpers shared by the data build scripts: geometry and data cleaning (no network, no files)."""

import math
from collections.abc import Callable, Sequence
from itertools import pairwise

type Point = tuple[float, float]
type Projection = Callable[[float, float], Point]

R_EARTH = 6371000.0


def make_proj(lat0: float, lon0: float) -> tuple[Projection, Projection]:
    """Equirectangular projection around (lat0, lon0): returns (to_xy, to_ll) in metres, x = east."""
    kx = math.cos(math.radians(lat0)) * R_EARTH * math.pi / 180
    ky = R_EARTH * math.pi / 180

    def to_xy(lat: float, lon: float) -> Point:
        return ((lon - lon0) * kx, (lat - lat0) * ky)

    def to_ll(x: float, y: float) -> Point:
        return (lat0 + y / ky, lon0 + x / kx)

    return to_xy, to_ll


def close_dips(vals: list[float], width_n: int) -> list[float]:
    """Fermeture morphologique (max puis min glissants) : supprime les creux etroits du MNT
    (riviere sous un pont, tranchee) sans toucher aux vraies cotes."""

    def run(v: list[float], fn: Callable[[list[float]], float]) -> list[float]:
        n = len(v)
        return [fn(v[max(0, i - width_n) : min(n, i + width_n + 1)]) for i in range(n)]

    return run(run(vals, max), min)


def resample(pts: Sequence[Point], step: float) -> list[Point]:
    """Polyline -> points equidistants de `step` metres."""
    out = [pts[0]]
    need = step  # distance restant a parcourir avant le prochain echantillon
    for (x0, y0), (x1, y1) in pairwise(pts):
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


def gauss_smooth(vals: Sequence[float], sigma_n: float) -> list[float]:
    """Gaussian smoothing with standard deviation `sigma_n` samples; edges repeat the end values."""
    if sigma_n <= 0:
        return list(vals)
    r = int(sigma_n * 3)
    w = [math.exp(-0.5 * (i / sigma_n) ** 2) for i in range(-r, r + 1)]
    n = len(vals)
    out: list[float] = []
    for i in range(n):
        s = ws = 0.0
        for j, wj in enumerate(w):
            k = min(n - 1, max(0, i + j - r))
            s += vals[k] * wj
            ws += wj
        out.append(s / ws)
    return out


def cumlen(pts: Sequence[Point]) -> list[float]:
    """Cumulative length along a polyline, starting at 0."""
    c = [0.0]
    for a, b in pairwise(pts):
        c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return c


def project_on(pts: Sequence[Point], cum: Sequence[float], x: float, y: float) -> tuple[float, float]:
    """Abscisse curviligne du point du trace le plus proche de (x, y), et distance a ce point."""
    best = (1e18, 0.0)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        dx, dy = x1 - x0, y1 - y0
        l2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / l2))
        px, py = x0 + dx * t, y0 + dy * t
        d = (px - x) ** 2 + (py - y) ** 2
        if d < best[0]:
            best = (d, cum[i] + t * math.sqrt(l2))
    return best[1], math.sqrt(best[0])


def douglas_peucker(pts: list[Point], eps: float) -> list[Point]:
    """Douglas-Peucker simplification of a polyline with tolerance `eps` metres."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy) or 1e-9
        best, bi = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - x0) - dx * (pts[i][1] - y0)) / length
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep, strict=True) if k]


def dp_ring(ring: list[Point], eps: float) -> list[Point]:
    """Douglas-Peucker sur un anneau ferme (premier point == dernier) : traite en 2 moities."""
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 4:
        return ring + ring[:1]
    h = len(ring) // 2
    return douglas_peucker(ring[: h + 1], eps)[:-1] + douglas_peucker(ring[h:] + ring[:1], eps)


def join_rings(parts: Sequence[Sequence[Point]]) -> list[list[Point]]:
    """Assemble des morceaux de ways (membres 'outer' d'un multipolygone) en anneaux fermes."""
    todo = [list(p) for p in parts if len(p) > 1]
    rings: list[list[Point]] = []
    while todo:
        ring = todo.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, p in enumerate(todo):
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
                todo.pop(i)
                changed = True
                break
        rings.append(ring)
    return rings


def signed_area2(ring: Sequence[Point]) -> float:
    """Twice the signed area of a ring (> 0 = counter-clockwise), shoelace formula."""
    n = len(ring)
    return sum(ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1] for i in range(n))


def max_turn_curvature(pts: Sequence[Point], step: float) -> float:
    """Largest absolute heading change per metre between consecutive segments (0 for a straight line)."""
    curv: list[float] = []
    for i in range(1, len(pts) - 1):
        a1 = math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])
        a2 = math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0])
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        curv.append(abs(da) / step)
    return max(curv, default=0.0)


def clock_hm(t: str) -> str:
    """GTFS time "H:MM:SS" (hours may exceed 24) -> "HH:MM"."""
    h, m, _ = t.split(':')
    return f'{int(h):02d}:{m}'


def clock_seconds(t: str) -> int:
    """GTFS time "HH:MM:SS" -> seconds since midnight of the service day."""
    return sum(int(v) * m for v, m in zip(t.split(':'), (3600, 60, 1), strict=False))


def fill_missing(values: list[float | None], default: float) -> list[float]:
    """Replace each None by the previous known value (the first known value, or `default`, at the start)."""
    fill = next((v for v in values if v is not None), default)
    out: list[float] = []
    for v in values:
        if v is not None:
            fill = v
        out.append(fill)
    return out


BUILDING_KINDS = {
    'house': 1,
    'detached': 1,
    'semidetached_house': 1,
    'terrace': 1,
    'bungalow': 1,
    'garage': 1,
    'garages': 1,
    'shed': 1,
    'commercial': 2,
    'retail': 2,
    'industrial': 2,
    'warehouse': 2,
    'supermarket': 2,
    'church': 3,
    'chapel': 3,
    'cathedral': 3,
    'public': 3,
    'civic': 3,
    'school': 3,
    'university': 3,
    'hospital': 3,
    'government': 3,
    'college': 3,
}
PUBLIC_AMENITIES = ('place_of_worship', 'townhall', 'school', 'university', 'hospital')


def building_kind(tags: dict[str, str]) -> int:
    """0 = immeuble/autre, 1 = maison, 2 = commerce/industrie, 3 = edifice public/religieux."""
    if tags.get('amenity') in PUBLIC_AMENITIES:
        return 3
    return BUILDING_KINDS.get(tags.get('building', ''), 0)


def building_height(tags: dict[str, str], kind: int, seed: int) -> float:
    """Height (m) from OSM tags, else from the number of levels, else a plausible pseudo-random value."""
    for k in ('height', 'building:height'):
        try:
            return float(tags[k].replace('m', '').strip())
        except (KeyError, ValueError):
            pass
    try:
        levels = float(tags['building:levels'])
        return levels * 3.0 + (1.5 if kind != 1 else 1.0)
    except (KeyError, ValueError):
        pass
    r = (math.sin(seed * 12.9898) * 43758.5453) % 1
    if kind == 1:
        return 6 + r * 3
    if kind == 2:
        return 7 + r * 5
    if tags.get('building') in ('garage', 'garages', 'shed', 'roof', 'carport'):
        return 3
    return 10 + r * 9  # immeuble grenoblois typique : R+3 a R+6
