// @ts-check
/** Physique simplifiee du bus (valeurs du cahier des charges §4.5). Unites SI : m, s, m/s. */
import { ROAD } from '../world/road_geom.js';

export const VMAX = 50 / 3.6;
const ACC = 2.0; // 0 -> 50 km/h en ~7 s
const BRAKE = 4.5;
const DRAG = 0.45;
const VREV = 8 / 3.6;
const STEER_RATE = 3.2; // m/s de deplacement lateral a pleine vitesse
const CENTRIFUGAL = 0.22;
export const BUS_LEN = 12;
const HALF_W = 1.28;

export class Bus {
  constructor() {
    this.s = 0; // abscisse de l'arriere du bus
    this.lat = ROAD.LANE;
    this.v = 0;
    this.steer = 0; // -1..1 (lisse)
    this.braking = false;
    this.offroad = false;
  }

  /** @param {import('../world/track.js').Track} track @param {{up:boolean,down:boolean,left:boolean,right:boolean}} inp @param {number} dt */
  update(track, inp, dt) {
    const v = this.v;
    let a = 0;
    this.braking = false;
    if (inp.up) a += v >= 0 ? ACC * (1 - (v / VMAX) ** 2) : BRAKE;
    if (inp.down) {
      if (v > 0.15) {
        a -= BRAKE;
        this.braking = true;
      } else a -= ACC * 0.6;
    }
    if (!inp.up && !inp.down) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, DRAG + 0.004 * v * v);
    // pente reelle : le bus peine en cote, prend de l'elan en descente
    a -= 9.81 * track.slope(this.s + BUS_LEN / 2, 8) * 0.55;
    // bordure / trottoir
    this.offroad = Math.abs(this.lat) > ROAD.HW - HALF_W + 0.2;
    if (this.offroad && Math.abs(v) > 3) a -= Math.sign(v) * 3;
    let nv = v + a * dt;
    if (inp.down && v > 0 && nv < 0) nv = 0; // on s'arrete avant de reculer
    if (inp.up && v < 0 && nv > 0) nv = 0;
    this.v = Math.max(-VREV, Math.min(VMAX, nv));

    // direction
    const target = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    this.steer += (target - this.steer) * (1 - Math.exp(-dt / 0.12));
    const sp = Math.min(1, Math.abs(this.v) / 6);
    let dl = this.steer * STEER_RATE * sp * Math.sign(this.v || 1);
    // force centrifuge : on derive vers l'exterieur du virage (k > 0 = gauche -> derive a droite)
    dl += track.curv(this.s + BUS_LEN * 0.6) * this.v * this.v * CENTRIFUGAL;
    this.lat += dl * dt;
    const lim = ROAD.SW - HALF_W - 0.3;
    if (Math.abs(this.lat) > lim) {
      this.lat = Math.sign(this.lat) * lim;
      if (Math.abs(this.v) > 2) this.v *= 1 - 2 * dt;
    }

    this.s = Math.max(-5, Math.min(track.length - BUS_LEN, this.s + this.v * dt));
    if (this.s >= track.length - BUS_LEN && this.v > 0) this.v = 0;
  }
}
