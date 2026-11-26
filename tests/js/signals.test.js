// @ts-check
import { describe, expect, it } from 'vitest';
import { RedLightWatch, SignalMap, lightAt, mainAxis, mustStop, phaseOf } from '../../src/hd2d/signals.js';
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

  it('finds the junction around a point and follows the clock', () => {
    const { map } = lights();
    expect(map.groupAt(2, 2)).toBe(0);
    expect(map.groupAt(50, 0)).toBe(-1);
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
  it('tells once when the bus enters the junction on red, not on green nor when slow', () => {
    const { map } = lights();
    const watch = new RedLightWatch(map, 1);
    const offset = map.groups[0].offset;
    // phase of the east-west street red: well into the green of the other phase
    map.time = HALF + 1 - offset;
    expect(watch.step(-40, -2, 0, 10)).toBe(-1);
    expect(watch.step(-2, -2, 0, 10)).toBe(0);
    expect(watch.step(0, -2, 0, 10)).toBe(-1);
    expect(watch.step(40, -2, 0, 10)).toBe(-1);
    // green for the north-south street at that time
    expect(watch.step(2, 3, -Math.PI / 2, 10)).toBe(-1);
    watch.step(0, 40, 0, 0);
    expect(watch.step(-2, -2, 0, 0.5)).toBe(-1);
  });

  it('tells nothing on green', () => {
    const { map } = lights();
    const watch = new RedLightWatch(map, 1);
    map.time = 1 - map.groups[0].offset;
    expect(watch.step(-2, -2, 0, 10)).toBe(-1);
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
