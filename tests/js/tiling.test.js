// @ts-check
import { describe, expect, it } from 'vitest';
import { buildOrder, rectDistance, tileLevels } from '../../src/hd2d/tiling.js';
import { SETTINGS } from './fixtures.js';

const p = {
  ...SETTINGS.tiles,
  loadRadius: 1000,
  unloadRadius: 1200,
  fineGroundDistance: 500,
  streetDistance: 600,
  treeDistance: 400,
};

describe('rectDistance', () => {
  const rect = { x0: 0, y0: 0, x1: 500, y1: 500 };

  it('is zero inside and measures to the nearest edge or corner outside', () => {
    expect(rectDistance(rect, 250, 250)).toBe(0);
    expect(rectDistance(rect, 600, 250)).toBe(100);
    expect(rectDistance(rect, 250, -40)).toBe(40);
    expect(rectDistance(rect, -30, 540)).toBe(50);
  });
});

describe('tileLevels', () => {
  it('shows more layers the nearer the tile', () => {
    expect(tileLevels(0, p)).toEqual({
      keep: true,
      want: true,
      fineGround: true,
      streets: true,
      trees: true,
    });
    expect(tileLevels(450, p)).toMatchObject({ fineGround: true, streets: true, trees: false });
    expect(tileLevels(550, p)).toMatchObject({ fineGround: false, streets: true });
    expect(tileLevels(800, p)).toMatchObject({ want: true, streets: false });
  });

  it('keeps a built tile a little beyond the load radius, then frees it', () => {
    expect(tileLevels(1100, p)).toMatchObject({ want: false, keep: true });
    expect(tileLevels(1300, p)).toMatchObject({ want: false, keep: false });
  });
});

describe('buildOrder', () => {
  const tiles = [0, 1, 2, 3, 4].map((i) => ({
    key: `${i}_0`,
    rect: { x0: i * 500, y0: 0, x1: i * 500 + 500, y1: 500 },
  }));

  it('builds the wanted tiles that are not built yet, nearest first', () => {
    // the bus in tile 2: tiles 1 and 3 touch it, 0 and 4 are 500 m away, all within 1000 m
    expect(buildOrder(tiles, new Set(['2_0']), 1250, 250, p)).toEqual(['1_0', '3_0', '0_0', '4_0']);
    expect(buildOrder(tiles, new Set(), -1600, 250, p)).toEqual([]);
  });
});
