// @ts-check
/**
 * People walking in the streets (#50): on the sidewalks along both sides of the streets of the road graph
 * (ADR 0002), turning at random at the junctions, and sometimes crossing at a zebra crossing once no vehicle
 * comes. They appear and disappear out of sight around the bus. While on a crossing they are obstacles for
 * the traffic (ADR 0007). Pure logic, world metres (x east, y north).
 */
import { classSpeed, cumulative, polylinePoint } from './traffic.js';

/** @typedef {import('../settings/settings.js').Settings['pedestrians']} PedestrianSettings */
/** @typedef {import('../common/types.js').RoadsData} RoadsData */

/**
 * @typedef {object} Walkway a street with its two sidewalks
 * @property {number} a start node @property {number} b end node
 * @property {Float64Array} pts flat [x, y, ...] from a to b @property {Float64Array} cum distance at each point
 * @property {number} length @property {number} width width of the carriageway (m)
 * @property {number[]} crossings distances of its zebra crossings from a, sorted
 */

/**
 * @typedef {object} Pedestrian
 * @property {number} id @property {number} edge walkway @property {number} s distance from its start node
 * @property {1 | -1} dir walking towards b (1) or a (-1) @property {1 | -1} side right (1) or left (-1) sidewalk, seen from a to b
 * @property {number} speed m/s @property {number} look sprite variant
 * @property {'walk' | 'wait' | 'cross'} state @property {number} t progress of the crossing, 0..1
 * @property {number} waited time waiting at the kerb (s)
 * @property {number} lastCrossing distance of the last crossing passed on this walkway, NaN when none
 * @property {number} x @property {number} y
 */

/** Side of the cells that index the walkways (m). */
const CELL = 200;

/** Sidewalks of the streets, and where they cross. */
export class Walkways {
  /**
   * @param {RoadsData} roads @param {import('../settings/settings.js').Settings['traffic']['speeds']} speeds the
   * streets with a speed limit for the traffic have sidewalks
   */
  constructor(roads, speeds) {
    const tunnel = roads.flags.indexOf('tunnel');
    /** @type {Walkway[]} */
    this.edges = [];
    /** @type {Map<number, number[]>} walkways at each node */
    this.atNode = new Map();
    /** @type {Map<string, number[]>} */
    this.cells = new Map();
    for (const edge of roads.edges) {
      const [a, b, cls, widthDm, , mask] = edge;
      if (!classSpeed(roads.classes[cls], speeds) || (tunnel >= 0 && mask & (1 << tunnel))) continue;
      const pts = Float64Array.from(edge.slice(6), (v) => v / 10);
      const cum = cumulative(pts);
      const id = this.edges.length;
      this.edges.push({ a, b, pts, cum, length: cum[cum.length - 1], width: widthDm / 10, crossings: [] });
      for (const node of [a, b]) push(this.atNode, node, id);
      const keys = new Set();
      for (let k = 0; k < pts.length; k += 2) keys.add(cellKey(pts[k], pts[k + 1]));
      for (const key of keys) push(this.cells, key, id);
    }
  }

  /**
   * Walkways passing near (x, y), within `radius` rounded up to whole cells.
   * @param {number} x @param {number} y @param {number} radius @returns {number[]}
   */
  near(x, y, radius) {
    const reach = Math.ceil(radius / CELL);
    const ci = Math.floor(x / CELL),
      cj = Math.floor(y / CELL);
    const out = new Set();
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++)
        for (const id of this.cells.get(`${i}_${j}`) ?? []) out.add(id);
    return [...out];
  }

  /**
   * Put each zebra crossing on the nearest street within `reach` metres.
   * @param {number[]} points flat [x, y, ...] centres of the crossings @param {number} reach
   */
  addCrossings(points, reach) {
    for (let k = 0; k + 1 < points.length; k += 2) {
      const x = points[k],
        y = points[k + 1];
      let best = { id: -1, s: 0, d: reach };
      for (const id of this.near(x, y, reach)) {
        const found = nearestOnPolyline(this.edges[id], x, y);
        if (found.d < best.d) best = { id, ...found };
      }
      if (best.id >= 0) this.edges[best.id].crossings.push(best.s);
    }
    for (const edge of this.edges) edge.crossings.sort((p, q) => p - q);
  }

  /**
   * Point of a sidewalk: `lateral` metres right of the street centre line at distance `s` from its start.
   * @param {number} id @param {number} s @param {number} lateral
   */
  pointAt(id, s, lateral) {
    const edge = this.edges[id];
    return polylinePoint(edge.pts, edge.cum, s, lateral);
  }
}

/** @param {number} x @param {number} y */
const cellKey = (x, y) => `${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`;

/**
 * @template K @param {Map<K, number[]>} map @param {K} key @param {number} value
 */
