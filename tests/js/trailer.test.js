// @ts-check
import { describe, expect, it } from 'vitest';
import { Trailer, busGeometry } from '../../src/hd2d/trailer.js';
import { Drive } from '../../src/hd2d/drive.js';
import { Heightfield } from '../../src/hd2d/heightfield.js';
import { NO_INPUT, SETTINGS, tiltedTerrain } from './fixtures.js';

const DT = 1 / 60;
const ART = busGeometry(SETTINGS, 'art');
const flat = new Heightfield(tiltedTerrain(0));
const noWalls = { hit: () => false };

describe('busGeometry', () => {
  it('keeps the standard bus without a rear body', () => {
    const std = busGeometry(SETTINGS, 'std');
    expect(std.trailer).toBeNull();
    expect(std.bodyLength).toBe(SETTINGS.bus.bodyLength);
  });

  it('builds an 18 m articulated bus', () => {
    const t = /** @type {import('../../src/hd2d/trailer.js').TrailerGeometry} */ (ART.trailer);
    const front = ART.bodyLength - ART.rearOverhang;
    const total = front + t.hitchOffset + t.trailerWheelbase + t.trailerRearOverhang;
    expect(total).toBeCloseTo(18.1, 1);
    // the front body ends at the front of the bellows
    expect(ART.rearOverhang + t.bellowsLength / 2).toBeCloseTo(t.hitchOffset);
    expect(ART.bodyWidth).toBe(SETTINGS.bus.bodyWidth);
  });
});

describe('Trailer', () => {
  const geometry = /** @type {import('../../src/hd2d/trailer.js').TrailerGeometry} */ (ART.trailer);

  it('lines up behind the joint', () => {
    const trailer = new Trailer(geometry, 2.5);
    trailer.align(10, 0, 0);
    expect(trailer.hitch(10, 0, 0).x).toBeCloseTo(10 - geometry.hitchOffset);
    expect(trailer.state.x).toBeCloseTo(10 - geometry.hitchOffset - geometry.trailerWheelbase);
    expect(trailer.articulation(0)).toBeCloseTo(0);
    expect(trailer.probes()).toHaveLength(4);
  });

  it('keeps its distance to the joint and stops at the largest articulation', () => {
    const trailer = new Trailer(geometry, 2.5);
    trailer.align(0, 0, 0);
    // the front body turns on the spot by 90°: the joint swings, the trailer cannot follow that far
    const state = trailer.follow(0, 0, Math.PI / 2);
    const joint = trailer.hitch(0, 0, Math.PI / 2);
    expect(Math.hypot(joint.x - state.x, joint.y - state.y)).toBeCloseTo(geometry.trailerWheelbase);
    trailer.commit(state);
    expect(Math.abs(trailer.articulation(Math.PI / 2))).toBeCloseTo(geometry.maxArticulation);
    // not moving keeps the heading
    expect(trailer.follow(0, 0, Math.PI / 2).h).toBeCloseTo(state.h);
  });
});

describe('Drive with an articulated bus', () => {
  const geometry = /** @type {import('../../src/hd2d/trailer.js').TrailerGeometry} */ (ART.trailer);

  it('pulls the rear body, which cuts inside the turn', () => {
    const drive = new Drive(SETTINGS.drive, ART);
    drive.place(0, 0, 0);
    drive.v = 4;
    for (let t = 0; t < 4; t += DT)
      drive.update({ ...NO_INPUT, up: drive.v < 4, left: true }, DT, flat, noWalls);
    const trailer = /** @type {Trailer} */ (drive.trailer);
    expect(drive.h).toBeGreaterThan(0.5);
    // turning left, the rear body trails on the inside: its heading lags behind the front body
    expect(trailer.articulation(drive.h)).toBeLessThan(-0.05);
    const joint = trailer.hitch(drive.x, drive.y, drive.h);
    expect(Math.hypot(joint.x - trailer.state.x, joint.y - trailer.state.y)).toBeCloseTo(
      geometry.trailerWheelbase,
    );
  });

  it('stops when the rear body hits a building, and is realigned when placed', () => {
    const drive = new Drive(SETTINGS.drive, ART);
    drive.place(0, 0, 0);
    const before = { ...(drive.trailer?.state ?? { x: 0, y: 0, h: 0 }) };
    drive.v = -2; // reversing into a wall behind the rear body
    drive.bump = 1;
    // the back of the bus starts 9.5 m behind the middle axle
    const wallBehind = { hit: (/** @type {number} */ x) => x < -10 };
    const events = [];
    for (let t = 0; t < 1; t += DT) events.push(drive.update(NO_INPUT, DT, flat, wallBehind));
    expect(events).toContain('bump');
    expect(drive.blocked(wallBehind)).toBe(false);
    expect(drive.trailer?.point(-geometry.trailerRearOverhang).x).toBeGreaterThan(-10);
    drive.place(50, 50, 1);
    expect(drive.trailer?.state.h).toBe(1);
    expect(before.h).toBe(0);
    expect(drive.probes()).toHaveLength(11);
  });
});
