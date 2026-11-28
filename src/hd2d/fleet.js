// @ts-check
/**
 * The other buses of the line (#48): every service of the chosen day running at the game time, in both
 * directions, placed from the GTFS timetable. A bus dwells at each stop, slows down before it, and waits
 * behind the player's bus (or the bus ahead of it) instead of running into it, and at the red lights (#85),
 * then catches up with its timetable. Pure logic, no Three.js. Local frame: x east, y north, heading = math angle.
 */

import { approachSpeed, stopLineAhead } from './signals.js';

/** @typedef {import('../settings/settings.js').Settings['fleet']} FleetSettings */
/** @typedef {import('../world/track.js').Track} Track */
/** @typedef {{s: number, t: number}} TimedStop distance along the route (m) and time from the departure (s) */
/** @typedef {import('./signals.js').RouteStopLine} RouteStopLine */
/**
 * @typedef {object} FleetSignals traffic lights the buses obey
 * @property {(group: number, phase: 0 | 1) => import('./signals.js').Light} light
 * @property {number} braking @property {number} maxBraking decelerations (m/s²)
 * @property {number} atLine reach of a stop line (m)
 */

/**
 * Where a service is `elapsed` s after its departure: dwelling at a stop, or between two stops with a
 * smooth start and stop. Null before the departure and once the last dwell is over.
 * @param {readonly TimedStop[]} stops @param {number} elapsed @param {FleetSettings} params
 * @returns {{s: number, dwelling: boolean} | null} `s` = front door position along the route (m)
 */
export function scheduledPosition(stops, elapsed, params) {
  const last = stops[stops.length - 1];
  if (elapsed < 0 || !last || elapsed > last.t + params.dwellTime) return null;
  let i = 0;
  while (i + 1 < stops.length && stops[i + 1].t <= elapsed) i++;
  if (i === stops.length - 1) return { s: last.s, dwelling: true };
  const a = stops[i],
    b = stops[i + 1];
  // the dwell never takes more than its share of the time to the next stop
  const leave = a.t + Math.min(params.dwellTime, (b.t - a.t) * params.maxDwellShare);
  if (elapsed < leave) return { s: a.s, dwelling: true };
  const f = (elapsed - leave) / (b.t - leave);
  const eased = f * f * (3 - 2 * f); // slow start after the stop, slow arrival at the next one
  return { s: a.s + (b.s - a.s) * eased, dwelling: false };
}

/**
 * Nearest point of the route to (x, y), between its points, searched within `window` m of `hint` (whole
 * route when 0).
 * @param {Track} track @param {number} x @param {number} y @param {number} hint @param {number} window
 */
