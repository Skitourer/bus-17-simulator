// @ts-check
import { describe, expect, it } from 'vitest';
import { departuresOf, directionsOf, routeNote } from '../../src/common/lines.js';

/**
 * Fictitious route of a line.
 * @param {number} direction @param {string[]} stops @param {Record<string, string[]>} services
 * @returns {import('../../src/common/types.js').Route}
 */
function route(direction, stops, services) {
  return {
    direction,
    headsign: stops[stops.length - 1],
    trips: 1,
    length: 1000,
    pts: [0, 0, 0, 1000, 0, 0],
    stops: stops.map((name, i) => ({ name, commune: 'Ville', s: i * 100, off: 0, x: 0, y: 0, t: i * 60 })),
    services,
  };
}

/** @type {import('../../src/common/types.js').LineData} */
const LINE = {
  id: '99',
  name: 'Gare ⇄ Col',
  color: '#000000',
  text_color: '#FFFFFF',
  step: 2,
  routes: [
    route(0, ['Gare', 'Pont', 'Col'], { WEEK: ['08:00', '10:00'], SAT: ['09:00'] }),
    route(0, ['Gare', 'Pont'], { WEEK: ['09:00'], FRI: ['12:00'] }),
    route(1, ['Col', 'Pont', 'Gare'], { WEEK: ['08:30'] }),
    route(1, ['Pont', 'Gare'], { WEEK: ['07:00'] }),
  ],
  calendar: {
    WEEK: { days: '1111100', start: '20261101', end: '20261231' },
    FRI: { days: '0000100', start: '20261101', end: '20261231' },
    SAT: { days: '0000010', start: '20261101', end: '20261231' },
  },
};

describe('directionsOf', () => {
  it('groups the routes by direction, the main route first', () => {
    expect(directionsOf(LINE)).toEqual([
      { direction: 0, routes: [0, 1] },
      { direction: 1, routes: [2, 3] },
    ]);
  });
});

describe('departuresOf', () => {
  it('merges the departures of every service running on the date, by time', () => {
    // Friday 27 November 2026: the weekday and the Friday services
    expect(departuresOf(LINE, [0, 1], '20261127')).toEqual([
      { time: '08:00', route: 0 },
      { time: '09:00', route: 1 },
      { time: '10:00', route: 0 },
      { time: '12:00', route: 1 },
    ]);
    expect(departuresOf(LINE, [0, 1], '20261128')).toEqual([{ time: '09:00', route: 0 }]);
    expect(departuresOf(LINE, [0, 1], '20261129')).toEqual([]);
  });
});

describe('routeNote', () => {
  it('names the own terminus, else the own first stop, of a route that is not the main one', () => {
    expect(routeNote(LINE, 0, 0)).toBeNull();
    expect(routeNote(LINE, 1, 0)).toEqual({ kind: 'to', stop: 'Pont' });
    expect(routeNote(LINE, 3, 2)).toEqual({ kind: 'from', stop: 'Pont' });
    expect(routeNote(LINE, 2, 2)).toBeNull();
  });
});
