"""Unit tests of the BD TOPO building logic (fictitious buildings only)."""

from collections.abc import Sequence
from typing import Any

import pytest
from buildings import (
    CITY,
    FLAT_ROOF,
    GABLED_ROOF,
    HIPPED_ROOF,
    HOUSE,
    INDUSTRIAL,
    MODERN,
    PUBLIC,
    RECORD_HEAD,
    SLAB,
    Footprint,
    building_record,
    footprint,
    kind_of,
    osm_tags_for,
    outer_ring,
    roof_rise,
    roof_shape,
    seed_of,
    short_side,
    style_of,
    wall_height,
)
from geo import Point
from shapely import Polygon


def square(x: float, y: float, side: float) -> list[Point]:
    return [(x, y), (x + side, y), (x + side, y + side), (x, y + side)]


def fp(**changes: Any) -> Footprint:
    """A 20 m x 10 m residential building, 12 m high, flat roof; fields overridden by `changes`."""
    values: dict[str, Any] = {
        'ident': 'BATIMENT0000000000000001',
        'ring': [(0.0, 0.0), (20.0, 0.0), (20.0, 10.0), (0.0, 10.0)],
        'height': 12.0,
        'levels': None,
        'dwellings': None,
        'usage': 'Résidentiel',
        'nature': 'Indifférenciée',
        'roof_rise': 0.5,
        'roof_material': '',
    }
    values.update(changes)
    return Footprint(**values)


def feature(coords: Sequence[Sequence[float]], **props: Any) -> dict[str, Any]:
    """GeoJSON BD TOPO feature with lon/lat/z coordinates."""
    base = {'cleabs': 'BATIMENT1', 'hauteur': 9.5, 'usage_1': 'Résidentiel', 'nature': 'Indifférenciée'}
    return {
        'properties': base | props,
        'geometry': {'type': 'MultiPolygon', 'coordinates': [[coords]]},
    }


def metres(lat: float, lon: float) -> Point:
    """Fictitious projection: 1 degree = 1000 m."""
    return (lon * 1000, lat * 1000)


def test_outer_ring_takes_the_largest_part() -> None:
    small = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]]
    large = [[5.0, 5.0], [9.0, 5.0], [9.0, 9.0], [5.0, 5.0]]
    geometry = {'type': 'MultiPolygon', 'coordinates': [[small], [large]]}
    assert outer_ring(geometry)[0] == (5.0, 5.0)
    assert outer_ring({'type': 'Polygon', 'coordinates': [small]})[1] == (1.0, 0.0)


def test_footprint_reads_the_attributes_counter_clockwise() -> None:
    clockwise = [[0, 0, 210], [0, 0.01, 210], [0.02, 0.01, 210], [0.02, 0, 210], [0, 0, 210]]
    f = footprint(
        feature(
            clockwise,
            nombre_d_etages=3,
            nombre_de_logements=6,
            altitude_minimale_toit=220.0,
            altitude_maximale_toit=224.5,
            materiaux_de_la_toiture='10',
        ),
        metres,
    )
    assert f is not None
    assert f.area == pytest.approx(200)
    assert Polygon(f.ring).exterior.is_ccw  # given clockwise
    assert (f.height, f.levels, f.dwellings, f.roof_rise, f.roof_material) == (9.5, 3, 6, 4.5, '10')


def test_footprint_skips_small_buildings_and_missing_values() -> None:
    tiny = [[0, 0, 0], [0.003, 0, 0], [0.003, 0.003, 0], [0, 0.003, 0], [0, 0, 0]]
    assert footprint(feature(tiny), metres) is None
    f = footprint(
        feature([[0, 0, 0], [0.01, 0, 0], [0.01, 0.01, 0], [0, 0.01, 0], [0, 0, 0]], hauteur=None), metres
    )
    assert f is not None
    assert (f.height, f.levels, f.roof_rise, f.usage) == (None, None, 0.0, 'Résidentiel')


def test_osm_tags_for_takes_the_best_overlapping_building() -> None:
    footprints = [fp(ring=square(0, 0, 10)), fp(ring=square(100, 0, 10)), fp(ring=square(200, 0, 10))]
    osm = [
        (square(2, 0, 10), {'building': 'apartments'}),  # covers 80 %
        (square(0, 0, 10), {'building': 'church'}),  # covers all of it: wins
        (square(106, 0, 10), {'building': 'house'}),  # covers 40 %: too little
    ]
    assert osm_tags_for(footprints, osm) == [{'building': 'church'}, {}, {}]


