// @ts-check
/**
 * Stops on the sidewalk (#43): the GTFS position of a stop often falls on the carriageway, so each stop is
 * moved to the kerb on the right of its direction of travel, found by casting a ray from the route centre
 * line across the kerb lines of the street tiles. The same ray casts keep the bus lane on the carriageway
 * of narrow and one-way streets (#45). Pure logic, no DOM and no Three.js.
 */

/** Kerb segments bucketed in square cells, so that a ray only looks at the segments near it. */
export class SegmentGrid {
  /** @param {number[][]} segments [ax, ay, bx, by] (m) @param {number} cell cell size (m) */
  constructor(segments, cell) {
    this.cell = cell;
    /** @type {Map<string, number[][]>} */
    this.cells = new Map();
    for (const seg of segments) {
      const [ax, ay, bx, by] = seg;
      for (let i = Math.floor(Math.min(ax, bx) / cell); i <= Math.floor(Math.max(ax, bx) / cell); i++)
        for (let j = Math.floor(Math.min(ay, by) / cell); j <= Math.floor(Math.max(ay, by) / cell); j++) {
          const key = i + '_' + j;
          const list = this.cells.get(key);
          if (list) list.push(seg);
          else this.cells.set(key, [seg]);
        }
    }
  }

  /**
   * Segments of the cells within `radius` of (x, y), each once.
   * @param {number} x @param {number} y @param {number} radius @returns {number[][]}
   */
  near(x, y, radius) {
    /** @type {Set<number[]>} */
    const out = new Set();
    const c = this.cell;
    for (let i = Math.floor((x - radius) / c); i <= Math.floor((x + radius) / c); i++)
      for (let j = Math.floor((y - radius) / c); j <= Math.floor((y + radius) / c); j++)
        for (const seg of this.cells.get(i + '_' + j) ?? []) out.add(seg);
    return [...out];
  }
}

/**
 * Distance along a ray to the nearest segment it crosses, within (minReach, maxReach].
 * @param {number} px @param {number} py ray origin @param {number} dx @param {number} dy unit direction
 * @param {number[][]} segments [ax, ay, bx, by] @param {number} minReach @param {number} maxReach
 * @returns {number | null}
 */
