// @ts-check
import { describe, expect, it } from 'vitest';
import { RoadNetwork, Traffic, classSpeed, idmAcceleration } from '../../src/hd2d/traffic.js';
import { SETTINGS } from './fixtures.js';

const P = SETTINGS.traffic;
const FLAGS = ['oneway', 'oneway_reverse', 'roundabout', 'bridge', 'tunnel'];
const CLASSES = ['busway', 'minor', 'primary', 'secondary', 'service'];

/**
 * Fictitious crossroads: node 1 at (200, 0) m joins a west road (node 0), an east road (node 3) and a north
 * road (node 2); a busway and a tunnel that cars do not use. Coordinates in decimetres.
 * @param {number} [northMask] flags of the north road
 * @returns {import('../../src/common/types.js').RoadsData}
 */
function crossroads(northMask = 0) {
  return {
    attribution: '',
    classes: CLASSES,
    flags: FLAGS,
    nodes: [0, 0, 2000, 0, 2000, 2000, 4000, 0, 0, 2000],
    edges: [
      [0, 1, 1, 60, 0, 0, 0, 0, 1000, 0, 2000, 0],
      [1, 2, 1, 60, 0, northMask, 2000, 0, 2000, 2000],
      [1, 3, 2, 70, 0, 0, 2000, 0, 4000, 0],
      [0, 4, 0, 40, 0, 0, 0, 0, 0, 2000],
      [2, 4, 1, 60, 0, 16, 2000, 2000, 0, 2000],
    ],
  };
}

/** Seeded random numbers. @param {number} seed */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Traffic without spawning, for vehicles placed by hand. @param {RoadNetwork} network */
function quiet(network, change = {}) {
  return new Traffic(network, { ...P, vehicles: 0, ...change }, seeded(3));
}

/**
 * A car placed by hand on a lane.
 * @param {Traffic} traffic @param {number} lane @param {number} s @param {Partial<import('../../src/hd2d/traffic.js').Vehicle>} [more]
 */
function car(traffic, lane, s, more = {}) {
  const v = {
    id: traffic.nextId++,
    bike: false,
    lane,
    s,
    v: 0,
    next: -1,
    desired: 10,
    length: P.carLength,
    width: P.carWidth,
    variant: 0,
    x: 0,
    y: 0,
    h: 0,
    reserved: -1,
    previous: -1,
    ...more,
  };
  traffic.place(v);
  traffic.vehicles.push(v);
  return v;
}

/** Index of the lane from node `a` to node `b`. @param {RoadNetwork} n @param {number} a @param {number} b */
const laneOf = (n, a, b) => n.lanes.findIndex((lane) => lane.from === a && lane.to === b);

/** Run the traffic for `seconds` with the bus far away. @param {Traffic} traffic @param {number} seconds */
function run(
  traffic,
  seconds,
  obstacles = /** @type {import('../../src/hd2d/traffic.js').Obstacle[]} */ ([]),
) {
  for (let k = 0; k < seconds * 20; k++) traffic.update(0.05, { x: 200, y: 0 }, obstacles);
}

describe('classSpeed', () => {
  it('gives the limits of the streets and none to bus ways and service roads', () => {
    expect(classSpeed('minor', P.speeds)).toBeCloseTo(P.speeds.minor / 3.6);
    expect(classSpeed('primary', P.speeds)).toBeCloseTo(P.speeds.primary / 3.6);
    expect(classSpeed('secondary', P.speeds)).toBeCloseTo(P.speeds.secondary / 3.6);
    expect(classSpeed('busway', P.speeds)).toBe(0);
    expect(classSpeed('service', P.speeds)).toBe(0);
  });
});

describe('RoadNetwork', () => {
  it('has one lane per direction of the streets, none on bus ways and tunnels', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    expect(n.lanes).toHaveLength(6);
    expect(n.junctions).toEqual(new Set([1]));
    expect(n.lanes[laneOf(n, 0, 1)].length).toBeCloseTo(200);
  });

  it('keeps one direction on one-way roads', () => {
    expect(new RoadNetwork(crossroads(1), P.speeds).lanes.filter((l) => l.edge === 1)).toMatchObject([
      { from: 1, to: 2, twoWay: false },
    ]);
    expect(new RoadNetwork(crossroads(2), P.speeds).lanes.filter((l) => l.edge === 1)).toMatchObject([
      { from: 2, to: 1 },
    ]);
  });

  it('puts points right of the lane and finds the lanes of an area', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const east = laneOf(n, 0, 1);
    expect(n.pointAt(east, 150, 2)).toEqual({ x: 150, y: -2, h: 0 });
    expect(n.pointAt(laneOf(n, 1, 0), 50, 2).y).toBeCloseTo(2);
    expect(n.lanesNear(200, 0, 10)).toContain(east);
    expect(n.lanesNear(5000, 5000, 10)).toEqual([]);
  });

  it('does not turn back at a junction, only at a dead end', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const random = seeded(1);
    for (let k = 0; k < 20; k++) expect(n.lanes[n.nextLane(laneOf(n, 0, 1), random)].to).not.toBe(0);
    expect(n.lanes[n.nextLane(laneOf(n, 1, 3), random)]).toMatchObject({ from: 3, to: 1 });
  });
});

