import { describe, expect, it } from 'vitest';
import {
  daySchedule,
  linesThrough,
  mapColours,
  networkBuses,
  pointAlong,
} from '../../src/hd2d/lineNetwork.js';
import { SETTINGS } from './fixtures.js';

const params = { ...SETTINGS.fleet, dwellTime: 20, maxDwellShare: 0.5 };
/** @type {import('../../src/hd2d/lineNetwork.js').NetworkData} */
const network = {
  step: 100,
  lines: [
    {
      id: '19',
      color: '#ff0000',
      calendar: {
        week: { days: '1111100', start: '20261123', end: '20261218' },
        sunday: { days: '0000001', start: '20261123', end: '20261218' },
      },
      routes: [
        {
          // 300 m to the east: stops at 0 m (t 0) and 300 m (t 120 s)
          xy: [0, 0, 100, 0, 200, 0, 300, 0],
          stops: [0, 0, 300, 120],
          services: { week: ['08:00', '07:00'], sunday: ['09:00'] },
        },
      ],
    },
  ],
};
const at = (/** @type {string} */ hm) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 3600 + m * 60;
};

describe('daySchedule', () => {
  it('keeps the departures of the services running that day, sorted', () => {
    const [route] = daySchedule(network, '20261130', params);
    expect(route.departures).toEqual([at('07:00'), at('08:00')]);
    expect(route.duration).toBe(140);
    expect(route.color).toBe('#ff0000');
  });
  it('leaves out the routes without a departure that day', () => {
    expect(daySchedule(network, '20270101', params)).toEqual([]);
  });
});

describe('pointAlong', () => {
  it('interpolates between the points and clamps to the ends', () => {
    expect(pointAlong([0, 0, 100, 0, 100, 50], 100, 150)).toEqual({ x: 100, y: 25 });
    expect(pointAlong([0, 0, 100, 0], 100, -5)).toEqual({ x: 0, y: 0 });
    expect(pointAlong([0, 0, 100, 0], 100, 500)).toEqual({ x: 100, y: 0 });
  });
});

describe('networkBuses', () => {
  const schedule = daySchedule(network, '20261130', params);
  it('places the running services along their route', () => {
    const buses = networkBuses(schedule, 100, at('08:00') + 70, params, new Set());
    expect(buses).toHaveLength(1);
    expect(buses[0].x).toBeGreaterThan(0);
    expect(buses[0].x).toBeLessThan(300);
    expect(buses[0]).toMatchObject({ y: 0, color: '#ff0000', line: '19' });
  });
  it('shows no bus before the departure nor after the last dwell', () => {
    expect(networkBuses(schedule, 100, at('06:59'), params, new Set())).toEqual([]);
    expect(networkBuses(schedule, 100, at('07:00') + 141, params, new Set())).toEqual([]);
  });
  it('dwells at the terminus', () => {
    const buses = networkBuses(schedule, 100, at('07:00') + 130, params, new Set());
    expect(buses[0].x).toBe(300);
  });
  it('leaves out the skipped lines', () => {
    expect(networkBuses(schedule, 100, at('08:00') + 70, params, new Set(['19']))).toEqual([]);
  });
});

describe('mapColours', () => {
  const p = { lineHueStart: 10, lineSaturation: 70, lineLightness: 50, lineLightnessSpread: 12 };
  it('gives every line its own colour, neighbours far apart in hue', () => {
    const colours = mapColours(['17', '18', 'N62'], p);
    expect(new Set(Object.values(colours)).size).toBe(3);
    expect(colours['17']).toBe('hsl(10.0 70% 50%)');
    expect(colours['18']).toBe('hsl(147.5 70% 38%)');
  });
});

describe('linesThrough', () => {
  it('keeps the lines with a route point inside the area', () => {
    expect(linesThrough(network, (x) => x > 250)).toEqual(['19']);
    expect(linesThrough(network, (x) => x > 1000)).toEqual([]);
  });
});