export function rayHit(px, py, dx, dy, segments, minReach, maxReach) {
  let best = null;
  for (const [ax, ay, bx, by] of segments) {
    const ex = bx - ax,
      ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue; // parallel to the ray
    const wx = ax - px,
      wy = ay - py;
    const t = (wx * ey - wy * ex) / den; // along the ray
    const u = (wx * dy - wy * dx) / den; // along the segment
    if (u >= 0 && u <= 1 && t > minReach && t <= maxReach && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * Kerb lines of the street tiles as segments in the world frame (tile coordinates are decimetres from
 * the tile origin).
 * @param {Map<string, {kerbs: number[][]}>} tiles keyed "i_j"
 * @param {{x0: number, y0: number, size: number}} index
 * @returns {number[][]} [ax, ay, bx, by] in metres
 */
export function kerbSegments(tiles, index) {
  /** @type {number[][]} */
  const out = [];
  for (const [key, tile] of tiles) {
    const [i, j] = key.split('_').map(Number);
    const ox = index.x0 + i * index.size,
      oy = index.y0 + j * index.size;
    for (const line of tile.kerbs)
      for (let k = 0; k + 3 < line.length; k += 2)
        out.push([ox + line[k] / 10, oy + line[k + 1] / 10, ox + line[k + 2] / 10, oy + line[k + 3] / 10]);
  }
  return out;
}

/**
 * @typedef {object} StopPlace
 * @property {number} x @property {number} y kerb point the front door must reach (m)
 * @property {number} shelterX @property {number} shelterY middle of the shelter, on the sidewalk (m)
 * @property {number} h heading of the route at the stop (rad)
 * @property {boolean} kerb false when no kerb was found and the fallback offset was used
 */

/**
 * Place every stop of a route at the kerb on its right. Without a kerb within reach (yards, bus
 * stations), the stop keeps its GTFS distance from the route, but never less than the right side of a
 * bus driving in its lane.
 * @param {import('../world/track.js').Track} track
 * @param {SegmentGrid} kerbs kerb segments (world frame)
 * @param {{kerbSearch: number, shelterSetback: number, laneOffset: number, bodyWidth: number}} params
 * @returns {StopPlace[]}
 */
export function placeStops(track, kerbs, params) {
  const busSide = params.laneOffset + params.bodyWidth / 2;
  return track.stops.map((st) => {
    const c = track.pos(st.s);
    const rx = Math.sin(c.h),
      ry = -Math.cos(c.h); // right of the direction of travel
    const hit = rayHit(c.x, c.y, rx, ry, kerbs.near(c.x, c.y, params.kerbSearch), 0.5, params.kerbSearch);
    const gtfsSide = (st.x - c.x) * rx + (st.y - c.y) * ry;
    const d = hit ?? Math.max(gtfsSide, busSide);
    const shelter = d + params.shelterSetback;
    return {
      x: c.x + rx * d,
      y: c.y + ry * d,
      shelterX: c.x + rx * shelter,
      shelterY: c.y + ry * shelter,
      h: c.h,
      kerb: hit !== null,
    };
  });
}

/**
 * Distance to the right of the route centre line where the bus drives, at every point of the route: the
 * usual `laneOffset`, brought closer to the centre line where the kerb is too near for the bus to fit
 * (one-way and narrow streets). Where no kerb is in reach (junctions, squares), the offset is taken
 * from the nearest points that have one.
 * @param {import('../world/track.js').Track} track
 * @param {SegmentGrid} kerbs
 * @param {{kerbSearch: number, laneOffset: number, bodyWidth: number, kerbMargin: number}} params
 * @returns {Float64Array} one offset (m) per route point, `track.step` metres apart
 */
export function laneOffsets(track, kerbs, params) {
  const fit = new Float64Array(track.n).fill(NaN);
  for (let i = 0; i < track.n; i++) {
    const h = track.h[i],
      x = track.x[i],
      y = track.y[i];
    const hit = rayHit(
      x,
      y,
      Math.sin(h),
      -Math.cos(h),
      kerbs.near(x, y, params.kerbSearch),
      0.5,
      params.kerbSearch,
    );
    if (hit !== null)
      fit[i] = Math.max(0, Math.min(params.laneOffset, hit - params.bodyWidth / 2 - params.kerbMargin));
  }
  fillGaps(fit, params.laneOffset);
  return smooth(fit, Math.max(1, Math.round(10 / track.step)));
}

/**
 * Replace NaN values by the nearest known value before or after them (or `fallback` without any).
 * @param {Float64Array} values updated in place @param {number} fallback
 */
function fillGaps(values, fallback) {
  const n = values.length;
  const before = new Float64Array(n),
    after = new Float64Array(n);
  let last = NaN;
  for (let i = 0; i < n; i++) before[i] = last = Number.isNaN(values[i]) ? last : values[i];
  last = NaN;
  for (let i = n - 1; i >= 0; i--) after[i] = last = Number.isNaN(values[i]) ? last : values[i];
  for (let i = 0; i < n; i++)
    if (Number.isNaN(values[i])) {
      const known = [before[i], after[i]].filter((v) => !Number.isNaN(v));
      values[i] = known.length ? Math.min(...known) : fallback;
    }
}

/**
 * Moving minimum then moving average over `half` points on each side: the bus moves towards the centre
 * line before a narrowing, never after it, and without jerks.
 * @param {Float64Array} values @param {number} half @returns {Float64Array}
 */
function smooth(values, half) {
  const n = values.length;
  const low = values.map((_, i) => {
    let m = Infinity;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) m = Math.min(m, values[k]);
    return m;
  });
  return low.map((_, i) => {
    let sum = 0,
      count = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += low[k];
      count++;
    }
    return sum / count;
  });
}

/**
 * Offset of a lane profile at `s` metres along the route (linear between points, clamped at the ends).
 * @param {Float64Array} profile @param {number} step @param {number} s
 */
export function offsetAt(profile, step, s) {
  const f = Math.max(0, Math.min(profile.length - 1, s / step));
  const i = Math.min(profile.length - 2, Math.floor(f));
  if (i < 0) return profile[0];
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}
