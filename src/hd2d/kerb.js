// @ts-check
/**
 * Stops on the sidewalk (#43): the GTFS position of a stop often falls on the carriageway, so each stop is
 * moved to the kerb on the right of its direction of travel, found by casting a ray from the route centre
 * line across the kerb lines of the street tiles. Pure logic, no DOM and no Three.js.
 */

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
 * @param {number[][]} segments kerb segments (world frame)
 * @param {{kerbSearch: number, shelterSetback: number, laneOffset: number, bodyWidth: number}} params
 * @returns {StopPlace[]}
 */
export function placeStops(track, segments, params) {
  const busSide = params.laneOffset + params.bodyWidth / 2;
  return track.stops.map((st) => {
    const c = track.pos(st.s);
    const rx = Math.sin(c.h),
      ry = -Math.cos(c.h); // right of the direction of travel
    // only the segments near the stop: the ray is at most kerbSearch long
    const near = segments.filter(
      ([ax, ay, bx, by]) =>
        Math.min(ax, bx) <= c.x + params.kerbSearch &&
        Math.max(ax, bx) >= c.x - params.kerbSearch &&
        Math.min(ay, by) <= c.y + params.kerbSearch &&
        Math.max(ay, by) >= c.y - params.kerbSearch,
    );
    const hit = rayHit(c.x, c.y, rx, ry, near, 0.5, params.kerbSearch);
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
