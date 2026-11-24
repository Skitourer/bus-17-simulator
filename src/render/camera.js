// @ts-check
/** Camera de poursuite : derriere et au-dessus du bus, orientee selon le cap de la route. */
export const W = 960,
  H = 540;
export const HZ = Math.round(H * 0.42); // ligne d'horizon a tangage nul
const FOV = (70 * Math.PI) / 180;
export const F = W / 2 / Math.tan(FOV / 2); // focale en pixels
const NEAR = 0.6;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.lat = 0; // decalage lateral (suit le bus avec retard)
    this.s = 0;
    this.back = 9; // recul derriere l'arriere du bus (m)
    this.height = 4.4;
    this._c = 1;
    this._s = 0;
    this._cp = 1;
    this._sp = 0;
    this.ready = false;
  }

  /** @param {import('../world/track.js').Track} track @param {{s:number, lat:number}} bus @param {number} dt */
  follow(track, bus, dt) {
    const k = this.ready ? 1 - Math.exp(-dt / 0.35) : 1;
    this.lat += (bus.lat - this.lat) * k;
    this.s = bus.s - this.back;
    const yaw = track.meanHeading(this.s + 4, 14);
    this.yaw = this.ready ? this.yaw + (yaw - this.yaw) * (1 - Math.exp(-dt / 0.25)) : yaw;
    const p = track.pos(this.s, this.lat);
    this.x = p.x;
    this.y = p.y;
    const zg = Math.max(track.alt(this.s), track.alt(bus.s) - 1);
    const zc = zg + this.height;
    this.z = this.ready ? this.z + (zc - this.z) * (1 - Math.exp(-dt / 0.2)) : zc;
    // tangage : on regarde un peu vers le bas, et on suit la pente devant
    const pitch = -0.085 + Math.atan(track.slope(bus.s, 30)) * 0.7;
    this.pitch = this.ready ? this.pitch + (pitch - this.pitch) * (1 - Math.exp(-dt / 0.4)) : pitch;
    this._c = Math.cos(this.yaw);
    this._s = Math.sin(this.yaw);
    this._cp = Math.cos(this.pitch);
    this._sp = Math.sin(this.pitch);
    this.ready = true;
  }

  /** Projette un point monde. Ecrit dans out {x, y, sc, f}; renvoie false si derriere la camera. */
  project(X, Y, Z, out) {
    const dx = X - this.x,
      dy = Y - this.y,
      dz = Z - this.z;
    const f0 = dx * this._c + dy * this._s;
    const r = dx * this._s - dy * this._c;
    const f = f0 * this._cp + dz * this._sp;
    const u = dz * this._cp - f0 * this._sp;
    out.f = f;
    if (f < NEAR) return false;
    const sc = F / f;
    out.x = W / 2 + r * sc;
    out.y = HZ - u * sc;
    out.sc = sc;
    return true;
  }

  /** ordonnee ecran d'une direction a l'infini d'elevation `a` (rad) */
  horizonY(a) {
    return HZ - Math.tan(a - this.pitch) * F;
  }
}
