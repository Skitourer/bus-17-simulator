// @ts-check
import { describe, expect, it } from 'vitest';
import { Drive, obstacles } from '../../src/hd2d/drive.js';
import { Heightfield } from '../../src/hd2d/heightfield.js';
import { NO_INPUT, SETTINGS, tiltedTerrain } from './fixtures.js';

const DT = 1 / 60;

/**
 * @param {{update: (...args: any[]) => unknown}} vehicle @param {(dt: number) => void} step
 * @param {number} seconds
 */
function run(vehicle, step, seconds) {
  for (let t = 0; t < seconds; t += DT) step(DT);
  return vehicle;
}

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
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.place(0, 0, Math.PI / 2);
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true }, dt, flat, noWalls), 3);
    expect(drive.y).toBeGreaterThan(5);
    expect(Math.abs(drive.x)).toBeLessThan(0.01);
    expect(drive.center.y).toBeGreaterThan(drive.y);
  });

  it('turns left when steering left, and recentres the wheel', () => {
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.v = 5;
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true, left: true }, dt, flat, noWalls), 2);
    expect(drive.h).toBeGreaterThan(0.2);
    expect(drive.delta).toBeGreaterThan(0);
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true }, dt, flat, noWalls), 2);
    expect(drive.delta).toBeCloseTo(0);
  });

  it('brakes to a stop, then reverses', () => {
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.v = 8;
    run(drive, (dt) => drive.update({ ...NO_INPUT, down: true }, dt, flat, noWalls), 2.5);
    expect(drive.braking || drive.v <= 0).toBe(true);
    run(drive, (dt) => drive.update({ ...NO_INPUT, down: true }, dt, flat, noWalls), 4);
    expect(drive.v).toBeLessThan(0);
    run(drive, (dt) => drive.update(NO_INPUT, dt, flat, noWalls), 10);
    expect(drive.v).toBe(0);
  });

  it('places its centre on a point, stopped, and tells when an obstacle touches it', () => {
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.v = 5;
    drive.placeCentre(100, 50, Math.PI / 2);
    expect(drive.center.x).toBeCloseTo(100);
    expect(drive.center.y).toBeCloseTo(50);
    expect(drive.v).toBe(0);
    expect(drive.probes()).toHaveLength(7);
    expect(drive.blocked(noWalls)).toBe(false);
    // the front of the bus is 6 m north of its centre (12 m bus, 3 m rear overhang)
    expect(drive.blocked({ hit: (_x, /** @type {number} */ y) => y > 55.9 })).toBe(true);
    expect(drive.blocked({ hit: (_x, /** @type {number} */ y) => y > 56.1 })).toBe(false);
  });

  it('holds still with the brake on', () => {
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.v = 0.2;
    drive.hold();
    expect(drive.v).toBe(0);
    expect(drive.braking).toBe(true);
  });

  it('drives faster once tuned for the turbo', () => {
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.tune({ ...SETTINGS.drive, maxSpeed: 150 });
    run(drive, (dt) => drive.update({ ...NO_INPUT, up: true }, dt, flat, noWalls), 40);
    expect(drive.v * 3.6).toBeGreaterThan(60);
  });

  it('bounces off buildings and reports at most one collision per 0.6 s', () => {
    const drive = new Drive(SETTINGS.drive, SETTINGS.bus);
    drive.v = 6;
    drive.bump = 1;
    const wallAhead = { hit: (/** @type {number} */ x) => x > 9.5 };
    const events = [];
    for (let t = 0; t < 0.5; t += DT) {
      const ev = drive.update({ ...NO_INPUT, up: true }, DT, flat, wallAhead);
      if (ev) events.push(ev);
    }
    expect(events).toEqual(['bump']);
    expect(drive.point(12 - 3).x).toBeLessThanOrEqual(9.6);
  });
});

describe('obstacles', () => {
  const building = { hit: (/** @type {number} */ x) => x > 50 };
  const water = {
    waterBlocks: (/** @type {number} */ x, /** @type {number} */ _y, /** @type {number} */ z) =>
      x < 0 && z < 5,
  };

  it('stops the bus at buildings and at the water, not on a deck above it', () => {
    const low = obstacles(building, water, () => 0, false);
    expect(low.hit(60, 0)).toBe(true);
    expect(low.hit(-1, 0)).toBe(true);
    expect(low.hit(10, 0)).toBe(false);
    expect(obstacles(building, water, () => 8, false).hit(-1, 0)).toBe(false);
  });

  it('stops nothing in ghost mode', () => {
    const ghost = obstacles(building, water, () => 0, true);
    expect(ghost.hit(60, 0)).toBe(false);
    expect(ghost.hit(-1, 0)).toBe(false);
  });
});
