// @ts-check
import { describe, expect, it } from 'vitest';
import { leftTurnTrack, straightTrack, trackFromPoints } from './fixtures.js';

describe('Track', () => {
  it('measures the length and interpolates altitude and grade', () => {
    const track = straightTrack(100, 0.05);
    expect(track.length).toBe(100);
    expect(track.alt(50)).toBeCloseTo(102.5);
    expect(track.alt(500)).toBeCloseTo(105); // clamped at the terminus
    expect(track.slope(10, 20)).toBeCloseTo(0.05);
  });

  it('offsets points to the right of the heading', () => {
    const p = straightTrack(100).pos(40, 2);
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(-2); // heading east: right is south
    expect(p.h).toBeCloseTo(0);
  });

  it('extends the route in a straight line beyond both terminuses', () => {
    const track = straightTrack(100);
    expect(track.pos(-10).x).toBeCloseTo(-10);
    expect(track.pos(110).x).toBeCloseTo(110);
  });

  it('has a positive curvature of 1/R in a left turn', () => {
    const track = leftTurnTrack(50);
    expect(track.curv(track.length / 2)).toBeCloseTo(1 / 50, 3);
    expect(track.heading(track.length)).toBeCloseTo(Math.PI / 2, 1);
    expect(track.meanHeading(0, 0)).toBeCloseTo(track.heading(0));
  });

  it('keeps the heading continuous across ±π', () => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI / 2 + (i / 20) * Math.PI; // from north, turning left through west
      pts.push(10 * Math.cos(a), 10 * Math.sin(a), 0);
    }
    const track = trackFromPoints(pts, 1.57);
    for (let i = 1; i < track.n; i++) expect(Math.abs(track.h[i] - track.h[i - 1])).toBeLessThan(1);
    expect(track.h[track.n - 1] - track.h[0]).toBeCloseTo(Math.PI, 0); // half a turn (ends use one-sided differences), no 2π jump
  });
});
