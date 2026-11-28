// @ts-check
/** Services (jours, departs) tires du GTFS, partages par la page d'accueil et le jeu. */
import { t } from '../i18n/i18n.js';

/** M réso day types, in menu order. @typedef {(typeof DAY_TYPES)[number]} DayType */
export const DAY_TYPES = /** @type {const} */ (['school', 'holidays', 'saturday', 'sunday']);

/**
 * Day type encoded in an M réso service id (LVH = school weekdays, LVI = holiday weekdays), or null.
 * @param {string} sid
 * @returns {(typeof DAY_TYPES)[number] | null}
 */
export function serviceDayType(sid) {
  if (/Dimanche/i.test(sid)) return 'sunday';
  if (/Samedi/i.test(sid)) return 'saturday';
  if (/LVI/.test(sid)) return 'holidays';
  if (/LVH/.test(sid)) return 'school';
  return null;
}

/** Name of a day type for the player, '' without one. @param {DayType | null} type */
export const dayLabel = (type) => (type ? t('service.' + type) : '');

/** Calendar date "YYYYMMDD" of a UTC midnight timestamp. @param {number} ms */
const ymdOf = (ms) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
/** UTC midnight timestamp of a calendar date "YYYYMMDD". @param {string} ymd */
const midnightOf = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
const DAY_MS = 86400000;

/**
 * Date of the game (#55) for a service: today when the service runs today, else its next running day in its
 * period, else its last one (period over); today when the calendar does not know the service.
 * @param {string} sid @param {import('./types.js').Calendar} cal @param {Date} now local date of the player
 * @returns {string} "YYYYMMDD"
 */
export function serviceDate(sid, cal, now) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const c = cal[sid];
  if (!c) return ymdOf(today);
  const start = midnightOf(c.start),
    end = midnightOf(c.end);
  // 1970-01-01 was a Thursday: Monday is 0 as in the GTFS days string
  /** @param {number} ms */
  const runs = (ms) => c.days[(Math.floor(ms / DAY_MS) + 3) % 7] === '1';
  for (let ms = Math.max(today, start); ms <= end; ms += DAY_MS) if (runs(ms)) return ymdOf(ms);
  for (let ms = end; ms >= start; ms -= DAY_MS) if (runs(ms)) return ymdOf(ms);
  return ymdOf(today);
}

/**
 * Whether a calendar entry runs on a date (in its period and on its weekday).
 * @param {import('./types.js').CalendarEntry} entry @param {string} ymd "YYYYMMDD"
 */
export function runsOn(entry, ymd) {
  return entry.start <= ymd && ymd <= entry.end && entry.days[weekday(ymd)] === '1';
}

/** Weekday of a date, Monday = 0 as in the GTFS days string (1970-01-01 was a Thursday). @param {string} ymd */
const weekday = (ymd) => (Math.floor(midnightOf(ymd) / DAY_MS) + 3) % 7;

/**
 * Services of a calendar that run on a date: the timetable of that day is the union of their departures.
 * @param {import('./types.js').Calendar} cal @param {string} ymd "YYYYMMDD"
 */
export function activeServices(cal, ymd) {
  return Object.keys(cal).filter((sid) => runsOn(cal[sid], ymd));
}

/**
 * Day types of a calendar, in menu order, each with the date whose timetable it shows: the earliest of the
 * service dates of its services (today, the next running day, or the last one of a period that is over).
 * @param {import('./types.js').Calendar} cal @param {Date} now local date of the player
 * @returns {{type: DayType, date: string}[]}
 */
export function dayTypeDates(cal, now) {
  /** @type {Map<DayType, string>} */
  const best = new Map();
  for (const sid of Object.keys(cal)) {
    const type = serviceDayType(sid);
    if (!type) continue;
    const date = serviceDate(sid, cal, now);
    const known = best.get(type);
    if (!known || date < known) best.set(type, date);
  }
  return DAY_TYPES.filter((type) => best.has(type)).map((type) => ({
    type,
    date: /** @type {string} */ (best.get(type)),
  }));
}

/**
 * Day type of the services running on a date, or null when none of them has one.
 * @param {import('./types.js').Calendar} cal @param {string} ymd "YYYYMMDD"
 * @returns {DayType | null}
 */
export function dayTypeOn(cal, ymd) {
  for (const sid of activeServices(cal, ymd)) {
    const type = serviceDayType(sid);
    if (type) return type;
  }
  return null;
}

/**
 * Weekdays on which the services of a date run (seven "0"/"1" flags, Monday first), to keep a game date
 * on the same kind of day.
 * @param {import('./types.js').Calendar} cal @param {string} ymd "YYYYMMDD"
 */
export function weekdaysOn(cal, ymd) {
  const flags = [0, 1, 2, 3, 4, 5, 6].map((d) =>
    activeServices(cal, ymd).some((sid) => cal[sid].days[d] === '1') ? '1' : '0',
  );
  return flags.join('');
}

/**
 * The nearest day to `ymd` (the day itself first, then one day after, one before, two after...) on which
 * a service runs, by its weekdays: a date chosen for its season keeps a timetable of the right day type.
 * @param {string} ymd "YYYYMMDD" @param {string | undefined} days seven "0"/"1" flags, Monday first
 * @returns {string} "YYYYMMDD"
 */