function push(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Nearest point of a polyline to (x, y): its distance along the line and from the point.
 * @param {{pts: Float64Array, cum: Float64Array}} line @param {number} x @param {number} y
 */
function nearestOnPolyline(line, x, y) {
  let best = { s: 0, d: Infinity };
  for (let k = 1; k < line.cum.length; k++) {
    const x0 = line.pts[k * 2 - 2],
      y0 = line.pts[k * 2 - 1];
    const dx = line.pts[k * 2] - x0,
      dy = line.pts[k * 2 + 1] - y0;
    const L2 = dx * dx + dy * dy || 1;
    const f = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / L2));
    const d = Math.hypot(x0 + dx * f - x, y0 + dy * f - y);
    if (d < best.d) best = { s: line.cum[k - 1] + f * Math.sqrt(L2), d };
  }
  return best;
}

/**
 * Centres of the zebra crossings of the tiles: their stripes grouped by distance.
 * @param {Iterable<[string, {crossings: number[][]}]>} tiles key "i_j" and data
 * @param {{x0: number, y0: number, size: number}} index tile grid (m) @param {number} gather stripes closer than this (m) form one crossing
 * @returns {number[]} flat [x, y, ...] world metres
 */
export function crossingCentres(tiles, index, gather) {
  /** @type {{x: number, y: number, n: number}[]} */
  const groups = [];
  for (const [key, tile] of tiles) {
    const [i, j] = key.split('_').map(Number);
    const ox = index.x0 + i * index.size,
      oy = index.y0 + j * index.size;
    for (const stripe of tile.crossings) {
      let x = 0,
        y = 0;
      for (let k = 0; k + 1 < stripe.length; k += 2) {
        x += stripe[k] / 10;
        y += stripe[k + 1] / 10;
      }
      x = ox + x / (stripe.length / 2);
      y = oy + y / (stripe.length / 2);
      const group = groups.find((g) => Math.hypot(g.x / g.n - x, g.y / g.n - y) < gather);
      if (group) {
        group.x += x;
        group.y += y;
        group.n++;
      } else groups.push({ x, y, n: 1 });
    }
  }
  return groups.flatMap((g) => [g.x / g.n, g.y / g.n]);
}

/**
 * Who is around: vehicles about to drive over a point, and obstacles a pedestrian must not walk into.
 * @typedef {object} Surroundings
 * @property {(x: number, y: number, impatient: boolean) => boolean} vehicleComing an impatient person only
 *   waits for the vehicles very close
 * @property {(x: number, y: number) => boolean} vehicleWaiting a stopped vehicle waits at the point
 * @property {(x: number, y: number) => boolean} blocked
 */

/** People walking around the player's bus. */
export class Pedestrians {
  /**
   * @param {Walkways} walkways @param {PedestrianSettings} settings @param {number} looks sprite variants
   * @param {() => number} random 0..1, seeded in the tests
   */
  constructor(walkways, settings, looks, random) {
    this.walkways = walkways;
    this.p = settings;
    this.looks = looks;
    this.random = random;
    /** @type {Pedestrian[]} */
    this.people = [];
    this.nextId = 1;
    this.started = false;
    this.time = 0;
    /** @type {Map<string, number>} time each crossing was last stepped on, by "walkway:distance" */
    this.lastUse = new Map();
  }

  /** Distance of the sidewalk from the street centre line. @param {number} edge */
  offset(edge) {
    return this.walkways.edges[edge].width / 2 + this.p.sidewalkOffset;
  }

  /**
   * Move everybody by `dt` seconds, then remove those far from the bus and add new ones out of sight.
   * @param {number} dt @param {{x: number, y: number}} centre @param {Surroundings} around
   */
  update(dt, centre, around) {
    this.time += dt;
    for (const person of this.people) this.step(person, dt, around);
    this.people = this.people.filter(
      (q) => Math.hypot(q.x - centre.x, q.y - centre.y) <= this.p.despawnRadius,
    );
    this.spawn(centre, this.started ? this.p.spawnMinDistance : this.p.startMinDistance);
    this.started = true;
  }

