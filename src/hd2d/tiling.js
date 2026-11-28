// @ts-check
/**
 * World tiles around the bus (#12): which tiles are built, and which of their layers are drawn, from their
 * distance to the bus. Far tiles keep only a light ground; the streets, trees and buildings appear as the
 * bus comes near and are freed once it is far. Pure logic, no Three.js.
 */

/** @typedef {import('../settings/settings.js').Settings['tiles']} TileSettings */
/** @typedef {{x0: number, y0: number, x1: number, y1: number}} Rect */

/**
 * Distance from (x, y) to the nearest point of a tile (0 inside it).
 * @param {Rect} rect @param {number} x @param {number} y
 */
export function rectDistance(rect, x, y) {
  const dx = Math.max(rect.x0 - x, 0, x - rect.x1),
    dy = Math.max(rect.y0 - y, 0, y - rect.y1);
  return Math.hypot(dx, dy);
}

/**
 * @typedef {object} TileLevels
 * @property {boolean} keep the detailed layers stay built (not freed yet)
 * @property {boolean} want the detailed layers should be built
 * @property {boolean} fineGround the 5 m ground grid is drawn (else the light one)
 * @property {boolean} streets carriageway, sidewalks, kerbs and markings are drawn
 * @property {boolean} trees
 */

/**
 * Levels of a tile at `distance` m from the bus. Tiles are built within `loadRadius` and freed beyond
 * `unloadRadius`, a little farther, so that driving along the edge does not build and free them in turn.
 * @param {number} distance @param {TileSettings} p @returns {TileLevels}
 */
export function tileLevels(distance, p) {
  return {
    keep: distance <= p.unloadRadius,
    want: distance <= p.loadRadius,
    fineGround: distance <= p.fineGroundDistance,
    streets: distance <= p.streetDistance,
    trees: distance <= p.treeDistance,
  };
}

/**
 * Tiles to build next: wanted, not built yet, nearest first.
 * @param {readonly {key: string, rect: Rect}[]} tiles @param {ReadonlySet<string>} built
 * @param {number} x @param {number} y @param {TileSettings} p @returns {string[]}
 */
export function buildOrder(tiles, built, x, y, p) {
  return tiles
    .map((t) => ({ key: t.key, d: rectDistance(t.rect, x, y) }))
    .filter((t) => !built.has(t.key) && tileLevels(t.d, p).want)
    .sort((a, b) => a.d - b.d)
    .map((t) => t.key);
}

/**
 * Keys "i_j" of the tiles of the world within `margin` m of a route point (ADR 0010): the game loads only
 * the part of the shared world around its line.
 * @param {{x0: number, y0: number, size: number, tiles: string[]}} index
 * @param {{x: ArrayLike<number>, y: ArrayLike<number>, n: number}[]} routes
 * @param {number} margin
 * @returns {string[]} in the order of the index
 */
export function tilesNear(index, routes, margin) {
  const wanted = new Set();
  // a point reaches the tiles of the square around it; nearby tiles are then checked exactly
  for (const route of routes)
    for (let k = 0; k < route.n; k++) {
      const x = route.x[k],
        y = route.y[k];
      const i0 = Math.floor((x - margin - index.x0) / index.size),
        i1 = Math.floor((x + margin - index.x0) / index.size);
      const j0 = Math.floor((y - margin - index.y0) / index.size),
        j1 = Math.floor((y + margin - index.y0) / index.size);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const key = i + '_' + j;
          if (wanted.has(key)) continue;
          const x0 = index.x0 + i * index.size,
            y0 = index.y0 + j * index.size;
          const rect = { x0, y0, x1: x0 + index.size, y1: y0 + index.size };
          if (rectDistance(rect, x, y) <= margin) wanted.add(key);
        }
    }
  return index.tiles.filter((key) => wanted.has(key));
}
