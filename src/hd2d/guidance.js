// @ts-check
/**
 * Route guidance on the road (#74): the GTFS shape of the line is smoothed and drifts a few metres from the
 * streets, so the guidance strip is not drawn along it. Each point of the route is matched to a lane of the
 * road graph (ADR 0002) with a Viterbi search (nearest lane in the direction of travel, staying on the
 * same lane or going on to a connected one), then put in the right-most lane of that road. Where no road is
 * in reach, the strip keeps the bus lane of the route. Pure logic, world metres (x east, y north).
 */

import { cumulative, polylinePoint } from './traffic.js';

/** @typedef {import('../common/types.js').RoadsData} RoadsData */
/** @typedef {import('../world/track.js').Track} Track */
/** @typedef {import('../settings/settings.js').Settings['guidance']} GuidanceSettings */

/**
 * @typedef {object} GuidanceLane one direction of a road edge
 * @property {number} from start node @property {number} to end node
 * @property {Float64Array} pts flat [x, y, ...] in driving order @property {Float64Array} cum distance at each point
 * @property {number} length @property {number} width width of the road (m) @property {boolean} oneway
 */

/**
 * @typedef {object} GuidanceLine
 * @property {Float64Array} x @property {Float64Array} y one point per route point (m)
 * @property {Uint8Array} onRoad 1 where the point was matched to a road, 0 where it kept the route lane
 * @property {Int32Array} lane matched lane of each point (index in the lanes), -1 off the roads
 * @property {Float64Array} along distance along the matched lane (m)
 */

/** Side of the cells that index the lane segments (m): a few cells cover the search reach. */
const CELL = 25;

/**
 * Lanes of every road edge but tunnels (not drawn): one per direction allowed by the one-way flags.
 * @param {RoadsData} roads @returns {GuidanceLane[]}
 */
export function guidanceLanes(roads) {
  /** @param {string} name */
  const flag = (name) => {
    const bit = roads.flags.indexOf(name);
    return bit < 0 ? 0 : 1 << bit;
  };
  const oneway = flag('oneway'),
    reverse = flag('oneway_reverse'),
    tunnel = flag('tunnel');
  /** @type {GuidanceLane[]} */
  const lanes = [];
  /** @param {number} from @param {number} to @param {number[]} pts @param {number} width @param {boolean} single */
  const add = (from, to, pts, width, single) => {
    const cum = cumulative(pts);
    lanes.push({
      from,
      to,
      pts: Float64Array.from(pts),
      cum,
      length: cum[cum.length - 1],
      width,
      oneway: single,
    });
  };
  for (const edge of roads.edges) {
    const [a, b, , widthDm, , mask] = edge;
    if (mask & tunnel) continue;
    const pts = edge.slice(6).map((v) => v / 10);
    const single = Boolean(mask & (oneway | reverse));
    if (!(mask & reverse)) add(a, b, pts, widthDm / 10, single);
    if (!(mask & oneway)) add(b, a, backwards(pts), widthDm / 10, single);
  }
  return lanes;
}

/** @param {number[]} pts flat [x, y, ...] */
function backwards(pts) {
  const out = [];
  for (let k = pts.length - 2; k >= 0; k -= 2) out.push(pts[k], pts[k + 1]);
  return out;
}

/**
 * Distance right of a road centre line to the middle of its right-most lane, where the bus drives: the
 * outer lane of a one-way road, the outer lane of the right half of a two-way road, kept far enough from
 * the kerb for the bus body.
 * @param {number} width road width (m) @param {boolean} oneway
 * @param {{laneWidth: number, bodyWidth: number, kerbMargin: number}} params
 */
export function laneCentre(width, oneway, params) {
  const half = width / 2;
  const ownWidth = oneway ? width : half;
  const centre = half - Math.min(ownWidth, params.laneWidth) / 2;
  const fit = half - params.bodyWidth / 2 - params.kerbMargin;
  return Math.max(0, Math.min(centre, fit));
}

