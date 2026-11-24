// @ts-check
/** Services (jours, departs) tires du GTFS, partages par la page d'accueil et les deux moteurs. */

/** Libelle lisible d'un service GTFS M reso. */
export function serviceLabel(sid, cal) {
  const c = cal[sid];
  if (/Dimanche/i.test(sid)) return 'Dimanche / férié';
  if (/Samedi/i.test(sid)) return 'Samedi';
  if (/LVI/.test(sid)) return 'Semaine (vacances)';
  if (/LVH/.test(sid)) return 'Semaine (école)';
  if (c) return `Service ${c.start.slice(6)}/${c.start.slice(4, 6)} → ${c.end.slice(6)}/${c.end.slice(4, 6)}`;
  return sid;
}

const ORDER = ['Semaine (école)', 'Semaine (vacances)', 'Samedi', 'Dimanche / férié'];
/** services tries dans un ordre naturel */
export function sortedServices(services, cal) {
  return Object.keys(services).sort((a, b) => {
    const ia = ORDER.indexOf(serviceLabel(a, cal)),
      ib = ORDER.indexOf(serviceLabel(b, cal));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

/** service valable aujourd'hui (date dans la periode et jour de semaine coche), sinon null */
export function todayService(services, cal, now = new Date()) {
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const dow = (now.getDay() + 6) % 7; // lundi = 0
  for (const sid of Object.keys(services)) {
    const c = cal[sid];
    if (c && c.days[dow] === '1' && +c.start <= ymd && ymd <= +c.end) return sid;
  }
  return null;
}

export const toSec = (hm) => {
  const [h, m, s] = hm.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
};
const pad = (n) => String(n).padStart(2, '0');
export const hms = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};
export const hm = (s) => hms(s).slice(0, 5);
/** ecart horaire lisible : +1:20 (retard) / -0:45 (avance) */
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
  constructor(dep) {
    this.t0 = toSec(dep);
    this.t = this.t0;
  }
  tick(dt) {
    this.t += dt;
  }
  /** heure theorique de passage a un arret */
  sched(stop) {
    return this.t0 + (stop.t || 0);
  }
}
