// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServiceClock,
  delta,
  hm,
  hms,
  readParams,
  serviceLabel,
  sortedServices,
  todayService,
  toSec,
} from '../../src/common/service.js';

/** @type {import('../../src/common/types.js').Calendar} */
const CAL = {
  'X-other': { days: '1111111', start: '20260105', end: '20260320' },
  'X-DFHfi-Dimanche': { days: '0000001', start: '20260901', end: '20261231' },
  'X-SAHfi-Samedi': { days: '0000010', start: '20260901', end: '20261231' },
  'X-LVIfi-Semaine': { days: '1111100', start: '20270101', end: '20270131' },
  'X-LVHfi-Semaine': { days: '1111100', start: '20260901', end: '20261231' },
};
const SERVICES = Object.fromEntries(Object.keys(CAL).map((k) => [k, ['08:00']]));

describe('serviceLabel', () => {
  it('names the M réso day types', () => {
    expect(serviceLabel('X-LVHfi-Semaine', CAL)).toBe('Semaine (école)');
    expect(serviceLabel('X-LVIfi-Semaine', CAL)).toBe('Semaine (vacances)');
    expect(serviceLabel('X-SAHfi-Samedi', CAL)).toBe('Samedi');
    expect(serviceLabel('X-DFHfi-Dimanche', CAL)).toBe('Dimanche / férié');
  });

  it('falls back to the calendar period, then to the raw id', () => {
    expect(serviceLabel('X-other', CAL)).toBe('Service 05/01 → 20/03');
    expect(serviceLabel('unknown', CAL)).toBe('unknown');
  });
});

describe('sortedServices', () => {
  it('orders school week, holidays, Saturday, Sunday, then the others', () => {
    expect(sortedServices(SERVICES, CAL)).toEqual([
      'X-LVHfi-Semaine',
      'X-LVIfi-Semaine',
      'X-SAHfi-Samedi',
      'X-DFHfi-Dimanche',
      'X-other',
    ]);
  });
});

describe('todayService', () => {
  it('picks the service whose period and weekday match', () => {
    expect(todayService(SERVICES, CAL, new Date(2026, 10, 24))).toBe('X-LVHfi-Semaine'); // a Tuesday
    expect(todayService(SERVICES, CAL, new Date(2026, 10, 28))).toBe('X-SAHfi-Samedi');
    expect(todayService(SERVICES, CAL, new Date(2026, 10, 29))).toBe('X-DFHfi-Dimanche');
  });

  it('returns null outside every period', () => {
    expect(todayService(SERVICES, CAL, new Date(2030, 0, 1))).toBeNull();
  });
});

describe('time formatting', () => {
  it('converts between clock strings and seconds', () => {
    expect(toSec('07:32')).toBe(7 * 3600 + 32 * 60);
    expect(toSec('07:32:15')).toBe(7 * 3600 + 32 * 60 + 15);
    expect(hms(7 * 3600 + 32 * 60 + 15.9)).toBe('07:32:15');
    expect(hms(-5)).toBe('00:00:00');
    expect(hms(25 * 3600)).toBe('01:00:00');
    expect(hm(7 * 3600 + 32 * 60 + 15)).toBe('07:32');
  });

  it('formats the schedule deviation with its sign', () => {
    expect(delta(80)).toBe('+1:20');
    expect(delta(-45)).toBe('−0:45');
  });
});

describe('ServiceClock', () => {
  it('advances from the departure time and schedules stops', () => {
    const clock = new ServiceClock('08:00');
    clock.tick(90);
    expect(clock.t).toBe(8 * 3600 + 90);
    expect(clock.sched({ t: 120 })).toBe(8 * 3600 + 120);
    expect(clock.sched({})).toBe(8 * 3600);
  });
});

describe('readParams', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the game parameters from the URL', () => {
    vi.stubGlobal('location', { search: '?dir=1&dep=09:15&day=svc&bus=art&s=150&auto&map=2' });
    expect(readParams()).toEqual({
      dir: 1,
      dep: '09:15',
      day: 'svc',
      bus: 'art',
      s: 150,
      auto: true,
      nodecor: false,
      map: 2,
    });
  });

  it('uses defaults when the URL is empty', () => {
    vi.stubGlobal('location', { search: '' });
    expect(readParams()).toMatchObject({ dir: 0, dep: '07:32', day: '', bus: 'std', s: null, map: null });
  });
});
