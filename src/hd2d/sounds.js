// @ts-check
/**
 * Sound rules of the game: engine rate from the speed and the throttle, master volume from the player's
 * choice, and which events ring (doors, stop request). Pure logic; src/hd2d/audio.js plays them.
 */

/** @typedef {import('../settings/settings.js').Settings['audio']} AudioSettings */

/**
 * Engine sound: the idling recording played faster with the speed (the engine turns faster), louder and
 * brighter when the driver accelerates.
 * @param {number} speed m/s (either way) @param {number} throttle 0 (idle) to 1 (accelerating)
 * @param {AudioSettings} p
 * @returns {{rate: number, gain: number, cutoff: number}} playback rate, ratio, Hz
 */
export function engineTone(speed, throttle, p) {
  const pace = Math.min(1, Math.abs(speed) / p.engineTopSpeed);
  const push = Math.min(1, Math.max(0, throttle));
  return {
    rate: 1 + (p.engineTopRate - 1) * pace + p.engineLoadRate * push,
    gain: p.engineIdleGain + (p.engineLoadGain - p.engineIdleGain) * Math.max(push, pace * 0.5),
    cutoff: p.engineCutoffHz * (1 + push),
  };
}

/**
 * Master gain of a volume choice of the settings screen.
 * @param {'off' | 'low' | 'medium' | 'high'} volume @param {AudioSettings} p
 */
export function masterGain(volume, p) {
  if (volume === 'off') return 0;
  return volume === 'low' ? p.volumeLow : volume === 'high' ? p.volumeHigh : p.volumeMedium;
}

/**
 * Sound of the doors on a change of their state: the hiss of the air when they start to open, the warning
 * beeps when they start to close; null otherwise.
 * @param {string} before state at the last frame @param {string} now
 * @returns {'open' | 'close' | null}
 */
export function doorSound(before, now) {
  if (before === now) return null;
  if (now === 'opening') return 'open';
  if (now === 'closing') return 'close';
  return null;
}

/**
 * Whether the stop request bell rings: someone on board has just asked for the next stop.
 * @param {number} before people getting off at the next stop, at the last frame @param {number} now
 */
export function stopBell(before, now) {
  return before <= 0 && now > 0;
}
