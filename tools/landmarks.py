"""Landmarks drawn by hand in the game (#16): the Bastille cable car, the walls and buildings of the Bastille
fort and the stations, the Tour Perret, the Collégiale Saint-André, the cathedral and the town hall, read from
OpenStreetMap elements with wall heights from the IGN BD TOPO. Pure functions; local frame in metres."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from geo import Point, Projection, join_rings
from shapely import Polygon

# OSM ways and node of the landmarks (stable identifiers, checked on 2026-11-28)
CABLE_CAR_WAY = 342018458  # aerialway=cable_car "Bastille", lower station first
TOWER_WAY = 28696571  # man_made=tower "Tour Perret", outline of its base
FORT_NODE = 2876574205  # historic=fort "Fort de la Bastille"
WALL_REACH = 700.0  # m around the fort where the city walls belong to the Bastille fortifications


def geometry(element: dict[str, Any], to_xy: Projection) -> list[Point]:
    """Local points of an Overpass element with `out geom` (a node gives one point)."""
    if 'geometry' in element:
        points = [(g['lat'], g['lon']) for g in element['geometry']]
    else:
        points = [(element['lat'], element['lon'])]
    return [(round(x, 1), round(y, 1)) for x, y in (to_xy(lat, lon) for lat, lon in points)]


def centroid(points: Sequence[Point]) -> Point:
    """Mean of the points of a ring (its closing point counted once)."""
    ring = list(points[:-1]) if len(points) > 1 and points[0] == points[-1] else list(points)
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def landmarks(elements: Sequence[dict[str, Any]], to_xy: Projection) -> dict[str, Any]:
    """The landmarks document: the cable car line (stations at its ends, pylons at its inner vertices more
    than 30 m from them), the tower (centre and base radius) and the walls of the fort."""
    by_key = {(e['type'], e['id']): e for e in elements}
    cable = geometry(by_key[('way', CABLE_CAR_WAY)], to_xy)
    inner = [p for p in cable[1:-1] if min(_dist(p, cable[0]), _dist(p, cable[-1])) > 30]
    base = geometry(by_key[('way', TOWER_WAY)], to_xy)
    cx, cy = centroid(base)
    radius = max(_dist(p, (cx, cy)) for p in base)
    fort = geometry(by_key[('node', FORT_NODE)], to_xy)[0]
    walls = [
        geometry(e, to_xy)
        for e in elements
        if e['type'] == 'way' and e.get('tags', {}).get('barrier') == 'city_wall'
    ]
    near = [w for w in walls if min(_dist(p, fort) for p in w) <= WALL_REACH and len(w) >= 2]
    return {
        'cable_car': {'name': 'Bastille', 'stations': [cable[0], cable[-1]], 'pylons': inner},
        'towers': [{'name': 'Tour Perret', 'x': round(cx, 1), 'y': round(cy, 1), 'radius': round(radius, 1)}],
        'walls': near,
    }


def _dist(a: Point, b: Point) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


@dataclass(frozen=True)
class Part:
    """How to draw one OSM building: `style` of its walls (stone, brick, concrete, glass, render, shelter),
    `roof` (flat, gabled) and `rise` of a gabled roof, `height` of its walls (None: the tallest BD TOPO
    building inside it). A tower stands on it: `tower`, another OSM element, or with `has_tower` its tallest
    BD TOPO building, in `tower_style`, `tower_height` high (None: from the BD TOPO), with a `spire` above."""

    osm: tuple[str, int]
    style: str
    roof: str = 'flat'
    rise: float = 0.0
    height: float | None = None
    tower: tuple[str, int] | None = None
    has_tower: bool = False
    tower_style: str = ''
    tower_height: float | None = None
    spire: float = 0.0


@dataclass(frozen=True)
class Site:
    """Every BD TOPO building inside an OSM area, drawn in one `style` with flat roofs."""

    osm: tuple[str, int]
    style: str


# Wall heights from the BD TOPO unless given; spires from the sources cited.
PARTS: tuple[Part, ...] = (
    # Collégiale Saint-André: brick, its bell tower 56 m to the top of the spire (Grenoble tourist office)
    Part(('way', 32622734), 'brick', 'gabled', 6.0, has_tower=True, tower_style='brick', spire=23.0),
    # Cathédrale Notre-Dame and its porch bell tower (OSM bell_tower), and the church of Saint-Hugues
    Part(
        ('way', 33695011), 'stone', 'gabled', 5.0, tower=('way', 1460551638), tower_style='brick', spire=4.0
    ),
    Part(('way', 1227262391), 'stone', 'gabled', 4.0),
    # town hall (Novarina, 1967): a low block and its 46.5 m tower (OSM building part)
    Part(
        ('relation', 80393), 'concrete', tower=('way', 236256896), tower_style='concrete', tower_height=46.5
    ),
    # cable car stations: on the quay, and at the fort
    Part(('way', 32502225), 'glass', height=10.0),
    Part(('way', 66619998), 'glass', height=10.0),
    # buildings of the fort (no BD TOPO there: outside the corridor of the buildings); heights estimated
    Part(('way', 66620681), 'stone', 'gabled', 4.0, height=10.0),
    Part(('way', 66621162), 'stone', height=8.0),
    Part(('way', 66621465), 'stone', 'gabled', 3.0, height=6.0),
    Part(('way', 66619276), 'stone', height=6.0),
    Part(('way', 66619444), 'stone', height=6.0),
    Part(('way', 66620290), 'shelter', height=4.0),
    Part(('way', 66621243), 'shelter', height=4.0),
    # the three towers of the Ile Verte (1967), 28 storeys and 98 m high (OSM building parts; PSS-Archi
    # FR-38185-2859) on a 5 m base (their min_height); the BD TOPO holds only the base
    *(
        Part(
            ('way', outline),
            'concrete',
            height=5.0,
            tower=('way', part),
            tower_style='concrete',
            tower_height=98.0,
        )
        for outline, part in ((33756314, 233263821), (33756315, 233263819), (33756316, 233263820))
    ),
)
SITES: tuple[Site, ...] = (Site(('way', 383545858), 'render'),)
DEFAULT_HEIGHT = 10.0  # m, walls of a part without a BD TOPO building inside


@dataclass(frozen=True)
class Footprint:
    """A BD TOPO building: wall height (m) and outline."""

    height: float
    polygon: Polygon


def rings_of(element: dict[str, Any], to_xy: Projection) -> list[list[Point]]:
    """Outer rings of a way or of a multipolygon relation (with `out geom`)."""
    if element['type'] == 'way':
        return [geometry(element, to_xy)]
    parts = [
        [(round(x, 1), round(y, 1)) for x, y in (to_xy(g['lat'], g['lon']) for g in m['geometry'])]
        for m in element.get('members', [])
        if m.get('role') == 'outer' and 'geometry' in m
    ]
    return join_rings(parts)


def inside(area: Polygon, buildings: Sequence[Footprint]) -> list[Footprint]:
    """The BD TOPO buildings standing in an area (by a point inside each of them), tallest first."""
    found = [b for b in buildings if area.contains(b.polygon.representative_point())]
    return sorted(found, key=lambda b: -b.height)


def corners_of(footprint: Footprint) -> list[Point]:
    """Outline of a BD TOPO building as points."""
    return [(float(x), float(y)) for x, y in footprint.polygon.exterior.coords]


def block(
    ring: Sequence[Point],
    style: str,
    height: float,
    roof: str = 'flat',
    rise: float = 0.0,
    spire: float = 0.0,
) -> dict[str, Any]:
    """One drawn block, its ring without closing point."""
    coords = list(ring[:-1]) if ring[0] == ring[-1] else list(ring)
    return {
        'style': style,
        'ring': [[round(x, 1), round(y, 1)] for x, y in coords],
        'height': round(height, 1),
        'roof': roof,
        'rise': rise,
        'spire': spire,
    }


def part_blocks(part: Part, by_key: dict[tuple[str, int], Any], to_xy: Projection, bd: Sequence[Footprint]):
    """Blocks of one part: the building, and its tower."""
    out: list[dict[str, Any]] = []
    # the BD TOPO buildings of a separate tower do not set the height of the building
    towers = (
        [Polygon(r).buffer(0) for r in rings_of(by_key[part.tower], to_xy)] if part.tower in by_key else []
    )
    for ring in rings_of(by_key[part.osm], to_xy) if part.osm in by_key else []:
        found = [
            b
            for b in inside(Polygon(ring).buffer(0), bd)
            if not any(t.contains(b.polygon.representative_point()) for t in towers)
        ]
        tower = found[0] if part.has_tower and found else None
        rest = [b for b in found if b is not tower]
        out.append(
            block(
                ring,
                part.style,
                part.height or (rest[0].height if rest else DEFAULT_HEIGHT),
                part.roof,
                part.rise,
            )
        )
        if tower is not None:
            out.append(block(corners_of(tower), part.tower_style, tower.height, spire=part.spire))
    if part.tower and part.tower in by_key:
        for ring in rings_of(by_key[part.tower], to_xy):
            found = inside(Polygon(ring).buffer(0), bd)
            height = part.tower_height or (found[0].height if found else DEFAULT_HEIGHT)
            out.append(block(ring, part.tower_style, height, spire=part.spire))
    return out


def monuments(
    elements: Sequence[dict[str, Any]], to_xy: Projection, bd: Sequence[Footprint]
) -> list[dict[str, Any]]:
    """The buildings drawn by hand: one record per drawn block {style, ring, height, roof, rise, spire}."""
    by_key = {(e['type'], e['id']): e for e in elements}
    out: list[dict[str, Any]] = []
    for part in PARTS:
        out += part_blocks(part, by_key, to_xy, bd)
    for site in SITES:
        for ring in rings_of(by_key[site.osm], to_xy) if site.osm in by_key else []:
            for b in inside(Polygon(ring).buffer(0), bd):
                out.append(block(corners_of(b), site.style, b.height))
    return out