def test_kind_of_combines_bdtopo_and_osm() -> None:
    assert kind_of(fp(), {}) == 0
    assert kind_of(fp(nature='Eglise'), {}) == 3
    assert kind_of(fp(), {'amenity': 'school'}) == 3
    assert kind_of(fp(usage='Commercial et services'), {}) == 2
    assert kind_of(fp(usage='Indifférencié', nature='Industriel, agricole ou commercial'), {}) == 2
    assert kind_of(fp(dwellings=1), {}) == 1
    assert kind_of(fp(height=7.0, ring=square(0, 0, 12)), {}) == 1
    assert kind_of(fp(usage='Indifférencié'), {'building': 'retail'}) == 2


def test_wall_height_falls_back_on_storeys_then_osm() -> None:
    assert wall_height(fp(), {}, 0) == 12.0
    assert wall_height(fp(height=None, levels=4), {}, 0) == pytest.approx(13.5)
    assert wall_height(fp(height=1.0), {'height': '7'}, 0) == 7.0
    estimate = wall_height(fp(height=None), {}, 0)
    assert 10 <= estimate <= 19
    assert wall_height(fp(height=None), {}, 0) == estimate  # same at every build


def test_roof_rise_is_pitched_only_when_the_roof_really_rises() -> None:
    assert roof_rise(fp(), {}) == 0.0
    assert roof_rise(fp(roof_rise=2.0), {}) == pytest.approx(2.0)
    # never steeper than about 30 degrees over the short side (10 m)
    assert roof_rise(fp(roof_rise=7.0), {}) == pytest.approx(3.0)
    assert roof_rise(fp(roof_rise=2.0, roof_material='40'), {}) == 0.0
    assert roof_rise(fp(roof_rise=2.0), {'roof:shape': 'flat'}) == 0.0
    assert roof_rise(fp(roof_rise=0.2), {'roof:shape': 'gabled'}) == pytest.approx(1.5)


def test_roof_shape_follows_osm_then_a_stable_draw_by_family() -> None:
    assert roof_shape(fp(), {}, 0.0, HOUSE) == FLAT_ROOF
    assert roof_shape(fp(), {'roof:shape': 'gambrel'}, 2.0, CITY) == GABLED_ROOF
    assert roof_shape(fp(), {'roof:shape': 'half-hipped'}, 2.0, HOUSE) == HIPPED_ROOF
    houses = [roof_shape(fp(ident=f'BATIMENT{k}'), {}, 2.0, HOUSE) for k in range(400)]
    publics = [roof_shape(fp(ident=f'BATIMENT{k}'), {}, 2.0, PUBLIC) for k in range(400)]
    assert 0.45 < houses.count(GABLED_ROOF) / 400 < 0.75
    assert publics.count(GABLED_ROOF) / 400 < 0.2
    assert roof_shape(fp(ident='BATIMENT7'), {}, 2.0, HOUSE) == houses[7]


def test_short_side() -> None:
    assert short_side(fp().ring) == pytest.approx(10)
    assert short_side([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]) == 0.0


def test_style_of() -> None:
    assert style_of(3, 20, 300) == PUBLIC
    assert style_of(1, 6, 100) == HOUSE
    assert style_of(2, 8, 2000) == INDUSTRIAL
    assert style_of(2, 30, 2000) == MODERN
    assert style_of(0, 25, 900) == SLAB
    assert style_of(0, 18, 300) == CITY


def test_building_record_and_seed() -> None:
    rec = building_record(fp(roof_rise=2.0), {'roof:shape': 'gabled'})
    assert rec[:5] == [120, 0, CITY, 20, GABLED_ROOF]
    assert rec[5:7] == [0, 0]
    assert building_record(fp(), {})[3:5] == [0, FLAT_ROOF]
    assert seed_of('BATIMENT1') == seed_of('BATIMENT1') != seed_of('BATIMENT2')


def test_record_head_comes_before_the_outline() -> None:
    # build_roads.py read the outline from the 5th value after the roof shape was added (#131)
    rec = building_record(fp(), {})
    assert rec[RECORD_HEAD:] == [0, 0, 200, 0, 200, 100, 0, 100]
