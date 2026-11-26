// @ts-check
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ServiceClock,
  delta,
  hm,
  hms,
  alignDate,
  dateLabel,
  parisToUtc,
  readParams,
  serviceDate,
  serviceDayType,
  serviceLabel,
  sortedServices,
  todayService,
  toSec,
} from '../../src/common/service.js';
import { setMessages } from '../../src/i18n/i18n.js';
import fr from '../../src/i18n/fr.json';

beforeAll(() => setMessages(fr));

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

describe('serviceDayType', () => {
  it('decodes the M réso day type from the service id', () => {
    expect(serviceDayType('X-LVHfi-Semaine')).toBe('school');
    expect(serviceDayType('X-LVIfi-Semaine')).toBe('holidays');
    expect(serviceDayType('X-SAHfi-Samedi')).toBe('saturday');
    expect(serviceDayType('X-DFHfi-Dimanche')).toBe('sunday');
    expect(serviceDayType('X-other')).toBeNull();
  });
});

describe('sortedServices', () => {
  it('orders school week, holidays, Saturday, Sunday, then the others', () => {
    expect(sortedServices(SERVICES)).toEqual([
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
    vi.stubGlobal('location', {
      search:
        '?dir=1&date=20261224&dep=09:15&day=svc&bus=art&s=150&auto&map=2&debug&stop=saint-laurent&stress=200',
    });
    expect(readParams()).toEqual({
      dir: 1,
      date: '20261224',
      dep: '09:15',
      day: 'svc',
      bus: 'art',
      s: 150,
      auto: true,
      nodecor: false,
      map: 2,
      debug: true,
      stop: 'saint-laurent',
      stress: 200,
    });
  });

  it('uses defaults when the URL is empty', () => {
    vi.stubGlobal('location', { search: '' });
    expect(readParams()).toMatchObject({
      dir: 0,
      date: '',
      dep: '07:32',
      day: '',
      bus: 'std',
      s: null,
      map: null,
      debug: false,
      stop: '',
      stress: 0,
    });
  });
});

describe('serviceDate', () => {
  it('is today when the service runs today', () => {
    // Saturday 2026-09-05
    expect(serviceDate('X-SAHfi-Samedi', CAL, new Date(2026, 8, 5, 10))).toBe('20260905');
  });

  it('is the next running day in the period', () => {
    // Thursday 2026-09-03 -> Sunday 2026-09-06
    expect(serviceDate('X-DFHfi-Dimanche', CAL, new Date(2026, 8, 3))).toBe('20260906');
    // before the period: its first running day, Monday 2027-01-04
    expect(serviceDate('X-LVIfi-Semaine', CAL, new Date(2026, 11, 20))).toBe('20270101');
  });

  it('is the last running day of a period that is over, else today', () => {
    // Friday 2026-03-20 is the last day of X-other
    expect(serviceDate('X-other', CAL, new Date(2026, 5, 1))).toBe('20260320');
    expect(serviceDate('X-none', CAL, new Date(2026, 5, 1))).toBe('20260601');
    const never = { 'X-never': { days: '0000000', start: '20260101', end: '20260110' } };
    expect(serviceDate('X-never', never, new Date(2026, 5, 1))).toBe('20260601');
  });
});

describe('parisToUtc', () => {
  it('is UTC+1 in winter and UTC+2 in summer time', () => {
    expect(new Date(parisToUtc('20261126', 7 * 3600 + 32 * 60)).toISOString()).toBe(
      '2026-11-26T06:32:00.000Z',
    );
    expect(new Date(parisToUtc('20260621', 12 * 3600)).toISOString()).toBe('2026-06-21T10:00:00.000Z');
  });

  it('changes on the last Sundays of March and October at 01:00 UT', () => {
    // 2026: summer time from Sunday 29 March to Sunday 25 October
    expect(new Date(parisToUtc('20260329', 1 * 3600)).toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(new Date(parisToUtc('20260329', 4 * 3600)).toISOString()).toBe('2026-03-29T02:00:00.000Z');
    expect(new Date(parisToUtc('20261025', 4 * 3600)).toISOString()).toBe('2026-10-25T03:00:00.000Z');
    expect(new Date(parisToUtc('20261024', 4 * 3600)).toISOString()).toBe('2026-10-24T02:00:00.000Z');
  });

  it('puts times past midnight on the next day', () => {
    expect(new Date(parisToUtc('20261126', 25 * 3600)).toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });
});

describe('dateLabel', () => {
  it('names the day in the language of the page', () => {
    expect(dateLabel('20261126', 'fr')).toBe('jeudi 26 novembre');
  });
});

describe('alignDate', () => {
  it('keeps a running day and moves to the nearest running day otherwise', () => {
    // Saturday 2026-07-18 with weekdays only: Friday 17 is one day before, Monday 20 two days after
    expect(alignDate('20260720', '1111100')).toBe('20260720');
    expect(alignDate('20260718', '1111100')).toBe('20260717');
    expect(alignDate('20260719', '1111100')).toBe('20260720');
    expect(alignDate('20260715', '0000001')).toBe('20260712');
  });

  it('keeps the date without a calendar', () => {
    expect(alignDate('20260718', undefined)).toBe('20260718');
    expect(alignDate('20260718', '0000000')).toBe('20260718');
  });
});
