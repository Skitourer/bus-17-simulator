// @ts-check
/**
 * Street lights (#55): their places along the kerbs, only in built-up areas (#89), and the few nearest ones
 * that get a real light at night. Pure logic, world metres (x east, y north).
 */

/** @typedef {import('../common/types.js').RoadsData} RoadsData */

/**
 * Places every `spacing` metres along polylines, the first one half a spacing from the start of each line,
 * continued across the points of a line.
 * @param {number[][]} lines flat [x0, y0, x1, y1, ...] @param {number} spacing metres
 * @returns {number[]} flat [x, y, ...]
 */
export function placesAlong(lines, spacing) {
  /** @type {number[]} */
  const out = [];
  for (const line of lines) {
    let next = spacing / 2;
    let walked = 0;
    for (let k = 0; k + 3 < line.length; k += 2) {
      const x0 = line[k],
        y0 = line[k + 1],
        x1 = line[k + 2],
        y1 = line[k + 3];
      const L = Math.hypot(x1 - x0, y1 - y0);
      while (next <= walked + L) {
        const f = L ? (next - walked) / L : 0;
        out.push(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
        next += spacing;
      }
      walked += L;
    }
  }
  return out;
}

/** Places sorted into square cells, to find the nearest ones to a point quickly. */
export class PlaceGrid {
  /** @param {number[]} places flat [x, y, ...] @param {number} cell metres */
  constructor(places, cell) {
    this.cell = cell;
    /** @type {Map<string, number[]>} */
    this.cells = new Map();
    for (let i = 0; i + 1 < places.length; i += 2) {
      const key = this.key(places[i], places[i + 1]);
      const list = this.cells.get(key);
      if (list) list.push(places[i], places[i + 1]);
      else this.cells.set(key, [places[i], places[i + 1]]);
    }
  }

  /** @param {number} x @param {number} y */
  key(x, y) {
    return `${Math.floor(x / this.cell)}_${Math.floor(y / this.cell)}`;
  }

  /**
   * The `count` nearest places to (x, y) within one cell around the point's cell, nearest first.
   * @param {number} x @param {number} y @param {number} count @returns {number[][]} [x, y] pairs
   */
  nearest(x, y, count) {
    const ci = Math.floor(x / this.cell),
      cj = Math.floor(y / this.cell);
    /** @type {{x: number, y: number, d: number}[]} */
    const found = [];
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.cells.get(`${i}_${j}`) ?? [];
        for (let k = 0; k + 1 < list.length; k += 2)
          found.push({ x: list[k], y: list[k + 1], d: Math.hypot(list[k] - x, list[k + 1] - y) });
      }
    found.sort((p, q) => p.d - q.d);
    return found.slice(0, count).map((p) => [p.x, p.y]);
  }
}

/** Side of the cells of BuiltUpStreets (m): an index, not a tunable value. */
const CELL = 50;

/**
 * The streets of the built-up areas (`built_up` flag of roads.json, #94), to keep the street lights there
 * (#89). Without the flag in the data, every place is in a built-up area.
 */
export class BuiltUpStreets {
  /** @param {RoadsData} roads @param {number} reach metres beyond the edge of the carriageway */
  constructor(roads, reach) {
    this.reach = reach;
    const bit = roads.flags.indexOf('built_up');
    this.everywhere = bit < 0;
    /** @type {Map<string, number[][]>} segments [x0, y0, x1, y1, half width] passing through each cell */
    this.cells = new Map();
    if (this.everywhere) return;
    for (const edge of roads.edges) {
      if (!(edge[5] & (1 << bit))) continue;
      const half = edge[3] / 20;
      for (let k = 6; k + 3 < edge.length; k += 2) {
        const segment = [edge[k] / 10, edge[k + 1] / 10, edge[k + 2] / 10, edge[k + 3] / 10, half];
        for (const key of this.segmentCells(segment)) {
          const list = this.cells.get(key);
          if (list) list.push(segment);
          else this.cells.set(key, [segment]);
        }
      }
    }
  }

  /** Cells a segment passes through, sampled every half cell. @param {number[]} segment */
  segmentCells([x0, y0, x1, y1]) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)));
    const keys = new Set();
    for (let k = 0; k <= steps; k++)
      keys.add(this.key(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps));
    return keys;
  }

  /** @param {number} x @param {number} y */
  key(x, y) {
    return `${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`;
  }

  /**
   * Whether (x, y) is within `reach` metres of the carriageway of a built-up street.
   * @param {number} x @param {number} y
   */
  has(x, y) {
    if (this.everywhere) return true;
    const ci = Math.floor(x / CELL),
      cj = Math.floor(y / CELL);
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const [x0, y0, x1, y1, half] of this.cells.get(`${i}_${j}`) ?? [])
          if (segmentDistance(x, y, x0, y0, x1, y1) <= half + this.reach) return true;
    return false;
  }

  /**
   * The places (flat [x, y, ...]) along the built-up streets.
   * @param {number[]} places @returns {number[]}
   */
  keep(places) {
    /** @type {number[]} */
    const out = [];
    for (let k = 0; k + 1 < places.length; k += 2)
      if (this.has(places[k], places[k + 1])) out.push(places[k], places[k + 1]);
    return out;
  }
}

/**
 * Distance from (x, y) to the segment (x0, y0)-(x1, y1).
 * @param {number} x @param {number} y @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 */
function segmentDistance(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0,
    dy = y1 - y0;
  const length2 = dx * dx + dy * dy;
  const f = length2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / length2)) : 0;
  return Math.hypot(x - x0 - dx * f, y - y0 - dy * f);
}
