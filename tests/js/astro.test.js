// @ts-check
/** Reference values: worked examples of J. Meeus, "Astronomical Algorithms", 2nd ed. (1998). */
import { describe, expect, it } from 'vitest';
import {
  horizontal,
  julianDay,
  moonEquatorial,
  moonIllumination,
  siderealTime,
  skyAt,
  sunEquatorial,
} from '../../src/common/astro.js';

describe('julianDay and siderealTime', () => {
  it('matches Meeus example 12.a (1987 April 10, 0h UT)', () => {
    const jd = julianDay(Date.UTC(1987, 3, 10));
    expect(jd).toBe(2446895.5);
    // 13h 10m 46.3668s
    expect(siderealTime(jd)).toBeCloseTo((13 + 10 / 60 + 46.3668 / 3600) * 15, 4);
  });
});

describe('sunEquatorial', () => {
  it('matches Meeus example 25.a (1992 October 13, 0h)', () => {
    const sun = sunEquatorial(2448908.5);
    expect(sun.ra).toBeCloseTo(198.38083, 2);
    expect(sun.dec).toBeCloseTo(-7.78507, 2);
  });
});

describe('moonEquatorial and moonIllumination', () => {
  it('matches Meeus example 47.a (1992 April 12, 0h) within 0.05°', () => {
    const moon = moonEquatorial(2448724.5);
    expect(Math.abs(moon.lambda - 133.162655)).toBeLessThan(0.05);
    expect(Math.abs(moon.beta - -3.229126)).toBeLessThan(0.05);
    expect(Math.abs(moon.ra - 134.68847)).toBeLessThan(0.05);
    expect(Math.abs(moon.dec - 13.768368)).toBeLessThan(0.05);
  });

  it('matches Meeus example 48.a (lit fraction 0.68)', () => {
    expect(moonIllumination(2448724.5)).toBeCloseTo(0.6786, 2);
  });
});

describe('horizontal', () => {
  it('matches Meeus example 13.b (Venus seen from Washington)', () => {
    const jd = julianDay(Date.UTC(1987, 3, 10, 19, 21));
    const venus = { ra: (23 + 9 / 60 + 16.641 / 3600) * 15, dec: -(6 + 43 / 60 + 11.61 / 3600) };
    const sky = horizontal(venus, jd, 38 + 55 / 60 + 17 / 3600, -(77 + 3 / 60 + 56 / 3600));
    expect(sky.elevation).toBeCloseTo(15.1249, 2);
    // Meeus counts the azimuth from the south: 68.0337° + 180°
    expect(sky.azimuth).toBeCloseTo(248.0337, 2);
  });
});

describe('skyAt', () => {
  const GRENOBLE = [45.2134, 5.78085];

  it('puts the summer solstice noon sun at 90° - latitude + 23.44°, due south', () => {
    let best = { azimuth: 0, elevation: -90 };
    for (let minute = 0; minute < 24 * 60; minute++) {
      const { sun } = skyAt(Date.UTC(2026, 5, 21, 0, minute), GRENOBLE[0], GRENOBLE[1]);
      if (sun.elevation > best.elevation) best = sun;
    }
    expect(best.elevation).toBeCloseTo(90 - GRENOBLE[0] + 23.44, 0);
    expect(Math.abs(best.azimuth - 180)).toBeLessThan(1);
  });

  it('has the sun below the horizon at midnight and the full moon lit', () => {
    // full moon of 2026 November 24 (about 14:53 UT)
    const sky = skyAt(Date.UTC(2026, 10, 24, 23), GRENOBLE[0], GRENOBLE[1]);
    expect(sky.sun.elevation).toBeLessThan(-40);
    expect(sky.moonLit).toBeGreaterThan(0.97);
    expect(sky.moon.elevation).toBeGreaterThan(30);
  });
});
