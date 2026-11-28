// @ts-check
/**
 * Every bus of every line of the game at the game time (#130), for the minimap: each service runs its
 * timetable from data/grenoble/lines/network.json (dwelling at the stops like the other buses of the line,
 * without the traffic). Pure logic. Local frame: x east, y north.
 */
import { activeServices, toSec } from '../common/service.js';
import { scheduledPosition } from './fleet.js';

/**
 * @typedef {object} NetworkRoute
 * @property {number[]} xy one point every `step` m, [x0, y0, x1, y1, ...]
 * @property {number[]} stops [s0, t0, s1, t1, ...]: m along the route, s from the departure
 * @property {Record<string, string[]>} services departures "HH:MM" by service id
 */
/**
 * @typedef {object} NetworkData
 * @property {number} step m between two points of a route
 * @property {{id: string, color: string, calendar: import('../common/types.js').Calendar,
 *   routes: NetworkRoute[]}[]} lines
 */
/**
 * @typedef {object} RouteSchedule a route on one day
 * @property {string} line @property {string} color
 * @property {number[]} xy @property {{s: number, t: number}[]} stops
 * @property {number[]} departures s since midnight, sorted
 * @property {number} duration s from the departure to the end of the last dwell
 */
/** @typedef {{x: number, y: number, color: string, line: string}} NetworkBus */

/**
 * The routes of every line on a service date, with their departures of that day.
 * @param {NetworkData} network @param {string} ymd "YYYYMMDD"
 * @param {{dwellTime: number}} params
 * @returns {RouteSchedule[]}
 */
export function daySchedule(network, ymd, params) {
  /** @type {RouteSchedule[]} */
  const out = [];
  for (const line of network.lines) {
    const services = activeServices(line.calendar, ymd);
    for (const route of line.routes) {
      const times = new Set(services.flatMap((sid) => route.services[sid] ?? []));
      if (!times.size) continue;
      /** @type {{s: number, t: number}[]} */
      const stops = [];
      for (let k = 0; k + 1 < route.stops.length; k += 2)
        stops.push({ s: route.stops[k], t: route.stops[k + 1] });
      const last = stops[stops.length - 1];
      out.push({
        line: line.id,
        color: line.color,
        xy: route.xy,
        stops,
        departures: [...times].map(toSec).sort((a, b) => a - b),
        duration: (last?.t ?? 0) + params.dwellTime,
      });
    }
  }
  return out;
}

/**
 * Point `s` m along a route drawn every `step` m.
 * @param {number[]} xy @param {number} step @param {number} s
 */
export function pointAlong(xy, step, s) {
  const count = xy.length / 2;
  const f = Math.max(0, s / step);
  const k = Math.min(Math.floor(f), count - 1);
  if (k >= count - 1) return { x: xy[2 * (count - 1)], y: xy[2 * (count - 1) + 1] };
  const u = f - k;
  return {
    x: xy[2 * k] + (xy[2 * k + 2] - xy[2 * k]) * u,
    y: xy[2 * k + 1] + (xy[2 * k + 3] - xy[2 * k + 1]) * u,
  };
}

/**
 * Index of the first value not below `value` in a sorted list.
 * @param {number[]} sorted @param {number} value
 */
function lowerBound(sorted, value) {
  let lo = 0,
    hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Every bus running at `now` on the routes of the day, except the lines in `skip` (the chosen line, whose
 * buses are simulated in full).
 * @param {RouteSchedule[]} schedule @param {number} step @param {number} now s since midnight
 * @param {import('../settings/settings.js').Settings['fleet']} params @param {ReadonlySet<string>} skip
 * @returns {NetworkBus[]}
 */
export function networkBuses(schedule, step, now, params, skip) {
  /** @type {NetworkBus[]} */
  const out = [];
  for (const route of schedule) {
    if (skip.has(route.line)) continue;
    // only the departures of the last `duration` seconds can still be running
    for (let k = lowerBound(route.departures, now - route.duration); k < route.departures.length; k++) {
      const dep = route.departures[k];
      if (dep > now) break;
      const at = scheduledPosition(route.stops, now - dep, params);
      if (at) out.push({ ...pointAlong(route.xy, step, at.s), color: route.color, line: route.line });
    }
  }
  return out;
}
