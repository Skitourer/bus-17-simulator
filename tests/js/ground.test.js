// @ts-check
import { describe, expect, it } from 'vitest';
import { Ground, deckFromRecord, deckHeight, insideRings } from '../../src/hd2d/ground.js';
import { SETTINGS, tiltedTerrain } from './fixtures.js';

/** One 20 m tile with a 10 m grid: heights (m) given row by row from the south. */
function oneTile(
  /** @type {number[]} */ metres,
  /** @type {number[][]} */ bridges = [],
  /** @type {number[]} */ waterMetres = [],
  /** @type {number[][][]} */ water = [],
) {
  /** @type {import('../../src/hd2d/ground.js').TileIndex} */
  const index = { x0: 0, y0: 0, size: 20, step: 10, nx: 1, ny: 1, tiles: ['0_0'] };
  const tiles = new Map([
    [
      '0_0',
      {
        ground: metres.map((m) => m * 10),
        road: [],
        sidewalks: [],
        kerbs: [],
        centre_lines: [],
        crossings: [],
        bridges,
        buildings: [],
        trees: [],
        water,
        water_level: waterMetres.map((m) => m * 10),
        wet: [],
        dry: [],
        banks: [],
      },
    ],
  ]);
  return new Ground(tiltedTerrain(0), index, tiles, SETTINGS.world.deckCatch, 1);
}

/** The data of the only tile of a ground made by oneTile. @param {Ground} ground */
function tileData(ground) {
  return {
    ground: Array.from(/** @type {Float32Array} */ (ground.grids.get('0_0')), (m) => Math.round(m * 10)),
    road: [],
    sidewalks: [],
    kerbs: [],
    centre_lines: [],
    crossings: [],
    bridges: [],
    buildings: [],
    trees: [],
    water: [],
    water_level: [],
    wet: [],
    dry: [],
    banks: [],
  };
}