describe('idmAcceleration', () => {
  it('accelerates on a free road and brakes behind a close stopped vehicle', () => {
    expect(idmAcceleration(0, 10, Infinity, 0, P)).toBeCloseTo(P.acceleration);
    expect(idmAcceleration(10, 10, Infinity, 0, P)).toBeCloseTo(0);
    expect(idmAcceleration(10, 10, 5, 0, P)).toBeLessThan(-P.braking);
  });
});

describe('Traffic', () => {
  it('stops a car behind a stopped one, keeping its distance', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const lane = laneOf(n, 0, 1);
    const leader = car(traffic, lane, 120, { desired: 0 });
    const follower = car(traffic, lane, 20, { v: 10 });
    run(traffic, 30);
    const gap = leader.s - follower.s - P.carLength;
    expect(follower.v).toBeLessThan(0.1);
    expect(gap).toBeGreaterThan(P.minGap * 0.8);
    expect(gap).toBeLessThan(P.minGap * 2);
  });

  it('stops before an obstacle on its path, such as the player bus', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const lane = laneOf(n, 0, 1);
    const c = car(traffic, lane, 20, { v: 8 });
    const bus = { x: 80, y: -1.5, r: 2, v: 0, h: 0 };
    run(traffic, 20, [bus]);
    expect(c.v).toBeLessThan(0.1);
    expect(c.x).toBeLessThan(bus.x - bus.r);
    expect(traffic.hit(c.x, c.y)).toBe(true);
    expect(traffic.hit(c.x, c.y + 5)).toBe(false);
  });

  it('lets one car at a time cross a junction', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const fromWest = car(traffic, laneOf(n, 0, 1), 190, { v: 5, next: laneOf(n, 1, 3) });
    const fromNorth = car(traffic, laneOf(n, 2, 1), 192, { v: 5, next: laneOf(n, 1, 3) });
    run(traffic, 1);
    expect(traffic.reservations.get(1)?.owner).toBe(fromWest.id);
    expect(fromNorth.lane).toBe(laneOf(n, 2, 1));
    run(traffic, 10);
    // the first one has cleared the junction, the second one followed
    expect(fromWest.lane).toBe(laneOf(n, 1, 3));
    expect(fromNorth.lane).toBe(laneOf(n, 1, 3));
    expect(fromWest.s - fromNorth.s).toBeGreaterThan(P.carLength);
  });

  it('gives the junction to the first car of a queue only', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const lane = laneOf(n, 0, 1);
    const front = car(traffic, lane, 197, { desired: 0, next: laneOf(n, 1, 3) });
    const behind = car(traffic, lane, 190, { next: laneOf(n, 1, 3) });
    traffic.leader(behind, traffic.sortByLane(), []);
    expect(traffic.reservations.size).toBe(0);
    traffic.leader(front, traffic.sortByLane(), []);
    expect(traffic.reservations.get(1)?.owner).toBe(front.id);
  });

  it('gives way to the vehicles already on a roundabout', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const ring = laneOf(n, 2, 1);
    n.lanes[ring].roundabout = true;
    n.lanes[laneOf(n, 1, 3)].roundabout = true;
    const traffic = quiet(n);
    const entering = car(traffic, laneOf(n, 0, 1), 191, { v: 3, next: laneOf(n, 1, 3) });
    car(traffic, ring, 192, { v: 3, desired: 3, next: laneOf(n, 1, 3) });
    expect(traffic.reserve(entering, n.lanes[entering.lane])).toBe(false);
  });

  it('passes bikes on a wide road and follows them on a narrow one', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const lane = laneOf(n, 0, 1);
    for (const [width, passes] of /** @type {const} */ ([
      [2 * P.passWidth + 1, true],
      [2 * P.passWidth - 1, false],
    ])) {
      n.lanes[lane].width = width;
      const traffic = quiet(n);
      car(traffic, lane, 60, { bike: true, desired: 4, v: 4, length: P.bikeLength, width: P.bikeWidth });
      const c = car(traffic, lane, 40, { v: 8, next: laneOf(n, 1, 3) });
      const { gap } = traffic.leader(c, traffic.sortByLane(), []);
      expect(gap === Infinity).toBe(passes);
    }
  });

  it('removes a vehicle at the end of a road that leaves the map', () => {
    const n = new RoadNetwork(crossroads(1), P.speeds);
    const traffic = quiet(n);
    // the north road is one-way towards node 2, whose only other road is the tunnel
    car(traffic, laneOf(n, 1, 2), 150, { v: 8 });
    run(traffic, 20);
    expect(traffic.vehicles).toEqual([]);
  });

  it('keeps both axles on the path in a bend, the rear on the road it leaves', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const west = laneOf(n, 0, 1),
      north = laneOf(n, 1, 2);
    const c = car(traffic, north, 0.5, { previous: west });
    const half = (P.carLength * P.wheelbaseShare) / 2;
    const rear = traffic.pathPoint(c, c.s - half),
      front = traffic.pathPoint(c, c.s + half);
    const offset = traffic.offset(c, n.lanes[west]);
    // the car stands between its axles, pointing from the rear one to the front one
    expect(c.x).toBeCloseTo((rear.x + front.x) / 2);
    expect(c.h).toBeCloseTo(Math.atan2(front.y - rear.y, front.x - rear.x));
    // the rear axle is still on the west road (right of it), the front one on the north road
    expect(rear.y).toBeCloseTo(-offset, 1);
    expect(front.x).toBeCloseTo(200 + offset, 1);
    expect(c.h).toBeGreaterThan(0);
    expect(c.h).toBeLessThan(Math.PI / 2);
  });

  it('tells when a moving vehicle is about to drive over a point, or a stopped one waits there', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 100, { v: 8 });
    expect(traffic.approaching(120, -1.5, 30, 6)).toBe(true);
    expect(traffic.approaching(80, -1.5, 30, 6)).toBe(false);
    expect(traffic.approaching(c.x - 3, c.y, 30, 6)).toBe(true);
    expect(traffic.waiting(c.x, c.y, 6)).toBe(false);
    c.v = 0;
    expect(traffic.approaching(120, -1.5, 30, 6)).toBe(false);
    expect(traffic.approaching(c.x - 3, c.y, 30, 6)).toBe(false);
    expect(traffic.waiting(c.x + 3, c.y, 6)).toBe(true);
  });

  it('fills the streets around the bus and empties them when it leaves', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = new Traffic(
      n,
      { ...P, vehicles: 6, density: 100, spawnRadius: 300, despawnRadius: 350 },
      seeded(9),
    );
    traffic.update(0.05, { x: 200, y: 0 }, []);
    expect(traffic.vehicles.length).toBe(6);
    for (const v of traffic.vehicles) expect(Math.hypot(v.x - 200, v.y)).toBeLessThan(310);
    traffic.update(0.05, { x: 5000, y: 5000 }, []);
    expect(traffic.vehicles).toEqual([]);
    expect(traffic.reservations.size).toBe(0);
  });
});

