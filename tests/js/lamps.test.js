// @ts-check
import { describe, expect, it } from 'vitest';
import { PlaceGrid, placesAlong } from '../../src/hd2d/lamps.js';

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
