"""Pure building logic (#56): IGN BD TOPO footprints and heights, completed with OpenStreetMap tags.

No network and no files. Coordinates in metres, local frame (x east, y north).
BD TOPO attributes: https://geoservices.ign.fr/documentation/donnees/vecteur/bdtopo (Licence Ouverte 2.0).
"""

import math
import zlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from geo import Point, building_height, building_kind, dp_ring, signed_area2
from shapely import Polygon, STRtree

MIN_AREA_M2 = 12.0  # smaller: shelters, technical rooms, ignored (same as the OSM import)
SIMPLIFY_M = 0.4  # Douglas-Peucker tolerance of the footprints, well under a facade bay
LEVEL_HEIGHT = 3.0  # m per storey, plus GROUND_EXTRA for the ground floor and the roof edge
GROUND_EXTRA = 1.5
MIN_HEIGHT = 2.0  # m: lower BD TOPO heights are measurement noise on light constructions
OSM_OVERLAP = 0.5  # share of the smaller footprint an OSM building must cover to lend its tags
PITCHED_MIN_RISE = 1.5  # m between the lowest and highest roof points: lower is a flat roof with a parapet
MAX_ROOF_RISE = 8.0  # m: higher rises are towers and spires on a lower roof, not the roof itself
ROOF_PITCH = 0.6  # rise over half the short side at most (about 30 degrees, usual French tile roofs)
CONCRETE_ROOF = '4'  # MAJIC roof material code of concrete (terrace roofs)
PUBLIC_NATURES = ('Eglise', 'Chapelle', 'Château', 'Tour, donjon', 'Fort, blockhaus, casemate')
BUSINESS_USAGES = ('Commercial et services', 'Industriel', 'Agricole')
PITCHED_SHAPES = ('gabled', 'hipped', 'pyramidal', 'half-hipped', 'gambrel', 'mansard', 'skillion')
# roof shapes drawn by the game (#16): OSM roof:shape values that end in gables, the others are hipped
FLAT_ROOF, HIPPED_ROOF, GABLED_ROOF = range(3)
GABLED_SHAPES = ('gabled', 'gambrel', 'skillion', 'saltbox')
# share of gabled roofs by facade family when OSM does not say: gables on most houses, sheds and farms,
# fewer in the old town, hips on the large blocks and public buildings (owner's wish for varied roofs)
GABLED_SHARE = (0.35, 0.2, 0.3, 0.6, 0.7, 0.1)

# Facade families drawn by the game (index stored in the data)
CITY, SLAB, MODERN, HOUSE, INDUSTRIAL, PUBLIC = range(6)
SLAB_MIN_HEIGHT = 15.0  # m: post-war blocks of flats (R+4 and more) on large footprints
SLAB_MIN_AREA = 500.0  # m2
INDUSTRIAL_MIN_AREA = 800.0  # m2: sheds and warehouses, low and wide
INDUSTRIAL_MAX_HEIGHT = 12.0
HOUSE_MAX_HEIGHT = 9.0  # m: R+1 with a roof
HOUSE_MAX_AREA = 200.0  # m2


@dataclass(frozen=True)
class Footprint:
    """A BD TOPO building in the local frame, with the attributes the game uses."""

    ident: str
    ring: list[Point]
    height: float | None
    levels: int | None
    dwellings: int | None
    usage: str
    nature: str
    roof_rise: float
    roof_material: str

    @property
    def area(self) -> float:
        return abs(signed_area2(self.ring)) / 2


def outer_ring(geometry: dict[str, Any]) -> list[tuple[float, float]]:
    """Outer ring (lon, lat) of the largest part of a GeoJSON Polygon or MultiPolygon."""
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    best = max(polygons, key=lambda p: Polygon([c[:2] for c in p[0]]).area)
    return [(float(c[0]), float(c[1])) for c in best[0]]


def number(value: Any) -> float | None:
    """A numeric attribute, None when missing."""
    return float(value) if isinstance(value, int | float) else None


def footprint(feature: dict[str, Any], to_xy: Callable[[float, float], Point]) -> Footprint | None:
    """A BD TOPO `batiment` feature as a counter-clockwise footprint, or None when too small."""
    props: dict[str, Any] = feature['properties']
    ring = [to_xy(lat, lon) for lon, lat in outer_ring(feature['geometry'])]
    ring = dp_ring(ring, SIMPLIFY_M)[:-1]
    if len(ring) < 3 or abs(signed_area2(ring)) < 2 * MIN_AREA_M2:
        return None
    if signed_area2(ring) < 0:
        ring.reverse()
    low, high = number(props.get('altitude_minimale_toit')), number(props.get('altitude_maximale_toit'))
    levels, dwellings = number(props.get('nombre_d_etages')), number(props.get('nombre_de_logements'))
    return Footprint(
        ident=str(props['cleabs']),
        ring=ring,
        height=number(props.get('hauteur')),
        levels=int(levels) if levels is not None else None,
        dwellings=int(dwellings) if dwellings is not None else None,
        usage=str(props.get('usage_1') or ''),
        nature=str(props.get('nature') or ''),
        roof_rise=max(0.0, high - low) if low is not None and high is not None else 0.0,
        roof_material=str(props.get('materiaux_de_la_toiture') or ''),
    )