describe('Ground', () => {
  it('interpolates on the two triangles of each cell, like the mesh', () => {
    // cell (0, 0): a = 0, b = 10, c = 0, d = 0 -> the diagonal a-d separates the triangles
    const ground = oneTile([0, 10, 0, 0, 0, 0, 0, 0, 0]);
    expect(ground.h(0, 0)).toBeCloseTo(0);
    expect(ground.h(10, 0)).toBeCloseTo(10);
    expect(ground.h(7, 3)).toBeCloseTo(4); // triangle a-b-d: 10 * (tx - ty)
    expect(ground.h(3, 7)).toBeCloseTo(0); // triangle a-d-c
    expect(ground.h(19.99, 19.99)).toBeCloseTo(0); // north-east corner (20, 20 belongs to the next tile)
  });

  it('falls back to the natural terrain outside the tiles', () => {
    const ground = oneTile([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(ground.h(10, 10)).toBeCloseTo(5);
    expect(ground.h(-50, 10)).toBeCloseTo(200);
    expect(ground.inFine(10, 10)).toBe(true);
    expect(ground.inFine(-50, 10)).toBe(false);
    expect(ground.bounds).toEqual({ x0: 0, y0: 0, x1: 20, y1: 20 });
  });

  it('gives the water level on the same triangles, and none without water', () => {
    const ground = oneTile([5, 5, 5, 5, 5, 5, 5, 5, 5], [], [0, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(ground.waterLevel(7, 3)).toBeCloseTo(0.8);
    expect(ground.waterLevel(-50, 10)).toBeNull();
    expect(oneTile([5, 5, 5, 5, 5, 5, 5, 5, 5]).waterLevel(10, 10)).toBeNull();
  });

  it('keeps a vehicle on a deck within reach even when the ground below is closer', () => {
    // deck at 1 m over flat ground at 0 m: the ground under a bridge often runs close to the deck at its ends
    const deck = [40, 0, 100, 10, 200, 100, 10];
    const ground = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0], [deck]);
    expect(ground.surface(10, 10, 0.2)).toBeCloseTo(1);
    expect(ground.surface(10, 18, 0.2)).toBeCloseTo(0); // beside the deck
  });

  it('gives the highest deck at a point, none beside the decks', () => {
    const low = [40, 0, 100, 10, 200, 100, 10],
      high = [40, 100, 0, 60, 100, 200, 60];
    const ground = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0], [low, high]);
    expect(ground.deckAt(10, 10)).toBeCloseTo(6);
    expect(ground.deckAt(2, 10)).toBeCloseTo(1);
    expect(ground.deckAt(2, 2)).toBeNull();
  });

  it('gives the terrace height on a terrace and the ground grid beside and below it (#108)', () => {
    // terrace 4 m wide along y = 10, from 3 m at x = 0 to 5 m at x = 20, over flat ground at 0 m
    const tile = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const ground = new Ground(
      tiltedTerrain(0),
      tile.index,
      new Map([['0_0', { ...tileData(tile), terraces: [[40, 0, 100, 30, 200, 100, 50]] }]]),
      SETTINGS.world.deckCatch,
      1,
    );
    expect(ground.h(10, 10)).toBeCloseTo(4);
    expect(ground.h(10, 11.9)).toBeCloseTo(4);
    expect(ground.h(10, 12.5)).toBeCloseTo(0); // beside the terrace
    expect(ground.gridHeight(10, 10)).toBeCloseTo(0);
    expect(ground.surface(10, 10, 0)).toBeCloseTo(4); // whatever the height of the vehicle
    expect(ground.terraceHeight(-50, 10)).toBeNull();
  });

  it('drives an underpass floor near its height, the street above it otherwise (#86)', () => {
    // floor 4 m wide along y = 10 at -6 m, under flat ground at 0 m
    const tile = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const ground = new Ground(
      tiltedTerrain(0),
      tile.index,
      new Map([['0_0', { ...tileData(tile), tunnels: [[7, 40, 0, 100, -60, 200, 100, -60]] }]]),
      SETTINGS.world.deckCatch,
      1,
    );
    expect([...ground.tunnelEdges]).toEqual([7]);
    expect(ground.tunnelAt(10, 10)).toBeCloseTo(-6);
    expect(ground.tunnelAt(10, 15)).toBeNull();
    expect(ground.surface(10, 10, -5.5)).toBeCloseTo(-6);
    expect(ground.surface(10, 10, 0)).toBeCloseTo(0);
    expect(ground.h(10, 10)).toBeCloseTo(0);
  });

  it('finds the water pieces by ground triangle', () => {
    // piece (0, 0) (10, 0) (10, 5) in the first triangle of cell 0, and the whole second triangle of cell 3
    const pieces = [[[0, 0, 100, 0, 100, 50]], [[100, 100, 200, 200, 100, 200]]];
    const ground = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0], [], [], pieces);
    expect(ground.inWater(8, 2)).toBe(true);
    expect(ground.inWater(8, 7)).toBe(false); // same triangle, outside the piece
    expect(ground.inWater(2, 8)).toBe(false); // second triangle of the cell, dry
    expect(ground.inWater(12, 18)).toBe(true);
    expect(ground.inWater(18, 12)).toBe(false);
    expect(ground.inWater(-5, 5)).toBe(false); // outside the tiles
  });

  it('lets a vehicle cross the water only on a bridge deck', () => {
    // cell 0 fully under water (both triangles)
    const water = [[[0, 0, 100, 0, 100, 100]], [[0, 0, 100, 100, 0, 100]]];
    const deck = [40, 0, 20, 80, 200, 20, 80]; // 4 m wide at 8 m along y = 2
    const ground = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0], [deck], [], water);
    expect(ground.waterBlocks(5, 2, 0)).toBe(true); // at the water level
    expect(ground.waterBlocks(5, 2, 8)).toBe(false); // on the deck
    expect(ground.waterBlocks(5, 4.5, 8)).toBe(false); // over the side, within the 1 m margin
    expect(ground.waterBlocks(5, 8, 8)).toBe(true); // off the side of the deck
    expect(ground.waterBlocks(15, 15, 0)).toBe(false); // dry cell
  });

  it('tests points against rings with holes', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10],
      hole = [4, 4, 6, 4, 6, 6, 4, 6];
    expect(insideRings([square], 2, 2)).toBe(true);
    expect(insideRings([square, hole], 5, 5)).toBe(false);
    expect(insideRings([square, hole], 2, 5)).toBe(true);
    expect(insideRings([square], 12, 5)).toBe(false);
  });

  it('measures slopes along a heading', () => {
    const ground = oneTile([0, 1, 2, 0, 1, 2, 0, 1, 2]); // +0.1 m per metre eastwards
    expect(ground.slope(10, 10, 0, 5)).toBeCloseTo(0.1);
    expect(ground.slope(10, 10, Math.PI / 2, 5)).toBeCloseTo(0);
  });

  it('puts a vehicle on a bridge deck only when it is at deck level', () => {
    // a 4 m wide deck at 8 m along y = 10, over flat ground at 0 m
    const deck = [40, 0, 100, 80, 200, 100, 80];
    const ground = oneTile([0, 0, 0, 0, 0, 0, 0, 0, 0], [deck]);
    expect(ground.decks).toHaveLength(1);
    expect(ground.surface(10, 10, 7.5)).toBeCloseTo(8); // driving on the deck
    expect(ground.surface(10, 10, 0.2)).toBeCloseTo(0); // driving under it
    expect(ground.surface(10, 15, 7.5)).toBeCloseTo(0); // beside the deck
    expect(ground.slopeAt(10, 10, 0, 7.5, 2)).toBeCloseTo(0);
  });
});

describe('bridge decks', () => {
  it('interpolates the height along the centreline and checks the width', () => {
    const deck = deckFromRecord([60, 0, 0, 100, 100, 0, 200], 1000, 2000);
    expect(deck.halfWidth).toBe(3);
    expect(deck.box).toEqual([997, 1997, 1013, 2003]);
    expect(deckHeight(deck, 1005, 2000)).toBeCloseTo(15);
    expect(deckHeight(deck, 1005, 2002.9)).toBeCloseTo(15);
    expect(deckHeight(deck, 1005, 2003.5)).toBeNull();
    expect(deckHeight(deck, 900, 2000)).toBeNull();
  });
});
