// @ts-check
/**
 * Ambient traffic (#49): cars and bikes driving on the road graph (ADR 0002) around the player's bus.
 * Each direction of a road edge is a lane, driven on the right. Vehicles follow the one ahead with the
 * Intelligent Driver Model (Treiber, Hennecke and Helbing, Phys. Rev. E 62, 2000), take a random way at each
 * junction, cross a junction one at a time (first come, the vehicles already on a roundabout first) and stop
 * before any obstacle on their path (the player's bus, the other buses of the line). They appear and
 * disappear out of sight around the bus. Pure logic, world metres (x east, y north), headings in radians.
 */

/** @typedef {import('../settings/settings.js').Settings['traffic']} TrafficSettings */
/** @typedef {import('../common/types.js').RoadsData} RoadsData */

/**
 * @typedef {object} Lane one direction of a road edge
 * @property {number} edge index of the road edge @property {number} from start node @property {number} to end node
 * @property {Float64Array} pts flat [x, y, ...] in driving order @property {Float64Array} cum distance at each point
 * @property {number} length @property {number} width width of the road (m) @property {boolean} twoWay
 * @property {boolean} roundabout @property {number} speed speed limit (m/s)
 */

/**
 * @typedef {object} Vehicle
 * @property {number} id @property {boolean} bike @property {number} lane @property {number} s distance along the lane
 * @property {number} v speed (m/s) @property {number} next lane taken after this one, -1 when none
 * @property {number} desired speed it wants (m/s) @property {number} length @property {number} width
 * @property {number} variant look (colour) @property {number} x @property {number} y @property {number} h
 * @property {number} reserved junction node it may cross, -1 when none
 * @property {boolean} [gone] reached the end of a road that leaves the map
 */

/** @typedef {{x: number, y: number, r: number, v: number, h: number}} Obstacle a disc, its speed and heading */

/** @param {number} kmh */
const ms = (kmh) => kmh / 3.6;
/** Side of the cells that index the lanes (m): a few cells cover the spawn ring. */
const CELL = 200;

/**
 * Speed limit of a road class for the traffic, or 0 when cars do not use it (bus ways, service roads).
 * @param {string} name class name of roads.json @param {TrafficSettings['speeds']} speeds km/h
 */
export function classSpeed(name, speeds) {
  if (name === 'primary') return ms(speeds.primary);
  if (name === 'secondary') return ms(speeds.secondary);
  if (name === 'minor') return ms(speeds.minor);
  return 0;
}

/** Lanes of the road graph that cars and bikes drive on. */
export class RoadNetwork {
  /** @param {RoadsData} roads @param {TrafficSettings['speeds']} speeds */
  constructor(roads, speeds) {
    /** @param {string} name */
    const flag = (name) => {
      const bit = roads.flags.indexOf(name);
      return bit < 0 ? 0 : 1 << bit;
    };
    const oneway = flag('oneway'),
      reverse = flag('oneway_reverse'),
      roundabout = flag('roundabout'),
      tunnel = flag('tunnel');
    /** @type {Lane[]} */
    this.lanes = [];
    /** @type {Map<number, number[]>} lanes leaving each node */
    this.outgoing = new Map();
    /** @type {Map<number, number[]>} lanes reaching each node */
    this.incoming = new Map();
    /** @type {Map<number, number>} road edges at each node */
    const degree = new Map();
    roads.edges.forEach((edge, index) => {
      const [a, b, cls, widthDm, , mask] = edge;
      const speed = classSpeed(roads.classes[cls], speeds);
      if (!speed || mask & tunnel) return;
      const pts = edge.slice(6).map((v) => v / 10);
      const twoWay = !(mask & (oneway | reverse));
      const common = {
        edge: index,
        width: widthDm / 10,
        twoWay,
        roundabout: Boolean(mask & roundabout),
        speed,
      };
      if (!(mask & reverse)) this.add({ ...common, from: a, to: b }, pts);
      if (!(mask & oneway)) this.add({ ...common, from: b, to: a }, reversed(pts));
      for (const node of [a, b]) degree.set(node, (degree.get(node) ?? 0) + 1);
    });
    /** @type {Set<number>} nodes where three roads or more meet */
    this.junctions = new Set([...degree].filter(([, n]) => n >= 3).map(([node]) => node));
    /** @type {Map<string, number[]>} lanes passing through each square cell */
    this.cells = new Map();
    this.lanes.forEach((lane, id) => {
      const keys = new Set();
      for (let k = 0; k < lane.pts.length; k += 2) keys.add(this.cellKey(lane.pts[k], lane.pts[k + 1]));
      for (const key of keys) {
        const list = this.cells.get(key);
        if (list) list.push(id);
        else this.cells.set(key, [id]);
      }
    });
  }

  /** @param {number} x @param {number} y */
  cellKey(x, y) {
    return `${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`;
  }

