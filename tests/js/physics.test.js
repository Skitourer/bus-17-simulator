// @ts-check
import { describe, expect, it } from 'vitest';
import { BUS_LEN, Bus, VMAX } from '../../src/sim/bus.js';
import { ROAD } from '../../src/world/road_geom.js';
import { Drive } from '../../src/hd2d/drive.js';
import { Heightfield } from '../../src/hd2d/heightfield.js';
import { NO_INPUT, leftTurnTrack, straightTrack, tiltedTerrain } from './fixtures.js';

const DT = 1 / 60;

/**
 * @param {{update: (...args: any[]) => unknown}} vehicle @param {(dt: number) => void} step
 * @param {number} seconds
 */
function run(vehicle, step, seconds) {
  for (let t = 0; t < seconds; t += DT) step(DT);
  return vehicle;
}

describe('Bus (pseudo-3D route physics)', () => {
  it('accelerates to the speed limit and never exceeds it', () => {
    const track = straightTrack(2000);
    const bus = new Bus();
    run(bus, (dt) => bus.update(track, { ...NO_INPUT, up: true }, dt), 7);
    expect(bus.v * 3.6).toBeGreaterThan(35); // cahier des charges §4.5: 0 → 50 km/h in about 7 s
    run(bus, (dt) => bus.update(track, { ...NO_INPUT, up: true }, dt), 60);
    expect(bus.v).toBeLessThanOrEqual(VMAX);
  });

  it('stops exactly at zero when braking, then reverses if the brake is held', () => {
    const track = straightTrack(2000);
    const bus = new Bus();
    bus.v = 10;
    let steps = 0;
    while (bus.v > 0 && steps++ < 1000) bus.update(track, { ...NO_INPUT, down: true }, DT);
    expect(bus.v).toBe(0); // no overshoot into reverse on the stopping frame
    run(bus, (dt) => bus.update(track, { ...NO_INPUT, down: true }, dt), 3);
    expect(bus.v).toBeLessThan(0);
    expect(bus.v).toBeGreaterThanOrEqual(-8 / 3.6);
  });

  it('coasts to a stop and rolls back on a steep climb', () => {
    const flat = new Bus();
    flat.v = 5;
    const track = straightTrack(2000);
    run(flat, (dt) => flat.update(track, NO_INPUT, dt), 20);
    expect(Math.abs(flat.v)).toBeLessThan(0.05);

    const hill = straightTrack(2000, 0.15);
    const climbing = new Bus();
    climbing.s = 100;
    run(climbing, (dt) => climbing.update(hill, NO_INPUT, dt), 5);
    expect(climbing.v).toBeLessThan(0);
  });

  it('steers right, drifts outwards in turns and is held by the kerb', () => {
    const track = straightTrack(2000);
    const bus = new Bus();
    bus.v = 8;
    run(bus, (dt) => bus.update(track, { ...NO_INPUT, right: true }, dt), 0.5);
    expect(bus.lat).toBeGreaterThan(ROAD.LANE);
    run(bus, (dt) => bus.update(track, { ...NO_INPUT, right: true, up: true }, dt), 10);
    expect(bus.lat).toBeCloseTo(ROAD.SW - 1.28 - 0.3);
    expect(bus.offroad).toBe(true);

    const turn = leftTurnTrack(40);
    const drifting = new Bus();
    drifting.v = 12;
    run(drifting, (dt) => drifting.update(turn, NO_INPUT, dt), 0.5);
    expect(drifting.lat).toBeGreaterThan(ROAD.LANE); // left turn: pushed to the right
  });

  it('stops at the end of the route', () => {
    const track = straightTrack(100);
    const bus = new Bus();
    bus.s = 80;
    bus.v = 10;
    run(bus, (dt) => bus.update(track, { ...NO_INPUT, up: true }, dt), 3);
    expect(bus.s).toBe(track.length - BUS_LEN);
    expect(bus.v).toBe(0);
  });
});

describe('Heightfield', () => {
  const hf = new Heightfield(tiltedTerrain(0.1));

  it('interpolates the fine grid inside the city and the coarse grid outside', () => {
    expect(hf.inFine(0, 0)).toBe(true);
    expect(hf.h(10, 0)).toBeCloseTo(201);
    expect(hf.inFine(1000, 0)).toBe(false);
    expect(hf.h(1000, 0)).toBeCloseTo(300);
  });

  it('measures the slope along a heading', () => {
    expect(hf.slope(0, 0, 0)).toBeCloseTo(0.1);
    expect(hf.slope(0, 0, Math.PI / 2)).toBeCloseTo(0);
    expect(hf.slope(0, 0, Math.PI)).toBeCloseTo(-0.1);
  });

  it('exposes the bounds of the fine grid', () => {
    expect(hf.bounds).toEqual({ x0: -400, y0: -400, x1: 400, y1: 400 });
  });
});

describe('Drive (HD-2D free driving)', () => {
  const flat = new Heightfield(tiltedTerrain(0));
  const noWalls = { hit: () => false };

  it('drives forward along its heading', () => {
    const drive = new Drive();
    drive.place(0, 0, Math.PI / 2);
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true }, dt, flat, noWalls), 3);
    expect(drive.y).toBeGreaterThan(5);
    expect(Math.abs(drive.x)).toBeLessThan(0.01);
    expect(drive.center.y).toBeGreaterThan(drive.y);
  });

  it('turns left when steering left, and recentres the wheel', () => {
    const drive = new Drive();
    drive.v = 5;
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true, left: true }, dt, flat, noWalls), 2);
    expect(drive.h).toBeGreaterThan(0.2);
    expect(drive.delta).toBeGreaterThan(0);
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true }, dt, flat, noWalls), 2);
    expect(drive.delta).toBeCloseTo(0);
  });

  it('brakes to a stop, then reverses', () => {
    const drive = new Drive();
    drive.v = 8;
    run(drive, (dt) => drive.update({ ...NO_INPUT, down: true }, dt, flat, noWalls), 2.5);
    expect(drive.braking || drive.v <= 0).toBe(true);
    run(drive, (dt) => drive.update({ ...NO_INPUT, down: true }, dt, flat, noWalls), 4);
    expect(drive.v).toBeLessThan(0);
    run(drive, (dt) => drive.update(NO_INPUT, dt, flat, noWalls), 10);
    expect(drive.v).toBe(0);
  });

  it('bounces off buildings and reports at most one collision per 0.6 s', () => {
    const drive = new Drive();
    drive.v = 6;
    drive.bump = 1;
    const wallAhead = { hit: (/** @type {number} */ x) => x > 9.5 };
    const events = [];
    for (let t = 0; t < 0.5; t += DT) {
      const ev = drive.update({ ...NO_INPUT, up: true }, DT, flat, wallAhead);
      if (ev) events.push(ev);
    }
    expect(events).toEqual(['Accrochage !']);
    expect(drive.point(12 - 3).x).toBeLessThanOrEqual(9.6);
  });
});