def osm_tags_for(
    footprints: Sequence[Footprint], osm: Sequence[tuple[list[Point], dict[str, str]]]
) -> list[dict[str, str]]:
    """Tags of the OSM building that covers each footprint best (OSM_OVERLAP of the smaller one), else {}."""
    shapes = [Polygon(ring).buffer(0) for ring, _ in osm]
    tree = STRtree(shapes)
    out: list[dict[str, str]] = []
    for fp in footprints:
        own = Polygon(fp.ring).buffer(0)
        best, best_share = -1, OSM_OVERLAP
        for k in tree.query(own):
            other = shapes[int(k)]
            smaller = min(own.area, other.area)
            share = own.intersection(other).area / smaller if smaller > 0 else 0.0
            if share >= best_share:
                best, best_share = int(k), share
        out.append(osm[best][1] if best >= 0 else {})
    return out


def seed_of(ident: str) -> int:
    """Stable number from a BD TOPO identifier (seeds the estimates, the same at every build)."""
    return zlib.crc32(ident.encode())


def kind_of(fp: Footprint, tags: dict[str, str]) -> int:
    """Building kind of the game (see geo.building_kind): OSM first when it says more than BD TOPO."""
    osm = building_kind(tags) if tags else 0
    if osm == 3 or fp.nature in PUBLIC_NATURES or fp.usage in ('Religieux', 'Sportif'):
        return 3
    if osm:
        return osm
    if fp.usage in BUSINESS_USAGES or fp.nature == 'Industriel, agricole ou commercial':
        return 2
    small = (fp.height or 0) <= HOUSE_MAX_HEIGHT and fp.area <= HOUSE_MAX_AREA
    if fp.usage == 'Résidentiel' and (fp.dwellings == 1 or small):
        return 1
    return 0


def wall_height(fp: Footprint, tags: dict[str, str], kind: int) -> float:
    """Height of the walls (m): BD TOPO height, else its storeys, else the OSM tags or the usual estimate."""
    if fp.height is not None and fp.height >= MIN_HEIGHT:
        return fp.height
    if fp.levels:
        return fp.levels * LEVEL_HEIGHT + GROUND_EXTRA
    return building_height(tags, kind, seed_of(fp.ident))


def roof_rise(fp: Footprint, tags: dict[str, str]) -> float:
    """Height of a pitched roof above the walls (m), 0 for a flat roof."""
    shape = tags.get('roof:shape', '')
    if shape == 'flat' or fp.roof_material.startswith(CONCRETE_ROOF):
        return 0.0
    rise = min(fp.roof_rise, MAX_ROOF_RISE)
    if shape in PITCHED_SHAPES:
        rise = max(rise, PITCHED_MIN_RISE)
    elif rise < PITCHED_MIN_RISE:
        return 0.0
    return min(rise, ROOF_PITCH * short_side(fp.ring) / 2)


def roof_shape(fp: Footprint, tags: dict[str, str], rise: float, style: int) -> int:
    """Roof shape drawn by the game: flat without rise, else OSM roof:shape, else a stable draw by family."""
    if rise <= 0:
        return FLAT_ROOF
    shape = tags.get('roof:shape', '')
    if shape in PITCHED_SHAPES:
        return GABLED_ROOF if shape in GABLED_SHAPES else HIPPED_ROOF
    draw = (seed_of(fp.ident) >> 8) % 1000 / 1000
    return GABLED_ROOF if draw < GABLED_SHARE[style] else HIPPED_ROOF


def short_side(ring: Sequence[Point]) -> float:
    """Short side of the smallest rectangle around a footprint (m)."""
    rectangle = Polygon(ring).minimum_rotated_rectangle
    corners = list(rectangle.exterior.coords) if isinstance(rectangle, Polygon) else []
    if len(corners) < 4:
        return 0.0
    return min(math.dist(corners[0], corners[1]), math.dist(corners[1], corners[2]))


def style_of(kind: int, height: float, area: float) -> int:
    """Facade family drawn by the game."""
    if kind == 3:
        return PUBLIC
    if kind == 1:
        return HOUSE
    if kind == 2:
        return INDUSTRIAL if area >= INDUSTRIAL_MIN_AREA and height <= INDUSTRIAL_MAX_HEIGHT else MODERN
    if height >= SLAB_MIN_HEIGHT and area >= SLAB_MIN_AREA:
        return SLAB
    return CITY


RECORD_HEAD = 5  # values before the outline in a building record: height, kind, style, roof rise, roof shape


def building_record(fp: Footprint, tags: dict[str, str]) -> list[int]:
    """[height_dm, kind, style, roof_rise_dm, roof_shape, x, y, ...] in dm (see build_buildings.py)."""
    kind = kind_of(fp, tags)
    height = wall_height(fp, tags, kind)
    style = style_of(kind, height, fp.area)
    rise = roof_rise(fp, tags)
    return [
        round(height * 10),
        kind,
        style,
        round(rise * 10),
        roof_shape(fp, tags, rise, style),
        *(round(v * 10) for xy in fp.ring for v in xy),
    ]
