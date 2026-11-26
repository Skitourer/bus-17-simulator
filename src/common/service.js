// @ts-check
/** Services (jours, departs) tires du GTFS, partages par la page d'accueil et le jeu. */
import { t } from '../i18n/i18n.js';

/** M réso day types, in menu order. */
const DAY_TYPES = /** @type {const} */ (['school', 'holidays', 'saturday', 'sunday']);

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

/**
 * Libelle lisible d'un service GTFS M reso.
 * @param {string} sid @param {import('./types.js').Calendar} cal
 */
export function serviceLabel(sid, cal) {
  const type = serviceDayType(sid);
  if (type) return t('service.' + type);
  const c = cal[sid];
  if (c)
    return t('service.period', {
      start: `${c.start.slice(6)}/${c.start.slice(4, 6)}`,
      end: `${c.end.slice(6)}/${c.end.slice(4, 6)}`,
    });
  return sid;
}

/**
 * services tries dans un ordre naturel (ecole, vacances, samedi, dimanche, puis les autres)
 * @param {Record<string, string[]>} services
 */
export function sortedServices(services) {
  /** @param {string} sid */
  const rank = (sid) => {
    const type = serviceDayType(sid);
    return type ? DAY_TYPES.indexOf(type) : DAY_TYPES.length;
  };
  return Object.keys(services).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * service valable aujourd'hui (date dans la periode et jour de semaine coche), sinon null
 * @param {Record<string, string[]>} services @param {import('./types.js').Calendar} cal
 * @returns {string|null}
 */
export function todayService(services, cal, now = new Date()) {
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const dow = (now.getDay() + 6) % 7; // lundi = 0
  for (const sid of Object.keys(services)) {
    const c = cal[sid];
    if (c && c.days[dow] === '1' && +c.start <= ymd && ymd <= +c.end) return sid;
  }
  return null;
}

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

/** Parametres de partie passes dans l'URL par la page d'accueil. */
export function readParams() {
  const q = new URLSearchParams(location.search);
  return {
    dir: +(q.get('dir') || 0),
    // game date "YYYYMMDD" (#55); empty: derived from the service
    date: /^\d{8}$/.test(q.get('date') || '') ? q.get('date') || '' : '',
    dep: q.get('dep') || '07:32',
    day: q.get('day') || '',
    bus: q.get('bus') || 'std',
    s: q.has('s') ? +(q.get('s') || 0) : null,
    auto: q.has('auto'),
    nodecor: q.has('nodecor'),
    map: q.has('map') ? +(q.get('map') || 1) : null,
    debug: q.has('debug'),
    stop: q.get('stop') || '',
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
