// @ts-check
/**
 * Ground and drivable surface (ADR 0003): 1 km tiles of ground shaped by the roads (10 m grid), bridge decks
 * above them, and the coarse IGN grid outside the tiles. Local frame in metres: x east, y north.
 *
 * Heights inside a tile cell use the same two triangles as the rendered mesh (diagonal from the south-west
 * to the north-east corner), so objects sit exactly on what is drawn.
 */
import { Heightfield } from './heightfield.js';

/** A bus closer than this (m) to a deck height is on the deck; farther below, it drives under it. */
const DECK_CATCH = 2.5;

/**
 * @typedef {object} TileIndex
 * @property {number} x0
 * @property {number} y0
 * @property {number} size tile side (m)
 * @property {number} step ground grid step (m)
 * @property {number} nx
 * @property {number} ny
 */

/**
 * @typedef {object} TileData
 * @property {number[]} ground n x n heights (dm), row by row from the south
 * @property {number[][][]} road carriageway polygons: rings [x, y, ...] (dm, relative to the tile origin)
 * @property {number[][]} bridges [width, x, y, z, x, y, z, ...] (dm, x and y relative to the tile origin)
 * @property {number[][]} buildings [height, kind, x, y, ...] (dm; clipped off the carriageway, counter-clockwise)
 * @property {number[]} trees [x, y, ...] (dm, relative to the tile origin)
 */

/**
 * A bridge deck as a centreline with heights, in metres (world frame).
 * @typedef {{halfWidth: number, x: number[], y: number[], z: number[], box: number[]}} Deck
 */

/** @param {number[]} rec @param {number} ox @param {number} oy @returns {Deck} */
export function deckFromRecord(rec, ox, oy) {
  /** @type {Deck} */
  const deck = { halfWidth: rec[0] / 20, x: [], y: [], z: [], box: [] };
  for (let k = 1; k + 2 < rec.length; k += 3) {
    deck.x.push(ox + rec[k] / 10);
    deck.y.push(oy + rec[k + 1] / 10);
    deck.z.push(rec[k + 2] / 10);
  }
  const m = deck.halfWidth;
  deck.box = [
    Math.min(...deck.x) - m,
    Math.min(...deck.y) - m,
    Math.max(...deck.x) + m,
    Math.max(...deck.y) + m,
  ];
  return deck;
}

/**
 * Deck height at (x, y) if the point is on the deck, else null.
 * @param {Deck} deck @param {number} x @param {number} y
 */
export function deckHeight(deck, x, y) {
  const [x0, y0, x1, y1] = deck.box;
  if (x < x0 || y < y0 || x > x1 || y > y1) return null;
  let best = Infinity,
    z = 0;
  for (let i = 0; i + 1 < deck.x.length; i++) {
    const ax = deck.x[i],
      ay = deck.y[i],
      dx = deck.x[i + 1] - ax,
      dy = deck.y[i + 1] - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) {
      best = d;
      z = deck.z[i] + (deck.z[i + 1] - deck.z[i]) * t;
    }
  }
  return best <= deck.halfWidth ? z : null;
}

export class Ground {
  /**
   * @param {import('../common/types.js').TerrainData} terrain natural IGN grids (fallback outside the tiles)
   * @param {TileIndex} index @param {Map<string, TileData>} tiles key "i_j"
   */
  constructor(terrain, index, tiles) {
    this.natural = new Heightfield(terrain);
    this.index = index;
    this.n = Math.round(index.size / index.step) + 1;
    /** @type {Map<string, Float32Array>} heights in metres */
    this.grids = new Map();
    /** @type {Deck[]} */
    this.decks = [];
    for (const [key, tile] of tiles) {
      this.grids.set(
        key,
        Float32Array.from(tile.ground, (v) => v / 10),
      );
      const [i, j] = key.split('_').map(Number);
      const ox = index.x0 + i * index.size,
        oy = index.y0 + j * index.size;
      for (const rec of tile.bridges) this.decks.push(deckFromRecord(rec, ox, oy));
    }
  }

  /** Area covered by the tiles. */
  get bounds() {
    const ix = this.index;
    return { x0: ix.x0, y0: ix.y0, x1: ix.x0 + ix.nx * ix.size, y1: ix.y0 + ix.ny * ix.size };
  }

  /** @param {number} x @param {number} y */
  inFine(x, y) {
    const b = this.bounds;
    return x >= b.x0 && y >= b.y0 && x < b.x1 && y < b.y1;
  }

  /**
   * Ground height (m), ignoring bridge decks.
   * @param {number} x @param {number} y
   */
  h(x, y) {
    const ix = this.index;
    const i = Math.floor((x - ix.x0) / ix.size),
      j = Math.floor((y - ix.y0) / ix.size);
    const grid = this.grids.get(i + '_' + j);
    if (!grid) return this.natural.h(x, y);
    const n = this.n;
    const fx = (x - ix.x0 - i * ix.size) / ix.step,
      fy = (y - ix.y0 - j * ix.size) / ix.step;
    const ci = Math.min(n - 2, Math.floor(fx)),
      cj = Math.min(n - 2, Math.floor(fy));
    const tx = fx - ci,
      ty = fy - cj;
    const a = grid[cj * n + ci],
      b = grid[cj * n + ci + 1],
      c = grid[(cj + 1) * n + ci],
      d = grid[(cj + 1) * n + ci + 1];
    // same split as the mesh: triangles (a, b, d) and (a, d, c)
    return tx >= ty ? a + (b - a) * tx + (d - b) * ty : a + (c - a) * ty + (d - c) * tx;
  }

  /**
   * Drivable surface height (m): a bridge deck when `zRef` (current height of the vehicle) is close to it,
   * else the ground.
   * @param {number} x @param {number} y @param {number} zRef
   */
  surface(x, y, zRef) {
    const g = this.h(x, y);
    let best = g;
    for (const deck of this.decks) {
      const z = deckHeight(deck, x, y);
      if (z !== null && Math.abs(z - zRef) < DECK_CATCH && Math.abs(z - zRef) < Math.abs(best - zRef))
        best = z;
    }
    return best;
  }

  /**
   * Slope (m/m) along a heading on the drivable surface.
   * @param {number} x @param {number} y @param {number} hd @param {number} zRef
   */
  slopeAt(x, y, hd, zRef, span = 6) {
    const c = Math.cos(hd),
      s = Math.sin(hd);
    return (
      (this.surface(x + c * span, y + s * span, zRef) - this.surface(x - c * span, y - s * span, zRef)) /
      (2 * span)
    );
  }

  /**
   * Ground slope along a heading (bridges ignored).
   * @param {number} x @param {number} y @param {number} hd
   */
  slope(x, y, hd, span = 6) {
    return this.slopeAt(x, y, hd, -1e9, span);
  }
}