describe('Traffic and the player bus (#95)', () => {
  /** The player's bus as one disc. @param {number} x @param {number} y @param {number} h @param {number} [v] */
  const playerBus = (x, y, h, v = 0) => ({ x, y, r: 2, v, h, priority: true });

  it('keeps a larger gap from the player bus than from another obstacle', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    /** @param {boolean} priority */
    const stopAt = (priority) => {
      const traffic = quiet(n);
      const c = car(traffic, laneOf(n, 0, 1), 20, { v: 8 });
      run(traffic, 20, [{ ...playerBus(80, -1.5, 0), priority }]);
      return c.x;
    };
    expect(stopAt(false) - stopAt(true)).toBeGreaterThan(P.busGap - P.probeStep);
  });

  it('leaves the junction to the moving bus, not to the bus waiting near it', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    for (const [speed, yields] of /** @type {const} */ ([
      [5, true],
      [0, false],
    ])) {
      const traffic = quiet(n);
      const c = car(traffic, laneOf(n, 0, 1), 190, { v: 2, next: laneOf(n, 1, 3) });
      // the bus drives north to the junction from the south
      traffic.leader(c, traffic.sortByLane(), [playerBus(201.5, -15, Math.PI / 2, speed)]);
      expect(traffic.reservations.has(1)).toBe(!yields);
    }
  });

  it('backs off from the bus standing across its way, then is removed if it stays stuck', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 50);
    // the bus faces the car on its half of the road
    const bus = playerBus(70, -1.5, Math.PI);
    let closest = 0;
    for (let k = 0; k < 20 * 20 && !c.backOffs; k++) {
      run(traffic, 0.05, [bus]);
      closest = Math.max(closest, c.s);
    }
    expect(c.backOffs).toBe(1);
    run(traffic, P.backOffDistance / P.backOffSpeed, [bus]);
    expect(closest - c.s).toBeGreaterThan(P.backOffDistance / 2);
    run(traffic, 60, [bus]);
    expect(traffic.vehicles).toEqual([]);
  });

  it('waits behind the stopped bus it follows without backing off', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 50);
    run(traffic, 60, [playerBus(70, -1.5, 0)]);
    expect(c.backOffs).toBeUndefined();
    expect(traffic.vehicles).toEqual([c]);
  });

  it('is removed at once when it has no room to back off', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 3);
    traffic.backOff(c, traffic.sortByLane(), []);
    expect(c.gone).toBe(true);
    const behind = car(traffic, laneOf(n, 0, 1), 20);
    const front = car(traffic, laneOf(n, 0, 1), 20 + P.carLength + 1);
    traffic.backOff(front, traffic.sortByLane(), []);
    expect(front.gone).toBe(true);
    expect(behind.gone).toBeUndefined();
  });

  it('gives way when the driver keeps pushing the bus against its side, not against its rear', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 100, { desired: 0 });
    // the nose of the bus against its back, and the room just before the nose a little into it
    const rear = [
      { x: c.x - P.carLength / 2 - 0.2, y: c.y },
      { x: c.x - P.carLength / 2 + 1, y: c.y + 0.5 },
    ];
    for (let k = 0; k < (P.stuckDelay + 1) * 20; k++) traffic.pushedBy(rear, 0, 0.05);
    expect(c.backing).toBeUndefined();
    const side = [{ x: c.x, y: c.y + P.carWidth / 2 + 0.2 }];
    for (let k = 0; k < (P.stuckDelay + 1) * 20; k++) traffic.pushedBy(side, -Math.PI / 2, 0.05);
    expect(c.backing).toBeGreaterThan(0);
  });

  it('gives way when it got inside the bus, even going the same way', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 100, { desired: 0 });
    const body = [-3, -1.5, 0, 1.5, 3].map((along) => ({ x: c.x + along, y: c.y + 0.4 }));
    for (let k = 0; k < (P.stuckDelay + 1) * 20; k++) traffic.pushedBy(body, 0, 0.05);
    expect(c.backing).toBeGreaterThan(0);
  });

  it('gives way to the bus pushing against its side while driving alongside', () => {
    const n = new RoadNetwork(crossroads(), P.speeds);
    const traffic = quiet(n);
    const c = car(traffic, laneOf(n, 0, 1), 100, { desired: 0 });
    // the side of the bus, heading the same way, touches the rear half of the car
    const side = [{ x: c.x - P.carLength / 4, y: c.y + P.carWidth / 2 + 0.2 }];
    for (let k = 0; k < (P.stuckDelay + 1) * 20; k++) traffic.pushedBy(side, 0, 0.05);
    expect(c.backing).toBeGreaterThan(0);
  });
});