  /**
   * Lanes passing near (x, y), within `radius` rounded up to whole cells.
   * @param {number} x @param {number} y @param {number} radius @returns {number[]}
   */
  lanesNear(x, y, radius) {
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
   * @param {Omit<Lane, 'pts' | 'cum' | 'length'>} lane @param {number[]} pts
   */
  add(lane, pts) {
    const cum = new Float64Array(pts.length / 2);
    for (let k = 1; k < cum.length; k++)
      cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
    const id = this.lanes.length;
    this.lanes.push({ ...lane, pts: Float64Array.from(pts), cum, length: cum[cum.length - 1] });
    for (const [map, node] of /** @type {const} */ ([
      [this.outgoing, lane.from],
      [this.incoming, lane.to],
    ])) {
      const list = map.get(node);
      if (list) list.push(id);
      else map.set(node, [id]);
    }
  }

  /**
   * Point `offset` metres right of lane `id` at distance `s` along it, with the heading of the lane there.
   * @param {number} id @param {number} s @param {number} offset
   */
  pointAt(id, s, offset) {
    const { pts, cum } = this.lanes[id];
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const x0 = pts[k * 2 - 2],
      y0 = pts[k * 2 - 1],
      x1 = pts[k * 2],
      y1 = pts[k * 2 + 1];
    const L = cum[k] - cum[k - 1] || 1;
    const f = Math.min(1, Math.max(0, (s - cum[k - 1]) / L));
    const dx = (x1 - x0) / L,
      dy = (y1 - y0) / L;
    return {
      x: x0 + (x1 - x0) * f + dy * offset,
      y: y0 + (y1 - y0) * f - dx * offset,
      h: Math.atan2(dy, dx),
    };
  }

  /**
   * Lane taken after lane `id`: a random way out of its end node, not back on the same road unless it is a
   * dead end; -1 when the road goes nowhere.
   * @param {number} id @param {() => number} random
   */
  nextLane(id, random) {
    const lane = this.lanes[id];
    const out = this.outgoing.get(lane.to) ?? [];
    const ahead = out.filter((other) => this.lanes[other].edge !== lane.edge);
    const choices = ahead.length ? ahead : out;
    return choices.length ? choices[Math.floor(random() * choices.length)] : -1;
  }
}

/** @param {number[]} pts flat [x, y, ...] */
function reversed(pts) {
  const out = [];
  for (let k = pts.length - 2; k >= 0; k -= 2) out.push(pts[k], pts[k + 1]);
  return out;
}

/**
 * Acceleration of the Intelligent Driver Model.
 * @param {number} v speed @param {number} desired speed wanted on a free road @param {number} gap free distance to
 * the leader (Infinity without one) @param {number} leaderSpeed
 * @param {TrafficSettings} p acceleration, braking, minGap, headway
 */
export function idmAcceleration(v, desired, gap, leaderSpeed, p) {
  const free = 1 - Math.pow(v / Math.max(desired, 0.1), 4);
  if (gap === Infinity) return p.acceleration * free;
  const wanted =
    p.minGap +
    Math.max(0, v * p.headway + (v * (v - leaderSpeed)) / (2 * Math.sqrt(p.acceleration * p.braking)));
  return p.acceleration * (free - Math.pow(wanted / Math.max(gap, 0.1), 2));
}

/** Cars and bikes around the player's bus. */
export class Traffic {
  /**
   * @param {RoadNetwork} network @param {TrafficSettings} settings
   * @param {() => number} random 0..1, seeded in the tests
   */
  constructor(network, settings, random) {
    this.network = network;
    this.p = settings;
    this.random = random;
    /** @type {Vehicle[]} */
    this.vehicles = [];
    /** @type {Map<number, {owner: number, since: number}>} junction node -> vehicle crossing it */
    this.reservations = new Map();
    this.time = 0;
    this.nextId = 1;
    this.started = false;
  }

  /** Offset of a vehicle right of its lane centre line. @param {Vehicle} v @param {Lane} lane */
  offset(v, lane) {
    // bikes keep to the right edge of the road; cars drive in the middle of their half
    if (v.bike) return lane.width / 2 - this.p.bikeEdge;
    return lane.twoWay ? lane.width / 4 : 0;
  }

  /**
   * Move every vehicle by `dt` seconds, then remove those far from the bus and add new ones out of sight.
   * @param {number} dt @param {{x: number, y: number}} centre the player's bus @param {Obstacle[]} obstacles
   */
  update(dt, centre, obstacles) {
    this.time += dt;
    const byLane = this.sortByLane();
    for (const v of this.vehicles) this.drive(v, dt, byLane, obstacles);
    this.despawn(centre);
    this.spawn(centre, this.started ? this.p.spawnMinDistance : this.p.startMinDistance);
    this.started = true;
  }

