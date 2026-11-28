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
  activeServices,
  dayLabel,
  dayTypeDates,
  dayTypeOn,
  runsOn,
  weekdaysOn,
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

describe('dayLabel', () => {
  it('names the M réso day types, nothing without one', () => {
    expect(dayLabel('school')).toBe('Semaine (école)');
    expect(dayLabel('holidays')).toBe('Semaine (vacances)');
    expect(dayLabel('saturday')).toBe('Samedi');
    expect(dayLabel('sunday')).toBe('Dimanche / férié');
    expect(dayLabel(null)).toBe('');
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

describe('runsOn and activeServices', () => {
  it('needs the date in the period and on a running weekday', () => {
    expect(runsOn(CAL['X-LVHfi-Semaine'], '20261124')).toBe(true); // a Tuesday
    expect(runsOn(CAL['X-LVHfi-Semaine'], '20261128')).toBe(false); // a Saturday
    expect(runsOn(CAL['X-LVHfi-Semaine'], '20270104')).toBe(false); // after the period
    expect(activeServices(CAL, '20261128')).toEqual(['X-SAHfi-Samedi']);
    expect(activeServices(CAL, '20300101')).toEqual([]);
  });
});

describe('dayTypeDates', () => {
  it('gives each day type the earliest date of its services, in menu order', () => {
    expect(dayTypeDates(CAL, new Date(2026, 10, 27))).toEqual([
      { type: 'school', date: '20261127' },
      { type: 'holidays', date: '20270101' },
      { type: 'saturday', date: '20261128' },
      { type: 'sunday', date: '20261129' },
    ]);
  });

  it('prefers the service of a split day type that runs first', () => {
    /** @type {import('../../src/common/types.js').Calendar} */
    const cal = {
      'P-DFfi-Dimanche-010': { days: '0000001', start: '20261213', end: '20261227' },
      'P-DFPfi-Dimanche-011': { days: '0000001', start: '20261129', end: '20261206' },
    };
    expect(dayTypeDates(cal, new Date(2026, 10, 27))).toEqual([{ type: 'sunday', date: '20261129' }]);
  });
});

describe('dayTypeOn and weekdaysOn', () => {
  it('reads the day type and the weekdays of the services of a date', () => {
    expect(dayTypeOn(CAL, '20261124')).toBe('school');
    expect(dayTypeOn(CAL, '20260106')).toBeNull(); // only X-other runs
    expect(weekdaysOn(CAL, '20261124')).toBe('1111100');
    expect(weekdaysOn(CAL, '20300101')).toBe('0000000');
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
        '?line=N62&route=3&date=20261224&dep=09:15&day=20261223&bus=art&s=150&auto&map=2&debug&stop=saint-laurent&stress=200&at=-2990,-1332.5,90',
    });
    expect(readParams()).toEqual({
      line: 'N62',
      route: 3,
      date: '20261224',
      dep: '09:15',
      day: '20261223',
      bus: 'art',
      s: 150,
      auto: true,
      nodecor: false,
      map: 2,
      debug: true,
      stop: 'saint-laurent',
      stress: 200,
      at: { x: -2990, y: -1332.5, h: Math.PI / 2 },
    });
  });

  it('reads a place without heading and ignores a malformed one', () => {
    vi.stubGlobal('location', { search: '?at=10,20' });
    expect(readParams().at).toEqual({ x: 10, y: 20, h: null });
    for (const at of ['10', '10,a', '1,2,3,4', '']) {
      vi.stubGlobal('location', { search: '?at=' + at });
      expect(readParams().at).toBeNull();
    }
  });

  it('uses defaults when the URL is empty', () => {
    vi.stubGlobal('location', { search: '' });
    expect(readParams()).toMatchObject({
      line: '17',
      route: 0,
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
