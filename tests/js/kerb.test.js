// @ts-check
import { describe, expect, it } from 'vitest';
import { kerbSegments, placeStops, rayHit } from '../../src/hd2d/kerb.js';
import { leftTurnTrack, straightTrack } from './fixtures.js';

const params = { kerbSearch: 12, shelterSetback: 1, laneOffset: 1.8, bodyWidth: 2.5 };

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
    const [, middle] = placeStops(track, [[0, -4.2, 200, -4.2]], params);
    expect(middle.kerb).toBe(true);
    expect(middle.x).toBeCloseTo(100);
    expect(middle.y).toBeCloseTo(-4.2);
    expect(middle.shelterY).toBeCloseTo(-5.2);
    expect(middle.h).toBeCloseTo(0);
  });

  it('uses the kerb on the right of the direction of travel, not the left one', () => {
    const track = straightTrack(200);
    const [, middle] = placeStops(
      track,
      [
        [0, 5, 200, 5],
        [0, -3.5, 200, -3.5],
      ],
      params,
    );
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
    const [place] = placeStops(track, ring, params);
    expect(Math.hypot(place.x, place.y - 50)).toBeCloseTo(54, 0);
    expect(Math.hypot(place.shelterX, place.shelterY - 50)).toBeCloseTo(55, 0);
  });

  it('keeps the GTFS distance without a kerb, but never under the side of the bus', () => {
    const track = straightTrack(200);
    track.stops[0].y = -5;
    track.stops[1].y = -1;
    const [first, middle] = placeStops(track, [], params);
    expect(first.kerb).toBe(false);
    expect(first.y).toBeCloseTo(-5);
    expect(middle.y).toBeCloseTo(-(1.8 + 1.25));
  });
});
