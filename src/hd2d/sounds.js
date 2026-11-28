// @ts-check
/**
 * Sound rules of the game: engine tone from the speed and the throttle, master volume from the player's
 * choice, and which events ring (doors, stop request). Pure logic; src/hd2d/audio.js plays them.
 */

/** @typedef {import('../settings/settings.js').Settings['audio']} AudioSettings */

/**
 * Engine tone: a diesel hum whose pitch follows the speed (gearbox steps are left out), louder and brighter
 * when the driver accelerates.
 * @param {number} speed m/s (either way) @param {number} throttle 0 (idle) to 1 (accelerating)
 * @param {AudioSettings} p
 * @returns {{frequency: number, gain: number, cutoff: number}} Hz, ratio, Hz
 */
export function engineTone(speed, throttle, p) {
  const pace = Math.min(1, Math.abs(speed) / p.engineTopSpeed);
  const push = Math.min(1, Math.max(0, throttle));
  return {
    frequency: p.engineIdleHz + (p.engineTopHz - p.engineIdleHz) * pace,
    gain: p.engineIdleGain + (p.engineLoadGain - p.engineIdleGain) * Math.max(push, pace * 0.5),
    cutoff: p.engineCutoffHz * (1 + push),
  };
}

/**
 * Harmonics of the engine voice (Fourier sine terms, for a Web Audio periodic wave): falling as 1/n^1.5 so
 * the hum stays round, the odd ones stronger for the hollow knock of a diesel. Term 0 (offset) is 0.
 * @param {number} count number of harmonics
 * @returns {{real: Float32Array, imag: Float32Array}}
 */
export function engineHarmonics(count) {
  const real = new Float32Array(count + 1),
    imag = new Float32Array(count + 1);
  for (let n = 1; n <= count; n++) imag[n] = (n % 2 ? 1 : 0.55) / Math.pow(n, 1.5);
  return { real, imag };
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
