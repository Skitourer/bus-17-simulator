// @ts-check
import { describe, expect, it } from 'vitest';
import { rgb, skyLook, towards } from '../../src/hd2d/daylight.js';
import { SETTINGS } from './fixtures.js';

const D = SETTINGS.daylight;
const below = { azimuth: 0, elevation: -60 };

describe('rgb', () => {
  it('reads #rrggbb colours as 0..1 channels', () => {
    expect(rgb('#ff8000')).toEqual([1, 128 / 255, 0]);
  });
});

describe('skyLook', () => {
  it('uses the day colours with a high sun, lit by the sun', () => {
    const sun = { azimuth: 200, elevation: 50 };
    const look = skyLook(sun, below, 1, D);
    expect(look.skyTop).toEqual(rgb(D.keys.day.skyTop));
    expect(look.horizon).toEqual(rgb(D.keys.day.horizon));
    expect(look.night).toBe(D.keys.day.night);
    expect(look.billboard).toEqual([1, 1, 1]);
    expect(look.light).toMatchObject({ azimuth: 200, elevation: 50, intensity: D.keys.day.lightIntensity });
  });

  it('blends two key moments in between', () => {
    const { day, golden } = D.keys;
    const mid = (day.elevation + golden.elevation) / 2;
    const look = skyLook({ azimuth: 250, elevation: mid }, below, 0, D);
    expect(look.ambientIntensity).toBeCloseTo((day.ambientIntensity + golden.ambientIntensity) / 2);
    expect(look.skyMiddle[0]).toBeCloseTo((rgb(day.skyMiddle)[0] + rgb(golden.skyMiddle)[0]) / 2);
    // the light never comes from lower than the minimum elevation
    expect(look.light.elevation).toBe(Math.max(mid, D.minLightElevation));
  });

  it('is night below the lowest key moment, lit by a high full moon', () => {
    const moon = { azimuth: 150, elevation: 40 };
    const look = skyLook(below, moon, 1, D);
    expect(look.night).toBe(1);
    // sprites darken at night
    expect(Math.max(...look.billboard)).toBeLessThan(0.5);
    expect(look.skyTop).toEqual(rgb(D.keys.night.skyTop));
    expect(look.light).toEqual({
      colour: rgb(D.moonColor),
      intensity: D.moonIntensity,
      azimuth: 150,
      elevation: 40,
    });
  });

  it('has no moonlight for a new moon or a moon below the horizon', () => {
    expect(skyLook(below, { azimuth: 150, elevation: 40 }, 0, D).light.intensity).toBe(0);
    expect(skyLook(below, { azimuth: 150, elevation: -5 }, 1, D).light.intensity).toBe(0);
  });
});

describe('towards', () => {
  it('points north to -z, east to +x and up to +y', () => {
    const north = towards({ azimuth: 0, elevation: 0 });
    expect(north[2]).toBeCloseTo(-1);
    expect(towards({ azimuth: 90, elevation: 0 })[0]).toBeCloseTo(1);
    expect(towards({ azimuth: 0, elevation: 90 })[1]).toBeCloseTo(1);
  });
});
