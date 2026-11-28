"""Builds data/grenoble/tiles/: 500 m tiles of ground shaped by the roads, carriageway outlines and bridges.

Usage:  uv run python tools/build_streets.py      (after build_terrain.py and build_roads.py)
Geometry: see tools/streets.py and ADR 0003. All coordinates in decimetres.

  tiles/index.json  { "x0", "y0", "size": 500, "step": 5, "nx", "ny", "tiles": ["i_j", ...] }   tile (i, j)
                    covers [x0 + i size, x0 + (i+1) size] x [y0 + j size, y0 + (j+1) size]; only the tiles
                    of the corridor around the lines exist (tools/lines.py, ADR 0010)
  tiles/t_i_j.json  { "ground": [z, ...]          (n x n heights, row by row from south, n = size/step + 1),
                      "road": [[ring, hole, ...], ...]   (carriageway cut along the ground triangles;
                                                         rings [x, y, ...] relative to the tile origin),
                      "bridges": [[width, x, y, z, x, y, z, ...], ...] (x, y relative to the tile origin),
                      "terraces": [[width, x, y, z, ...], ...]   (roads held up by a retaining wall above a
                                  lower road, like "bridges"; see tools/terraces.py),
                      "sidewalks": [[ring, ...], ...]   (like "road"),
                      "kerbs": [[x, y, ...], ...]   (carriageway outline along sidewalks),
                      "centre_lines": [[x, y, ...], ...]   (dashed, stopped before junctions),
                      "crossings": [[x, y, x, y, x, y, x, y], ...]   (zebra stripes),
                      "buildings": [[height, kind, style, roof_rise, roof_shape, x, y, ...], ...]   (see
                                         build_buildings.py; clipped off the carriageway, CCW),
                      "lintels": [[height, kind, style, 0, 0, base, x, y, ...], ...]   (parts of buildings
                                  over a passage, drawn from `base` above the ground to `height`),
                      "portals": [[x, y, heading, width], ...]   (tunnel mouths; heading into the tunnel
                                                                  in milliradians),
                      "trees": [x, y, ...]   (OSM and seeded, off roads and buildings),
                      "water": [[ring, ...], ...]   (water areas cut along the ground triangles, like "road"),
                      "water_level": [z, ...]   (n x n water surface, like "ground"; [] without water),
                      "wet": [k, ...]   (ground triangles under water, not drawn: k < (n-1)^2 is the first
                                         triangle of cell k, else the second of cell k - (n-1)^2),
                      "dry": [[ring, ...], ...]   (dry parts of the wet triangles, drawn instead of them),
                      "banks": [[x, y, ...], ...]   (water edges, where quay walls stand) }
Water: see tools/water.py and ADR 0005.
"""

import glob
import math
import os
from collections import defaultdict
from typing import Any

import numpy as np
from geo import Point
from lines import corridor, read_lines, routes_xy, tiles_in
from overpasses import crossings as bridge_crossings
from overpasses import separate_levels
from shapely import LineString, MultiLineString, MultiPoint, MultiPolygon, Polygon, box, union_all
from shapely import Point as ShapelyPoint
from shapely.geometry.base import BaseGeometry
from shapes import FloatArray, clip, coordinates, distances, interpolate, points, polygon_parts
from sources import CACHE, ROOT, read_json, write_json
from streets import (
    BUILDING_CLEARANCE,
    PASSAGE_CLEARANCE,
    PROFILE_STEP,
    TREE_CLEARANCE,
    Profile,
    RoadEdge,
    RoadHeights,
    TerrainGrid,
    carriageway,
    centre_lines,
    clear_trees,
    clip_building,
    crossings,
    flat_vertices,
    junction_radii,
    keep_out_zone,
    kerb_lines,
    lintels,
    load_edges,
    passage_zone,
    rings_of,
    road_cross_slopes,
    road_pieces,
    road_profiles,
    sample_positions,
    seeded_trees,
    shaped_ground,
    sidewalk_zone,
    tunnel_portals,
)
from terraces import BELOW_REACH, footprint, split_edges, terrace_record, terrace_runs, terraced_ground
from water import shore_lines, water_area, water_cut, water_level

