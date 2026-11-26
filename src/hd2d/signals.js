// @ts-check
/**
 * Traffic lights (#77) at the junctions tagged with signals in OpenStreetMap (`signals` of roads.json:
 * groups of graph nodes sharing one cycle). The approaches of a group are split into two phases by their
 * direction (the main axis and the cross axis); each phase gets green, amber, then red while the other one
 * goes, with an all-red gap between them. Pure logic, world metres (x east, y north), headings in radians.
 */

import { polylinePoint } from './traffic.js';

/** @typedef {import('../settings/settings.js').Settings['signals']} SignalSettings */
/** @typedef {import('../common/types.js').RoadsData} RoadsData */
/** @typedef {'green' | 'amber' | 'red'} Light */

/**
 * @typedef {object} SignalGroup junction (or close junctions) with one light cycle
 * @property {Set<number>} nodes @property {number} x @property {number} y centre (m)
 * @property {number} radius reach of the junction around its centre (m) @property {number} offset s into the cycle
 */

/**
 * @typedef {object} Approach a lane entering a signalised junction
 * @property {number} group @property {0 | 1} phase @property {number} stopLine distance of the stop line
 * before the end of the lane (m)
 */

/**
 * @typedef {object} SignalHead lights on a pole at the right of an approach, before its stop line
 * @property {number} x @property {number} y foot of the pole (m) @property {number} h heading of the approach
 * @property {number} group @property {0 | 1} phase
 */

/** Golden ratio: spreads the cycle offsets of the junctions evenly without a pattern. */
const GOLDEN = 0.6180339887;

/**
 * Light of a phase at `time` (s) into the cycle of its junction.
 * @param {number} time @param {0 | 1} phase @param {SignalSettings} p @returns {Light}
 */
export function lightAt(time, phase, p) {
  const half = p.green + p.amber + p.allRed;
  const t = (((time - phase * half) % (2 * half)) + 2 * half) % (2 * half);
  if (t < p.green) return 'green';
  if (t < p.green + p.amber) return 'amber';
  return 'red';
}

/**
 * Whether a vehicle must stop at the line: on red when it still can, on amber when it can do it comfortably.
 * @param {Light} light @param {number} gap distance to the stop line (m) @param {number} v speed (m/s)
 * @param {number} braking comfortable deceleration @param {number} maxBraking hardest deceleration (m/s²)
 */
export function mustStop(light, gap, v, braking, maxBraking) {
  if (light === 'green' || gap < 0) return false;
  return gap >= (v * v) / (2 * (light === 'red' ? maxBraking : braking));
}

/**
 * Phase of a heading in a junction whose main axis is `axis`: 0 along the axis (either way), 1 across.
 * @param {number} heading @param {number} axis @returns {0 | 1}
 */
export function phaseOf(heading, axis) {
  const turn = Math.abs(Math.sin(heading - axis));
  return turn < Math.SQRT1_2 ? 0 : 1;
}

/**
 * Main axis of a junction: the approach heading that the most approaches run along (either way).
 * @param {number[]} headings @returns {number}
 */
export function mainAxis(headings) {
  let best = 0,
    count = -1;
  for (const candidate of headings) {
    const along = headings.filter((h) => phaseOf(h, candidate) === 0).length;
    if (along > count) {
      best = candidate;
      count = along;
    }
  }
  return best;
}

