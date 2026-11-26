// @ts-check
import { describe, expect, it } from 'vitest';
import { Pedestrians, Walkways, crossingCentres } from '../../src/hd2d/pedestrians.js';
import { SETTINGS } from './fixtures.js';

const P = SETTINGS.pedestrians;
const SPEEDS = SETTINGS.traffic.speeds;

/**
 * Fictitious streets: west road from node 0 (0, 0) to node 1 (200, 0), 6 m wide, then east (node 3) and north
 * (node 2) roads; a busway without sidewalks. Coordinates in decimetres.
 * @returns {import('../../src/common/types.js').RoadsData}
 */
function streets() {
  return {
    attribution: '',
    classes: ['busway', 'minor', 'primary'],
    flags: ['oneway', 'oneway_reverse', 'roundabout', 'bridge', 'tunnel'],
    nodes: [0, 0, 2000, 0, 2000, 2000, 4000, 0],
    edges: [
      [0, 1, 1, 60, 0, 0, 0, 0, 2000, 0],
      [1, 2, 1, 60, 0, 0, 2000, 0, 2000, 2000],
      [1, 3, 2, 60, 0, 0, 2000, 0, 4000, 0],
      [0, 3, 0, 40, 0, 0, 0, 0, 4000, 0],
    ],
  };
}

/** @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const free = { vehicleComing: () => false, vehicleWaiting: () => false, blocked: () => false };

/**
 * One person placed by hand.
 * @param {Pedestrians} crowd @param {Partial<import('../../src/hd2d/pedestrians.js').Pedestrian>} more
 */
function walker(crowd, more) {
  /** @type {import('../../src/hd2d/pedestrians.js').Pedestrian} */
  const q = {
    id: crowd.nextId++,
    edge: 0,
    s: 10,
    dir: 1,
    side: 1,
    speed: 1.5,
    look: 0,
    state: 'walk',
    t: 0,
    waited: 0,
    lastCrossing: NaN,
    x: 0,
    y: 0,
    ...more,
  };
  crowd.place(q);
  crowd.people.push(q);
  return q;
}

/**
 * @param {Pedestrians} crowd @param {number} seconds
 * @param {import('../../src/hd2d/pedestrians.js').Surroundings} [around]
 */
function run(crowd, seconds, around = free) {
  for (let k = 0; k < seconds * 10; k++) crowd.update(0.1, { x: 200, y: 0 }, around);
}

describe('Walkways', () => {
  it('has the streets with sidewalks, not the bus ways', () => {
    const w = new Walkways(streets(), SPEEDS);
    expect(w.edges).toHaveLength(3);
    expect(w.atNode.get(1)).toEqual([0, 1, 2]);
    expect(w.near(100, 0, 10)).toContain(0);
  });

  it('puts each crossing on the nearest street', () => {
    const w = new Walkways(streets(), SPEEDS);
    w.addCrossings([120, 1, 200, 80, 900, 900], P.crossingReach);
    expect(w.edges[0].crossings).toEqual([120]);
    expect(w.edges[1].crossings[0]).toBeCloseTo(80);
  });
});

describe('crossingCentres', () => {
  it('groups the stripes of a crossing and moves them to the world frame', () => {
    /** @param {number} x @param {number} y */
    const square = (x, y) => [x, y, x + 5, y, x + 5, y + 30, x, y + 30];
    const tiles = new Map([['1_0', { crossings: [square(0, 0), square(10, 0), square(500, 500)] }]]);
    const centres = crossingCentres(tiles, { x0: -100, y0: 50, size: 500 }, P.crossingGather);
    expect(centres).toHaveLength(4);
    expect(centres[0]).toBeCloseTo(400 + 0.75);
    expect(centres[1]).toBeCloseTo(50 + 1.5);
  });
});