  /** Vehicles of each lane, nearest the start first. */
  sortByLane() {
    /** @type {Map<number, Vehicle[]>} */
    const byLane = new Map();
    for (const v of this.vehicles) {
      const list = byLane.get(v.lane);
      if (list) list.push(v);
      else byLane.set(v.lane, [v]);
    }
    for (const list of byLane.values()) list.sort((a, b) => a.s - b.s);
    return byLane;
  }

  /**
   * The nearest thing a vehicle must keep its distance to: gap (m) and speed.
   * @param {Vehicle} v @param {Map<number, Vehicle[]>} byLane @param {Obstacle[]} obstacles
   */
  leader(v, byLane, obstacles) {
    const lane = this.network.lanes[v.lane];
    let gap = Infinity,
      speed = 0;
    /** @param {number} g @param {number} s */
    const keep = (g, s) => {
      if (g < gap) {
        gap = g;
        speed = s;
      }
    };
    // cars pass bikes where the half road is wide enough
    /** @param {Vehicle} other @param {Lane} on */
    const ignored = (other, on) =>
      !v.bike && other.bike && (on.twoWay ? on.width / 2 : on.width) >= this.p.passWidth;
    for (const other of byLane.get(v.lane) ?? [])
      if (other !== v && other.s > v.s && !ignored(other, lane)) {
        keep(other.s - v.s - (other.length + v.length) / 2, other.v);
        break;
      }
    const toEnd = lane.length - v.s;
    if (v.next >= 0 && toEnd < this.p.lookahead) {
      const nextLane = this.network.lanes[v.next];
      for (const other of byLane.get(v.next) ?? [])
        if (!ignored(other, nextLane)) {
          keep(toEnd + other.s - (other.length + v.length) / 2, other.v);
          break;
        }
    }
    // a junction is crossed only with its reservation: else stop before it
    if (this.network.junctions.has(lane.to) && toEnd < this.p.junctionApproach && !this.reserve(v, lane))
      keep(toEnd - this.p.stopBack - v.length / 2, 0);
    if (v.next < 0) keep(toEnd - v.length / 2, 0);
    this.probe(v, obstacles, keep);
    return { gap, speed };
  }

  /**
   * Obstacles on the path ahead of a vehicle, looked at every probeStep metres up to lookahead.
   * @param {Vehicle} v @param {Obstacle[]} obstacles @param {(gap: number, speed: number) => void} keep
   */
  probe(v, obstacles, keep) {
    if (!obstacles.length) return;
    const lane = this.network.lanes[v.lane];
    for (let ahead = this.p.probeStep; ahead <= this.p.lookahead; ahead += this.p.probeStep) {
      let s = v.s + ahead,
        id = v.lane;
      if (s > lane.length) {
        if (v.next < 0) return;
        s -= lane.length;
        id = v.next;
      }
      const at = this.network.pointAt(id, s, this.offset(v, this.network.lanes[id]));
      for (const o of obstacles)
        if (Math.hypot(o.x - at.x, o.y - at.y) < o.r + v.width / 2) {
          // the obstacle moves away along our way as fast as its speed points that way
          keep(ahead - v.length / 2, Math.max(0, o.v * Math.cos(o.h - at.h)));
          return;
        }
    }
  }

  /**
   * Take or keep the reservation of the junction at the end of the lane; vehicles already on a roundabout
   * go first.
   * @param {Vehicle} v @param {Lane} lane
   */
  reserve(v, lane) {
    const node = lane.to;
    const held = this.reservations.get(node);
    if (held && held.owner === v.id) return true;
    if (held && this.time - held.since < this.p.reservationTimeout) return false;
    const entering = v.next >= 0 && this.network.lanes[v.next].roundabout && !lane.roundabout;
    if (entering) {
      for (const id of this.network.incoming.get(node) ?? []) {
        const other = this.network.lanes[id];
        if (!other.roundabout) continue;
        for (const w of this.vehicles)
          if (w.lane === id && other.length - w.s < this.p.junctionApproach) return false;
      }
    }
    this.release(v);
    this.reservations.set(node, { owner: v.id, since: this.time });
    v.reserved = node;
    return true;
  }

  /** Free the junction a vehicle holds. @param {Vehicle} v */
  release(v) {
    if (v.reserved >= 0 && this.reservations.get(v.reserved)?.owner === v.id)
      this.reservations.delete(v.reserved);
    v.reserved = -1;
  }