/** Lane segments bucketed in square cells. */
class SegmentIndex {
  /** @param {GuidanceLane[]} lanes */
  constructor(lanes) {
    /** @type {Map<string, number[]>} flat [lane, segment, ...] per cell */
    this.cells = new Map();
    lanes.forEach((lane, id) => {
      const { pts } = lane;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const i0 = Math.floor(Math.min(pts[k], pts[k + 2]) / CELL),
          i1 = Math.floor(Math.max(pts[k], pts[k + 2]) / CELL);
        const j0 = Math.floor(Math.min(pts[k + 1], pts[k + 3]) / CELL),
          j1 = Math.floor(Math.max(pts[k + 1], pts[k + 3]) / CELL);
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const key = i + '_' + j;
            const list = this.cells.get(key);
            if (list) list.push(id, k / 2);
            else this.cells.set(key, [id, k / 2]);
          }
      }
    });
  }

  /** @param {number} x @param {number} y @param {number} radius @returns {number[]} flat [lane, segment, ...] */
  near(x, y, radius) {
    const out = [];
    for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++)
      for (let j = Math.floor((y - radius) / CELL); j <= Math.floor((y + radius) / CELL); j++)
        out.push(...(this.cells.get(i + '_' + j) ?? []));
    return out;
  }
}

/**
 * @typedef {object} Candidate a lane near a route point
 * @property {number} lane @property {number} along distance along the lane of the nearest point (m)
 * @property {number} cost how badly the lane fits the point
 */

/**
 * Lanes near (x, y) that run in the direction `heading`, each with its nearest point.
 * @param {SegmentIndex} index @param {GuidanceLane[]} lanes @param {number} x @param {number} y
 * @param {number} heading @param {GuidanceSettings} params @returns {Candidate[]}
 */
function candidates(index, lanes, x, y, heading, params) {
  /** @type {Map<number, {along: number, d: number, h: number}>} */
  const best = new Map();
  const near = index.near(x, y, params.snapReach);
  for (let k = 0; k < near.length; k += 2) {
    const id = near[k],
      seg = near[k + 1];
    const { pts, cum } = lanes[id];
    const ax = pts[seg * 2],
      ay = pts[seg * 2 + 1],
      ex = pts[seg * 2 + 2] - ax,
      ey = pts[seg * 2 + 3] - ay;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-9) continue;
    const f = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2));
    const d = Math.hypot(ax + ex * f - x, ay + ey * f - y);
    const known = best.get(id);
    if (d <= params.snapReach && (!known || d < known.d))
      best.set(id, { along: cum[seg] + f * Math.sqrt(len2), d, h: Math.atan2(ey, ex) });
  }
  const maxTurn = (params.snapAngle * Math.PI) / 180;
  /** @type {Candidate[]} */
  const out = [];
  for (const [lane, { along, d, h }] of best) {
    const turn = Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading)));
    if (turn <= maxTurn)
      out.push({ lane, along, cost: (d / params.snapSpread) ** 2 + (turn / maxTurn) ** 2 });
  }
  return out;
}

/**
 * Cost of going from lane candidate `a` at one route point to `b` at the next one, `step` metres on: free
 * along the same lane or on to a lane that starts where it ends (through at most one short lane),
 * `jumpCost` otherwise.
 * @param {Candidate} a @param {Candidate} b @param {GuidanceLane[]} lanes
 * @param {Map<number, number[]>} outgoing lanes leaving each node @param {number} step @param {number} jumpCost
 */
function transitionCost(a, b, lanes, outgoing, step, jumpCost) {
  // the route may wobble back a little on a lane, never a whole step
  const slack = step * 2;
  if (a.lane === b.lane) return b.along >= a.along - slack ? 0 : jumpCost;
  const from = lanes[a.lane];
  const left = from.length - a.along;
  if (left > slack + step) return jumpCost;
  const to = lanes[b.lane];
  if (from.to === to.from) return b.along <= slack + step ? 0 : jumpCost;
  for (const middle of outgoing.get(from.to) ?? [])
    if (lanes[middle].to === to.from && left + lanes[middle].length + b.along <= slack * 2 + step) return 0;
  return jumpCost;
}

/**
 * Lane matched to every point of the route (Viterbi over the candidates and an "off the roads" state), or
 * -1 where none is in reach.
 * @param {Track} track @param {GuidanceLane[]} lanes @param {GuidanceSettings} params
 * @returns {{lane: Int32Array, along: Float64Array}}
 */
