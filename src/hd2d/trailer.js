// @ts-check
/**
 * Articulated bus (#54): the rear body (trailer) is pulled by the front one through a joint behind the
 * middle axle. The trailer axle follows the joint without sliding sideways, so the rear body cuts the
 * corners like a real articulated bus. Pure logic, no DOM and no Three.js. Local frame: x east, y north,
 * heading = math angle (0 = east, counter-clockwise).
 */

/** @typedef {import('../settings/settings.js').Settings} Settings */

/**
 * @typedef {object} TrailerGeometry
 * @property {number} hitchOffset joint behind the middle axle (m)
 * @property {number} bellowsLength length of the bellows centred on the joint (m)
 * @property {number} trailerWheelbase joint to the rear axle (m)
 * @property {number} trailerRearOverhang rear axle to the back of the bus (m)
 * @property {number} maxArticulation largest angle between the two bodies (rad)
 */

/** @typedef {Settings['bus'] & {trailer: TrailerGeometry | null}} BusGeometry */

/**
 * Geometry of the bus type chosen in the menu: `std` (12 m) or `art` (articulated, 18 m). The front body of
 * the articulated bus replaces the standard length, wheelbase and rear overhang; width, height and
 * textures are shared.
 * @param {Settings} settings @param {string} type @returns {BusGeometry}
 */
export function busGeometry(settings, type) {
  if (type !== 'art') return { ...settings.bus, trailer: null };
  const a = settings.articulated;
  return {
    ...settings.bus,
    bodyLength: a.bodyLength,
    wheelbase: a.wheelbase,
    rearOverhang: a.rearOverhang,
    trailer: {
      hitchOffset: a.hitchOffset,
      bellowsLength: a.bellowsLength,
      trailerWheelbase: a.trailerWheelbase,
      trailerRearOverhang: a.trailerRearOverhang,
      maxArticulation: a.maxArticulation,
    },
  };
}

/** @typedef {{x: number, y: number, h: number}} TrailerState rear axle position and heading of the trailer */

/** @param {number} a */
function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Trailer {
  /** @param {TrailerGeometry} geometry @param {number} bodyWidth */
  constructor(geometry, bodyWidth) {
    this.g = geometry;
    this.halfWidth = bodyWidth / 2;
    /** @type {TrailerState} */
    this.state = { x: 0, y: 0, h: 0 };
  }

  /**
   * Joint position for the front body with its middle axle at (x, y), heading h.
   * @param {number} x @param {number} y @param {number} h
   */
  hitch(x, y, h) {
    return { x: x - Math.cos(h) * this.g.hitchOffset, y: y - Math.sin(h) * this.g.hitchOffset };
  }

  /**
   * Trailer in line with the front body (bus placed or teleported).
   * @param {number} x @param {number} y @param {number} h
   */
  align(x, y, h) {
    const j = this.hitch(x, y, h);
    const L = this.g.trailerWheelbase;
    this.state = { x: j.x - Math.cos(h) * L, y: j.y - Math.sin(h) * L, h };
  }

  /**
   * Where the trailer goes once the front body has moved to (x, y, h): its axle is pulled straight
   * towards the joint (no sideways slip), and the angle between the bodies is limited (jackknife stop).
   * The state is not changed; `commit` keeps the result.
   * @param {number} x @param {number} y @param {number} h @returns {TrailerState}
   */
  follow(x, y, h) {
    const j = this.hitch(x, y, h);
    const L = this.g.trailerWheelbase;
    // the axle stays trailerWheelbase behind the joint, so this direction is always defined
    let heading = Math.atan2(j.y - this.state.y, j.x - this.state.x);
    const bend = wrapAngle(heading - h);
    const max = this.g.maxArticulation;
    if (Math.abs(bend) > max) heading = h + Math.sign(bend) * max;
    return { x: j.x - Math.cos(heading) * L, y: j.y - Math.sin(heading) * L, h: heading };
  }

  /** @param {TrailerState} state */
  commit(state) {
    this.state = state;
  }

  /**
   * Point `f` m ahead of the trailer axle and `r` m to its right.
   * @param {number} f @param {number} [r] @param {TrailerState} [state]
   */
  point(f, r = 0, state = this.state) {
    const c = Math.cos(state.h),
      s = Math.sin(state.h);
    return { x: state.x + c * f + s * r, y: state.y + s * f - c * r };
  }

  /** Angle between the trailer and the front body heading `h` (rad, > 0 = trailer to the left). @param {number} h */
  articulation(h) {
    return wrapAngle(this.state.h - h);
  }

  /**
   * Outline points of the rear body tested against obstacles: back corners and the sides at the axle.
   * @param {TrailerState} [state]
   */
  probes(state = this.state) {
    const back = -this.g.trailerRearOverhang,
      hw = this.halfWidth;
    return [
      [back, -hw],
      [back, hw],
      [0, -hw],
      [0, hw],
    ].map(([f, r]) => this.point(f, r, state));
  }
}
