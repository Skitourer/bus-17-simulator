// @ts-check
/**
 * Altitude reelle (IGN RGE ALTI) : grille fine (40 m) sur la ville, grille large (300 m) autour.
 * Repere local (metres) : x = est, y = nord. Dans Three.js : X = x, Y = altitude, Z = -y.
 */
export class Heightfield {
  /** @param {import('../common/types.js').TerrainData} terrain */
  constructor(terrain) {
    this.fine = terrain.fine;
    this.coarse = terrain.coarse;
  }

  /** @param {import('../common/types.js').TerrainGrid} g @param {number} x @param {number} y */
  static _bilin(g, x, y) {
    const fx = (x - g.x0) / g.step,
      fy = (y - g.y0) / g.step;
    const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(g.ny - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - i)),
      ty = Math.max(0, Math.min(1, fy - j));
    const d = g.dm,
      k = j * g.nx + i;
    const a = d[k] * (1 - tx) + d[k + 1] * tx;
    const b = d[k + g.nx] * (1 - tx) + d[k + g.nx + 1] * tx;
    return (a * (1 - ty) + b * ty) / 10;
  }

  /** @param {number} x @param {number} y */
  inFine(x, y) {
    const g = this.fine;
    return x >= g.x0 && y >= g.y0 && x <= g.x0 + (g.nx - 1) * g.step && y <= g.y0 + (g.ny - 1) * g.step;
  }

  /** altitude (m) en un point local @param {number} x @param {number} y */
  h(x, y) {
    return Heightfield._bilin(this.inFine(x, y) ? this.fine : this.coarse, x, y);
  }

  /** pente le long d'un cap (m/m) @param {number} x @param {number} y @param {number} hd */
  slope(x, y, hd, span = 6) {
    const c = Math.cos(hd),
      s = Math.sin(hd);
    return (this.h(x + c * span, y + s * span) - this.h(x - c * span, y - s * span)) / (2 * span);
  }

  /** emprise de la zone fine */
  get bounds() {
    const g = this.fine;
    return { x0: g.x0, y0: g.y0, x1: g.x0 + (g.nx - 1) * g.step, y1: g.y0 + (g.ny - 1) * g.step };
  }
}