DATA = os.path.join(ROOT, 'data', 'grenoble')
OUT = os.path.join(DATA, 'tiles')
TILE = 500  # m (keeps every tile file under the 1 MB pre-commit limit)
STEP = 5  # m between ground heights (#92: closer than the hairpins and stacked roads of the hillsides)
TREE_SEED = 5
# m/m: the cross slope reported by the build check; French roads have a 2.5 % cross fall, up to 7 % of
# superelevation in bends (SETRA, ARP 1994), so a steeper triangle under a road is a defect (#76)
CROSS_SLOPE_MAX = 0.07
JUNCTION_MARGIN = 10.0  # m around a junction where the slope of a side street is no cross slope
ROUTE_REACH = 6.0  # m from the route of a line: the triangle is under the bus
TERRACE_JUNCTION_MARGIN = 2.0  # m around a junction surface kept free of terraces (#108)


def dm(v: float) -> int:
    return round(v * 10)


def bridge_record(e: RoadEdge, prof: Profile, ox: float, oy: float) -> list[int]:
    line = LineString(e.coords)
    s = sample_positions(line.length, PROFILE_STEP)
    xs, ys = coordinates(interpolate(line, s))
    rec = [dm(e.width)]
    for x, y, si in zip(xs, ys, s, strict=True):
        rec += [dm(float(x) - ox), dm(float(y) - oy), dm(prof.at(float(si)))]
    return rec


type TileKey = tuple[int, int]


