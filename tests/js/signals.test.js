// @ts-check
import { describe, expect, it } from 'vitest';
import {
  RedLightWatch,
  SignalMap,
  approachSpeed,
  lightAt,
  mainAxis,
  mustStop,
  phaseOf,
  routeStopLines,
  stopLineAhead,
} from '../../src/hd2d/signals.js';
import { RoadNetwork, Traffic } from '../../src/hd2d/traffic.js';
import { SETTINGS } from './fixtures.js';

const P = SETTINGS.signals;
const HALF = P.green + P.amber + P.allRed;

/**
 * Fictitious crossroads with lights: node 0 at (0, 0) m, arms 100 m west (1), east (2), north (3) and south
 * (4), two-way minor streets 6 m wide; coordinates in decimetres.
 * @param {number[][]} [signals] @returns {import('../../src/common/types.js').RoadsData}
 */
function crossroads(signals = [[0]]) {
  return {
    attribution: '',
    classes: ['minor'],
    flags: ['oneway', 'oneway_reverse', 'roundabout', 'bridge', 'tunnel'],
    nodes: [0, 0, -1000, 0, 1000, 0, 0, 1000, 0, -1000],
    edges: [
      [1, 0, 0, 60, 0, 0, -1000, 0, 0, 0],
      [0, 2, 0, 60, 0, 0, 0, 0, 1000, 0],
      [3, 0, 0, 60, 0, 0, 0, 1000, 0, 0],
      [0, 4, 0, 60, 0, 0, 0, 0, 0, -1000],
    ],
    signals,
  };
}

/** Lights of the crossroads and the network of its lanes. @param {number[][]} [signals] */
function lights(signals) {
  const roads = crossroads(signals);
  const network = new RoadNetwork(roads, SETTINGS.traffic.speeds);
  return { network, map: new SignalMap(roads, network, P) };
}

/** Lane from node `a` to node `b`. @param {RoadNetwork} network @param {number} a @param {number} b */
const laneOf = (network, a, b) => network.lanes.findIndex((l) => l.from === a && l.to === b);

describe('lightAt', () => {
  it('runs green, amber and red, the two phases in turn with an all-red gap', () => {
    expect(lightAt(0, 0, P)).toBe('green');
    expect(lightAt(P.green + 0.5, 0, P)).toBe('amber');
    expect(lightAt(P.green + P.amber + 0.5, 0, P)).toBe('red');
    expect(lightAt(P.green + P.amber + 0.5, 1, P)).toBe('red');
    expect(lightAt(HALF + 0.5, 1, P)).toBe('green');
    expect(lightAt(HALF + 0.5, 0, P)).toBe('red');
    expect(lightAt(2 * HALF + 0.5, 0, P)).toBe('green');
    expect(lightAt(-0.5, 0, P)).toBe('red');
  });

  it('never shows green to both phases', () => {
    for (let t = 0; t < 2 * HALF; t += 0.25)
      expect([lightAt(t, 0, P), lightAt(t, 1, P)]).not.toEqual(['green', 'green']);
  });
});

describe('mustStop', () => {
  it('goes on green and once past the line', () => {
    expect(mustStop('green', 30, 10, 2, 8)).toBe(false);
    expect(mustStop('red', -1, 0, 2, 8)).toBe(false);
  });

  it('stops on red unless even the hardest braking cannot', () => {
    expect(mustStop('red', 10, 10, 2, 8)).toBe(true);
    expect(mustStop('red', 5, 10, 2, 8)).toBe(false);
    expect(mustStop('red', 0.2, 0, 2, 8)).toBe(true);
  });

  it('stops on amber only with comfortable braking', () => {
    expect(mustStop('amber', 30, 10, 2, 8)).toBe(true);
    expect(mustStop('amber', 10, 10, 2, 8)).toBe(false);
  });
});

describe('phaseOf and mainAxis', () => {
  it('puts both ways of an axis in one phase and the cross street in the other', () => {
    expect(phaseOf(0, 0)).toBe(0);
    expect(phaseOf(Math.PI, 0)).toBe(0);
    expect(phaseOf(Math.PI / 2, 0)).toBe(1);
    expect(phaseOf(-Math.PI / 2 + 0.3, 0)).toBe(1);
  });

  it('takes the direction most approaches run along', () => {
    expect(mainAxis([Math.PI / 2, 0, Math.PI, 0.1])).toBe(0);
    expect(mainAxis([])).toBe(0);
  });
});

