// @ts-check
/**
 * Serving the stops (#37, #40): the front doors, the passengers drawn for a service, their exchange at the
 * stops, and the outcome of each stop (served, missed, or passed without request). Pure logic, no DOM and
 * no WebGL.
 */

/** @typedef {import('../settings/settings.js').Settings} Settings */

/**
 * Who wants this stop: how many people on board get off ("stop requested" when more than none), and how
 * many people wait at the stop.
 * @typedef {{alight: number, board: number}} StopRequest
 */

/**
 * Passengers of a service: on board at the start, and the requests of every stop.
 * @typedef {{onBoard: number, stops: StopRequest[]}} ServicePlan
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
 * Passengers of a service. Nobody gets off at the first stop, nobody boards at the terminus, and everybody
 * on board gets off there; nobody gets off who is not on board.
 * @param {number} count number of stops @param {number} seed @param {Settings['gameplay']} gameplay
 * @param {Settings['passengers']} passengers
 * @returns {ServicePlan}
 */
export function drawService(count, seed, gameplay, passengers) {
  const next = random(seed);
  /** @param {number} max */
  const between1And = (max) => 1 + Math.floor(next() * max);
  const onBoard = Math.floor(next() * (passengers.initialMax + 1));
  let aboard = onBoard;
  const stops = Array.from({ length: count }, (_, i) => {
    const wantsOff = next() < gameplay.alightProbability,
      waits = next() < gameplay.boardProbability;
    const offCount = between1And(passengers.alightMax),
      waitCount = between1And(passengers.boardMax);
    const alight = i === count - 1 ? aboard : i > 0 && wantsOff ? Math.min(offCount, aboard) : 0;
    const board = i < count - 1 && waits ? waitCount : 0;
    aboard += board - alight;
    return { alight, board };
  });
  return { onBoard, stops };
}

/**
 * People getting off then on through the front door, one every `interval` seconds.
 * @typedef {'alight' | 'board'} PassengerMove
 */
export class Exchange {
  /** @param {number} interval s between two people */
  constructor(interval) {
    this.interval = interval;
    this.alight = 0;
    this.board = 0;
    this.t = 0;
  }

  /** @param {number} alight @param {number} board */
  start(alight, board) {
    this.alight = alight;
    this.board = board;
    this.t = 0;
  }

  get done() {
    return this.alight === 0 && this.board === 0;
  }

  /**
   * Advance by `dt` seconds; returns the moves that happened, those getting off first.
   * @param {number} dt @returns {PassengerMove[]}
   */
  update(dt) {
    /** @type {PassengerMove[]} */
    const moves = [];
    this.t += dt;
    while (!this.done && this.t >= this.interval) {
      this.t -= this.interval;
      if (this.alight > 0) {
        this.alight--;
        moves.push('alight');
      } else {
        this.board--;
        moves.push('board');
      }
    }
    return moves;
  }
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

/** Progress through the stops of a service, with the people getting off and on. */
export class StopService {
  /**
   * @param {ServiceStop[]} stops updated in place (`served`, `missed`) for the displays
   * @param {ServicePlan} plan @param {Settings['gameplay']} gameplay @param {Settings['passengers']} passengers
   */
  constructor(stops, plan, gameplay, passengers) {
    this.stops = stops;
    this.requests = plan.stops;
    this.g = gameplay;
    this.onBoard = plan.onBoard;
    this.exchange = new Exchange(passengers.interval);
    /** whether the exchange of the next stop has started */
    this.started = false;
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
    this.started = false;
    this.stops.forEach((st, k) => {
      st.served = false;
      st.missed = k < this.next;
    });
  }

  /** People still to get off and on at the next stop (none after the terminus). */
  get request() {
    if (this.started) return { alight: this.exchange.alight, board: this.exchange.board };
    const planned = this.requests[this.next];
    if (!planned) return { alight: 0, board: 0 };
    // everybody gets off at the terminus; nobody gets off who is not on board
    const last = this.next === this.stops.length - 1;
    return { alight: last ? this.onBoard : Math.min(planned.alight, this.onBoard), board: planned.board };
  }

  /**
   * Advance by `dt` seconds.
   * @param {number} dt
   * @param {{progress: number, doorDistance: number, doorsOpen: boolean, onRoute: boolean}} bus
   * `doorDistance`: from the front door to the next stop (m); `onRoute`: close enough to the route to count
   * a stop as passed
   * @returns {{event: StopEvent | null, moves: PassengerMove[]}}
   */
  update(dt, bus) {
    const st = this.stops[this.next];
    /** @type {PassengerMove[]} */
    let moves = [];
    if (!st) return { event: null, moves };
    const index = this.next;
    if (bus.doorsOpen && bus.doorDistance < this.g.stopDistance) {
      if (!this.started) {
        const { alight, board } = this.request;
        this.exchange.start(alight, board);
        this.started = true;
      }
      moves = this.exchange.update(dt);
      for (const move of moves) this.onBoard += move === 'board' ? 1 : -1;
      this.dwell += dt;
      if (this.exchange.done && this.dwell >= this.g.doorTime) {
        st.served = true;
        this.advance();
        return { event: { type: 'served', index }, moves };
      }
      return { event: null, moves };
    }
    if (bus.onRoute && bus.progress > st.s + this.g.missedStopDistance) {
      const { alight, board } = this.request;
      st.missed = alight > 0 || board > 0;
      this.advance();
      return { event: { type: st.missed ? 'missed' : 'passed', index }, moves };
    }
    return { event: null, moves };
  }

  advance() {
    this.next++;
    this.dwell = 0;
    this.started = false;
  }
}
