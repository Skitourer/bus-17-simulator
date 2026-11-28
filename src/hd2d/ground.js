// @ts-check
/**
 * Ground and drivable surface (ADR 0003): 1 km tiles of ground shaped by the roads (5 m grid, #92), bridge decks
 * above them, and the coarse IGN grid outside the tiles. Local frame in metres: x east, y north.
 *
 * Heights inside a tile cell use the same two triangles as the rendered mesh (diagonal from the south-west
 * to the north-east corner), so objects sit exactly on what is drawn.
 */
import { Heightfield } from './heightfield.js';

/**
 * @typedef {object} TileIndex
 * @property {number} x0
 * @property {number} y0
 * @property {number} size tile side (m)
 * @property {number} step ground grid step (m)
 * @property {number} nx
 * @property {number} ny
 * @property {string[]} tiles keys "i_j" of the tiles that exist (only those near the lines, ADR 0010)
 */

/**
 * @typedef {object} TileData
 * @property {number[]} ground n x n heights (dm), row by row from the south
 * @property {number[][][]} road carriageway polygons: rings [x, y, ...] (dm, relative to the tile origin)
 * @property {number[][]} bridges [width, x, y, z, x, y, z, ...] (dm, x and y relative to the tile origin)
 * @property {number[][]} [terraces] roads held up by a retaining wall above a lower road (#108), like `bridges`:
 * inside them the ground height is the terrace height
 * @property {number[][][]} sidewalks sidewalk polygons, like `road`
 * @property {number[][]} kerbs carriageway outline along sidewalks: [x, y, ...] (dm, relative to the tile origin)
 * @property {number[][]} centre_lines dashed centre lines: [x, y, ...] (dm, relative)
 * @property {number[][]} crossings zebra stripes: [x, y, x, y, x, y, x, y] (dm, relative)
 * @property {number[][]} buildings [height, kind, style, roof rise, x, y, ...] (dm; clipped off the carriageway,
 * counter-clockwise; see tools/build_buildings.py)
 * @property {number[][]} [lintels] [height, kind, style, roof rise, base, x, y, ...] parts of buildings over a
 * passage, drawn from `base` above the ground to `height` (dm, counter-clockwise)
 * @property {number[][]} [portals] tunnel mouths [x, y, heading into the tunnel (mrad), width] (dm, relative)
 * @property {number[]} trees [x, y, ...] (dm, relative to the tile origin)
 * @property {number[][][]} water water polygons cut along the ground triangles, like `road`
 * @property {number[]} water_level n x n water surface heights (dm), like `ground`; empty without water
 * @property {number[]} wet ground triangles under water (not drawn): k < (n-1)^2 is the first triangle of
 * cell k, else the second triangle of cell k - (n-1)^2
 * @property {number[][][]} dry dry parts of the wet triangles, like `road`
 * @property {number[][]} banks water edges: [x, y, ...] (dm, relative to the tile origin)
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
 * Deck height at (x, y) if the point is on the deck (its sides widened by `margin` m), else null.
 * @param {Deck} deck @param {number} x @param {number} y
 */
export function deckHeight(deck, x, y, margin = 0) {
  const [x0, y0, x1, y1] = deck.box;
  if (x < x0 - margin || y < y0 - margin || x > x1 + margin || y > y1 + margin) return null;
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
  return best <= deck.halfWidth + margin ? z : null;
}

