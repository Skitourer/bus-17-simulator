// @ts-check
/**
 * Ambient traffic (#49): cars and bikes driving on the road graph (ADR 0002) around the player's bus.
 * Each direction of a road edge is a lane, driven on the right. Vehicles follow the one ahead with the
 * Intelligent Driver Model (Treiber, Hennecke and Helbing, Phys. Rev. E 62, 2000), take a random way at each
 * junction, cross a junction one at a time (first come, the vehicles already on a roundabout first) and stop
 * before any obstacle on their path (the player's bus, the other buses of the line). The player's bus is a
 * priority vehicle (#95): they keep a larger gap from it and leave it the junctions it drives to; one that
 * stays stuck against it, or waits for it across its way, backs off or is removed, so that no deadlock lasts.
 * They appear and disappear out of sight around the bus. Pure logic, world metres (x east, y north), headings
 * in radians.
 */

import { mustStop } from './signals.js';

/** @typedef {import('../settings/settings.js').Settings['traffic']} TrafficSettings */
/** @typedef {import('../common/types.js').RoadsData} RoadsData */

/**
 * @typedef {object} Lane one direction of a road edge
 * @property {number} edge index of the road edge @property {number} from start node @property {number} to end node
 * @property {Float64Array} pts flat [x, y, ...] in driving order @property {Float64Array} cum distance at each point
 * @property {number} length @property {number} width width of the road (m) @property {boolean} twoWay
 * @property {boolean} roundabout @property {number} speed speed limit (m/s)
 * @property {boolean} builtUp in a town, village or hamlet (#94); every lane when the data has no such flag
 * @property {boolean} bridge on a bridge deck (#75)
 */

/**
 * @typedef {object} Vehicle
 * @property {number} id @property {boolean} bike @property {number} lane @property {number} s distance along the lane
 * @property {number} v speed (m/s) @property {number} next lane taken after this one, -1 when none
 * @property {number} desired speed it wants (m/s) @property {number} length @property {number} width
 * @property {number} variant look (colour) @property {number} x @property {number} y @property {number} h
 * @property {number} reserved junction node it may cross, -1 when none
 * @property {number} previous lane driven before this one, -1 when none
 * @property {boolean} [gone] reached the end of a road that leaves the map, or removed to unstick the bus
 * @property {number} [stuck] time stopped against the player's bus or waiting for it (s)
 * @property {number} [backing] distance still to back off (m)
 * @property {number} [backOffs] times it backed off
 * @property {number} [pushed] time the player's bus has been pushing against it (s)
 * @property {number} [z] height of the road under it (m), when the simulation knows the heights (#75)
 * @property {boolean} [braking] slowing down or standing: its brake lights are on (#87)
 */

/**
 * @typedef {{x: number, y: number, r: number, v: number, h: number, priority?: boolean, z?: number}} Obstacle a
 * disc, its speed and heading; `priority` for the player's bus; `z` its height, when known: a vehicle on another
 * level (on a bridge above it, on the road below) ignores it (#75)
 */

/**
 * @typedef {object} BusWait the player's bus is what a vehicle waits for
 * @property {number} gap free distance to it (m) @property {boolean} follows it drives the same way, ahead
 * @property {number} speed of the bus (m/s)
 */

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
      tunnel = flag('tunnel'),
      bridge = flag('bridge'),
      builtUp = flag('built_up');
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
        builtUp: !builtUp || Boolean(mask & builtUp),
        bridge: Boolean(mask & bridge),
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
    const cum = cumulative(pts);
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
    return polylinePoint(pts, cum, s, offset);
  }

  /**
   * Lane taken after lane `id`: a random way out of its end node, not back on the same road unless it is a
   * dead end; -1 when the road goes nowhere. A bike stays in built-up areas: it turns back at their edge.
   * @param {number} id @param {() => number} random @param {boolean} [bike]
   */
  nextLane(id, random, bike = false) {
    const lane = this.lanes[id];
    const out = this.outgoing.get(lane.to) ?? [];
    const ahead = out.filter((other) => this.lanes[other].edge !== lane.edge);
    /** @param {number[]} list */
    const town = (list) => (bike ? list.filter((other) => this.lanes[other].builtUp) : list);
    const choices = [town(ahead), town(out), ahead, out].find((list) => list.length) ?? [];
    return choices.length ? choices[Math.floor(random() * choices.length)] : -1;
  }
}

