// @ts-check
/**
 * Free orbit of the exterior camera around the bus, driven by mouse drags.
 * While free, the camera keeps its own world yaw (it follows the bus position, not its heading);
 * reset() eases it back to the automatic yaw and pitch of the current camera mode.
 */

/** Radians per pixel of mouse drag. */
const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.004;
/** Pitch limits (rad): never at or below the horizon, never past straight down. */
export const PITCH_MIN = 0.06;
export const PITCH_MAX = 1.45;
/** Time constant (s) of the return to the automatic view. */
const RETURN_TAU = 0.18;
/** Below this angle (rad) the return is complete. */
const RETURN_DONE = 0.002;

/** @param {number} a */
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class OrbitCamera {
  constructor() {
    /** @type {'auto' | 'free' | 'returning'} */
    this.state = 'auto';
    this.yaw = 0;
    this.pitch = 0;
  }

  get free() {
    return this.state === 'free';
  }

  /**
   * Mouse drag by (dx, dy) pixels; the first drag starts from the current automatic view.
   * @param {number} dx @param {number} dy @param {number} autoYaw @param {number} autoPitch
   */
  drag(dx, dy, autoYaw, autoPitch) {
    if (this.state === 'auto') {
      this.yaw = autoYaw;
      this.pitch = autoPitch;
    }
    this.state = 'free';
    // dragging right turns the view to the right, i.e. the camera moves counter-clockwise
    this.yaw = wrapAngle(this.yaw - dx * YAW_PER_PX);
    this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + dy * PITCH_PER_PX));
  }

  /** Start easing back to the automatic view (no-op when already automatic). */
  reset() {
    if (this.state === 'free') this.state = 'returning';
  }

  /** Jump back to the automatic view at once (camera mode change). */
  snap() {
    this.state = 'auto';
  }

  /**
   * View to use this frame.
   * @param {number} dt @param {number} autoYaw @param {number} autoPitch
   * @returns {{yaw: number, pitch: number}}
   */
  view(dt, autoYaw, autoPitch) {
    if (this.state === 'auto') return { yaw: autoYaw, pitch: autoPitch };
    if (this.state === 'returning') {
      const k = 1 - Math.exp(-dt / RETURN_TAU);
      const dyaw = wrapAngle(autoYaw - this.yaw);
      const dpitch = autoPitch - this.pitch;
      this.yaw = wrapAngle(this.yaw + dyaw * k);
      this.pitch += dpitch * k;
      if (Math.abs(dyaw) < RETURN_DONE && Math.abs(dpitch) < RETURN_DONE) this.state = 'auto';
    }
    return { yaw: this.yaw, pitch: this.pitch };
  }
}
