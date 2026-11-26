// @ts-check
import { describe, expect, it } from 'vitest';
import {
  guidanceLanes,
  guidanceLine,
  laneCentre,
  matchRoute,
  offRoadStretches,
} from '../../src/hd2d/guidance.js';
import { SETTINGS, straightTrack, trackFromPoints } from './fixtures.js';

const FLAGS = ['oneway', 'oneway_reverse', 'roundabout', 'bridge', 'tunnel'];
const ONEWAY = 1,
  REVERSE = 2,
  TUNNEL = 16;
const params = { ...SETTINGS.guidance, bodyWidth: 2.55, kerbMargin: 0.3 };

/**
 * Fictitious roads from [a, b, width (m), flag mask, x, y, x, y, ...] in metres.
 * @param {number[][]} edges @returns {import('../../src/common/types.js').RoadsData}
 */
function roads(edges) {
  return {
    attribution: '',
    classes: ['minor'],
    flags: FLAGS,
    nodes: [],
    edges: edges.map(([a, b, width, mask, ...pts]) => [
      a,
      b,
      0,
      width * 10,
      0,
      mask,
      ...pts.map((v) => v * 10),
    ]),
  };
}

/** Route along the given [x, y] corners, one point every 2 m. @param {number[][]} corners */
function routeThrough(corners) {
  const pts = [];
  for (let k = 0; k + 1 < corners.length; k++) {
    const [ax, ay] = corners[k],
      [bx, by] = corners[k + 1];
    const n = Math.round(Math.hypot(bx - ax, by - ay) / 2);
    for (let i = k === 0 ? 0 : 1; i <= n; i++)
      pts.push(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, 0);
  }
  return trackFromPoints(pts, 2);
}

describe('guidanceLanes', () => {
  it('makes one lane per allowed direction and leaves out tunnels', () => {
    const lanes = guidanceLanes(
      roads([
        [0, 1, 6, 0, 0, 0, 100, 0],
        [1, 2, 4, ONEWAY, 100, 0, 200, 0],
        [2, 3, 4, REVERSE, 200, 0, 300, 0],
        [3, 4, 6, TUNNEL, 300, 0, 400, 0],
      ]),
    );
    expect(lanes.map((l) => [l.from, l.to, l.oneway])).toEqual([
      [0, 1, false],
      [1, 0, false],
      [1, 2, true],
      [3, 2, true],
    ]);
    expect([...lanes[1].pts]).toEqual([100, 0, 0, 0]);
    expect(lanes[0].length).toBe(100);
    expect(lanes[0].width).toBe(6);
  });
});

describe('laneCentre', () => {
  const sizes = { laneWidth: 3.25, bodyWidth: 2.55, kerbMargin: 0.3 };

  it('is the middle of the right half of a two-way street', () => {
    expect(laneCentre(6.5, false, sizes)).toBeCloseTo(1.625);
  });

  it('is the outer lane of a wide road', () => {
    expect(laneCentre(14, false, sizes)).toBeCloseTo(5.375);
    expect(laneCentre(9.75, true, sizes)).toBeCloseTo(3.25);
  });

  it('keeps the bus body off the kerb, and never goes left of the centre line', () => {
    expect(laneCentre(4, true, sizes)).toBeCloseTo(0.375);
    expect(laneCentre(4.5, false, sizes)).toBeCloseTo(0.675);
    expect(laneCentre(2, true, sizes)).toBe(0);
  });
});

describe('matchRoute', () => {
  it('matches the lane in the direction of travel, not the opposite one', () => {
    const lanes = guidanceLanes(roads([[0, 1, 6.5, 0, -20, 3, 300, 3]]));
    const { lane, along } = matchRoute(straightTrack(200), lanes, params);
    expect(new Set(lane)).toEqual(new Set([0]));
    expect(along[50]).toBeCloseTo(120);
  });

  it('never takes a one-way road against its direction', () => {
    const lanes = guidanceLanes(roads([[0, 1, 4, ONEWAY, 300, 0, -20, 0]]));
    expect(new Set(matchRoute(straightTrack(100), lanes, params).lane)).toEqual(new Set([-1]));
  });

  it('follows a turn onto the connected road even where the route cuts the corner', () => {
    const lanes = guidanceLanes(
      roads([
        [0, 1, 6.5, 0, 0, 0, 100, 0],
        [1, 2, 6.5, 0, 100, 0, 100, 100],
      ]),
    );
    const track = routeThrough([
      [0, 0],
      [92, 0],
      [100, 8],
      [100, 100],
    ]);
    const { lane } = matchRoute(track, lanes, params);
    const used = [...new Set(lane)];
    expect(used.map((id) => [lanes[id].from, lanes[id].to])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('goes through a short connecting lane', () => {
    const lanes = guidanceLanes(
      roads([
        [0, 1, 6.5, ONEWAY, 0, 0, 100, 0],
        [1, 2, 6.5, ONEWAY, 100, 0, 101, 0],
        [2, 3, 6.5, ONEWAY, 101, 0, 101, 100],
      ]),
    );
    const track = routeThrough([
      [0, 0],
      [101, 0],
      [101, 100],
    ]);
    const { lane } = matchRoute(track, lanes, params);
    expect(lane[0]).toBe(0);
    expect(lane[track.n - 1]).toBe(2);
  });

  it('stays on its road rather than jumping to a parallel one it is not connected to', () => {
    // two parallel roads 7 m apart; the route wanders towards the other one for a few metres
    const lanes = guidanceLanes(
      roads([
        [0, 1, 6.5, ONEWAY, 0, 0, 200, 0],
        [2, 3, 6.5, ONEWAY, 0, 7, 200, 7],
      ]),
    );
    const track = routeThrough([
      [0, 0],
      [96, 0],
      [100, 4],
      [104, 0],
      [200, 0],
    ]);
    expect(new Set(matchRoute(track, lanes, params).lane)).toEqual(new Set([0]));
  });

  it('is off the roads where none is in reach', () => {
    const lanes = guidanceLanes(roads([[0, 1, 6.5, 0, 0, 0, 100, 0]]));
    const track = routeThrough([
      [0, 0],
      [100, 0],
      [200, 0],
    ]);
    const { lane } = matchRoute(track, lanes, params);
    expect(lane[10]).toBe(0);
    expect(lane[track.n - 1]).toBe(-1);
  });
});

describe('guidanceLine', () => {
  it('draws the strip in the right lane of the road, not along the route', () => {
    const lanes = guidanceLanes(roads([[0, 1, 6.5, 0, -20, 2, 300, 2]]));
    const track = straightTrack(200);
    const guide = guidanceLine(track, lanes, new Float64Array(track.n).fill(1.8), params);
    expect(guide.y[50]).toBeCloseTo(2 - 1.625);
    expect(guide.x[50]).toBeCloseTo(100);
    expect(guide.onRoad.every((v) => v === 1)).toBe(true);
  });

  it('keeps the bus lane of the route off the roads', () => {
    const track = straightTrack(100);
    const guide = guidanceLine(track, [], new Float64Array(track.n).fill(1.8), params);
    expect(guide.y[20]).toBeCloseTo(-1.8);
    expect(offRoadStretches(guide.onRoad, track.step)).toEqual([[0, 100]]);
  });
});

describe('offRoadStretches', () => {
  it('lists the stretches without a road, in metres along the route', () => {
    expect(offRoadStretches(Uint8Array.from([1, 0, 0, 1, 1, 0]), 2)).toEqual([
      [2, 4],
      [10, 10],
    ]);
    expect(offRoadStretches(Uint8Array.from([1, 1]), 2)).toEqual([]);
  });
});
