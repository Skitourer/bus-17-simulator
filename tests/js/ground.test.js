// @ts-check
import { describe, expect, it } from 'vitest';
import { Ground, deckFromRecord, deckHeight } from '../../src/hd2d/ground.js';
import { tiltedTerrain } from './fixtures.js';

/** One 20 m tile with a 10 m grid: heights (m) given row by row from the south. */
function oneTile(/** @type {number[]} */ metres, /** @type {number[][]} */ bridges = []) {
  /** @type {import('../../src/hd2d/ground.js').TileIndex} */
  const index = { x0: 0, y0: 0, size: 20, step: 10, nx: 1, ny: 1 };
  const tiles = new Map([['0_0', { ground: metres.map((m) => m * 10), road: [], bridges }]]);
  return new Ground(tiltedTerrain(0), index, tiles);
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
