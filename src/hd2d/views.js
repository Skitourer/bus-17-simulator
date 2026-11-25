// @ts-check
/**
 * Views from inside the bus (#18): driver cabin and passenger seat, steering wheel and mirror layout.
 * Pure logic, no DOM and no WebGL. Bus frame: +x forward, +y up, +z right (door side), origin at the rear
 * axle on the road.
 */

/** @typedef {import('../settings/settings.js').Settings} Settings */
/** @typedef {Settings['camera']['cabin']} InteriorView */

/**
 * Eye position in the bus frame.
 * @param {InteriorView} view @param {Settings['bus']} bus
 */
export function eyePosition(view, bus) {
  return { x: bus.bodyLength - bus.rearOverhang - view.eyeFromFront, y: view.eyeHeight, z: view.eyeSide };
}

/**
 * Point one metre along a view direction from an eye, in the world frame (x east, y north, z up).
 * @param {{x: number, y: number, z: number}} eye world position @param {number} yaw @param {number} pitch
 * downwards
 */
export function lookTarget(eye, yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: eye.x + Math.cos(yaw) * c, y: eye.y + Math.sin(yaw) * c, z: eye.z - Math.sin(pitch) };
}

/**
 * Steering wheel angle (rad, positive to the left) for a front wheel angle.
 * @param {number} wheelAngle rad @param {number} ratio steering ratio
 */
export function steeringWheelAngle(wheelAngle, ratio) {
  return wheelAngle * ratio;
}

/**
 * Screen rectangles of the two exterior mirrors (CSS pixels, origin at the top left), on the left and right
 * edges of the windscreen.
 * @param {number} width @param {number} height screen size @param {Settings['camera']['mirrors']} mirrors
 */
export function mirrorRects(width, height, mirrors) {
  const w = Math.round(width * mirrors.widthShare),
    h = Math.round(w / mirrors.aspect);
  const y = Math.round(height * mirrors.top);
  const margin = Math.round(width * 0.015);
  return {
    left: { x: margin, y, w, h },
    right: { x: width - margin - w, y, w, h },
  };
}