def tile_of(x: float, y: float, bx0: float, by0: float) -> TileKey:
    return int((x - bx0) // TILE), int((y - by0) // TILE)


def flat_dm(coords: list[Point], ox: float, oy: float) -> list[int]:
    return [v for x, y in coords for v in (dm(x - ox), dm(y - oy))]


def group_by_tile(
    shapes: list[tuple[list[Point], bool]], bx0: float, by0: float
) -> dict[TileKey, list[list[Point]]]:
    """Shapes grouped by the tile of their first point (lines) or of their centre (polygons)."""
    out: defaultdict[TileKey, list[list[Point]]] = defaultdict(list)
    for coords, is_polygon in shapes:
        x = sum(p[0] for p in coords) / len(coords) if is_polygon else coords[0][0]
        y = sum(p[1] for p in coords) / len(coords) if is_polygon else coords[0][1]
        out[tile_of(x, y, bx0, by0)].append(coords)
    return out


# record head (height, kind, style, roof rise) and ring of each building piece, by tile
type Footprints = defaultdict[TileKey, list[tuple[list[int], list[Point]]]]


def buildings_and_trees(
    data: dict[str, Any],
    polys: dict[str, list[list[float]]],
    surface: BaseGeometry,
    passages: BaseGeometry,
    origin: Point,
) -> tuple[Footprints, Footprints, dict[TileKey, list[Point]]]:
    """Buildings clipped off the carriageway, their parts over passages, and trees cleared of roads and
    buildings, grouped by tile."""
    bx0, by0 = origin
    buildings: Footprints = defaultdict(list)
    over: Footprints = defaultdict(list)
    footprints: list[Polygon] = []
    building_zone = keep_out_zone(surface, BUILDING_CLEARANCE)
    clipped = 0
    for rec in data['b']:
        values = [int(v) for v in rec]
        head, flat = values[:5], values[5:]  # height, kind, style, roof rise, roof shape
        ring = [(flat[k] / 10, flat[k + 1] / 10) for k in range(0, len(flat), 2)]
        for part in lintels(ring, passages, head[0] / 10):
            c = Polygon(part).representative_point()
            # a flat top: the roof of the building does not fit the piece over the passage
            over[tile_of(c.x, c.y, bx0, by0)].append(([*head[:3], 0, 0], part))
        parts = clip_building(ring, building_zone)
        clipped += parts != [ring]
        for part in parts:
            footprints.append(Polygon(part))
            c = Polygon(part).representative_point()
            buildings[tile_of(c.x, c.y, bx0, by0)].append((head, part))
    osm = [(v[k] / 10, v[k + 1] / 10) for v in [data['trees']] for k in range(0, len(v), 2)]
    trees = clear_trees(
        osm + seeded_trees(polys, TREE_SEED), keep_out_zone(surface, TREE_CLEARANCE), footprints
    )
    by_tile: defaultdict[TileKey, list[Point]] = defaultdict(list)
    for x, y in trees:
        by_tile[tile_of(x, y, bx0, by0)].append((x, y))
    print(f'  {len(footprints)} batiments ({clipped} recoupes par la chaussee), {len(trees)} arbres')
    print(f'  {sum(len(v) for v in over.values())} morceaux au-dessus des passages (> {PASSAGE_CLEARANCE} m)')
    return buildings, over, by_tile


def split_pieces(
    zone: Polygon | MultiPolygon, terraces: BaseGeometry, ox: float, oy: float, n: int
) -> list[Polygon]:
    """Pieces of a zone cut along the ground triangles and along the edges of the terraces, so that no piece
    lies both on a terrace and on the ground below it."""
    inside = MultiPolygon(polygon_parts(zone.intersection(terraces)))
    if inside.is_empty:
        return road_pieces(zone, ox, oy, n, STEP)
    outside = MultiPolygon(polygon_parts(zone.difference(terraces)))
    return road_pieces(outside, ox, oy, n, STEP) + road_pieces(inside, ox, oy, n, STEP)


def report_cross_slopes(slopes: list[tuple[float, float, float]], routes: BaseGeometry) -> None:
    """Build check (#76, #108): the road triangles steeper across the road than CROSS_SLOPE_MAX, and those on
    the routes of the lines."""
    steep = sorted((s for s in slopes if s[2] > CROSS_SLOPE_MAX), key=lambda s: -s[2])
    print(f'devers : {len(steep)} triangles de chaussee sur {len(slopes)} au-dela de {CROSS_SLOPE_MAX:.0%}')
    for x, y, slope in steep[:10]:
        print(f'    ({x:7.0f}, {y:7.0f}) {slope:.0%}')
    on_routes = [s for s in steep if routes.distance(ShapelyPoint(s[0], s[1])) < ROUTE_REACH]
    print(f'  dont {len(on_routes)} sur le trajet des lignes')
    for x, y, slope in on_routes[:10]:
        print(f'    ({x:7.0f}, {y:7.0f}) {slope:.0%}')


def tile_grid(ox: float, oy: float, n: int) -> tuple[FloatArray, FloatArray]:
    """x and y of the n x n ground vertices of the tile at (ox, oy), row by row from the south."""
    gx, gy = np.meshgrid(ox + np.arange(n) * STEP, oy + np.arange(n) * STEP)
    return gx.ravel().astype(np.float64), gy.ravel().astype(np.float64)


def near_tile(ox: float, oy: float) -> Polygon:
    """The tile at (ox, oy) and 30 m around it (the roads that shape its ground)."""
    return box(ox - 30, oy - 30, ox + TILE + 30, oy + TILE + 30)


class TerracedRoads:
    """The terraces of the roads (#108) and what shapes the ground without them."""

    def __init__(
        self,
        edges: list[RoadEdge],
        profiles: list[Profile],
        surface: Polygon | MultiPolygon,
        junction_surfaces: BaseGeometry,
        defects: BaseGeometry,
    ) -> None:
        runs = terrace_runs(edges, profiles, junction_surfaces, defects)
        ground_edges, ground_profiles, self.edges, self.profiles = split_edges(edges, profiles, runs)
        self.area = footprint(self.edges)
        self.ground_surface = MultiPolygon(polygon_parts(surface.difference(self.area)))
        self.ground_heights = RoadHeights(ground_edges, ground_profiles)
        self.heights = RoadHeights(self.edges, self.profiles) if self.edges else None
        print(f'  {len(self.edges)} terrasses, {sum(float(p.s[-1]) for p in self.profiles):.0f} m de murs')

    def ground(
        self, xs: FloatArray, ys: FloatArray, shaped: FloatArray, natural: FloatArray, near: Polygon
    ) -> tuple[FloatArray, Polygon | MultiPolygon]:
        """Ground of a tile with its terraces, and the carriageway that lies on the ground there."""
        area = clip(self.area, near)
        local = MultiPolygon(polygon_parts(clip(self.ground_surface, near)))
        if area.is_empty or self.heights is None:
            return shaped, local
        ox, oy = float(xs.min()), float(ys.min())
        n = round(math.sqrt(len(xs)))
        flat = flat_vertices(local, ox, oy, n, STEP)
        without = shaped_ground(xs, ys, natural, local, self.ground_heights, flat)
        pts = points(xs, ys)
        to_roads = np.where(flat, 0.0, distances(local, pts))
        to_terraces = distances(area, pts)
        close = to_terraces < BELOW_REACH
        terrace_z = np.full(len(xs), np.inf)
        terrace_z[close] = self.heights.heights(xs[close], ys[close])
        return terraced_ground(shaped, without, to_roads, to_terraces, terrace_z), local

    def records(self, ox: float, oy: float) -> list[list[int]]:
        """Terrace records of the tile at (ox, oy) (by the centre of each terrace)."""
        return [
            terrace_record(e, p, ox, oy)
            for e, p in zip(self.edges, self.profiles, strict=True)
            if ox <= LineString(e.coords).centroid.x < ox + TILE
            and oy <= LineString(e.coords).centroid.y < oy + TILE
        ]


def main() -> None:
    terrain_data = read_json(os.path.join(DATA, 'terrain.json'))['fine']
    terrain = TerrainGrid(**terrain_data)
    map_data = read_json(os.path.join(DATA, 'map.json'))
    bx0, by0, bx1, by1 = (float(v) for v in map_data['bbox'])
    edges = load_edges(read_json(os.path.join(DATA, 'roads.json')))
    print(f'{len(edges)} troncons : profils en long...')
    profiles = road_profiles(edges, terrain)
    found = bridge_crossings(edges, profiles)
    profiles = separate_levels(edges, profiles)
    print(f'  {len(found)} croisements sous un pont, {sum(c.missing > 0 for c in found)} sans hauteur libre')
    print('chaussee (union des troncons)...')
    surface = carriageway(edges)
    heights = RoadHeights(edges, profiles)
    bridges = [(e, p) for e, p in zip(edges, profiles, strict=True) if e.level == 'bridge']
    print('trottoirs et marquage...')
    sidewalks = sidewalk_zone(edges, surface)
    radii = junction_radii(edges)
    ends = {e.a: e.coords[0] for e in edges} | {e.b: e.coords[-1] for e in edges}
    junctions = union_all([ShapelyPoint(ends[k]).buffer(r + JUNCTION_MARGIN) for k, r in radii.items()])
    slopes: list[tuple[float, float, float]] = []
    marks = group_by_tile([(line, False) for line in centre_lines(edges, radii)], bx0, by0)
    zebras = group_by_tile([(poly, True) for poly in crossings(edges, radii)], bx0, by0)
    kerbs = group_by_tile([(line, False) for line in kerb_lines(surface, sidewalks)], bx0, by0)
    print('batiments et arbres...')
    by_tile_buildings, by_tile_lintels, by_tile_trees = buildings_and_trees(
        read_json(os.path.join(CACHE, 'buildings.json')),
        map_data['polys'],
        surface,
        passage_zone(edges),
        (bx0, by0),
    )
    portals: defaultdict[TileKey, list[tuple[float, float, float, float]]] = defaultdict(list)
    for portal in tunnel_portals(edges):
        portals[tile_of(portal[0], portal[1], bx0, by0)].append(portal)
    print(f'  {sum(len(v) for v in portals.values())} entrees de tunnel')

    nx, ny = math.ceil((bx1 - bx0) / TILE), math.ceil((by1 - by0) / TILE)
    routes = [route for line in read_lines() for route in routes_xy(line)]
    area = corridor(routes)
    kept = tiles_in(area, bx0, by0, nx, ny, TILE)
    print(f'{len(kept)} tuiles sur {nx * ny} dans le couloir des lignes')
    print('eau (niveau et rives)...')
    water = water_area(map_data['polys']['water'], (bx0, by0, bx0 + nx * TILE, by0 + ny * TILE))
    cells = TILE // STEP
    level = water_level(water, terrain.heights, bx0, by0, nx * cells + 1, ny * cells + 1, STEP)
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, 't_*.json')):
        os.remove(old)
    n = TILE // STEP + 1
    print('sol des tuiles...')
    shaped: dict[TileKey, tuple[FloatArray, FloatArray]] = {}
    before: list[tuple[float, float, float]] = []
    for i, j in kept:
        xs, ys = tile_grid(bx0 + i * TILE, by0 + j * TILE, n)
        local = clip(surface, near_tile(bx0 + i * TILE, by0 + j * TILE))
        natural = terrain.heights(xs, ys)
        ground = natural
        if isinstance(local, Polygon | MultiPolygon) and not local.is_empty:
            flat = flat_vertices(local, bx0 + i * TILE, by0 + j * TILE, n, STEP)
            ground = shaped_ground(xs, ys, natural, local, heights, flat)
            before += road_cross_slopes(
                ground, bx0 + i * TILE, by0 + j * TILE, n, STEP, local, heights, junctions
            )
        shaped[(i, j)] = (ground, natural)
    print('terrasses (murs de soutenement)...')
    terraces = TerracedRoads(
        edges,
        profiles,
        surface,
        union_all([ShapelyPoint(ends[k]).buffer(r + TERRACE_JUNCTION_MARGIN) for k, r in radii.items()]),
        MultiPoint([(x, y) for x, y, slope in before if slope > CROSS_SLOPE_MAX]),
    )
    print(f'  avant les terrasses : {sum(s[2] > CROSS_SLOPE_MAX for s in before)} triangles trop en devers')
    for i, j in kept:
        ox, oy = bx0 + i * TILE, by0 + j * TILE
        xs, ys = tile_grid(ox, oy, n)
        near = near_tile(ox, oy)
        local = clip(surface, near)
        ground, natural = shaped[(i, j)]
        if isinstance(local, Polygon | MultiPolygon) and not local.is_empty:
            ground, on_ground = terraces.ground(xs, ys, ground, natural, near)
            slopes += road_cross_slopes(
                ground, ox, oy, n, STEP, on_ground, terraces.ground_heights, junctions
            )
        road = local if isinstance(local, Polygon | MultiPolygon) else Polygon()
        pieces = split_pieces(road, terraces.area, ox, oy, n)
        walk = clip(sidewalks, box(ox, oy, ox + TILE, oy + TILE))
        walk_pieces = (
            split_pieces(walk, terraces.area, ox, oy, n) if isinstance(walk, Polygon | MultiPolygon) else []
        )
        wet, wet_pieces, dry_pieces = water_cut(water, ox, oy, n, STEP)
        tile_level = level[j * cells : j * cells + n, i * cells : i * cells + n].ravel()
        tile_bridges = [
            bridge_record(e, p, ox, oy)
            for e, p in bridges
            if ox <= LineString(e.coords).centroid.x < ox + TILE
            and oy <= LineString(e.coords).centroid.y < oy + TILE
        ]
        write_json(
            os.path.join(OUT, f't_{i}_{j}.json'),
            {
                'ground': [dm(float(z)) for z in ground],
                'road': rings_of(MultiPolygon(pieces), ox, oy) if pieces else [],
                'bridges': tile_bridges,
                'terraces': terraces.records(ox, oy),
                'sidewalks': rings_of(MultiPolygon(walk_pieces), ox, oy) if walk_pieces else [],
                'kerbs': [flat_dm(line, ox, oy) for line in kerbs.get((i, j), [])],
                'centre_lines': [flat_dm(line, ox, oy) for line in marks.get((i, j), [])],
                'crossings': [flat_dm(poly, ox, oy) for poly in zebras.get((i, j), [])],
                'buildings': [
                    [*head, *(v for x, y in ring for v in (dm(x - ox), dm(y - oy)))]
                    for head, ring in by_tile_buildings.get((i, j), [])
                ],
                'lintels': [
                    [
                        *head,
                        dm(PASSAGE_CLEARANCE),
                        *(v for x, y in ring for v in (dm(x - ox), dm(y - oy))),
                    ]
                    for head, ring in by_tile_lintels.get((i, j), [])
                ],
                'portals': [
                    [dm(x - ox), dm(y - oy), round(heading * 1000), dm(width)]
                    for x, y, heading, width in portals.get((i, j), [])
                ],
                'trees': [v for x, y in by_tile_trees.get((i, j), []) for v in (dm(x - ox), dm(y - oy))],
                'water': rings_of(MultiPolygon(wet_pieces), ox, oy) if wet_pieces else [],
                'water_level': [dm(float(z)) for z in tile_level] if wet else [],
                'wet': wet,
                'dry': rings_of(MultiPolygon(dry_pieces), ox, oy) if dry_pieces else [],
                'banks': [flat_dm(line, ox, oy) for line in shore_lines(water, ox, oy, TILE)] if wet else [],
            },
        )
    report_cross_slopes(slopes, MultiLineString(routes))
    write_json(
        os.path.join(OUT, 'index.json'),
        {
            'x0': bx0,
            'y0': by0,
            'size': TILE,
            'step': STEP,
            'nx': nx,
            'ny': ny,
            'tiles': [f'{i}_{j}' for i, j in kept],
        },
    )


if __name__ == '__main__':
    main()
