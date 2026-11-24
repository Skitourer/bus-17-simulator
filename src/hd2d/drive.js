// @ts-check
/**
 * Conduite libre : modele bicyclette (essieu arriere = reference), pente reelle, collisions avec le bati OSM.
 * Repere local : x est, y nord, cap h = angle math (0 = est, sens trigo).
 */
import { BUS } from './bus3d.js';

const VMAX = 50 / 3.6,
  ACC = 1.6,
  BRAKE = 4.5,
  VREV = 8 / 3.6;
const DMAX = 0.62; // braquage max (rad) -> rayon de braquage ~ 8,5 m
const STEER_SPEED = 0.9; // rad/s au volant

export class Drive {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.h = 0; // essieu arriere
    this.v = 0;
    this.delta = 0;
    this.braking = false;
    this.bump = 0; // temps depuis le dernier accrochage
  }

  /** @param {number} x @param {number} y @param {number} h */
  place(x, y, h) {
    this.x = x;
    this.y = y;
    this.h = h;
    this.v = 0;
    this.delta = 0;
  }

  /** point du bus a `f` m devant l'essieu arriere et `r` m a droite @param {number} f */
  point(f, r = 0) {
    const c = Math.cos(this.h),
      s = Math.sin(this.h);
    return { x: this.x + c * f + s * r, y: this.y + s * f - c * r };
  }
  get center() {
    return this.point(BUS.L / 2 - BUS.REAR);
  }

  /**
   * @param {import('../common/types.js').DriveInput} inp @param {number} dt
   * @param {import('./heightfield.js').Heightfield} hf @param {{hit:(x:number,y:number)=>boolean}} walls
   * @returns {'bump'|null} evenement eventuel (cle de traduction toast.bump)
   */
  update(inp, dt, hf, walls) {
    /** @type {'bump'|null} */
    let ev = null;
    const v = this.v;
    let a = 0;
    this.braking = false;
    if (inp.up) a += v >= -0.05 ? ACC * (1 - (v / VMAX) ** 2) : BRAKE;
    if (inp.down) {
      if (v > 0.15) {
        a -= BRAKE;
        this.braking = true;
      } else a -= ACC * 0.6;
    }
    if (!inp.up && !inp.down) a -= Math.sign(v) * Math.min(Math.abs(v) / dt, 0.45 + 0.004 * v * v);
    const c = this.center;
    a -= 9.81 * hf.slope(c.x, c.y, this.h) * 0.55;
    let nv = v + a * dt;
    if (inp.down && v > 0 && nv < 0) nv = 0;
    if (inp.up && v < 0 && nv > 0) nv = 0;
    if (!inp.up && !inp.down && Math.abs(nv) < 0.05) nv = 0;
    this.v = Math.max(-VREV, Math.min(VMAX, nv));

    // volant : on braque en maintenant, il revient seul au centre ; moins de braquage a haute vitesse
    const lim = DMAX * (1 - 0.72 * Math.min(1, Math.abs(this.v) / VMAX));
    const target = ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * lim;
    const rate = target === 0 ? STEER_SPEED * 1.6 : STEER_SPEED;
    this.delta += Math.max(-rate * dt, Math.min(rate * dt, target - this.delta));

    const px = this.x,
      py = this.y,
      ph = this.h;
    this.h += (this.v / BUS.WB) * Math.tan(this.delta) * dt;
    this.x += Math.cos(this.h) * this.v * dt;
    this.y += Math.sin(this.h) * this.v * dt;

    // collision : contour du bus contre les emprises des batiments
    this.bump += dt;
    const F = BUS.L - BUS.REAR,
      R = -BUS.REAR,
      HW = BUS.W / 2;
    const probes = [
      [F, -HW],
      [F, HW],
      [F, 0],
      [R, -HW],
      [R, HW],
      [BUS.WB / 2, -HW],
      [BUS.WB / 2, HW],
    ];
    for (const [f, r] of probes) {
      const p = this.point(f, r);
      if (walls.hit(p.x, p.y)) {
        this.x = px;
        this.y = py;
        this.h = ph;
        if (this.bump > 0.6 && Math.abs(this.v) > 1) ev = 'bump';
        this.v = -this.v * 0.25;
        this.bump = 0;
        break;
      }
    }
    return ev;
  }
}