/**
 * Point `offset` metres right of a polyline at distance `s` along it, with the heading there.
 * @param {ArrayLike<number>} pts flat [x, y, ...] @param {ArrayLike<number>} cum distance at each point
 * @param {number} s @param {number} offset
 */
export function polylinePoint(pts, cum, s, offset) {
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
  return { x: x0 + (x1 - x0) * f + dy * offset, y: y0 + (y1 - y0) * f - dx * offset, h: Math.atan2(dy, dx) };
}

/**
 * Distance at each point of a polyline.
 * @param {ArrayLike<number>} pts flat [x, y, ...]
 */
export function cumulative(pts) {
  const cum = new Float64Array(pts.length / 2);
  for (let k = 1; k < cum.length; k++)
    cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
  return cum;
}

/** @param {number[]} pts flat [x, y, ...] */
function reversed(pts) {
  const out = [];
  for (let k = pts.length - 2; k >= 0; k -= 2) out.push(pts[k], pts[k + 1]);
  return out;
}

/**
 * Height and tilt of a vehicle on the ground under its wheels (#93): pitch from the heights under the front
 * and rear axles, roll from those under its left and right sides (none for a bike, which rides upright).
 * @param {{x: number, y: number, h: number, width: number, bike?: boolean}} v
 * @param {number} wheelbase distance between the axles (m) @param {(x: number, y: number) => number} heightAt
 * @returns {{z: number, pitch: number, roll: number}} pitch > 0 nose up, roll > 0 left side up (radians)
 */
