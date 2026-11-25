// @ts-check
/**
 * Distance to the nearest bank, for the foam along the water edges. Bank segments are bucketed in square
 * cells so that a query only looks at the cells within the largest distance of interest.
 */

export class ShoreIndex {
  /**
   * @param {number[][]} lines banks as [x, y, x, y, ...] in metres (world frame)
   * @param {number} maxDistance distances are only measured up to this value (m)
   */
  constructor(lines, maxDistance) {
    this.max = maxDistance;
    this.cell = Math.max(1, maxDistance);
    /** @type {Map<string, number[][]>} segments [ax, ay, bx, by] by cell */
    this.cells = new Map();
    for (const line of lines)
      for (let k = 0; k + 3 < line.length; k += 2) this.add([line[k], line[k + 1], line[k + 2], line[k + 3]]);
  }

  /** @param {number[]} segment [ax, ay, bx, by] */
  add(segment) {
    const [ax, ay, bx, by] = segment;
    const c = this.cell;
    for (let i = Math.floor(Math.min(ax, bx) / c); i <= Math.floor(Math.max(ax, bx) / c); i++)
      for (let j = Math.floor(Math.min(ay, by) / c); j <= Math.floor(Math.max(ay, by) / c); j++) {
        const key = i + '_' + j;
        const list = this.cells.get(key);
        if (list) list.push(segment);
        else this.cells.set(key, [segment]);
      }
  }

  /**
   * Distance (m) from (x, y) to the nearest bank, capped at `maxDistance`.
   * @param {number} x @param {number} y
   */
  distance(x, y) {
    const c = this.cell,
      ci = Math.floor(x / c),
      cj = Math.floor(y / c);
    let best = this.max;
    for (let i = ci - 1; i <= ci + 1; i++)
      for (let j = cj - 1; j <= cj + 1; j++)
        for (const s of this.cells.get(i + '_' + j) ?? []) best = Math.min(best, segmentDistance(s, x, y));
    return best;
  }
}

/**
 * Distance from (x, y) to a segment.
 * @param {number[]} segment [ax, ay, bx, by] @param {number} x @param {number} y
 */
export function segmentDistance([ax, ay, bx, by], x, y) {
  const dx = bx - ax,
    dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - x, ay + dy * t - y);
}
