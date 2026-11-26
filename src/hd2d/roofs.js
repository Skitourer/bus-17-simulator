// @ts-check
/**
 * Pitched roofs (#56): a hipped roof over a footprint, its ridge along the long axis of the smallest
 * rectangle around it. Each wall gets a roof face rising from its top edge to the ridge, so a rectangle
 * gets the usual four faces and a near-rectangular footprint something close. Pure logic, metres.
 */

/**
 * @typedef {object} OrientedBox smallest rectangle around a footprint
 * @property {number} cx @property {number} cy centre @property {number} ux @property {number} uy unit vector
 * of the long side @property {number} length long side @property {number} width short side
 */

/**
 * Smallest rectangle around a ring, among the directions of its edges (the optimum lies on one of them for
 * the convex hull; footprints are mostly convex).
 * @param {number[][]} ring [x, y] points @returns {OrientedBox}
 */
export function orientedBox(ring) {
  /** @type {OrientedBox} */
  let best = { cx: 0, cy: 0, ux: 1, uy: 0, length: 0, width: 0 };
  let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i],
      [bx, by] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len,
      uy = (by - ay) / len;
    let a0 = Infinity,
      a1 = -Infinity,
      b0 = Infinity,
      b1 = -Infinity;
    for (const [x, y] of ring) {
      const a = x * ux + y * uy,
        b = -x * uy + y * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestArea) {
      bestArea = area;
      const ca = (a0 + a1) / 2,
        cb = (b0 + b1) / 2;
      const along = a1 - a0 >= b1 - b0;
      best = {
        cx: ca * ux - cb * uy,
        cy: ca * uy + cb * ux,
        ux: along ? ux : -uy,
        uy: along ? uy : ux,
        length: Math.max(a1 - a0, b1 - b0),
        width: Math.min(a1 - a0, b1 - b0),
      };
    }
  }
  return best;
}

/** Signed area of a ring (positive counter-clockwise). @param {number[][]} ring */
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i],
      [bx, by] = ring[(i + 1) % ring.length];
    sum += ax * by - bx * ay;
  }
  return sum / 2;
}

/**
 * Faces of a hipped roof over a footprint: polygons of [x, y, z] points, z from 0 at the top of the walls to
 * `rise` on the ridge; null when the footprint is too far from its rectangle (L, U shapes) for one ridge.
 * @param {number[][]} ring counter-clockwise footprint @param {number} rise m
 * @param {{roofPitch: number, roofCompactness: number}} params
 * @returns {number[][][] | null}
 */
export function hippedRoof(ring, rise, params) {
  const box = orientedBox(ring);
  if (box.width <= 0 || Math.abs(ringArea(ring)) < params.roofCompactness * box.length * box.width)
    return null;
  const z = Math.min(rise, (params.roofPitch * box.width) / 2);
  if (z <= 0) return null;
  const half = (box.length - box.width) / 2;
  /** @param {number[]} p @returns {number[]} point of the ridge above a footprint point */
  const ridge = ([x, y]) => {
    const a = Math.max(-half, Math.min(half, (x - box.cx) * box.ux + (y - box.cy) * box.uy));
    return [box.cx + a * box.ux, box.cy + a * box.uy, z];
  };
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const rp = ridge(p),
      rq = ridge(q);
    const same = Math.hypot(rp[0] - rq[0], rp[1] - rq[1]) < 1e-6;
    return same ? [[...p, 0], [...q, 0], rp] : [[...p, 0], [...q, 0], rq, rp];
  });
}