export function groundPose(v, wheelbase, heightAt) {
  const c = Math.cos(v.h),
    s = Math.sin(v.h);
  const half = wheelbase / 2,
    side = v.width / 2;
  const front = heightAt(v.x + c * half, v.y + s * half),
    rear = heightAt(v.x - c * half, v.y - s * half);
  const pitch = Math.atan2(front - rear, wheelbase);
  if (v.bike) return { z: (front + rear) / 2, pitch, roll: 0 };
  // left of a heading h is (-sin h, cos h)
  const left = heightAt(v.x - s * side, v.y + c * side),
    right = heightAt(v.x + s * side, v.y - c * side);
  return { z: (front + rear + left + right) / 4, pitch, roll: Math.atan2(left - right, v.width) };
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
   * @param {import('./signals.js').SignalMap | null} [signals] traffic lights the vehicles obey
   */
  constructor(network, settings, random, signals = null) {
    this.network = network;
    this.p = settings;
    this.random = random;
    this.signals = signals;
    /** @type {Vehicle[]} */
    this.vehicles = [];
    /** @type {Map<number, {owner: number, since: number}>} junction node -> vehicle crossing it */
    this.reservations = new Map();
    this.time = 0;
    this.nextId = 1;
    this.started = false;
    /**
     * Height of the road at a point of a lane, on its bridge deck for a lane on a bridge (#75); null: no
     * heights, every vehicle and obstacle on one level.
     * @type {((x: number, y: number, bridge: boolean) => number) | null}
     */
    this.heightAt = null;
    /** @type {Obstacle[]} obstacles of the last step */
    this.lastObstacles = [];
    /** @type {{key: string, count: number} | null} vehicles wanted around the cell of the bus */
    this.wantedCache = null;
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
    this.lastObstacles = obstacles;
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
    /** @type {BusWait | null} */
    let bus = null;
    /** @param {number} g @param {number} s @param {BusWait | null} [why] */
    const keep = (g, s, why = null) => {
      if (g < gap) {
        gap = g;
        speed = s;
        bus = why;
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
    // only the first vehicle of a lane may ask for the junction: one behind it would hold it for nothing
    const first = !(byLane.get(v.lane) ?? []).some((other) => other !== v && other.s > v.s);
    const toEnd = lane.length - v.s;
    if (v.next >= 0 && toEnd < this.p.lookahead) {
      const nextLane = this.network.lanes[v.next];
      for (const other of byLane.get(v.next) ?? [])
        if (!ignored(other, nextLane)) {
          keep(toEnd + other.s - (other.length + v.length) / 2, other.v);
          break;
        }
    }
    // at a red light the vehicle waits at the stop line without holding the junction
    const signal = this.signals?.approaches.get(v.lane);
    if (signal) {
      const toLine = toEnd - signal.stopLine - v.length / 2;
      const light = /** @type {import('./signals.js').SignalMap} */ (this.signals).light(
        signal.group,
        signal.phase,
      );
      if (mustStop(light, toLine, v.v, this.p.braking, this.p.maxBraking)) {
        this.release(v);
        keep(toLine, 0);
        this.probe(v, obstacles, keep);
        return { gap, speed, bus };
      }
    }
    // a junction is crossed only with its reservation: else stop before it
    if (this.network.junctions.has(lane.to) && toEnd < this.p.junctionApproach) {
      const toLine = toEnd - this.p.stopBack - v.length / 2;
      // it leaves the junction to the bus while it can still stop before it
      const yields = toLine > (v.v * v.v) / (2 * this.p.maxBraking) && this.busAtJunction(lane, obstacles);
      if (!first || yields) this.release(v);
      if (!first || yields || !this.reserve(v, lane)) keep(toLine, 0);
    }
    if (v.next < 0) keep(toEnd - v.length / 2, 0);
    this.probe(v, obstacles, keep);
    return { gap, speed, bus };
  }

  /**
   * Whether the moving player's bus drives to the junction at the end of a lane, or is in it.
   * @param {Lane} lane @param {Obstacle[]} obstacles
   */
  busAtJunction(lane, obstacles) {
    const x = lane.pts[lane.pts.length - 2],
      y = lane.pts[lane.pts.length - 1];
    for (const o of obstacles) {
      if (!o.priority || o.v < this.p.yieldSpeed) continue;
      const dx = x - o.x,
        dy = y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > this.p.yieldRadius) continue;
      if (d < o.r + this.p.junctionClear || dx * Math.cos(o.h) + dy * Math.sin(o.h) > 0) return true;
    }
    return false;
  }

  /**
   * Obstacles on the path ahead of a vehicle, looked at every probeStep metres up to lookahead.
   * @param {Vehicle} v @param {Obstacle[]} obstacles
   * @param {(gap: number, speed: number, bus?: BusWait | null) => void} keep
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
          const along = Math.cos(o.h - at.h);
          const free = ahead - v.length / 2;
          if (!o.priority) keep(free, Math.max(0, o.v * along));
          else
            keep(free - this.p.busGap, Math.max(0, o.v * along), {
              gap: free,
              follows: along > Math.cos((this.p.followAngle * Math.PI) / 180),
              speed: o.v,
            });
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
    obstacles = obstacles.filter((o) => this.sameLevel(v, o.z));
    if (v.backing) {
      this.reverse(v, dt);
      return;
    }
    const { gap, speed, bus } = this.leader(v, byLane, obstacles);
    const acceleration = Math.max(-this.p.maxBraking, idmAcceleration(v.v, v.desired, gap, speed, this.p));
    v.v = Math.max(0, v.v + acceleration * dt);
    v.braking = acceleration < -this.p.brakeLightDeceleration || v.v < this.p.stuckSpeed;
    v.stuck = this.waitsForBus(v, bus) ? (v.stuck ?? 0) + dt : 0;
    if (v.stuck > this.p.stuckDelay) {
      this.backOff(v, byLane, obstacles);
      return;
    }
    v.s += v.v * dt;
    let lane = this.network.lanes[v.lane];
    if (v.s >= lane.length && v.next >= 0) {
      v.s -= lane.length;
      v.previous = v.lane;
      v.lane = v.next;
      lane = this.network.lanes[v.lane];
      v.next = this.network.nextLane(v.lane, this.random, v.bike);
      v.desired = this.desired(v.bike, lane);
    }
    v.s = Math.min(v.s, lane.length);
    // the road leaves the map: the vehicle leaves with it, another one appears elsewhere
    if (v.next < 0 && v.s >= lane.length - v.length / 2 - this.p.minGap - 0.5) v.gone = true;
    // the junction is free once the whole vehicle has crossed it
    if (v.reserved >= 0 && v.reserved !== lane.to && v.s > v.length + this.p.junctionClear) this.release(v);
    this.place(v);
  }

  /**
   * Whether a stopped vehicle is stuck by the player's bus: against it, or waiting for it while the bus stands
   * across its way (a vehicle behind the bus waits as long as the bus does).
   * @param {Vehicle} v @param {BusWait | null} bus
   */
  waitsForBus(v, bus) {
    if (!bus || v.v >= this.p.stuckSpeed) return false;
    return bus.gap < this.p.stuckContact || (!bus.follows && bus.speed < this.p.stuckSpeed);
  }

  /**
   * Unstick a vehicle from the player's bus: it backs off where there is room behind it, else (or after
   * backOffs times) it is removed and another one appears out of sight.
   * @param {Vehicle} v @param {Map<number, Vehicle[]>} byLane @param {Obstacle[]} obstacles
   */
  backOff(v, byLane, obstacles) {
    v.stuck = 0;
    v.v = 0;
    this.release(v);
    v.backOffs = (v.backOffs ?? 0) + 1;
    const room = this.roomBehind(v, byLane, obstacles);
    if (v.backOffs > this.p.backOffs || room < this.p.backOffMin) v.gone = true;
    else v.backing = Math.min(this.p.backOffDistance, room);
  }

  /**
   * Free distance behind a vehicle on its path, up to backOffDistance: to the start of its road (or of the
   * road it came from), the vehicle behind it and the obstacles.
   * @param {Vehicle} v @param {Map<number, Vehicle[]>} byLane @param {Obstacle[]} obstacles
   */
  roomBehind(v, byLane, obstacles) {
    const lanes = this.network.lanes;
    let room = Math.min(
      this.p.backOffDistance,
      v.s - v.length / 2 + (v.previous >= 0 ? lanes[v.previous].length : 0),
    );
    for (const other of byLane.get(v.lane) ?? [])
      if (other !== v && other.s < v.s)
        room = Math.min(room, v.s - other.s - (v.length + other.length) / 2 - this.p.minGap / 2);
    for (let back = this.p.probeStep; back <= room; back += this.p.probeStep) {
      const at = this.pathPoint(v, v.s - v.length / 2 - back);
      if (obstacles.some((o) => Math.hypot(o.x - at.x, o.y - at.y) < o.r + v.width / 2))
        return back - this.p.probeStep;
    }
    return Math.max(0, room);
  }

  /** One step backwards along the path, on to the road it came from. @param {Vehicle} v @param {number} dt */
  reverse(v, dt) {
    const step = Math.min(this.p.backOffSpeed * dt, v.backing ?? 0);
    v.backing = (v.backing ?? 0) - step;
    v.s -= step;
    if (v.s < 0 && v.previous >= 0) {
      v.next = v.lane;
      v.lane = v.previous;
      v.previous = -1;
      v.s += this.network.lanes[v.lane].length;
    }
    if (v.s <= 0) {
      v.s = 0;
      v.backing = 0;
    }
    this.place(v);
  }

  /**
   * Vehicles the player's bus pushes against while its driver wants to move (or just before its nose while it
   * waits for them): one pushed for stuckDelay backs
   * off or is removed, unless the bus pushes it from behind (it goes on when its own way is free).
   * @param {{x: number, y: number}[]} outline points of the outline and the middle line of the bus
   * @param {number} heading of the bus
   * @param {number} dt
   * @param {number} [z] height of the bus: vehicles on another level are not pushed
   */
  pushedBy(outline, heading, dt, z = undefined) {
    const byLane = this.sortByLane();
    const follow = Math.cos((this.p.followAngle * Math.PI) / 180);
    for (const v of this.vehicles) {
      if (!this.sameLevel(v, z)) continue;
      const touching = outline.filter((p) => this.touches(v, p.x, p.y, this.p.contactMargin));
      // behind the car (not alongside it): the bus drives into its back
      const rear = (/** @type {{x: number, y: number}} */ p) => {
        const dx = p.x - v.x,
          dy = p.y - v.y;
        const along = dx * Math.cos(v.h) + dy * Math.sin(v.h),
          across = -dx * Math.sin(v.h) + dy * Math.cos(v.h);
        return along < 0 && Math.abs(across) < v.width / 2;
      };
      const behind = touching.every(rear) && Math.cos(heading - v.h) > follow;
      if (!touching.length || behind || v.backing) {
        v.pushed = 0;
        continue;
      }
      v.pushed = (v.pushed ?? 0) + dt;
      if (v.pushed > this.p.stuckDelay) {
        v.pushed = 0;
        this.backOff(v, byLane, this.lastObstacles);
      }
    }
    this.despawnGone();
  }

  /** Remove the vehicles removed to unstick the bus. */
  despawnGone() {
    for (const v of this.vehicles) if (v.gone) this.release(v);
    this.vehicles = this.vehicles.filter((v) => !v.gone);
  }

  /** Position and heading of a vehicle; the heading looks a little ahead to round the corners. @param {Vehicle} v */
  place(v) {
    // both axles on the path, the vehicle between them: the rear follows the road instead of swinging out
    const half = (v.length * this.p.wheelbaseShare) / 2;
    const front = this.pathPoint(v, v.s + half),
      rear = this.pathPoint(v, v.s - half);
    v.x = (front.x + rear.x) / 2;
    v.y = (front.y + rear.y) / 2;
    v.h =
      Math.hypot(front.x - rear.x, front.y - rear.y) > 0.1
        ? Math.atan2(front.y - rear.y, front.x - rear.x)
        : front.h;
    if (this.heightAt) v.z = this.heightAt(v.x, v.y, this.network.lanes[v.lane].bridge);
  }

  /**
   * Whether something at height `z` is on the level of a vehicle: not on a bridge above it or on the road
   * below (#75). Without heights, everything is on one level.
   * @param {Vehicle} v @param {number | undefined} z
   */
  sameLevel(v, z) {
    return z === undefined || v.z === undefined || Math.abs(z - v.z) < this.p.levelGap;
  }

  /**
   * Point of a vehicle's path at distance `s` along its lane, before it on the previous lane or past it on
   * the next one.
   * @param {Vehicle} v @param {number} s
   */
  pathPoint(v, s) {
    const lanes = this.network.lanes;
    let id = v.lane;
    if (s > lanes[id].length && v.next >= 0) {
      s -= lanes[id].length;
      id = v.next;
    } else if (s < 0 && v.previous >= 0) {
      id = v.previous;
      s += lanes[id].length;
    }
    return this.network.pointAt(id, Math.min(Math.max(s, 0), lanes[id].length), this.offset(v, lanes[id]));
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
    if (this.vehicles.length >= this.wanted(centre)) return;
    const near = this.network.lanesNear(centre.x, centre.y, this.p.spawnRadius);
    if (!near.length) return;
    const wanted = this.wanted(centre);
    for (let attempt = 0; attempt < this.p.spawnAttempts && this.vehicles.length < wanted; attempt++) {
      const id = near[Math.floor(this.random() * near.length)];
      const lane = this.network.lanes[id];
      // fewer cars in the countryside
      if (!lane.builtUp && this.random() > this.p.ruralShare) continue;
      const s = this.random() * lane.length;
      const at = this.network.pointAt(id, s, 0);
      const d = Math.hypot(at.x - centre.x, at.y - centre.y);
      if (d < minDistance || d > this.p.spawnRadius) continue;
      if (this.vehicles.some((v) => v.lane === id && Math.abs(v.s - s) < this.p.spawnClearance)) continue;
      const bike = lane.builtUp && this.random() < this.p.bikeShare;
      /** @type {Vehicle} */
      const v = {
        id: this.nextId++,
        bike,
        lane: id,
        s,
        v: 0,
        next: this.network.nextLane(id, this.random, bike),
        desired: this.desired(bike, lane),
        length: bike ? this.p.bikeLength : this.p.carLength,
        width: bike ? this.p.bikeWidth : this.p.carWidth,
        variant: Math.floor(this.random() * this.p.looks),
        x: 0,
        y: 0,
        h: 0,
        reserved: -1,
        previous: -1,
      };
      v.v = v.desired / 2;
      this.place(v);
      this.vehicles.push(v);
    }
  }

  /**
   * Vehicles wanted around the bus: `density` per km of the lanes near it, `ruralShare` of it outside built-up
   * areas, at most `vehicles`; computed again when the bus enters another cell.
   * @param {{x: number, y: number}} centre
   */
  wanted(centre) {
    const key = this.network.cellKey(centre.x, centre.y);
    if (this.wantedCache?.key !== key) {
      let km = 0;
      for (const id of this.network.lanesNear(centre.x, centre.y, this.p.spawnRadius)) {
        const lane = this.network.lanes[id];
        km += (lane.length / 1000) * (lane.builtUp ? 1 : this.p.ruralShare);
      }
      this.wantedCache = { key, count: Math.min(this.p.vehicles, Math.round(this.p.density * km)) };
    }
    return this.wantedCache.count;
  }

  /**
   * Whether a vehicle is about to drive over a point: a moving one closer than `near`, or closer than
   * `radius` and heading towards it. A stopped vehicle lets people cross in front of it.
   * @param {number} x @param {number} y @param {number} radius @param {number} near
   */
  approaching(x, y, radius, near) {
    for (const v of this.vehicles) {
      const dx = x - v.x,
        dy = y - v.y;
      const d = Math.hypot(dx, dy);
      if (v.v <= 0.5) continue;
      if (d < near) return true;
      if (d < radius && dx * Math.cos(v.h) + dy * Math.sin(v.h) > 0) return true;
    }
    return false;
  }

  /**
   * Whether a stopped vehicle stands closer than `near` to a point (waiting at a crossing).
   * @param {number} x @param {number} y @param {number} near
   */
  waiting(x, y, near) {
    return this.vehicles.some((v) => v.v <= 0.5 && Math.hypot(x - v.x, y - v.y) < near);
  }

  /**
   * Whether a point is inside a vehicle (for the collisions of the player's bus), on the level of `z` if given.
   * @param {number} x @param {number} y @param {number} [z]
   */
  hit(x, y, z = undefined) {
    return this.vehicles.some((v) => this.sameLevel(v, z) && this.touches(v, x, y, 0));
  }

  /**
   * Whether a point is inside a vehicle grown by `margin` on every side.
   * @param {Vehicle} v @param {number} x @param {number} y @param {number} margin
   */
  touches(v, x, y, margin) {
    const dx = x - v.x,
      dy = y - v.y;
    if (Math.abs(dx) > v.length + margin || Math.abs(dy) > v.length + margin) return false;
    const along = dx * Math.cos(v.h) + dy * Math.sin(v.h),
      across = -dx * Math.sin(v.h) + dy * Math.cos(v.h);
    return Math.abs(along) <= v.length / 2 + margin && Math.abs(across) <= v.width / 2 + margin;
  }
}
