// @ts-check
import { describe, expect, it } from 'vitest';
import { buildScenery } from '../../src/world/scenery.js';
import { straightTrack } from './fixtures.js';

/** @param {{key: string, d: number}[][]} segs @param {(item: {key: string, d: number}) => boolean} test */
const count = (segs, test) => segs.flat().filter(test).length;

describe('buildScenery', () => {
  it('puts a shelter and a pole at every stop', () => {
    const track = straightTrack(400);
    const segs = buildScenery(track, null);
    expect(segs).toHaveLength(track.n);
    expect(count(segs, (it) => it.key === 'shelter')).toBe(track.stops.length);
    expect(count(segs, (it) => it.key === 'pole')).toBe(track.stops.length);
    expect(count(segs, (it) => it.key.startsWith('bld'))).toBeGreaterThan(10);
  });

  it('is deterministic', () => {
    const track = straightTrack(400);
    expect(buildScenery(track, null)).toEqual(buildScenery(track, null));
  });

  it('replaces buildings by trees in parks and by nothing on water', () => {
    const track = straightTrack(400);
    const square = (/** @type {number} */ y0, /** @type {number} */ y1) => [
      -50,
      y0,
      450,
      y0,
      450,
      y1,
      -50,
      y1,
    ];
    /** @type {import('../../src/common/types.js').MapData} */
    const map = {
      attribution: 'test',
      bbox: [-50, -100, 450, 100],
      polys: { water: [square(5, 100)], park: [square(-100, -5)], forest: [] },
      lines: {},
    };
    const segs = buildScenery(track, map);
    expect(count(segs, (it) => it.key.startsWith('bld'))).toBe(0);
    const parkTrees = count(segs, (it) => it.key.startsWith('tree') && it.d > 8);
    expect(parkTrees).toBeGreaterThan(20);
  });
});
