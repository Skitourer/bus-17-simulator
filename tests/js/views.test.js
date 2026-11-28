// @ts-check
import { describe, expect, it } from 'vitest';
import { eyePosition, lookTarget, mirrorRects, steeringWheelAngle, wheelPose } from '../../src/hd2d/views.js';
import { SETTINGS } from './fixtures.js';

describe('views from inside the bus', () => {
  it('puts the driver eye behind the front, on the left', () => {
    const eye = eyePosition(SETTINGS.camera.cabin, SETTINGS.bus);
    const front = SETTINGS.bus.bodyLength - SETTINGS.bus.rearOverhang;
    expect(eye.x).toBeCloseTo(front - SETTINGS.camera.cabin.eyeFromFront);
    expect(eye.y).toBe(SETTINGS.camera.cabin.eyeHeight);
    expect(eye.z).toBeLessThan(0);
  });

  it('looks along the heading and below the horizon', () => {
    const look = lookTarget({ x: 10, y: 20, z: 5 }, Math.PI / 2, 0.5);
    expect(look.x).toBeCloseTo(10);
    expect(look.y).toBeCloseTo(20 + Math.cos(0.5));
    expect(look.z).toBeCloseTo(5 - Math.sin(0.5));
  });

  it('turns the steering wheel by the steering ratio', () => {
    expect(steeringWheelAngle(0.1, 18)).toBeCloseTo(1.8);
    expect(steeringWheelAngle(-0.2, 10)).toBeCloseTo(-2);
  });

  it('places the mirrors symmetrically on the screen edges', () => {
    const m = SETTINGS.camera.mirrors;
    const { left, right } = mirrorRects(1280, 720, m);
    expect(left.w).toBe(right.w);
    expect(left.y).toBe(Math.round(720 * m.top));
    expect(left.w / left.h).toBeCloseTo(m.aspect, 1);
    expect(left.x).toBe(1280 - right.x - right.w);
  });

  it('puts the interior mirror in the middle at the top of the windscreen (#42)', () => {
    const m = SETTINGS.camera.mirrors;
    const { left, right, inside } = mirrorRects(1280, 720, m);
    expect(inside.x + inside.w / 2).toBeCloseTo(640, 0);
    expect(inside.y).toBe(Math.round(720 * m.insideTop));
    expect(inside.w / inside.h).toBeCloseTo(m.insideAspect, 1);
    // between the exterior mirrors
    expect(inside.x).toBeGreaterThan(left.x + left.w);
    expect(inside.x + inside.w).toBeLessThan(right.x);
  });

  it('puts the steering wheel ahead of and below the driver, nearly flat (#42)', () => {
    const eye = eyePosition(SETTINGS.camera.cabin, SETTINGS.bus);
    const dash = SETTINGS.camera.dashboard;
    const wheel = wheelPose(eye, dash);
    expect(wheel.x).toBeCloseTo(eye.x + dash.wheelAhead);
    expect(wheel.y).toBeCloseTo(eye.y - dash.wheelBelow);
    expect(wheel.z).toBe(eye.z);
    expect(wheel.tilt).toBeLessThan(Math.PI / 4);
    // the wheel stays inside the bus, behind the windscreen
    const front = SETTINGS.bus.bodyLength - SETTINGS.bus.rearOverhang;
    expect(wheel.x + dash.wheelRadius).toBeLessThan(front);
  });
});
