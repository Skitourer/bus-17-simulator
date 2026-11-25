// @ts-check
/**
 * Serving the stops (#37): the front doors, the stop requests drawn for a service, and the outcome of each
 * stop (served, missed, or passed without request). Pure logic, no DOM and no WebGL.
 */

/** @typedef {import('../settings/settings.js').Settings} Settings */

/**
 * Who wants this stop: someone on board asking to get off, and people waiting at the stop.
 * @typedef {{alight: boolean, board: boolean}} StopRequest
 */

/**
 * Small deterministic random generator (mulberry32): the same service always gets the same requests.
 * @param {number} seed
 */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seed of a service from its departure time and direction.
 * @param {string} departure "HH:MM" @param {number} direction
 */
export function serviceSeed(departure, direction) {
  let h = 2166136261;
  for (const ch of `${departure}/${direction}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Requests of every stop of a service. Nobody gets off at the first stop and nobody boards at the terminus,
 * where everybody gets off.
 * @param {number} count number of stops @param {number} seed @param {Settings['gameplay']} gameplay
 * @returns {StopRequest[]}
 */
export function drawRequests(count, seed, gameplay) {
  const next = random(seed);
  return Array.from({ length: count }, (_, i) => {
    const alight = next() < gameplay.alightProbability;
    const board = next() < gameplay.boardProbability;
    if (i === count - 1) return { alight: true, board: false };
    return { alight: i > 0 && alight, board };
  });
}

/** Front doors: closed, opening, open or closing; they move in `doorMoveTime` seconds. */
export class Doors {
  /** @param {Settings['gameplay']} gameplay */
  constructor(gameplay) {
    this.g = gameplay;
    /** @type {'closed' | 'opening' | 'open' | 'closing'} */
    this.state = 'closed';
    this.t = 0;
  }

  get closed() {
    return this.state === 'closed';
  }

  get open() {
    return this.state === 'open';
  }

  /**
   * Doors button. Returns 'tooFast' when the bus is still moving (the doors stay closed), else null.
   * @param {number} speed m/s
   * @returns {'tooFast' | null}
   */
  toggle(speed) {
    if (this.state === 'closed' || this.state === 'closing') {
      if (Math.abs(speed) >= this.g.stopSpeed) return 'tooFast';
      this.start('opening');
    } else this.start('closing');
    return null;
  }

  /** @param {'opening' | 'closing'} state */
  start(state) {
    // reversing a movement halfway takes only the time already spent
    this.t = this.state === 'closed' || this.state === 'open' ? 0 : this.g.doorMoveTime - this.t;
    this.state = state;
  }

  /** @param {number} dt */
  update(dt) {
    if (this.state !== 'opening' && this.state !== 'closing') return;
    this.t += dt;
    if (this.t >= this.g.doorMoveTime) {
      this.state = this.state === 'opening' ? 'open' : 'closed';
      this.t = 0;
    }
  }

  /** Close at once (bus moved by the debug mode). */
  reset() {
    this.state = 'closed';
    this.t = 0;
  }
}

/**
 * @typedef {object} ServiceStop
 * @property {string} name
 * @property {number} s distance along the route (m)
 * @property {boolean} [served]
 * @property {boolean} [missed]
 */

/**
 * @typedef {{type: 'served' | 'missed' | 'passed', index: number}} StopEvent
 */

/** Progress through the stops of a service. */
export class StopService {
  /**
   * @param {ServiceStop[]} stops updated in place (`served`, `missed`) for the displays
   * @param {StopRequest[]} requests @param {Settings['gameplay']} gameplay
   */
  constructor(stops, requests, gameplay) {
    this.stops = stops;
    this.requests = requests;
    this.g = gameplay;
    this.next = 0;
    /** time spent with the doors open at the next stop (s) */
    this.dwell = 0;
    this.reset(-Infinity);
  }

  /**
   * Stops behind `progress` are missed, the others still to serve.
   * @param {number} progress distance along the route (m)
   */
  reset(progress) {
    const i = this.stops.findIndex((st) => st.s >= progress - 5);
    this.next = i < 0 ? this.stops.length : i;
    this.dwell = 0;
    this.stops.forEach((st, k) => {
      st.served = false;
      st.missed = k < this.next;
    });
  }

  /** Requests of the next stop (none after the terminus). */
  get request() {
    return this.requests[this.next] ?? { alight: false, board: false };
  }

  /**
   * Advance by `dt` seconds.
   * @param {number} dt
   * @param {{progress: number, doorDistance: number, doorsOpen: boolean, onRoute: boolean}} bus
   * `doorDistance`: from the front door to the next stop (m); `onRoute`: close enough to the route to count
   * a stop as passed
   * @returns {StopEvent | null}
   */
  update(dt, bus) {
    const st = this.stops[this.next];
    if (!st) return null;
    const index = this.next;
    if (bus.doorsOpen && bus.doorDistance < this.g.stopDistance) {
      this.dwell += dt;
      if (this.dwell >= this.g.doorTime) {
        st.served = true;
        this.advance();
        return { type: 'served', index };
      }
      return null;
    }
    if (bus.onRoute && bus.progress > st.s + this.g.missedStopDistance) {
      const { alight, board } = this.request;
      st.missed = alight || board;
      this.advance();
      return { type: st.missed ? 'missed' : 'passed', index };
    }
    return null;
  }

  advance() {
    this.next++;
    this.dwell = 0;
  }
}
