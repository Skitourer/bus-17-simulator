// @ts-check
import { describe, expect, it } from 'vitest';
import { cablePath, shuttle } from '../../src/hd2d/cablecar.js';

describe('cablePath', () => {
  /** @type {[number, number, number][]} */
  const supports = [
    [0, 0, 100],
    [300, 400, 200],
    [300, 600, 300],
  ];
  const cable = cablePath(supports, 0.05);

  it('measures the spans along the ground and goes through the supports', () => {
    expect(cable.length).toBeCloseTo(700);
    expect(cable.at(0)).toMatchObject({ x: 0, y: 0, z: 100 });
    expect(cable.at(500).z).toBeCloseTo(200);
    expect(cable.at(700)).toMatchObject({ x: 300, y: 600, z: 300 });
    expect(cable.at(-10).z).toBe(100);
    expect(cable.at(900).z).toBe(300);
  });

  it('sags most in the middle of each span, and follows its heading', () => {
    const middle = cable.at(250);
    expect(middle.z).toBeCloseTo(150 - 0.05 * 500);
    expect(middle.h).toBeCloseTo(Math.atan2(400, 300));
    expect(cable.at(600).h).toBeCloseTo(Math.PI / 2);
  });
});

describe('shuttle', () => {
  const p = { cableSpeed: 5, cableDwell: 20 };

  it('climbs, waits at the top, comes down and waits at the bottom', () => {
    expect(shuttle(0, 500, p)).toBe(0);
    expect(shuttle(50, 500, p)).toBe(250);
    expect(shuttle(110, 500, p)).toBe(500);
    expect(shuttle(170, 500, p)).toBe(250);
    expect(shuttle(230, 500, p)).toBe(0);
    expect(shuttle(240, 500, p)).toBe(0);
    expect(shuttle(240 + 50, 500, p)).toBe(250);
    expect(shuttle(-50, 500, p)).toBe(150); // before the start: on the way down
  });
});