describe('SignalMap', () => {
  it('has one approach and one head per lane entering the junction, east-west against north-south', () => {
    const { network, map } = lights();
    expect(map.approaches.size).toBe(4);
    expect(map.heads).toHaveLength(4);
    const fromWest = map.approaches.get(laneOf(network, 1, 0));
    const fromEast = map.approaches.get(laneOf(network, 2, 0));
    const fromNorth = map.approaches.get(laneOf(network, 3, 0));
    expect(fromWest?.phase).toBe(fromEast?.phase);
    expect(fromNorth?.phase).not.toBe(fromWest?.phase);
    // stop line: half the crossing street (3 m) and the gap for the zebra crossing
    expect(fromWest?.stopLine).toBeCloseTo(3 + P.stopLineGap);
    expect(map.approaches.has(laneOf(network, 0, 2))).toBe(false);
  });

  it('puts the poles on the right of each approach, before the stop line', () => {
    const { map } = lights();
    const fromWest = map.heads.find((h) => Math.abs(h.h) < 0.1);
    expect(fromWest?.x).toBeCloseTo(-(3 + P.stopLineGap));
    expect(fromWest?.y).toBeCloseTo(-(3 + P.poleSetback));
  });

  it('follows the clock', () => {
    const { map } = lights();
    const before = map.light(0, 0);
    map.advance(HALF);
    expect(map.light(0, 0)).not.toBe(before === 'green' ? 'green' : 'none');
  });

  it('works without signal data', () => {
    const roads = crossroads();
    delete roads.signals;
    const map = new SignalMap(roads, new RoadNetwork(roads, SETTINGS.traffic.speeds), P);
    expect(map.groups).toHaveLength(0);
    expect(map.heads).toHaveLength(0);
  });
});

describe('RedLightWatch', () => {
  // the stop line from the west stands 3 + stopLineGap m before the junction, across y in [-3, 0]
  const line = -(3 + P.stopLineGap);

  it('tells once when the front of the bus crosses a stop line on red, not on green nor when slow', () => {
    const { map } = lights();
    const watch = new RedLightWatch(map, 1, 1);
    // phase of the east-west street red: well into the green of the other phase
    map.time = HALF + 1 - map.groups[0].offset;
    expect(watch.step(line - 5, -1.5, 0, 10)).toBe(-1);
    expect(watch.step(line - 0.5, -1.5, 0, 10)).toBe(-1); // stopped right at the line
    expect(watch.step(line + 0.5, -1.5, 0, 10)).toBe(0);
    expect(watch.step(0, -1.5, 0, 10)).toBe(-1);
    // slow: being placed, not crossing
    watch.step(line - 1, -1.5, 0, 0.5);
    expect(watch.step(line + 1, -1.5, 0, 0.5)).toBe(-1);
  });

  it('ignores the lines of the other side and of the other directions', () => {
    const { map } = lights();
    const watch = new RedLightWatch(map, 1, 1);
    map.time = HALF + 1 - map.groups[0].offset;
    // left of the centre line, driving west: the line from the east is on the other side
    watch.step(line - 1, 2, 0, 10);
    expect(watch.step(line + 1, 2, 0, 10)).toBe(-1);
    // backwards over the line
    watch.step(line + 1, -1.5, Math.PI, 10);
    expect(watch.step(line - 1, -1.5, Math.PI, 10)).toBe(-1);
  });

  it('tells nothing on green', () => {
    const { map } = lights();
    const watch = new RedLightWatch(map, 1, 1);
    map.time = 1 - map.groups[0].offset;
    watch.step(line - 1, -1.5, 0, 10);
    expect(watch.step(line + 1, -1.5, 0, 10)).toBe(-1);
  });
});

describe('Traffic at the lights', () => {
  /** A car from the west at `s` along its lane, alone. */
  function carFromWest(time = 0, s = 60, v = 0) {
    const { network, map } = lights();
    map.time = time - map.groups[0].offset;
    const traffic = new Traffic(network, SETTINGS.traffic, () => 0.5, map);
    const lane = laneOf(network, 1, 0);
    const car = {
      id: 1,
      bike: false,
      lane,
      s,
      v,
      next: laneOf(network, 0, 2),
      desired: 10,
      length: 4.5,
      width: 1.8,
      variant: 0,
      x: 0,
      y: 0,
      h: 0,
      reserved: -1,
      previous: -1,
    };
    traffic.vehicles.push(car);
    return { traffic, car, map, network };
  }

  it('waits at the stop line on red without holding the junction, then goes on green', () => {
    const { traffic, car, map } = carFromWest(HALF + 1);
    for (let i = 0; i < 2 * HALF * 60; i++) {
      map.advance(1 / 60);
      if (map.light(0, 0) === 'green') break;
      traffic.drive(car, 1 / 60, traffic.sortByLane(), []);
    }
    const line = 100 - (3 + P.stopLineGap) - car.length / 2;
    expect(car.s).toBeLessThan(line + 0.01);
    expect(car.s).toBeGreaterThan(line - 3);
    expect(car.v).toBeLessThan(0.3);
    expect(traffic.reservations.size).toBe(0);
    for (let i = 0; i < 10 * 60; i++) traffic.drive(car, 1 / 60, traffic.sortByLane(), []);
    expect(car.lane).not.toBe(laneOf(lights().network, 1, 0));
  });

  it('drives through on green', () => {
    const { traffic, car } = carFromWest(1, 60, 10);
    for (let i = 0; i < 6 * 60; i++) traffic.drive(car, 1 / 60, traffic.sortByLane(), []);
    expect(car.s).toBeGreaterThan(0);
    expect(car.lane).toBe(laneOf(lights().network, 0, 2));
  });
});

