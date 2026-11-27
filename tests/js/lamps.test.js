// @ts-check
import { describe, expect, it } from 'vitest';
import { BuiltUpStreets, PlaceGrid, placesAlong } from '../../src/hd2d/lamps.js';

describe('placesAlong', () => {
  it('places points every spacing from half a spacing, across the line points', () => {
    expect(placesAlong([[0, 0, 25, 0, 25, 40]], 20)).toEqual([10, 0, 25, 5, 25, 25]);
  });

  it('places nothing on lines shorter than half a spacing', () => {
    expect(
      placesAlong(
        [
          [0, 0, 5, 0],
          [3, 3],
        ],
        20,
      ),
    ).toEqual([]);
  });
});

describe('PlaceGrid', () => {
  it('returns the nearest places first, within the neighbour cells', () => {
    const grid = new PlaceGrid([0, 0, 10, 0, 30, 0, 200, 0], 50);
    expect(grid.nearest(12, 1, 2)).toEqual([
      [10, 0],
      [0, 0],
    ]);
    expect(grid.nearest(12, 1, 10)).toHaveLength(3);
    expect(grid.nearest(-500, 0, 3)).toEqual([]);
  });
});

describe('BuiltUpStreets', () => {
  /**
   * A village street from (0, 0) to (100, 0), 6 m wide, then a country road on to (500, 0); decimetres.
   * @param {string[]} flags @returns {import('../../src/common/types.js').RoadsData}
   */
  const roads = (flags) => ({
    attribution: '',
    classes: ['minor'],
    flags,
    nodes: [0, 0, 1000, 0, 5000, 0],
    edges: [
      [0, 1, 0, 60, 0, 1, 0, 0, 1000, 0],
      [1, 2, 0, 60, 0, 0, 1000, 0, 5000, 0],
    ],
  });

  it('keeps the street lights along the built-up streets only', () => {
    const streets = new BuiltUpStreets(roads(['built_up']), 4);
    // on the kerbs of the village street, beside it but too far, on the country road
    expect(streets.keep([50, 4, 50, -4, 50, 9, 300, 4])).toEqual([50, 4, 50, -4]);
    expect(streets.has(103, 3)).toBe(true);
    expect(streets.has(120, 3)).toBe(false);
  });

  it('keeps every place without built-up areas in the data', () => {
    expect(new BuiltUpStreets(roads(['oneway']), 4).keep([300, 4])).toEqual([300, 4]);
  });
});
