// @ts-check
import { describe, expect, it } from 'vitest';
import { SegmentGrid, kerbSegments, laneOffsets, offsetAt, placeStops, rayHit } from '../../src/hd2d/kerb.js';
import { leftTurnTrack, straightTrack } from './fixtures.js';

const params = { kerbSearch: 12, shelterSetback: 1, laneOffset: 1.8, bodyWidth: 2.5 };
/** @param {number[][]} segments */
const grid = (segments) => new SegmentGrid(segments, 16);

describe('rayHit', () => {
  const wall = [[-10, -4, 10, -4]];

  it('finds the nearest crossed segment within reach', () => {
    expect(rayHit(0, 0, 0, -1, [...wall, [-10, -7, 10, -7]], 0.5, 12)).toBeCloseTo(4);
  });

  it('ignores segments too close, too far, behind, parallel or missed', () => {
    expect(rayHit(0, 0, 0, -1, [[-10, -0.2, 10, -0.2]], 0.5, 12)).toBeNull();
    expect(rayHit(0, 0, 0, -1, wall, 0.5, 3)).toBeNull();
    expect(rayHit(0, 0, 0, 1, wall, 0.5, 12)).toBeNull();
    expect(rayHit(0, 0, 1, 0, wall, 0.5, 12)).toBeNull();
    expect(rayHit(20, 0, 0, -1, wall, 0.5, 12)).toBeNull();
  });
});

describe('kerbSegments', () => {
  it('converts tile decimetres to world metres from the tile origin', () => {
    const tiles = new Map([['1_2', { kerbs: [[0, 0, 100, 0, 100, 50]] }]]);
    expect(kerbSegments(tiles, { x0: -1000, y0: 500, size: 500 })).toEqual([
      [-500, 1500, -490, 1500],
      [-490, 1500, -490, 1505],
    ]);
  });
});

describe('placeStops', () => {
  it('moves a stop on the carriageway to the kerb on the right, shelter on the sidewalk', () => {
    const track = straightTrack(200); // heading east: right is south (-y)
    track.stops[1].y = -1; // GTFS point on the road
    const [, middle] = placeStops(track, grid([[0, -4.2, 200, -4.2]]), params);
    expect(middle.kerb).toBe(true);
    expect(middle.x).toBeCloseTo(100);
    expect(middle.y).toBeCloseTo(-4.2);
    expect(middle.shelterY).toBeCloseTo(-5.2);
    expect(middle.h).toBeCloseTo(0);
  });

  it('uses the kerb on the right of the direction of travel, not the left one', () => {
    const track = straightTrack(200);
    const sides = [
      [0, 5, 200, 5],
      [0, -3.5, 200, -3.5],
    ];
    const [, middle] = placeStops(track, grid(sides), params);
    expect(middle.y).toBeCloseTo(-3.5);
  });

  it('follows the route heading in a curve', () => {
    const track = leftTurnTrack(50);
    track.stops = [{ name: 'Virage', commune: 'Ville', s: 40, off: 0, x: 0, y: 0, t: 0 }];
    // circle of radius 50 + 4 around the centre of the turn (0, 50): the kerb on the outside
    const ring = Array.from({ length: 64 }, (_, k) => {
      const a = (k / 64) * Math.PI * 2,
        b = ((k + 1) / 64) * Math.PI * 2;
      return [54 * Math.sin(a), 50 - 54 * Math.cos(a), 54 * Math.sin(b), 50 - 54 * Math.cos(b)];
    });
    const [place] = placeStops(track, grid(ring), params);
    expect(Math.hypot(place.x, place.y - 50)).toBeCloseTo(54, 0);
    expect(Math.hypot(place.shelterX, place.shelterY - 50)).toBeCloseTo(55, 0);
  });

  it('keeps the GTFS distance without a kerb, but never under the side of the bus', () => {
    const track = straightTrack(200);
    track.stops[0].y = -5;
    track.stops[1].y = -1;
    const [first, middle] = placeStops(track, grid([]), params);
    expect(first.kerb).toBe(false);
    expect(first.y).toBeCloseTo(-5);
    expect(middle.y).toBeCloseTo(-(1.8 + 1.25));
  });
});

describe('SegmentGrid', () => {
  it('returns each segment near a point once, and nothing far away', () => {
    const long = [0, 0, 100, 0];
    const kerbs = grid([long, [500, 500, 510, 500]]);
    expect(kerbs.near(50, 3, 12)).toEqual([long]);
    expect(kerbs.near(0, 0, 40)).toEqual([long]);
    expect(kerbs.near(300, 300, 12)).toEqual([]);
  });
});

describe('laneOffsets', () => {
  const lanes = { kerbSearch: 12, laneOffset: 1.8, bodyWidth: 2.5, kerbMargin: 0.3 };

  it('keeps the usual offset in a wide street and moves to the centre line in a narrow one', () => {
    const track = straightTrack(400);
    // kerb 4 m to the right up to x = 200, then 2 m (one-way street)
    const profile = laneOffsets(
      track,
      grid([
        [0, -4, 200, -4],
        [200, -2, 400, -2],
      ]),
      lanes,
    );
    expect(profile).toHaveLength(track.n);
    expect(offsetAt(profile, track.step, 50)).toBeCloseTo(1.8);
    expect(offsetAt(profile, track.step, 300)).toBeCloseTo(2 - 1.25 - 0.3);
    // already moving before the narrowing, never after it
    expect(offsetAt(profile, track.step, 199)).toBeLessThan(1.8);
    expect(offsetAt(profile, track.step, 230)).toBeCloseTo(0.45);
  });

  it('bridges the junctions without kerb, and keeps the usual offset without any kerb', () => {
    const track = straightTrack(200);
    const profile = laneOffsets(
      track,
      grid([
        [0, -2.5, 80, -2.5],
        [120, -4, 200, -4],
      ]),
      lanes,
    );
    expect(offsetAt(profile, track.step, 100)).toBeCloseTo(0.95);
    expect(offsetAt(profile, track.step, 180)).toBeCloseTo(1.8);
    expect(offsetAt(laneOffsets(track, grid([]), lanes), track.step, 100)).toBeCloseTo(1.8);
  });
});

describe('offsetAt', () => {
  it('interpolates between points and clamps at the ends', () => {
    const profile = new Float64Array([0, 1, 3]);
    expect(offsetAt(profile, 2, 1)).toBeCloseTo(0.5);
    expect(offsetAt(profile, 2, 3)).toBeCloseTo(2);
    expect(offsetAt(profile, 2, -5)).toBe(0);
    expect(offsetAt(profile, 2, 50)).toBe(3);
    expect(offsetAt(new Float64Array([1.2]), 2, 7)).toBe(1.2);
  });
});
