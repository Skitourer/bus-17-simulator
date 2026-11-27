// @ts-check
/**
 * Lines of the game (ADR 0010): the routes of a line grouped by direction, and the departures of a direction
 * on a service date, shared by the menu and the game. Pure logic.
 */
import { activeServices } from './service.js';

/**
 * Directions of a line in the order of the file, each with its routes; the first route of a direction is
 * its main one (the longest, written first by tools/build_line.py).
 * @param {import('./types.js').LineData} line
 * @returns {{direction: number, routes: number[]}[]}
 */
export function directionsOf(line) {
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  line.routes.forEach((route, i) => {
    const list = groups.get(route.direction);
    if (list) list.push(i);
    else groups.set(route.direction, [i]);
  });
  return [...groups].map(([direction, routes]) => ({ direction, routes }));
}

/**
 * Departures of the routes on a service date: the union of the services running that day, by time.
 * @param {import('./types.js').LineData} line @param {number[]} routes route indices
 * @param {string} ymd service date "YYYYMMDD"
 * @returns {{time: string, route: number}[]}
 */
export function departuresOf(line, routes, ymd) {
  const services = activeServices(line.calendar, ymd);
  /** @type {{time: string, route: number}[]} */
  const out = [];
  for (const route of routes) {
    const times = new Set(services.flatMap((sid) => line.routes[route].services[sid] ?? []));
    for (const time of times) out.push({ time, route });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.route - b.route);
}

/**
 * How a route differs from the main route of its direction: its own terminus, else its own first stop;
 * null for the main route or a route with the same ends.
 * @param {import('./types.js').LineData} line @param {number} route @param {number} main
 * @returns {{kind: 'to' | 'from', stop: string} | null}
 */
export function routeNote(line, route, main) {
  if (route === main) return null;
  const stops = line.routes[route].stops,
    mainStops = line.routes[main].stops;
  const last = stops[stops.length - 1].name;
  if (last !== mainStops[mainStops.length - 1].name) return { kind: 'to', stop: last };
  if (stops[0].name !== mainStops[0].name) return { kind: 'from', stop: stops[0].name };
  return null;
}