/** Signalised junctions, their approaches and their light heads, on the lanes of the traffic. */
export class SignalMap {
  /**
   * @param {RoadsData} roads @param {import('./traffic.js').RoadNetwork} network @param {SignalSettings} settings
   */
  constructor(roads, network, settings) {
    this.p = settings;
    this.time = 0;
    const cycle = 2 * (settings.green + settings.amber + settings.allRed);
    /** @param {number} node */
    const at = (node) => ({ x: roads.nodes[node * 2] / 10, y: roads.nodes[node * 2 + 1] / 10 });
    /** @type {SignalGroup[]} */
    this.groups = (roads.signals ?? []).map((list, index) => {
      const points = list.map(at);
      const x = points.reduce((sum, q) => sum + q.x, 0) / points.length,
        y = points.reduce((sum, q) => sum + q.y, 0) / points.length;
      const spread = Math.max(...points.map((q) => Math.hypot(q.x - x, q.y - y)));
      return {
        nodes: new Set(list),
        x,
        y,
        radius: spread + settings.junctionReach,
        offset: ((index * GOLDEN) % 1) * cycle,
      };
    });
    /** @type {Map<number, number>} group of each signalised node */
    const groupOf = new Map();
    this.groups.forEach((g, index) => g.nodes.forEach((node) => groupOf.set(node, index)));
    /** @type {Map<number, Approach>} lanes entering a group from outside, by lane id */
    this.approaches = new Map();
    /** @type {SignalHead[]} */
    this.heads = [];
    /** @type {{lane: number, group: number, h: number}[][]} */
    const entering = this.groups.map(() => []);
    network.lanes.forEach((lane, id) => {
      const group = groupOf.get(lane.to);
      if (group === undefined || groupOf.get(lane.from) === group) return;
      const n = lane.pts.length;
      const h = Math.atan2(lane.pts[n - 1] - lane.pts[n - 3], lane.pts[n - 2] - lane.pts[n - 4]);
      entering[group].push({ lane: id, group, h });
    });
    entering.forEach((list, group) => {
      const axis = mainAxis(list.map((e) => e.h));
      for (const { lane: id, h } of list) {
        const lane = network.lanes[id];
        // the stop line stands clear of the widest road crossing the junction, never before the lane starts
        const crossing = Math.max(
          0,
          ...list.filter((e) => e.lane !== id).map((e) => network.lanes[e.lane].width / 2),
        );
        const stopLine = Math.min(lane.length, crossing + settings.stopLineGap);
        const phase = phaseOf(h, axis);
        this.approaches.set(id, { group, phase, stopLine });
        const foot = polylinePoint(
          lane.pts,
          lane.cum,
          lane.length - stopLine,
          lane.width / 2 + settings.poleSetback,
        );
        this.heads.push({ x: foot.x, y: foot.y, h: foot.h, group, phase });
      }
    });
  }

  /** @param {number} dt s */
  advance(dt) {
    this.time += dt;
  }

  /** Light of a phase of a group now. @param {number} group @param {0 | 1} phase @returns {Light} */
  light(group, phase) {
    return lightAt(this.time + this.groups[group].offset, phase, this.p);
  }

  /**
   * Group whose junction holds (x, y), or -1.
   * @param {number} x @param {number} y
   */
  groupAt(x, y) {
    return this.groups.findIndex((g) => Math.hypot(g.x - x, g.y - y) < g.radius);
  }
}

/** Tells when the player's bus drives into a signalised junction on red. */
export class RedLightWatch {
  /** @param {SignalMap} signals @param {number} minSpeed m/s: slower, the bus is not crossing */
  constructor(signals, minSpeed) {
    this.signals = signals;
    this.minSpeed = minSpeed;
    this.inside = -1;
  }

  /**
   * Group entered on red at this step, or -1.
   * @param {number} x @param {number} y @param {number} h heading @param {number} v speed (m/s)
   */
  step(x, y, h, v) {
    const group = this.signals.groupAt(x, y);
    const entered = group >= 0 && group !== this.inside;
    this.inside = group;
    if (!entered || v < this.minSpeed) return -1;
    const axis = this.axisOf(group);
    return this.signals.light(group, phaseOf(h, axis)) === 'red' ? group : -1;
  }

  /** Main axis of a group, from the heads of its phase 0. @param {number} group */
  axisOf(group) {
    const head = this.signals.heads.find((hd) => hd.group === group && hd.phase === 0);
    return head ? head.h : 0;
  }
}
