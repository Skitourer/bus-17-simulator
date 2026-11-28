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
 * Screen rectangles of the mirrors (CSS pixels, origin at the top left): the two exterior ones on the left
 * and right edges of the windscreen, the interior one (#42) in the middle at the top of the windscreen.
 * @param {number} width @param {number} height screen size @param {Settings['camera']['mirrors']} mirrors
 */
export function mirrorRects(width, height, mirrors) {
  const w = Math.round(width * mirrors.widthShare),
    h = Math.round(w / mirrors.aspect);
  const y = Math.round(height * mirrors.top);
  const margin = Math.round(width * 0.015);
  const iw = Math.round(width * mirrors.insideWidthShare),
    ih = Math.round(iw / mirrors.insideAspect);
  return {
    left: { x: margin, y, w, h },
    right: { x: width - margin - w, y, w, h },
    inside: { x: Math.round((width - iw) / 2), y: Math.round(height * mirrors.insideTop), w: iw, h: ih },
  };
}

/**
 * Pose of the steering wheel of a city bus (#42): its centre in the bus frame and its tilt from the
 * horizontal, in front of the driver's eye.
 * @param {{x: number, y: number, z: number}} eye driver's eye in the bus frame
 * @param {Settings['camera']['dashboard']} dash
 */
export function wheelPose(eye, dash) {
  return { x: eye.x + dash.wheelAhead, y: eye.y - dash.wheelBelow, z: eye.z, tilt: dash.wheelTilt };
}
