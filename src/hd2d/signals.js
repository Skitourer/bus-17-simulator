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
 * @property {Set<number>} nodes @property {number} offset s into the cycle
 */

/**
 * @typedef {object} Approach a lane entering a signalised junction
 * @property {number} group @property {0 | 1} phase @property {number} stopLine distance of the stop line
 * before the end of the lane (m)
 */

/**
 * @typedef {object} StopLineMark a stop line across an approach
 * @property {number} x @property {number} y point of the line on the centre line of the road (m)
 * @property {number} h heading of the approach @property {number} left @property {number} right extent of
 * the line left and right of that point (m) @property {number} group @property {0 | 1} phase
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
 * @typedef {object} RouteStopLine a stop line on the way of a bus route
 * @property {number} s distance along the route where the front of the bus stops (m) @property {number} group
 * @property {0 | 1} phase
 */

/**
 * Stop lines of the signalised junctions a route goes through (#85): where its matched lane is an approach
 * of a junction and the route then leaves that lane through the junction.
 * @param {{lane: Int32Array, along: Float64Array}} match lane and distance along it of every route point
 * @param {readonly {from: number, to: number, length: number}[]} lanes the matched lanes
 * @param {(from: number, to: number) => Approach | undefined} approachOf approach of a lane, by its nodes
 * @param {number} step distance between route points (m)
 * @returns {RouteStopLine[]} in route order
 */
export function routeStopLines(match, lanes, approachOf, step) {
  /** @type {RouteStopLine[]} */
  const out = [];
  const n = match.lane.length;
  let start = 0;
  for (let i = 1; i <= n; i++) {
    const id = match.lane[start];
    if (i < n && match.lane[i] === id) continue;
    // the run [start, i) stays on one lane; it counts when the route goes on through the junction
    const lane = lanes[id];
    const approach = lane && i < n && match.lane[i] >= 0 ? approachOf(lane.from, lane.to) : undefined;
    if (lane && approach) {
      const line = lane.length - approach.stopLine;
      let k = start;
      while (k < i - 1 && match.along[k] < line) k++;
      // the route point at the line, shifted by what remains between that point and the line
      const s = k * step + Math.max(-step, Math.min(step, line - match.along[k]));
      out.push({ s, group: approach.group, phase: approach.phase });
    }
    start = i;
  }
  return out;
}

/**
 * Distance from the front of a bus to the nearest stop line ahead where it must stop (red, or amber with
 * room to brake comfortably; at the line, until green), else null.
 * @param {readonly RouteStopLine[]} lines @param {number} front distance of the front of the bus along the route
 * @param {(group: number, phase: 0 | 1) => Light} light @param {number} v speed (m/s)
 * @param {{braking: number, maxBraking: number, atLine: number}} p decelerations (m/s²) and reach of a line (m)
 */
export function stopLineAhead(lines, front, light, v, p) {
  for (const line of lines) {
    if (line.s - front < -p.atLine) continue;
    const gap = Math.max(0, line.s - front);
    const state = light(line.group, line.phase);
    if (gap <= p.atLine ? state !== 'green' : mustStop(state, gap, v, p.braking, p.maxBraking)) return gap;
  }
  return null;
}

/**
 * Highest speed from which a vehicle still stops within `gap` m with the deceleration `braking`.
 * @param {number} gap @param {number} braking m/s²
 */
export function approachSpeed(gap, braking) {
  return Math.sqrt(2 * braking * Math.max(0, gap));
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
    /** @type {SignalGroup[]} */
    this.groups = (roads.signals ?? []).map((list, index) => ({
      nodes: new Set(list),
      offset: ((index * GOLDEN) % 1) * cycle,
    }));
    /** @type {Map<number, number>} group of each signalised node */
    const groupOf = new Map();
    this.groups.forEach((g, index) => g.nodes.forEach((node) => groupOf.set(node, index)));
    /** @type {Map<number, Approach>} lanes entering a group from outside, by lane id */
    this.approaches = new Map();
    /** @type {Map<string, Approach>} the same approaches by their nodes "from>to" */
    this.byNodes = new Map();
    /** @type {SignalHead[]} */
    this.heads = [];
    /** @type {StopLineMark[]} */
    this.lines = [];
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
        this.byNodes.set(lane.from + '>' + lane.to, { group, phase, stopLine });
        const foot = polylinePoint(
          lane.pts,
          lane.cum,
          lane.length - stopLine,
          lane.width / 2 + settings.poleSetback,
        );
        this.heads.push({ x: foot.x, y: foot.y, h: foot.h, group, phase });
        // across the right half of a two-way road, across the whole of a one-way road
        const at = polylinePoint(lane.pts, lane.cum, lane.length - stopLine, 0);
        const half = lane.width / 2;
        this.lines.push({
          x: at.x,
          y: at.y,
          h: at.h,
          left: lane.twoWay ? 0 : half,
          right: half,
          group,
          phase,
        });
      }
    });
  }

  /** Approach of the lane from one node to another, if it enters a signalised junction. @param {number} from @param {number} to */
  approachOf(from, to) {
    return this.byNodes.get(from + '>' + to);
  }

  /** @param {number} dt s */
  advance(dt) {
    this.time += dt;
  }

  /** Light of a phase of a group now. @param {number} group @param {0 | 1} phase @returns {Light} */
  light(group, phase) {
    return lightAt(this.time + this.groups[group].offset, phase, this.p);
  }
}

/** Tells when the player's bus crosses the stop line of a red light (#85). */
export class RedLightWatch {
  /**
   * @param {SignalMap} signals @param {number} minSpeed m/s: slower, the bus is not crossing
   * @param {number} margin m: the line counts this far beyond its ends
   */
  constructor(signals, minSpeed, margin) {
    this.signals = signals;
    this.minSpeed = minSpeed;
    this.margin = margin;
    /** @type {{x: number, y: number} | null} front of the bus at the previous step */
    this.last = null;
  }

  /**
   * Group whose stop line the front of the bus crossed on red at this step, or -1.
   * @param {number} x @param {number} y front of the bus @param {number} h heading @param {number} v speed (m/s)
   */
  step(x, y, h, v) {
    const last = this.last;
    this.last = { x, y };
    if (!last || v < this.minSpeed) return -1;
    for (const line of this.signals.lines) {
      const c = Math.cos(line.h),
        sn = Math.sin(line.h);
      // along the approach: from before the line to after it, in its direction of travel
      const before = (last.x - line.x) * c + (last.y - line.y) * sn,
        after = (x - line.x) * c + (y - line.y) * sn;
      if (!(before < 0 && after >= 0) || Math.cos(h - line.h) < 0.5) continue;
      // across: right of the centre line is positive
      const across = (x - line.x) * sn - (y - line.y) * c;
      if (across < -line.left - this.margin || across > line.right + this.margin) continue;
      if (this.signals.light(line.group, line.phase) === 'red') return line.group;
    }
    return -1;
  }
}
