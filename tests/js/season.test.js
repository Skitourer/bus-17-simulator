// @ts-check
import { describe, expect, it } from 'vitest';
import { dateOfDay, dayOfYear, mountainColour, seasonLook } from '../../src/hd2d/season.js';
import { rgb } from '../../src/hd2d/daylight.js';
import { SETTINGS } from './fixtures.js';

const SEASONS = SETTINGS.seasons;
const { winter, summer, autumn } = SEASONS.keys;

describe('dayOfYear and dateOfDay', () => {
  it('count days from January 1st, leap years included', () => {
    expect(dayOfYear('20260101')).toBe(1);
    expect(dayOfYear('20261231')).toBe(365);
    expect(dayOfYear('20240301')).toBe(61);
    expect(dateOfDay(2026, 200)).toBe('20260719');
    expect(dateOfDay(2026, dayOfYear('20261126'))).toBe('20261126');
  });
});

describe('seasonLook', () => {
  it('gives the key moment on its day', () => {
    const look = seasonLook(summer.day, SEASONS);
    expect(look.park).toEqual(rgb(summer.park));
    expect(look.leaves).toBe(summer.leaves);
    expect(look.snowLine).toBe(summer.snowLine);
  });

  it('blends two key moments in between', () => {
    const look = seasonLook((summer.day + autumn.day) / 2, SEASONS);
    expect(look.snowLine).toBeCloseTo((summer.snowLine + autumn.snowLine) / 2);
  });

  it('blends across the new year, from autumn to winter', () => {
    const span = winter.day + 365 - autumn.day;
    const newYear = seasonLook(365, SEASONS);
    expect(newYear.snowLine).toBeCloseTo(
      autumn.snowLine + ((winter.snowLine - autumn.snowLine) * (365 - autumn.day)) / span,
    );
    const early = seasonLook(1, SEASONS);
    expect(early.leaves).toBeGreaterThanOrEqual(winter.leaves);
    expect(early.leaves).toBeLessThan(autumn.leaves);
  });
});

describe('mountainColour', () => {
  const look = seasonLook(winter.day, SEASONS);

  it('is lowland in the valley and rock high above the trees without snow', () => {
    const summerLook = seasonLook(summer.day, SEASONS);
    expect(mountainColour(200, 0, summerLook, SEASONS)).toEqual(summerLook.lowland);
    expect(mountainColour(SEASONS.rockFrom + 100, 0, summerLook, SEASONS)).toEqual(rgb(SEASONS.rockColor));
  });

  it('is white above the snow line, partly white on snowy forests', () => {
    expect(mountainColour(SEASONS.rockFrom + 500, 0, look, SEASONS)).toEqual(rgb(SEASONS.snowColor));
    const forest = mountainColour(SEASONS.treeLine - 10, 0, look, SEASONS);
    expect(forest[0]).toBeLessThan(rgb(SEASONS.snowColor)[0]);
    expect(forest[0]).toBeGreaterThan(look.mountainForest[0]);
  });

  it('moves the snow line with the edge noise', () => {
    const z = look.snowLine + SEASONS.snowFade / 2;
    const up = mountainColour(z, 1, look, SEASONS);
    const down = mountainColour(z, -1, look, SEASONS);
    expect(down[0]).toBeGreaterThan(up[0]);
  });
});
