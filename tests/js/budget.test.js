// @ts-check
import { describe, expect, it } from 'vitest';
import { SpawnRing, lodOf, nearestWithin, simulationStep } from '../../src/hd2d/budget.js';
import { SETTINGS } from './fixtures.js';

const budget = {
  ...SETTINGS.budget,
  modelDistance: 100,
  spriteDistance: 500,
  simulationRadius: 200,
  farUpdateInterval: 0.5,
  spawnMinDistance: 100,
  spawnRadius: 300,
  despawnRadius: 400,
};

describe('lodOf', () => {
  it('draws a model near, a sprite farther and nothing beyond', () => {
    expect(lodOf(0, budget)).toBe('model');
    expect(lodOf(100, budget)).toBe('model');
    expect(lodOf(101, budget)).toBe('sprite');
    expect(lodOf(500, budget)).toBe('sprite');
    expect(lodOf(501, budget)).toBe('hidden');
  });
});

describe('nearestWithin', () => {
  const points = [
    { x: 30, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 500 },
    { x: 0, y: -20 },
  ];

  it('keeps the points in the radius, nearest first, up to the limit', () => {
    expect(nearestWithin(points, 0, 0, 100, 10)).toEqual([1, 3, 0]);
    expect(nearestWithin(points, 0, 0, 100, 2)).toEqual([1, 3]);
    expect(nearestWithin([], 0, 0, 100, 2)).toEqual([]);
  });
});

describe('simulationStep', () => {
  it('simulates every frame near the bus', () => {
    const clock = { pending: 0 };
    expect(simulationStep(clock, 50, 0.1, budget)).toBeCloseTo(0.1);
    expect(clock.pending).toBe(0);
  });

  it('saves up the time far away and applies it once per interval', () => {
    const clock = { pending: 0 };
    const steps = Array.from({ length: 6 }, () => simulationStep(clock, 1000, 0.1, budget));
    expect(steps.filter((s) => s > 0)).toHaveLength(1);
    expect(steps.reduce((a, b) => a + b, 0)).toBeCloseTo(0.5);
    // coming close again: the saved time is applied at once
    simulationStep(clock, 1000, 0.1, budget);
    expect(simulationStep(clock, 50, 0.1, budget)).toBeCloseTo(0.3);
  });
});

describe('SpawnRing', () => {
  const ring = new SpawnRing(budget);

  it('removes the objects beyond the despawn radius', () => {
    expect(
      ring.despawn(
        [
          { x: 0, y: 399 },
          { x: 401, y: 0 },
          { x: -300, y: -300 },
        ],
        0,
        0,
      ),
    ).toEqual([1, 2]);
  });

  it('spawns in the ring, behind the bus first, spaced out', () => {
    const candidates = [
      { x: 50, y: 0 }, // too close
      { x: 200, y: 0 }, // ahead
      { x: -200, y: 0 }, // behind, too close to the next one, which is farther
      { x: -205, y: 0 }, // behind
      { x: 0, y: 250 }, // on the side
      { x: 1000, y: 0 }, // too far
    ];
    expect(ring.spawnPlaces(candidates, [], 0, 0, 0, 10, 20)).toEqual([3, 4, 1]);
    expect(ring.spawnPlaces(candidates, [], 0, 0, 0, 1, 20)).toEqual([3]);
    // an existing object blocks the place next to it
    expect(ring.spawnPlaces(candidates, [{ x: -210, y: 0 }], 0, 0, 0, 10, 20)).toEqual([4, 1]);
  });
});