describe('Pedestrians', () => {
  it('walks along the right sidewalk, away from the carriageway', () => {
    const w = new Walkways(streets(), SPEEDS);
    const crowd = new Pedestrians(w, { ...P, count: 0 }, 4, seeded(1));
    const q = walker(crowd, {});
    run(crowd, 10);
    expect(q.s).toBeCloseTo(10 + 15);
    expect(q.y).toBeCloseTo(-(3 + P.sidewalkOffset));
  });

  it('turns into another street at a junction', () => {
    const w = new Walkways(streets(), SPEEDS);
    const crowd = new Pedestrians(w, { ...P, count: 0 }, 4, seeded(2));
    const q = walker(crowd, { s: 195 });
    run(crowd, 5);
    expect(q.edge).not.toBe(0);
  });

  it('turns back only at a dead end', () => {
    const w = new Walkways(streets(), SPEEDS);
    const crowd = new Pedestrians(w, { ...P, count: 0 }, 4, seeded(6));
    const q = walker(crowd, { edge: 2, s: 198 });
    run(crowd, 3);
    expect(q.edge).toBe(2);
    expect(q.dir).toBe(-1);
  });

  it('waits for the vehicles at a crossing, then crosses to the other sidewalk', () => {
    const w = new Walkways(streets(), SPEEDS);
    w.addCrossings([100, 0], P.crossingReach);
    const crowd = new Pedestrians(w, { ...P, count: 0, crossChance: 1 }, 4, seeded(3));
    const q = walker(crowd, { s: 95 });
    let coming = true;
    const around = { vehicleComing: () => coming, vehicleWaiting: () => false, blocked: () => false };
    run(crowd, 5, around);
    expect(q.state).toBe('wait');
    expect(q.s).toBe(100);
    expect(crowd.obstacles()).toEqual([]);
    coming = false;
    run(crowd, 2, around);
    expect(q.state).toBe('cross');
    expect(crowd.obstacles()).toHaveLength(1);
    run(crowd, 10, around);
    expect(q.state).toBe('walk');
    expect(q.side).toBe(-1);
    expect(q.y).toBeGreaterThan(0);
  });

  it('gets impatient: after a while only waits for the vehicles very close', () => {
    const w = new Walkways(streets(), SPEEDS);
    w.addCrossings([100, 0], P.crossingReach);
    const crowd = new Pedestrians(w, { ...P, count: 0, crossChance: 1 }, 4, seeded(8));
    const q = walker(crowd, { s: 99 });
    /** @type {boolean[]} */
    const asked = [];
    const around = {
      vehicleComing: (
        /** @type {number} */ _x,
        /** @type {number} */ _y,
        /** @type {boolean} */ impatient,
      ) => {
        asked.push(impatient);
        return !impatient;
      },
      vehicleWaiting: () => false,
      blocked: () => false,
    };
    run(crowd, P.patience + 2, around);
    expect(asked[0]).toBe(false);
    expect(q.state).not.toBe('wait');
  });

  it('lets the waiting vehicles go between groups of people crossing', () => {
    const w = new Walkways(streets(), SPEEDS);
    w.addCrossings([100, 0], P.crossingReach);
    const crowd = new Pedestrians(w, { ...P, count: 0, crossChance: 1 }, 4, seeded(7));
    const around = { vehicleComing: () => false, vehicleWaiting: () => true, blocked: () => false };
    const first = walker(crowd, { s: 99 });
    const friend = walker(crowd, { s: 99.5 });
    run(crowd, 1, around);
    // people arriving together cross together
    expect(first.state).toBe('cross');
    expect(friend.state).toBe('cross');
    run(crowd, P.crossingGroup, around);
    const late = walker(crowd, { s: 99, dir: 1 });
    run(crowd, 1, around);
    expect(late.state).toBe('wait');
    run(crowd, P.crossingRest, around);
    expect(late.state).not.toBe('wait');
  });

  it('stops before an obstacle on the sidewalk', () => {
    const w = new Walkways(streets(), SPEEDS);
    const crowd = new Pedestrians(w, { ...P, count: 0 }, 4, seeded(4));
    const q = walker(crowd, {});
    run(crowd, 3, { vehicleComing: () => false, vehicleWaiting: () => false, blocked: () => true });
    expect(q.s).toBe(10);
  });

  it('fills the sidewalks around the bus and empties them when it leaves', () => {
    const w = new Walkways(streets(), SPEEDS);
    const crowd = new Pedestrians(w, { ...P, count: 8 }, 4, seeded(5));
    for (let k = 0; k < 5; k++) crowd.update(0.1, { x: 200, y: 0 }, free);
    expect(crowd.people.length).toBe(8);
    for (const q of crowd.people) expect(Math.hypot(q.x - 200, q.y)).toBeLessThanOrEqual(P.despawnRadius);
    crowd.update(0.1, { x: 9000, y: 9000 }, free);
    expect(crowd.people).toEqual([]);
  });
});