export class Ground {
  /**
   * @param {import('../common/types.js').TerrainData} terrain natural IGN grids (fallback outside the tiles)
   * @param {TileIndex} index @param {Map<string, TileData>} tiles key "i_j"
   * @param {number} deckCatch a vehicle closer than this (m) to a deck height drives on the deck
   * @param {number} deckMargin the water does not stop a vehicle this close (m) beyond the side of a deck
   */
  constructor(terrain, index, tiles, deckCatch, deckMargin) {
    this.deckCatch = deckCatch;
    this.deckMargin = deckMargin;
    this.natural = new Heightfield(terrain);
    this.index = index;
    this.n = Math.round(index.size / index.step) + 1;
    /** @type {Map<string, Float32Array>} heights in metres */
    this.grids = new Map();
    /** @type {Map<string, Float32Array>} water surface heights in metres, for the tiles with water */
    this.levels = new Map();
    /** @type {Map<string, Map<number, number[][][]>>} water pieces by tile and ground triangle (m, tile frame) */
    this.water = new Map();
    /** @type {Deck[]} */
    this.decks = [];
    /** @type {Deck[]} terraces (#108): stretches of road held up by a retaining wall */
    this.terraces = [];
    /** @type {Map<string, Deck[]>} terraces by the tiles their box touches */
    this.terracesByTile = new Map();
    /** tile range [i0, j0, i1, j1] of the loaded tiles */
    this.range = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [key, tile] of tiles) {
      const [ti, tj] = key.split('_').map(Number);
      this.range = [
        Math.min(this.range[0], ti),
        Math.min(this.range[1], tj),
        Math.max(this.range[2], ti),
        Math.max(this.range[3], tj),
      ];
      if (tile.water.length) this.water.set(key, this.piecesByTriangle(tile.water));
      this.grids.set(
        key,
        Float32Array.from(tile.ground, (v) => v / 10),
      );
      if (tile.water_level.length)
        this.levels.set(
          key,
          Float32Array.from(tile.water_level, (v) => v / 10),
        );
      const [i, j] = key.split('_').map(Number);
      const ox = index.x0 + i * index.size,
        oy = index.y0 + j * index.size;
      for (const rec of tile.bridges) this.decks.push(deckFromRecord(rec, ox, oy));
      for (const rec of tile.terraces ?? []) this.addTerrace(deckFromRecord(rec, ox, oy));
    }
  }

  /** @param {Deck} terrace */
  addTerrace(terrace) {
    this.terraces.push(terrace);
    const ix = this.index,
      [x0, y0, x1, y1] = terrace.box;
    for (let j = Math.floor((y0 - ix.y0) / ix.size); j <= Math.floor((y1 - ix.y0) / ix.size); j++)
      for (let i = Math.floor((x0 - ix.x0) / ix.size); i <= Math.floor((x1 - ix.x0) / ix.size); i++) {
        const key = i + '_' + j,
          list = this.terracesByTile.get(key);
        if (list) list.push(terrace);
        else this.terracesByTile.set(key, [terrace]);
      }
  }

  /**
   * Height of the terrace at (x, y), null outside every terrace.
   * @param {number} x @param {number} y
   */
  terraceHeight(x, y) {
    const ix = this.index;
    const list = this.terracesByTile.get(
      Math.floor((x - ix.x0) / ix.size) + '_' + Math.floor((y - ix.y0) / ix.size),
    );
    if (!list) return null;
    for (const terrace of list) {
      const z = deckHeight(terrace, x, y);
      if (z !== null) return z;
    }
    return null;
  }

  /**
   * Water pieces grouped by the ground triangle that holds them (each piece lies in one triangle).
   * @param {number[][][]} pieces rings [x, y, ...] in dm relative to the tile origin
   */
  piecesByTriangle(pieces) {
    /** @type {Map<number, number[][][]>} */
    const out = new Map();
    for (const rings of pieces) {
      const metres = rings.map((ring) => ring.map((v) => v / 10));
      const outer = metres[0];
      let cx = 0,
        cy = 0;
      for (let k = 0; k + 1 < outer.length; k += 2) {
        cx += outer[k];
        cy += outer[k + 1];
      }
      // the mean of the vertices lies inside the (convex) triangle that holds the piece
      const k = this.triangleOf(cx / (outer.length / 2), cy / (outer.length / 2));
      const list = out.get(k);
      if (list) list.push(metres);
      else out.set(k, [metres]);
    }
    return out;
  }

  /**
   * Index of the ground triangle at a point of a tile (m from the tile origin), in the order of the tile data:
   * every cell's first triangle (south-east of the diagonal), then every cell's second triangle.
   * @param {number} lx @param {number} ly
   */
  triangleOf(lx, ly) {
    const n = this.n,
      step = this.index.step;
    const ci = Math.max(0, Math.min(n - 2, Math.floor(lx / step))),
      cj = Math.max(0, Math.min(n - 2, Math.floor(ly / step)));
    const cell = cj * (n - 1) + ci;
    return lx / step - ci >= ly / step - cj ? cell : cell + (n - 1) * (n - 1);
  }

  /**
   * Whether (x, y) lies on a water surface (rivers and lakes of the tiles).
   * @param {number} x @param {number} y
   */
  inWater(x, y) {
    const ix = this.index;
    const i = Math.floor((x - ix.x0) / ix.size),
      j = Math.floor((y - ix.y0) / ix.size);
    const byTriangle = this.water.get(i + '_' + j);
    if (!byTriangle) return false;
    const lx = x - ix.x0 - i * ix.size,
      ly = y - ix.y0 - j * ix.size;
    const pieces = byTriangle.get(this.triangleOf(lx, ly));
    return !!pieces && pieces.some((rings) => insideRings(rings, lx, ly));
  }

  /**
   * Whether a vehicle at height `zRef` is on a bridge deck at (x, y), its sides widened by `margin` (m).
   * @param {number} x @param {number} y @param {number} zRef
   */
  onDeck(x, y, zRef, margin = 0) {
    return this.decks.some((deck) => {
      const z = deckHeight(deck, x, y, margin);
      return z !== null && Math.abs(z - zRef) < this.deckCatch;
    });
  }

  /**
   * Whether the water stops a vehicle at height `zRef` at (x, y): water, and no bridge deck at that height.
   * @param {number} x @param {number} y @param {number} zRef
   */
  waterBlocks(x, y, zRef) {
    // the deck margin keeps a bus that drifts in its lane, or overhangs a narrow deck, from being stopped
    return this.inWater(x, y) && !this.onDeck(x, y, zRef, this.deckMargin);
  }

  /** Rectangle around the loaded tiles. */
  get bounds() {
    const ix = this.index,
      [i0, j0, i1, j1] = this.range;
    return {
      x0: ix.x0 + i0 * ix.size,
      y0: ix.y0 + j0 * ix.size,
      x1: ix.x0 + (i1 + 1) * ix.size,
      y1: ix.y0 + (j1 + 1) * ix.size,
    };
  }

  /**
   * Whether a loaded tile lies within `margin` m of (x, y), with margin at most one tile side.
   * @param {number} x @param {number} y @param {number} margin
   */
  nearTile(x, y, margin) {
    const ix = this.index;
    for (const dy of [-margin, 0, margin])
      for (const dx of [-margin, 0, margin]) {
        const i = Math.floor((x + dx - ix.x0) / ix.size),
          j = Math.floor((y + dy - ix.y0) / ix.size);
        if (this.grids.has(i + '_' + j)) return true;
      }
    return false;
  }

  /** Whether (x, y) lies on a loaded tile. @param {number} x @param {number} y */
  inFine(x, y) {
    return this.nearTile(x, y, 0);
  }

  /**
   * Ground height (m), ignoring bridge decks: the terrace height on a terrace, else the ground grid.
   * @param {number} x @param {number} y
   */
  h(x, y) {
    return this.terraceHeight(x, y) ?? this.gridHeight(x, y);
  }

  /**
   * Height of the ground grid (m), below the terraces.
   * @param {number} x @param {number} y
   */
  gridHeight(x, y) {
    return this.sample(this.grids, x, y) ?? this.natural.h(x, y);
  }

  /**
   * Water surface height (m) near water, null in the tiles without water. Away from the water it is only an
   * estimate below the ground (piers use it to reach under the water).
   * @param {number} x @param {number} y
   */
  waterLevel(x, y) {
    return this.sample(this.levels, x, y);
  }

  /**
   * Height from per-tile grids, on the two triangles of each cell like the mesh; null without a grid.
   * @param {Map<string, Float32Array>} grids @param {number} x @param {number} y
   */
  sample(grids, x, y) {
    const ix = this.index;
    const i = Math.floor((x - ix.x0) / ix.size),
      j = Math.floor((y - ix.y0) / ix.size);
    const grid = grids.get(i + '_' + j);
    if (!grid) return null;
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
    // a deck within reach wins over the ground, even when the ground is closer: the ground under a bridge
    // slopes down gently towards the river and would otherwise pull the vehicle off the deck
    /** @type {number | null} */
    let best = null;
    for (const deck of this.decks) {
      const z = deckHeight(deck, x, y);
      if (
        z !== null &&
        Math.abs(z - zRef) < this.deckCatch &&
        (best === null || Math.abs(z - zRef) < Math.abs(best - zRef))
      )
        best = z;
    }
    return best ?? this.h(x, y);
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

/**
 * Even-odd point in polygon test over all the rings (outline and holes).
 * @param {number[][]} rings [x, y, ...] @param {number} x @param {number} y
 */
export function insideRings(rings, x, y) {
  let inside = false;
  for (const ring of rings) {
    const m = ring.length;
    for (let k = 0, l = m - 2; k < m; l = k, k += 2) {
      const xk = ring[k],
        yk = ring[k + 1],
        xl = ring[l],
        yl = ring[l + 1];
      if (yk > y !== yl > y && x < ((xl - xk) * (y - yk)) / (yl - yk) + xk) inside = !inside;
    }
  }
  return inside;
}
