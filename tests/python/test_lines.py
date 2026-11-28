"""Tests of the line patterns and the corridor around the lines (tools/lines.py)."""

from lines import (
    bounds_of,
    corridor,
    departures_by_service,
    network_of,
    overpass_polys,
    routes_xy,
    tiles_in,
    trip_patterns,
)


def trip(trip_id: str, direction: int, service: str = 'WEEK') -> dict[str, str]:
    return {'trip_id': trip_id, 'direction_id': str(direction), 'service_id': service}


def test_trip_patterns_group_by_direction_and_stops_longest_first() -> None:
    trips = [trip('a', 0), trip('b', 0), trip('c', 0), trip('d', 1), trip('e', 0)]
    stops = {'a': ['G', 'P'], 'b': ['G', 'P', 'C'], 'c': ['G', 'P'], 'd': ['C', 'P', 'G']}
    patterns = trip_patterns(trips, stops)
    assert [(p.direction, p.stop_ids) for p in patterns] == [
        (0, ('G', 'P', 'C')),
        (0, ('G', 'P')),
        (1, ('C', 'P', 'G')),
    ]
    assert [t['trip_id'] for t in patterns[1].trips] == ['a', 'c']
    assert patterns[1].reference['trip_id'] == 'a'  # trip 'e' has no stop times: left out


def test_trip_patterns_order_equal_lengths_by_frequency() -> None:
    trips = [trip('a', 0), trip('b', 0), trip('c', 0)]
    stops = {'a': ['G', 'X'], 'b': ['G', 'Y'], 'c': ['G', 'Y']}
    assert [p.stop_ids for p in trip_patterns(trips, stops)] == [('G', 'Y'), ('G', 'X')]


def test_departures_by_service_are_sorted() -> None:
    trips = [trip('a', 0), trip('b', 0, 'SAT'), trip('c', 0)]
    first = {'a': '10:00', 'b': '09:00', 'c': '07:30'}
    assert departures_by_service(trips, first) == {'WEEK': ['07:30', '10:00'], 'SAT': ['09:00']}


def test_routes_xy_and_bounds() -> None:
    line = {'routes': [{'pts': [0, 0, 200, 10, 5, 201]}, {'pts': [-3, 8, 200]}]}
    routes = routes_xy(line)
    assert routes == [[(0, 0), (10, 5)], [(-3, 8)]]
    assert bounds_of(routes) == (-3, 0, 10, 8)


def test_tiles_in_keeps_the_tiles_of_the_corridor_only() -> None:
    # a route along y = 50 from x = 0 to 250, 30 m corridor, 100 m tiles on a 4 x 3 grid
    area = corridor([[(0.0, 50.0), (250.0, 50.0)]], 30.0)
    assert tiles_in(area, 0, 0, 4, 3, 100) == [(0, 0), (1, 0), (2, 0)]
    wide = corridor([[(0.0, 50.0), (250.0, 50.0)]], 60.0)
    assert tiles_in(wide, 0, 0, 4, 3, 100) == [(0, 0), (1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1)]


def test_overpass_polys_one_filter_per_part_in_lat_lon() -> None:
    def to_ll(x: float, y: float) -> tuple[float, float]:
        return (45 + y / 1000, 5 + x / 1000)

    area = corridor([[(0.0, 0.0), (100.0, 0.0)], [(1000.0, 0.0), (1100.0, 0.0)]], 10.0)
    polys = overpass_polys(area, to_ll, 1.0)
    assert len(polys) == 2
    values = [float(v) for v in polys[0].split()]
    assert all(44.98 <= la <= 45.02 for la in values[0::2])


def test_network_of_keeps_one_point_in_every_and_the_last() -> None:
    pts = [v for k in range(5) for v in (k * 2.0, 0.0, 200.0)]
    line = {
        'id': '17',
        'color': '#33A457',
        'step': 2.0,
        'calendar': {'S': {'days': '1111100', 'start': '20261124', 'end': '20261218'}},
        'routes': [
            {
                'pts': pts,
                'stops': [{'name': 'A', 's': 0.0, 't': 0}, {'name': 'B', 's': 8.0, 't': 60}],
                'services': {'S': ['06:35']},
            }
        ],
    }
    network = network_of([line], 3)
    assert network['step'] == 6.0
    route = network['lines'][0]['routes'][0]
    assert route['xy'] == [0.0, 0.0, 6.0, 0.0, 8.0, 0.0]
    assert route['stops'] == [0.0, 0, 8.0, 60]
    assert network['lines'][0]['color'] == '#33A457'
