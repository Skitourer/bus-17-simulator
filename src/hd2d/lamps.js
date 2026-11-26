// @ts-check
/**
 * Street lights (#55): their places along the kerbs, and the few nearest ones that get a real light at
 * night. Pure logic, world metres (x east, y north).
 */

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