describe('Traffic in built-up areas and in the countryside (#94)', () => {
  /** The crossroads with the west road in a village; the other roads in the countryside. */
  function village() {
    const data = crossroads();
    data.flags = [...data.flags, 'built_up'];
    data.edges[0][5] = 32;
    return new RoadNetwork(data, P.speeds);
  }

  it('tells the lanes of built-up areas, every lane without the flag in the data', () => {
    const n = village();
    expect(n.lanes[laneOf(n, 0, 1)].builtUp).toBe(true);
    expect(n.lanes[laneOf(n, 1, 3)].builtUp).toBe(false);
    const plain = new RoadNetwork(crossroads(), P.speeds);
    expect(plain.lanes.every((lane) => lane.builtUp)).toBe(true);
  });

  it('wants density vehicles per km of lane, fewer in the countryside, at most vehicles', () => {
    const n = village();
    const traffic = new Traffic(n, { ...P, density: 10, ruralShare: 0.25, vehicles: 100 }, seeded(4));
    // 0.4 km of lanes in the village and 0.8 km in the countryside
    expect(traffic.wanted({ x: 200, y: 0 })).toBe(Math.round(10 * (0.4 + 0.25 * 0.8)));
    const capped = new Traffic(n, { ...P, density: 10, ruralShare: 0.25, vehicles: 3 }, seeded(4));
    expect(capped.wanted({ x: 200, y: 0 })).toBe(3);
  });

  it('puts the bikes in built-up areas only, and turns them back at their edge', () => {
    const n = village();
    const traffic = new Traffic(
      n,
      { ...P, vehicles: 40, density: 100, bikeShare: 1, ruralShare: 1, spawnRadius: 300 },
      seeded(5),
    );
    traffic.update(0.05, { x: 200, y: 0 }, []);
    const bikes = traffic.vehicles.filter((v) => v.bike);
    expect(bikes.length).toBeGreaterThan(0);
    for (const bike of bikes) expect(n.lanes[bike.lane].builtUp).toBe(true);
    expect(traffic.vehicles.some((v) => !v.bike)).toBe(true);
    // at the crossroads, the only built-up way out of the village is back
    expect(n.nextLane(laneOf(n, 0, 1), seeded(1), true)).toBe(laneOf(n, 1, 0));
  });
});
