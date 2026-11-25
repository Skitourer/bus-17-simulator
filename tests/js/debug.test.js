// @ts-check
import { describe, expect, it } from 'vitest';
import { FreeFly, findStop, normalizeName, stepStop, turboDrive } from '../../src/hd2d/debug.js';
import { SETTINGS } from './fixtures.js';

const STOPS = [
  { name: 'Verdun - Préfecture', s: 0 },
  { name: 'Saint-Laurent', s: 400 },
  { name: 'Saint-Laurent Musée', s: 700 },
  { name: "L'Île Verte", s: 1000 },
];

describe('findStop', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeName("  L'Île  Verte ")).toBe('l ile verte');
    expect(findStop(STOPS, 'saint laurent')).toBe(1);
    expect(findStop(STOPS, 'SAINT-LAURENT')).toBe(1);
    expect(findStop(STOPS, 'ile verte')).toBe(3);
  });

  it('falls back to a partial name, else -1', () => {
    expect(findStop(STOPS, 'musee')).toBe(2);
    expect(findStop(STOPS, 'Chavant')).toBe(-1);
    expect(findStop(STOPS, ' - ')).toBe(-1);
  });
});

describe('stepStop', () => {
  it('goes to the next or previous stop, the current one excluded', () => {
    expect(stepStop(STOPS, 400, 1)).toBe(2);
    expect(stepStop(STOPS, 400, -1)).toBe(0);
    expect(stepStop(STOPS, 550, 1)).toBe(2);
    expect(stepStop(STOPS, 550, -1)).toBe(1);
  });

  it('stays on the first and last stops', () => {
    expect(stepStop(STOPS, 1000, 1)).toBe(3);
    expect(stepStop(STOPS, 0, -1)).toBe(0);
  });
});

describe('turboDrive', () => {
  it('raises the top speed and multiplies acceleration and braking', () => {
    const turbo = turboDrive(SETTINGS.drive, SETTINGS.debug);
    expect(turbo.maxSpeed).toBe(SETTINGS.debug.turboMaxSpeed);
    expect(turbo.acceleration).toBeCloseTo(SETTINGS.drive.acceleration * SETTINGS.debug.turboFactor);
    expect(turbo.braking).toBeCloseTo(SETTINGS.drive.braking * SETTINGS.debug.turboFactor);
    expect(turbo.maxSteer).toBe(SETTINGS.drive.maxSteer);
  });
});

describe('FreeFly', () => {
  const still = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    fast: false,
  };
  const flat = () => 100;

  it('flies along its heading, sideways and up', () => {
    const fly = new FreeFly(SETTINGS.debug, SETTINGS.camera.orbit);
    fly.start(0, 0, 150, Math.PI / 2, 0.3);
    const speed = SETTINGS.debug.flySpeed;
    fly.update({ ...still, forward: true }, 1, flat);
    expect(fly.x).toBeCloseTo(0);
    expect(fly.y).toBeCloseTo(speed);
    fly.update({ ...still, right: true, up: true }, 1, flat);
    expect(fly.x).toBeCloseTo(speed);
    expect(fly.z).toBeCloseTo(150 + speed);
    fly.update({ ...still, back: true, left: true, fast: true }, 1, flat);
    const fast = speed * SETTINGS.debug.flyFastFactor;
    expect(fly.x).toBeCloseTo(speed - fast);
    expect(fly.y).toBeCloseTo(speed - fast);
  });

  it('stays above the ground', () => {
    const fly = new FreeFly(SETTINGS.debug, SETTINGS.camera.orbit);
    fly.start(0, 0, 103, 0, 0);
    fly.update({ ...still, down: true }, 10, flat);
    expect(fly.z).toBeCloseTo(100 + SETTINGS.debug.flyMinHeight);
  });

  it('turns with the mouse and looks along its heading', () => {
    const fly = new FreeFly(SETTINGS.debug, SETTINGS.camera.orbit);
    fly.start(0, 0, 0, 0, 0);
    fly.turn(-100, 100);
    expect(fly.yaw).toBeCloseTo(100 * SETTINGS.camera.orbit.yawPerPixel);
    expect(fly.pitch).toBeCloseTo(100 * SETTINGS.camera.orbit.pitchPerPixel);
    fly.turn(0, 1e6);
    expect(fly.pitch).toBe(SETTINGS.camera.orbit.pitchMax);
    fly.start(0, 0, 10, 0, 0);
    expect(fly.target).toEqual({ x: 1, y: 0, z: 10 });
  });
});
