// @ts-check
import { describe, expect, it } from 'vitest';
import { OrbitCamera, PITCH_MAX, PITCH_MIN } from '../../src/hd2d/orbit.js';

const DT = 1 / 60;

describe('OrbitCamera', () => {
  it('follows the automatic view until the first drag', () => {
    const orbit = new OrbitCamera();
    expect(orbit.view(DT, 1.2, 0.3)).toEqual({ yaw: 1.2, pitch: 0.3 });
    expect(orbit.free).toBe(false);
  });

  it('starts a drag from the automatic view and keeps its own yaw afterwards', () => {
    const orbit = new OrbitCamera();
    orbit.drag(100, 0, 1.0, 0.3);
    expect(orbit.free).toBe(true);
    const v = orbit.view(DT, 2.5, 0.3); // the bus turned: the free view does not
    expect(v.yaw).toBeCloseTo(1.0 - 0.6);
    expect(v.pitch).toBeCloseTo(0.3);
  });

  it('clamps the pitch above the horizon and below the zenith', () => {
    const orbit = new OrbitCamera();
    orbit.drag(0, -10000, 0, 0.3);
    expect(orbit.pitch).toBe(PITCH_MIN);
    orbit.drag(0, 10000, 0, 0.3);
    expect(orbit.pitch).toBe(PITCH_MAX);
  });

  it('wraps the yaw', () => {
    const orbit = new OrbitCamera();
    orbit.drag(-1000, 0, 3, 0.3); // +6 rad
    expect(Math.abs(orbit.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('eases back to the automatic view after a reset, the short way round', () => {
    const orbit = new OrbitCamera();
    orbit.drag(0, 0, 3.0, 0.3);
    orbit.drag(0, 50, 3.0, 0.3);
    orbit.reset();
    let v = orbit.view(DT, -3.0, 0.3);
    expect(Math.abs(v.yaw)).toBeGreaterThan(3.0); // crosses ±π, not through 0
    for (let i = 0; i < 120; i++) v = orbit.view(DT, -3.0, 0.3);
    expect(orbit.state).toBe('auto');
    expect(orbit.view(DT, -3.0, 0.3)).toEqual({ yaw: -3.0, pitch: 0.3 });
  });

  it('snaps back at once on a camera mode change; reset is a no-op when automatic', () => {
    const orbit = new OrbitCamera();
    orbit.reset();
    expect(orbit.state).toBe('auto');
    orbit.drag(10, 10, 0, 0.3);
    orbit.snap();
    expect(orbit.view(DT, 0.7, 0.4)).toEqual({ yaw: 0.7, pitch: 0.4 });
  });
});
