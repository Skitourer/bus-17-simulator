// @ts-check
/**
 * Debug mode (`?debug`): finding a stop by name, stepping between stops, and the free-flying camera.
 * Pure logic, no DOM and no WebGL.
 */

/** @typedef {import('../settings/settings.js').Settings} Settings */

/**
 * Lower case, without accents and punctuation: "Saint-Laurent" and "saint laurent" match.
 * @param {string} name
 */
export function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Index of the stop named `query`: exact match first, else the first stop whose name contains it; -1 if none.
 * @param {{name: string}[]} stops @param {string} query
 */
export function findStop(stops, query) {
  const wanted = normalizeName(query);
  if (!wanted) return -1;
  const names = stops.map((st) => normalizeName(st.name));
  const exact = names.indexOf(wanted);
  return exact >= 0 ? exact : names.findIndex((name) => name.includes(wanted));
}

/**
 * Index of the next stop (`direction` 1) or the previous one (-1) from a position along the route, clamped to
 * the first and last stops. A stop less than `margin` metres away counts as the current one.
 * @param {{s: number}[]} stops @param {number} s @param {1 | -1} direction
 */
export function stepStop(stops, s, direction, margin = 5) {
  if (direction > 0) {
    const i = stops.findIndex((st) => st.s > s + margin);
    return i < 0 ? stops.length - 1 : i;
  }
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i].s < s - margin) return i;
  return 0;
}

/**
 * Driving parameters of the turbo: higher top speed, stronger acceleration and brakes.
 * @param {Settings['drive']} drive @param {Settings['debug']} debug @returns {Settings['drive']}
 */
export function turboDrive(drive, debug) {
  return {
    ...drive,
    maxSpeed: debug.turboMaxSpeed,
    acceleration: drive.acceleration * debug.turboFactor,
    braking: drive.braking * debug.turboFactor,
  };
}

/**
 * @typedef {object} FlyInput
 * @property {boolean} forward
 * @property {boolean} back
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} fast
 */

/** Free camera flying over the city: x east, y north, z up; yaw 0 = east, counter-clockwise. */
export class FreeFly {
  /** @param {Settings['debug']} params @param {Settings['camera']['orbit']} look mouse sensitivity and limits */
  constructor(params, look) {
    this.p = params;
    this.look = look;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
  }

  /**
   * Start from a camera position, looking along `yaw` and down by `pitch` (rad).
   * @param {number} x @param {number} y @param {number} z @param {number} yaw @param {number} pitch
   */
  start(x, y, z, yaw, pitch) {
    Object.assign(this, { x, y, z, yaw, pitch });
  }

  /**
   * Mouse drag by (dx, dy) pixels: dragging right turns right, dragging down looks further down.
   * @param {number} dx @param {number} dy
   */
  turn(dx, dy) {
    const { yawPerPixel, pitchPerPixel, pitchMax } = this.look;
    this.yaw -= dx * yawPerPixel;
    this.pitch = Math.max(-pitchMax, Math.min(pitchMax, this.pitch + dy * pitchPerPixel));
  }

  /**
   * Move for `dt` seconds, staying `flyMinHeight` above `floor(x, y)`.
   * @param {FlyInput} input @param {number} dt @param {(x: number, y: number) => number} floor
   */
  update(input, dt, floor) {
    const speed = this.p.flySpeed * (input.fast ? this.p.flyFastFactor : 1) * dt;
    const ahead = (input.forward ? 1 : 0) - (input.back ? 1 : 0),
      side = (input.right ? 1 : 0) - (input.left ? 1 : 0),
      rise = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    this.x += (c * ahead + s * side) * speed;
    this.y += (s * ahead - c * side) * speed;
    this.z = Math.max(floor(this.x, this.y) + this.p.flyMinHeight, this.z + rise * speed);
  }

  /** Point one metre ahead along the view direction. */
  get target() {
    const cp = Math.cos(this.pitch);
    return {
      x: this.x + Math.cos(this.yaw) * cp,
      y: this.y + Math.sin(this.yaw) * cp,
      z: this.z - Math.sin(this.pitch),
    };
  }
}