  /**
   * One step of a person: crossing, waiting at the kerb or walking along the sidewalk.
   * @param {Pedestrian} q @param {number} dt @param {Surroundings} around
   */
  step(q, dt, around) {
    if (q.state === 'wait') {
      q.waited += dt;
      if (around.vehicleComing(q.x, q.y, q.waited > this.p.patience)) return;
      // a crossing used without a break would stop the waiting vehicles for ever: people let them go
      const key = `${q.edge}:${q.s}`;
      const used = this.lastUse.get(key) ?? -Infinity;
      const busy = this.time - used > this.p.crossingGroup && this.time - used < this.p.crossingRest;
      if (busy && around.vehicleWaiting(q.x, q.y)) return;
      if (this.time - used > this.p.crossingGroup) this.lastUse.set(key, this.time);
      q.state = 'cross';
      q.t = 0;
    }
    if (q.state === 'cross') {
      q.t += (q.speed * dt) / (2 * this.offset(q.edge));
      if (q.t >= 1) {
        q.side = /** @type {1 | -1} */ (-q.side);
        q.state = 'walk';
      }
      this.place(q);
      return;
    }
    const before = q.s;
    const next = q.s + q.dir * q.speed * dt;
    const ahead = this.walkways.pointAt(
      q.edge,
      next + q.dir * this.p.lookAhead,
      q.side * this.offset(q.edge),
    );
    if (around.blocked(ahead.x, ahead.y)) return;
    q.s = next;
    const crossing = this.crossingPassed(q, before);
    if (crossing !== null) {
      q.lastCrossing = crossing;
      if (this.random() < this.p.crossChance) {
        q.s = crossing;
        q.state = 'wait';
        q.waited = 0;
      }
    }
    const edge = this.walkways.edges[q.edge];
    if (q.s < 0 || q.s > edge.length) this.turn(q);
    this.place(q);
  }

  /**
   * Zebra crossing of the walkway passed during the last step, if any (and not the one just used).
   * @param {Pedestrian} q @param {number} before distance before the step @returns {number | null}
   */
  crossingPassed(q, before) {
    const lo = Math.min(before, q.s),
      hi = Math.max(before, q.s);
    for (const s of this.walkways.edges[q.edge].crossings)
      if (s >= lo && s <= hi && s !== q.lastCrossing) return s;
    return null;
  }

  /**
   * At the end of a walkway: on to another street of the node (back only at a dead end), on the sidewalk
   * nearest to where the person stands.
   * @param {Pedestrian} q
   */
  turn(q) {
    const here = this.walkways.pointAt(q.edge, q.s, q.side * this.offset(q.edge));
    const edge = this.walkways.edges[q.edge];
    const node = q.dir > 0 ? edge.b : edge.a;
    const all = this.walkways.atNode.get(node) ?? [q.edge];
    const others = all.filter((id) => id !== q.edge);
    const choices = others.length ? others : all;
    const id = choices[Math.floor(this.random() * choices.length)];
    const next = this.walkways.edges[id];
    q.edge = id;
    q.dir = next.a === node ? 1 : -1;
    q.s = q.dir > 0 ? 0 : next.length;
    q.lastCrossing = NaN;
    /** @param {1 | -1} side */
    const gap = (side) => {
      const p = this.walkways.pointAt(id, q.s, side * this.offset(id));
      return Math.hypot(p.x - here.x, p.y - here.y);
    };
    q.side = gap(1) <= gap(-1) ? 1 : -1;
  }

  /** Position of a person, on a sidewalk or on the crossing. @param {Pedestrian} q */
  place(q) {
    const o = this.offset(q.edge);
    const lateral = q.state === 'cross' ? q.side * o * (1 - 2 * q.t) : q.side * o;
    const at = this.walkways.pointAt(q.edge, q.s, lateral);
    q.x = at.x;
    q.y = at.y;
  }

  /**
   * Add people up to the wanted count on sidewalks between `minDistance` and spawnRadius from the bus.
   * @param {{x: number, y: number}} centre @param {number} minDistance
   */
  spawn(centre, minDistance) {
    if (this.people.length >= this.p.count) return;
    const near = this.walkways.near(centre.x, centre.y, this.p.spawnRadius);
    if (!near.length) return;
    for (let attempt = 0; attempt < this.p.spawnAttempts && this.people.length < this.p.count; attempt++) {
      const edge = near[Math.floor(this.random() * near.length)];
      const s = this.random() * this.walkways.edges[edge].length;
      /** @type {Pedestrian} */
      const q = {
        id: this.nextId++,
        edge,
        s,
        dir: this.random() < 0.5 ? 1 : -1,
        side: this.random() < 0.5 ? 1 : -1,
        speed: this.p.speed * (1 - this.p.speedSpread / 2 + this.random() * this.p.speedSpread),
        look: Math.floor(this.random() * this.looks),
        state: 'walk',
        t: 0,
        waited: 0,
        lastCrossing: NaN,
        x: 0,
        y: 0,
      };
      this.place(q);
      const d = Math.hypot(q.x - centre.x, q.y - centre.y);
      if (d >= minDistance && d <= this.p.spawnRadius) this.people.push(q);
    }
  }

  /**
   * People on a crossing, as obstacles for the traffic.
   * @returns {import('./traffic.js').Obstacle[]}
   */
  obstacles() {
    return this.people
      .filter((q) => q.state === 'cross')
      .map((q) => ({ x: q.x, y: q.y, r: this.p.obstacleRadius, v: 0, h: 0 }));
  }
}
