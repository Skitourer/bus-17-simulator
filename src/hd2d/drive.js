// @ts-check
/**
 * Conduite libre : modele bicyclette (essieu arriere = reference), pente reelle, collisions avec le bati OSM.
 * Repere local : x est, y nord, cap h = angle math (0 = est, sens trigo).
 */

/** @typedef {import('../settings/settings.js').Settings} Settings */

export class Drive {
  /** @param {Settings['drive']} params @param {Settings['bus']} bus */
  constructor(params, bus) {
    this.bus = bus;
    this.p = params;
    this.maxSpeed = 0;
    this.reverseMaxSpeed = 0;
    this.tune(params);
    this.x = 0;
    this.y = 0;
    this.h = 0; // essieu arriere
    this.v = 0;
    this.delta = 0;
    this.braking = false;
    this.bump = 0; // temps depuis le dernier accrochage
  }

  /**
   * Change the driving parameters (debug turbo).
   * @param {Settings['drive']} params
   */
  tune(params) {
    this.p = params;
    this.maxSpeed = params.maxSpeed / 3.6;
    this.reverseMaxSpeed = params.reverseMaxSpeed / 3.6;
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
    return this.point(this.bus.bodyLength / 2 - this.bus.rearOverhang);
  }

  /**
   * @param {import('../common/types.js').DriveInput} inp @param {number} dt
   * @param {{slope: (x: number, y: number, hd: number) => number}} hf surface slope along a heading @param {{hit:(x:number,y:number)=>boolean}} walls
   * @returns {'bump'|null} evenement eventuel (cle de traduction toast.bump)
   */
  update(inp, dt, hf, walls) {
    /** @type {'bump'|null} */
    let ev = null;
    const { p, bus } = this;
    const v = this.v,
      vmax = this.maxSpeed;
    let a = 0;
    this.braking = false;
    if (inp.up) a += v >= -0.05 ? p.acceleration * (1 - (v / vmax) ** 2) : p.braking;
    if (inp.down) {
      if (v > 0.15) {
        a -= p.braking;
        this.braking = true;
      } else a -= p.reverseAcceleration;
    }
    if (!inp.up && !inp.down)
      a -= Math.sign(v) * Math.min(Math.abs(v) / dt, p.rollingDeceleration + p.airDrag * v * v);
    const c = this.center;
    a -= 9.81 * hf.slope(c.x, c.y, this.h) * p.slopeFactor;
    let nv = v + a * dt;
    if (inp.down && v > 0 && nv < 0) nv = 0;
    if (inp.up && v < 0 && nv > 0) nv = 0;
    if (!inp.up && !inp.down && Math.abs(nv) < 0.05) nv = 0;
    this.v = Math.max(-this.reverseMaxSpeed, Math.min(vmax, nv));

    // volant : on braque en maintenant, il revient seul au centre ; moins de braquage a haute vitesse
    const lim = p.maxSteer * (1 - p.steerReductionAtMaxSpeed * Math.min(1, Math.abs(this.v) / vmax));
    const target = ((inp.left ? 1 : 0) - (inp.right ? 1 : 0)) * lim;
    const rate = target === 0 ? p.steerReturnRate : p.steerRate;
    this.delta += Math.max(-rate * dt, Math.min(rate * dt, target - this.delta));

    const px = this.x,
      py = this.y,
      ph = this.h;
    this.h += (this.v / bus.wheelbase) * Math.tan(this.delta) * dt;
    this.x += Math.cos(this.h) * this.v * dt;
    this.y += Math.sin(this.h) * this.v * dt;

    // collision : contour du bus contre les emprises des batiments
    this.bump += dt;
    const F = bus.bodyLength - bus.rearOverhang,
      R = -bus.rearOverhang,
      HW = bus.bodyWidth / 2;
    const probes = [
      [F, -HW],
      [F, HW],
      [F, 0],
      [R, -HW],
      [R, HW],
      [bus.wheelbase / 2, -HW],
      [bus.wheelbase / 2, HW],
    ];
    for (const [f, r] of probes) {
      const probe = this.point(f, r);
      if (walls.hit(probe.x, probe.y)) {
        this.x = px;
        this.y = py;
        this.h = ph;
        if (this.bump > p.bumpCooldown && Math.abs(this.v) > 1) ev = 'bump';
        this.v = -this.v * p.bumpRebound;
        this.bump = 0;
        break;
      }
    }
    return ev;
  }
}