describe('routeStopLines', () => {
  const approach = { group: 3, phase: /** @type {0 | 1} */ (1), stopLine: 9 };
  const lanes = [
    { from: 1, to: 0, length: 100 },
    { from: 0, to: 2, length: 100 },
  ];
  /** @param {number} from @param {number} to */
  const approachOf = (from, to) => (from === 1 && to === 0 ? approach : undefined);
  /** Route of 2 m steps from 100 m west of the junction to 100 m east of it. */
  const match = {
    lane: Int32Array.from({ length: 101 }, (_, i) => (i <= 50 ? 0 : 1)),
    along: Float64Array.from({ length: 101 }, (_, i) => (i <= 50 ? i * 2 : (i - 50) * 2)),
  };

  it('puts a stop line where the route goes through a signalised junction', () => {
    expect(routeStopLines(match, lanes, approachOf, 2)).toEqual([{ s: 91, group: 3, phase: 1 }]);
  });

  it('skips the approaches the route never leaves, and the roads without lights', () => {
    const ends = { lane: match.lane.slice(0, 40), along: match.along.slice(0, 40) };
    expect(routeStopLines(ends, lanes, approachOf, 2)).toEqual([]);
    expect(routeStopLines(match, lanes, () => undefined, 2)).toEqual([]);
    const off = { lane: Int32Array.from(match.lane, (v) => (v === 1 ? -1 : v)), along: match.along };
    expect(routeStopLines(off, lanes, approachOf, 2)).toEqual([]);
  });
});

describe('stopLineAhead', () => {
  const RULE = { braking: 1.5, maxBraking: 4, atLine: 0.5 };
  const lines = [
    { s: 100, group: 0, phase: /** @type {0 | 1} */ (0) },
    { s: 300, group: 1, phase: /** @type {0 | 1} */ (0) },
  ];
  /** @param {Record<number, import('../../src/hd2d/signals.js').Light>} lights */
  const by = (lights) => (/** @type {number} */ group) => lights[group];

  it('stops at the first line ahead on red, goes on through a green one', () => {
    expect(stopLineAhead(lines, 40, by({ 0: 'red', 1: 'red' }), 8, RULE)).toBe(60);
    expect(stopLineAhead(lines, 40, by({ 0: 'green', 1: 'red' }), 8, RULE)).toBe(260);
    expect(stopLineAhead(lines, 120, by({ 0: 'red', 1: 'green' }), 8, RULE)).toBeNull();
    expect(stopLineAhead([], 0, by({}), 8, RULE)).toBeNull();
  });

  it('runs an amber light it cannot stop at comfortably', () => {
    // 8 m/s needs 21 m at 1.5 m/s², 8 m at 4 m/s²
    expect(stopLineAhead(lines, 70, by({ 0: 'amber' }), 8, RULE)).toBe(30);
    expect(stopLineAhead(lines, 85, by({ 0: 'amber', 1: 'green' }), 8, RULE)).toBeNull();
    expect(stopLineAhead(lines, 85, by({ 0: 'red' }), 8, RULE)).toBe(15);
  });

  it('keeps a bus at the line until green, whatever its speed', () => {
    expect(stopLineAhead(lines, 99.8, by({ 0: 'amber' }), 3, RULE)).toBeCloseTo(0.2);
    expect(stopLineAhead(lines, 100.4, by({ 0: 'red' }), 3, RULE)).toBe(0);
    expect(stopLineAhead(lines, 100.4, by({ 0: 'green', 1: 'green' }), 3, RULE)).toBeNull();
    expect(stopLineAhead(lines, 101, by({ 0: 'red', 1: 'green' }), 0, RULE)).toBeNull();
  });

  it('gives the speed from which a vehicle still stops before the line', () => {
    expect(approachSpeed(32, 1)).toBe(8);
    expect(approachSpeed(-3, 1)).toBe(0);
  });
});

describe('SignalMap.approachOf', () => {
  it('finds the approaches of a junction by their nodes', () => {
    const roads = crossroads();
    const map = new SignalMap(roads, new RoadNetwork(roads, SETTINGS.traffic.speeds), P);
    expect(map.approachOf(1, 0)).toMatchObject({ group: 0 });
    expect(map.approachOf(0, 1)).toBeUndefined();
  });
});