export function projectOnTrack(track, x, y, hint, window) {
  const i0 = window ? Math.max(0, Math.floor((hint - window) / track.step)) : 0;
  const i1 = window ? Math.min(track.n - 1, Math.ceil((hint + window) / track.step)) : track.n - 1;
  let best = Infinity,
    bi = i0;
  for (let i = i0; i <= i1; i++) {
    const d = (track.x[i] - x) ** 2 + (track.y[i] - y) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  // between the points: the nearest of the two segments around the nearest point
  let s = bi * track.step,
    d = Math.sqrt(best);
  for (const i of [bi - 1, bi]) {
    if (i < i0 || i + 1 > i1) continue;
    const dx = track.x[i + 1] - track.x[i],
      dy = track.y[i + 1] - track.y[i];
    const t = Math.max(
      0,
      Math.min(1, ((x - track.x[i]) * dx + (y - track.y[i]) * dy) / (dx * dx + dy * dy || 1)),
    );
    const dist = Math.hypot(track.x[i] + dx * t - x, track.y[i] + dy * t - y);
    if (dist < d) {
      d = dist;
      s = (i + t) * track.step;
    }
  }
  return { s, d, h: track.h[bi] };
}

/** @param {number} a */
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * @typedef {object} FleetBus
 * @property {number} dir direction index @property {number} dep departure (s since midnight)
 * @property {number} s front door position along its route (m) @property {number} v speed (m/s)
 * @property {boolean} dwelling
 * @property {boolean} braking slowing down or standing: its brake lights are on (#87)
 * @property {number} x @property {number} y @property {number} z @property {number} h centre of the bus (z: route
 *   altitude, on the deck over a bridge) and heading
 */

/**
 * @typedef {object} FleetDirection
 * @property {Track} track @property {number[]} departures departure times (s since midnight)
 * @property {(s: number) => number} lane offset of the bus lane at `s` (m to the right)
 * @property {RouteStopLine[]} [lines] stop lines of the traffic lights along the route
 */

export class Fleet {
  /**
   * @param {FleetDirection[]} directions by direction index
   * @param {FleetSettings} params
   * @param {{bodyLength: number, bodyWidth: number, frontDoorSetback: number}} bus shape of the other buses
   * @param {{dir: number, dep: number}} own the player's service, never drawn twice
   * @param {FleetSignals | null} [signals] traffic lights the buses stop at
   */
  constructor(directions, params, bus, own, signals = null) {
    this.directions = directions;
    this.signals = signals;
    this.p = params;
    this.bus = bus;
    this.own = own;
    /** @type {Map<string, FleetBus>} running buses by "direction:departure" */
    this.running = new Map();
    /** player's position along each route, for the next search */
    this.hints = directions.map(() => 0);
  }

  /** @returns {FleetBus[]} */
  get buses() {
    return [...this.running.values()];
  }

  /**
   * Move every running service to the game time `now`, behind the player's bus and the bus ahead.
   * @param {number} now game time (s since midnight) @param {number} dt
   * @param {{x: number, y: number, h: number, length: number}} player centre, heading and overall length
   */
  update(now, dt, player) {
    /** @type {Map<string, FleetBus>} */
    const next = new Map();
    this.directions.forEach((direction, dir) => {
      /** @type {number[]} back of what blocks the buses of this direction, along its route (m) */
      const blockers = [];
      let p = projectOnTrack(direction.track, player.x, player.y, this.hints[dir], this.p.searchWindow);
      // far from where it was (teleported, or on another street): search the whole route
      if (p.d > this.p.searchWindow / 2) p = projectOnTrack(direction.track, player.x, player.y, 0, 0);
      this.hints[dir] = p.s;
      // the player blocks this direction when driving in its lane, the same way
      if (p.d < this.p.laneTolerance && Math.abs(wrapAngle(player.h - p.h)) < this.p.headingTolerance)
        blockers.push(p.s - player.length / 2);
      /** @type {{key: string, dep: number, target: {s: number, dwelling: boolean}}[]} */
      const wanted = [];
      for (const dep of direction.departures) {
        if (dir === this.own.dir && dep === this.own.dep) continue;
        const target = scheduledPosition(direction.track.stops, now - dep, this.p);
        if (target) wanted.push({ key: dir + ':' + dep, dep, target });
      }
      // leading bus first, so that each bus knows where the one ahead of it stands
      wanted.sort((a, b) => b.target.s - a.target.s);
      const setback = this.bus.frontDoorSetback;
      for (const { key, dep, target } of wanted) {
        const previous = this.running.get(key);
        // towards the timetable, never backwards, at most catchUpSpeed when late
        let s = previous
          ? previous.s + Math.max(0, Math.min(target.s - previous.s, this.p.catchUpSpeed * dt))
          : target.s;
        const wasFront = (previous ? previous.s : s) + setback;
        const signals = this.signals;
        if (previous && signals && direction.lines) {
          const gap = stopLineAhead(direction.lines, wasFront, signals.light, previous.v, signals);
          // a comfortable stop at the line: never faster than what still stops there
          if (gap !== null)
            s = Math.min(s, previous.s + Math.min(gap, approachSpeed(gap, signals.braking) * dt));
        }
        for (const back of blockers)
          // only what is ahead blocks: a bus already alongside or past keeps going
          if (wasFront <= back && s + setback > back - this.p.gap) s = back - this.p.gap - setback;
        if (previous) s = Math.max(previous.s, s);
        const centre = s + setback - this.bus.bodyLength / 2;
        const pos = direction.track.pos(centre, direction.lane(centre));
        // a bus never appears on top of the player's bus: it waits at the depot until there is room
        const room = (this.bus.bodyLength + player.length) / 2 + this.p.gap;
        if (!previous && Math.hypot(pos.x - player.x, pos.y - player.y) < room) continue;
        const dwelling = target.dwelling && Math.abs(target.s - s) < 1;
        const v = previous && dt > 0 ? (s - previous.s) / dt : 0;
        const braking = v < this.p.brakeSpeed || (previous !== undefined && v < previous.v - 1e-6);
        next.set(key, { dir, dep, s, v, dwelling, braking, x: pos.x, y: pos.y, z: pos.z, h: pos.h });
        blockers.push(s + setback - this.bus.bodyLength);
      }
    });
    this.running = next;
  }

  /**
   * Whether (x, y) is inside one of the running buses (obstacle for the player's bus).
   * @param {number} x @param {number} y
   */
  hit(x, y) {
    const halfLength = this.bus.bodyLength / 2,
      halfWidth = this.bus.bodyWidth / 2;
    for (const b of this.running.values()) {
      const dx = x - b.x,
        dy = y - b.y;
      if (dx * dx + dy * dy > halfLength * halfLength + halfWidth * halfWidth) continue;
      const along = dx * Math.cos(b.h) + dy * Math.sin(b.h),
        across = -dx * Math.sin(b.h) + dy * Math.cos(b.h);
      if (Math.abs(along) <= halfLength && Math.abs(across) <= halfWidth) return true;
    }
    return false;
  }
}
