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
    dep: q.get('dep') || '07:32',
    day: q.get('day') || '',
    bus: q.get('bus') || 'std',
    s: q.has('s') ? +(q.get('s') || 0) : null,
    auto: q.has('auto'),
    nodecor: q.has('nodecor'),
    map: q.has('map') ? +(q.get('map') || 1) : null,
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