export function matchRoute(track, lanes, params) {
  const index = new SegmentIndex(lanes);
  /** @type {Map<number, number[]>} */
  const outgoing = new Map();
  lanes.forEach((lane, id) => {
    const list = outgoing.get(lane.from);
    if (list) list.push(id);
    else outgoing.set(lane.from, [id]);
  });
  // off the roads costs as much as a lane at the edge of the reach, so the nearest lane in reach wins
  const offCost = (params.snapReach / params.snapSpread) ** 2;
  const off = { lane: -1, along: 0, cost: offCost };
  /** @type {Candidate[][]} */
  const states = [];
  /** @type {Int32Array[]} */
  const back = [];
  let total = new Float64Array(0);
  for (let i = 0; i < track.n; i++) {
    const list = [...candidates(index, lanes, track.x[i], track.y[i], track.h[i], params), off];
    const next = new Float64Array(list.length);
    const from = new Int32Array(list.length);
    list.forEach((b, j) => {
      if (i === 0) {
        next[j] = b.cost;
        return;
      }
      let best = Infinity,
        arg = 0;
      states[i - 1].forEach((a, k) => {
        const move =
          a.lane < 0 || b.lane < 0
            ? a.lane === b.lane
              ? 0
              : params.jumpCost
            : transitionCost(a, b, lanes, outgoing, track.step, params.jumpCost);
        const cost = total[k] + move;
        if (cost < best) {
          best = cost;
          arg = k;
        }
      });
      next[j] = best + b.cost;
      from[j] = arg;
    });
    states.push(list);
    back.push(from);
    total = next;
  }
  const lane = new Int32Array(track.n),
    along = new Float64Array(track.n);
  let j = total.indexOf(Math.min(...total));
  for (let i = track.n - 1; i >= 0; i--) {
    lane[i] = states[i][j].lane;
    along[i] = states[i][j].along;
    j = back[i][j];
  }
  return { lane, along };
}

/**
 * Line of the guidance strip: every route point moved to the right-most lane of its matched road, or kept
 * in the bus lane of the route (`fallback`, m right of the route) off the roads, then smoothed so that the
 * corners of the junctions are rounded.
 * @param {Track} track @param {GuidanceLane[]} lanes @param {Float64Array} fallback
 * @param {GuidanceSettings & {bodyWidth: number, kerbMargin: number}} params @returns {GuidanceLine}
 */
export function guidanceLine(track, lanes, fallback, params) {
  const { lane, along } = matchRoute(track, lanes, params);
  const rawX = new Float64Array(track.n),
    rawY = new Float64Array(track.n);
  const onRoad = new Uint8Array(track.n);
  for (let i = 0; i < track.n; i++) {
    if (lane[i] >= 0) {
      const road = lanes[lane[i]];
      const p = polylinePoint(road.pts, road.cum, along[i], laneCentre(road.width, road.oneway, params));
      rawX[i] = p.x;
      rawY[i] = p.y;
      onRoad[i] = 1;
    } else {
      const p = track.pos(i * track.step, fallback[i]);
      rawX[i] = p.x;
      rawY[i] = p.y;
    }
  }
  const half = Math.max(0, Math.round(params.smoothing / track.step));
  return { x: movingAverage(rawX, half), y: movingAverage(rawY, half), onRoad, lane, along };
}

/**
 * The route the buses drive (#85): the points of the guidance line with the route altitudes, so that the
 * distances `s` along it, its stops and its timetable stay those of the route.
 * @param {import('../common/types.js').Route} route @param {GuidanceLine} guide
 * @returns {import('../common/types.js').Route}
 */
export function drivingRoute(route, guide) {
  const pts = route.pts.slice();
  for (let i = 0; i < guide.x.length; i++) {
    pts[i * 3] = guide.x[i];
    pts[i * 3 + 1] = guide.y[i];
  }
  return { ...route, pts };
}

/** @param {Float64Array} values @param {number} half points on each side @returns {Float64Array} */
function movingAverage(values, half) {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0,
      count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += values[k];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Stretches [s0, s1] (m along the route) where the guidance found no road and kept the route lane.
 * @param {Uint8Array} onRoad @param {number} step @returns {[number, number][]}
 */
export function offRoadStretches(onRoad, step) {
  /** @type {[number, number][]} */
  const out = [];
  let start = -1;
  for (let i = 0; i <= onRoad.length; i++) {
    const off = i < onRoad.length && !onRoad[i];
    if (off && start < 0) start = i;
    else if (!off && start >= 0) {
      out.push([start * step, (i - 1) * step]);
      start = -1;
    }
  }
  return out;
}
