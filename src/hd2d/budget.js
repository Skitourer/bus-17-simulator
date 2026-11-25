// @ts-check
/**
 * Budget for the moving objects (#47): the game never draws nor fully simulates every vehicle and person of
 * the map. Objects get a level of detail from their distance to the camera, ambient objects only exist in
 * a ring around the player's bus, and the far ones are simulated less often. Pure logic, no Three.js.
 */

/** @typedef {import('../settings/settings.js').Settings['budget']} BudgetSettings */
/** @typedef {'model' | 'sprite' | 'hidden'} Lod */

/**
 * Level of detail at `distance` m from the camera: a 3D model near, a flat sprite farther, nothing beyond.
 * @param {number} distance @param {BudgetSettings} budget @returns {Lod}
 */
export function lodOf(distance, budget) {
  if (distance <= budget.modelDistance) return 'model';
  if (distance <= budget.spriteDistance) return 'sprite';
  return 'hidden';
}

/**
 * Indices of the points within `radius` of (x, y), nearest first, at most `limit` of them.
 * @param {readonly {x: number, y: number}[]} points @param {number} x @param {number} y
 * @param {number} radius @param {number} limit @returns {number[]}
 */
export function nearestWithin(points, x, y, radius, limit) {
  const r2 = radius * radius;
  /** @type {[number, number][]} */
  const found = [];
  points.forEach((p, i) => {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d2 <= r2) found.push([d2, i]);
  });
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, limit).map(([, i]) => i);
}

/**
 * Time step for an object at `distance` m from the player's bus: every frame near it; farther, the
 * elapsed time is saved up and applied once every `farUpdateInterval` seconds.
 * @param {{pending: number}} clock per-object time not yet simulated (s), updated in place
 * @param {number} distance @param {number} dt @param {BudgetSettings} budget
 * @returns {number} seconds to simulate now (0: skip this frame)
 */
export function simulationStep(clock, distance, dt, budget) {
  clock.pending += dt;
  if (distance > budget.simulationRadius && clock.pending < budget.farUpdateInterval) return 0;
  const step = clock.pending;
  clock.pending = 0;
  return step;
}

/**
 * Spawn / despawn ring around the player's bus for the ambient objects (traffic, pedestrians): the objects
 * beyond `despawnRadius` go away, and new ones appear between `spawnMinDistance` and `spawnRadius`, out of
 * the player's sight as much as possible (behind the bus first).
 */
export class SpawnRing {
  /** @param {BudgetSettings} budget */
  constructor(budget) {
    this.b = budget;
  }

  /**
   * Indices of the objects to remove: too far from the bus.
   * @param {readonly {x: number, y: number}[]} objects @param {number} x @param {number} y @returns {number[]}
   */
  despawn(objects, x, y) {
    const r2 = this.b.despawnRadius ** 2;
    return objects.flatMap((p, i) => ((p.x - x) ** 2 + (p.y - y) ** 2 > r2 ? [i] : []));
  }

  /**
   * Up to `count` spawn places among `candidates` (e.g. points of the road network), inside the ring and
   * at least `spacing` m from each other and from the existing objects; the places behind the bus come
   * first, then the farthest ones.
   * @param {readonly {x: number, y: number}[]} candidates @param {readonly {x: number, y: number}[]} existing
   * @param {number} x @param {number} y @param {number} heading bus heading (rad) @param {number} count
   * @param {number} spacing @returns {number[]} indices into `candidates`
   */
  spawnPlaces(candidates, existing, x, y, heading, count, spacing) {
    const { spawnMinDistance: min, spawnRadius: max } = this.b;
    const fx = Math.cos(heading),
      fy = Math.sin(heading);
    /** @type {[number, number][]} */
    const ranked = [];
    candidates.forEach((p, i) => {
      const dx = p.x - x,
        dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d < min || d > max) return;
      const ahead = (dx * fx + dy * fy) / d; // 1 straight ahead, -1 straight behind
      ranked.push([ahead - d / max, i]);
    });
    ranked.sort((a, b) => a[0] - b[0]);
    /** @type {{x: number, y: number}[]} */
    const taken = [...existing];
    /** @type {number[]} */
    const out = [];
    const s2 = spacing * spacing;
    for (const [, i] of ranked) {
      if (out.length >= count) break;
      const p = candidates[i];
      if (taken.some((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < s2)) continue;
      taken.push(p);
      out.push(i);
    }
    return out;
  }
}