  /**
   * One step of a vehicle: speed from its leader, then along its lane and on to the next one.
   * @param {Vehicle} v @param {number} dt @param {Map<number, Vehicle[]>} byLane @param {Obstacle[]} obstacles
   */
  drive(v, dt, byLane, obstacles) {
    const { gap, speed } = this.leader(v, byLane, obstacles);
    const acceleration = Math.max(-this.p.maxBraking, idmAcceleration(v.v, v.desired, gap, speed, this.p));
    v.v = Math.max(0, v.v + acceleration * dt);
    v.s += v.v * dt;
    let lane = this.network.lanes[v.lane];
    if (v.s >= lane.length && v.next >= 0) {
      v.s -= lane.length;
      v.lane = v.next;
      lane = this.network.lanes[v.lane];
      v.next = this.network.nextLane(v.lane, this.random);
      v.desired = this.desired(v.bike, lane);
    }
    v.s = Math.min(v.s, lane.length);
    // the road leaves the map: the vehicle leaves with it, another one appears elsewhere
    if (v.next < 0 && v.s >= lane.length - v.length / 2 - this.p.minGap - 0.5) v.gone = true;
    // the junction is free once the whole vehicle has crossed it
    if (v.reserved >= 0 && v.reserved !== lane.to && v.s > v.length + this.p.junctionClear) this.release(v);
    this.place(v);
  }

  /** Position and heading of a vehicle; the heading looks a little ahead to round the corners. @param {Vehicle} v */
  place(v) {
    const lane = this.network.lanes[v.lane];
    const at = this.network.pointAt(v.lane, v.s, this.offset(v, lane));
    let s = v.s + this.p.headingAhead,
      id = v.lane;
    if (s > lane.length && v.next >= 0) {
      s -= lane.length;
      id = v.next;
    }
    const ahead = this.network.pointAt(
      id,
      Math.min(s, this.network.lanes[id].length),
      this.offset(v, this.network.lanes[id]),
    );
    v.x = at.x;
    v.y = at.y;
    v.h =
      Math.hypot(ahead.x - at.x, ahead.y - at.y) > 0.5 ? Math.atan2(ahead.y - at.y, ahead.x - at.x) : at.h;
  }

  /** Speed a vehicle wants on a lane. @param {boolean} bike @param {Lane} lane */
  desired(bike, lane) {
    return bike
      ? ms(this.p.bikeSpeed)
      : lane.speed * (1 - this.p.speedSpread / 2 + this.random() * this.p.speedSpread);
  }

  /** Remove the vehicles too far from the bus or gone off the map. @param {{x: number, y: number}} centre */
  despawn(centre) {
    const keep = [];
    for (const v of this.vehicles) {
      if (!v.gone && Math.hypot(v.x - centre.x, v.y - centre.y) <= this.p.despawnRadius) keep.push(v);
      else this.release(v);
    }
    this.vehicles = keep;
  }

  /**
   * Add vehicles up to the wanted count, on lanes between `minDistance` and spawnRadius from the bus, on a free
   * stretch of road.
   * @param {{x: number, y: number}} centre @param {number} minDistance
   */
  spawn(centre, minDistance) {
    if (this.vehicles.length >= this.p.vehicles) return;
    const near = this.network.lanesNear(centre.x, centre.y, this.p.spawnRadius);
    if (!near.length) return;
    for (
      let attempt = 0;
      attempt < this.p.spawnAttempts && this.vehicles.length < this.p.vehicles;
      attempt++
    ) {
      const id = near[Math.floor(this.random() * near.length)];
      const lane = this.network.lanes[id];
      const s = this.random() * lane.length;
      const at = this.network.pointAt(id, s, 0);
      const d = Math.hypot(at.x - centre.x, at.y - centre.y);
      if (d < minDistance || d > this.p.spawnRadius) continue;
      if (this.vehicles.some((v) => v.lane === id && Math.abs(v.s - s) < this.p.spawnClearance)) continue;
      const bike = this.random() < this.p.bikeShare;
      /** @type {Vehicle} */
      const v = {
        id: this.nextId++,
        bike,
        lane: id,
        s,
        v: 0,
        next: this.network.nextLane(id, this.random),
        desired: this.desired(bike, lane),
        length: bike ? this.p.bikeLength : this.p.carLength,
        width: bike ? this.p.bikeWidth : this.p.carWidth,
        variant: Math.floor(this.random() * this.p.looks),
        x: 0,
        y: 0,
        h: 0,
        reserved: -1,
      };
      v.v = v.desired / 2;
      this.place(v);
      this.vehicles.push(v);
    }
  }

  /**
   * Whether a point is inside a vehicle (for the collisions of the player's bus).
   * @param {number} x @param {number} y
   */
  hit(x, y) {
    for (const v of this.vehicles) {
      const dx = x - v.x,
        dy = y - v.y;
      if (Math.abs(dx) > v.length || Math.abs(dy) > v.length) continue;
      const along = dx * Math.cos(v.h) + dy * Math.sin(v.h),
        across = -dx * Math.sin(v.h) + dy * Math.cos(v.h);
      if (Math.abs(along) <= v.length / 2 && Math.abs(across) <= v.width / 2) return true;
    }
    return false;
  }
}
