// @ts-check
/**
 * Turn signals (#119): the indicator switch of the player's bus, the blinking, and when a car signals its
 * turn. Pure logic, no DOM.
 */

/** @typedef {'left' | 'right'} Side */
/** @typedef {import('../settings/settings.js').Settings['indicators']} IndicatorSettings */

/**
 * Whether a blinking lamp is lit at time `t` (s): `rate` flashes per second, lit for `duty` of each.
 * @param {number} t @param {IndicatorSettings} p @param {number} [offset] phase of this lamp (s)
 */
export function blinkOn(t, p, offset = 0) {
  const phase = ((t + offset) * p.blinkRate) % 1;
  return phase < p.duty;
}

/**
 * The indicator switch of the bus: one key per side, the same key again or the other one switches it off
 * or over. Like a real stalk it cancels itself once the wheel, turned towards the signalled side, comes back
 * near straight.
 */
export class IndicatorSwitch {
  /** @param {IndicatorSettings} params */
  constructor(params) {
    this.p = params;
    /** @type {Side | null} */
    this.side = null;
    /** the wheel went past the cancelling angle towards the signalled side */
    this.turned = false;
  }

  /** @param {Side} side */
  press(side) {
    this.side = this.side === side ? null : side;
    this.turned = false;
  }

  /**
   * Self-cancelling, from the steering angle (rad, positive to the left).
   * @param {number} steer
   */
  update(steer) {
    if (!this.side) return;
    const towards = this.side === 'left' ? steer : -steer;
    if (towards > this.p.cancelSteer) this.turned = true;
    else if (this.turned && Math.abs(steer) < this.p.straightSteer) {
      this.side = null;
      this.turned = false;
    }
  }
}

/**
 * Side of a turn from the heading at the end of a lane to the heading at the start of the next one, null
 * when the road goes on about straight.
 * @param {number} before heading (rad, from east, counter-clockwise) @param {number} after
 * @param {IndicatorSettings} p
 * @returns {Side | null}
 */
export function turnSide(before, after, p) {
  const turn = Math.atan2(Math.sin(after - before), Math.cos(after - before));
  if (Math.abs(turn) < p.turnAngle) return null;
  return turn > 0 ? 'left' : 'right';
}

/**
 * Indicator of a car: on the side of its next turn from carSignalDistance before the end of its lane, and
 * of the turn it has just taken until it is carSignalAfter into the new road.
 * @param {number} toEnd distance left on the lane (m) @param {Side | null} next side of the turn ahead
 * @param {number} along distance driven on the lane (m) @param {Side | null} last side of the turn just taken
 * @param {IndicatorSettings} p
 * @returns {Side | null}
 */
export function carSignal(toEnd, next, along, last, p) {
  if (next && toEnd <= p.carSignalDistance) return next;
  if (last && along <= p.carSignalAfter) return last;
  return null;
}
