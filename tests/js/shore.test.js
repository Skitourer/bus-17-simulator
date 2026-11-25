// @ts-check
import { describe, expect, it } from 'vitest';
import { ShoreIndex, segmentDistance } from '../../src/hd2d/shore.js';

describe('segmentDistance', () => {
  it('measures to the nearest point of the segment', () => {
    expect(segmentDistance([0, 0, 10, 0], 5, 3)).toBeCloseTo(3);
    expect(segmentDistance([0, 0, 10, 0], -4, 3)).toBeCloseTo(5);
    expect(segmentDistance([0, 0, 10, 0], 13, -4)).toBeCloseTo(5);
    expect(segmentDistance([2, 2, 2, 2], 5, 6)).toBeCloseTo(5);
  });
});

describe('ShoreIndex', () => {
  // a bank along y = 0 from x = 0 to 100, then up to (100, 50)
  const index = new ShoreIndex([[0, 0, 50, 0, 100, 0, 100, 50]], 8);

  it('gives the distance to the nearest bank', () => {
    expect(index.distance(30, 2)).toBeCloseTo(2);
    expect(index.distance(97, 20)).toBeCloseTo(3);
    expect(index.distance(-3, -4)).toBeCloseTo(5);
  });

  it('caps the distance far from any bank', () => {
    expect(index.distance(30, 7.9)).toBeCloseTo(7.9);
    expect(index.distance(30, 20)).toBe(8);
    expect(new ShoreIndex([], 5).distance(0, 0)).toBe(5);
  });
});