export function alignDate(ymd, days) {
  if (!days || !days.includes('1')) return ymd;
  const day = midnightOf(ymd);
  for (const shift of [0, 1, -1, 2, -2, 3, -3]) {
    const ms = day + shift * DAY_MS;
    if (days[(Math.floor(ms / DAY_MS) + 3) % 7] === '1') return ymdOf(ms);
  }
  return ymd;
}

/**
 * Date of the game for the player, e.g. "jeudi 26 novembre".
 * @param {string} ymd "YYYYMMDD" @param {string} language BCP 47 tag of the page
 */
export function dateLabel(ymd, language) {
  return new Intl.DateTimeFormat(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(midnightOf(ymd));
}

/**
 * Last Sunday of a month at 01:00 UT, when European summer time starts (March) or ends (October)
 * (EU directive 2000/84/EC). @param {number} year @param {number} month 0-based
 */
function lastSundayOneUtc(year, month) {
  const last = Date.UTC(year, month + 1, 0, 1);
  return last - new Date(last).getUTCDay() * DAY_MS;
}

/**
 * Instant of a local time in Grenoble (Europe/Paris: UTC+1, UTC+2 in summer time), whatever the time zone
 * of the player's computer. Times past 24:00 (late services) fall on the next day.
 * @param {string} ymd "YYYYMMDD" @param {number} seconds since local midnight
 * @returns {number} milliseconds since 1970-01-01 0h UT
 */
export function parisToUtc(ymd, seconds) {
  const winter = midnightOf(ymd) + seconds * 1000 - 3600000;
  const year = new Date(winter).getUTCFullYear();
  const summer = winter >= lastSundayOneUtc(year, 2) && winter < lastSundayOneUtc(year, 9);
  return summer ? winter - 3600000 : winter;
}

/** @param {string} hm "HH:MM" or "HH:MM:SS" */
export const toSec = (hm) => {
  const [h, m, s] = hm.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');
/** @param {number} s seconds since midnight */
export const hms = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};
/** @param {number} s seconds since midnight */
export const hm = (s) => hms(s).slice(0, 5);
/** ecart horaire lisible : +1:20 (retard) / -0:45 (avance) @param {number} s */
export const delta = (s) =>
  `${s >= 0 ? '+' : '−'}${Math.floor(Math.abs(s) / 60)}:${pad(Math.round(Math.abs(s)) % 60)}`;

/** A date parameter "YYYYMMDD", or '' when missing or malformed. @param {string | null} value */
const ymdParam = (value) => (/^\d{8}$/.test(value || '') ? value || '' : '');

/**
 * A place of the map "x,y[,heading]" (m, m, degrees), or null when missing or malformed.
 * @param {string | null} value @returns {{x: number, y: number, h: number | null} | null}
 */
function placeParam(value) {
  const parts = (value || '').split(',').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((v) => !Number.isFinite(v))) return null;
  return { x: parts[0], y: parts[1], h: parts.length === 3 ? (parts[2] * Math.PI) / 180 : null };
}

/**
 * A camera place "x,y,height,heading,pitch" (m, m, m, degrees, degrees), or null when missing or malformed.
 * @param {string | null} value
 * @returns {{x: number, y: number, height: number, yaw: number, pitch: number} | null}
 */
function eyeParam(value) {
  const parts = (value || '').split(',').map(Number);
  if (parts.length !== 5 || parts.some((v) => !Number.isFinite(v))) return null;
  const [x, y, height, yaw, pitch] = parts;
  return { x, y, height, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 };
}

/** Parametres de partie passes dans l'URL par la page d'accueil. */
export function readParams() {
  const q = new URLSearchParams(location.search);
  return {
    line: q.get('line') || '17',
    // index of the route in the line file (one route per trip pattern, ADR 0010)
    route: Math.max(0, Math.floor(+(q.get('route') || 0)) || 0),
    // game date "YYYYMMDD" (#55); empty: the service date
    date: ymdParam(q.get('date')),
    dep: q.get('dep') || '07:32',
    // service date "YYYYMMDD": its timetable is the one of the game
    day: ymdParam(q.get('day')),
    bus: q.get('bus') || 'std',
    s: q.has('s') ? +(q.get('s') || 0) : null,
    auto: q.has('auto'),
    nodecor: q.has('nodecor'),
    map: q.has('map') ? +(q.get('map') || 1) : null,
    debug: q.has('debug'),
    stop: q.get('stop') || '',
    // debug start at a place of the map: "x,y" or "x,y,heading" (m, m, degrees from east, counter-clockwise)
    at: placeParam(q.get('at')),
    // debug free-flight camera at start: "x,y,height,heading,pitch" (m, m, m above the ground, degrees from
    // east counter-clockwise, degrees down)
    eye: eyeParam(q.get('eye')),
    stress: Math.max(0, Math.floor(+(q.get('stress') || 0)) || 0),
  };
}

/** Horloge de service : heure de depart + temps de jeu ecoule. */
export class ServiceClock {
  /** @param {string} dep departure time "HH:MM" */
  constructor(dep) {
    this.t0 = toSec(dep);
    this.t = this.t0;
  }
  /** @param {number} dt */
  tick(dt) {
    this.t += dt;
  }
  /** heure theorique de passage a un arret @param {{t?: number}} stop */
  sched(stop) {
    return this.t0 + (stop.t || 0);
  }
}
