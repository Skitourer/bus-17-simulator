// @ts-check
/**
 * Player preferences (#46): language, graphics quality, view distance, difficulty and key bindings, chosen
 * in the settings screen and kept in the browser. They are applied on top of the game.json values: a
 * preset replaces some parameters, the middle choice of each keeps game.json as is.
 */
import { BINDINGS } from '../common/keys.js';

/** Choices of each preset, the default one (game.json values, no override) in the middle. */
export const CHOICES = Object.freeze(
  /** @type {const} */ ({
    quality: ['low', 'medium', 'high'],
    viewDistance: ['near', 'medium', 'far'],
    difficulty: ['easy', 'normal', 'hard'],
  }),
);

/** Actions the player may bind to another key; the debug keys and Escape (menu) stay fixed. */
export const REMAPPABLE = Object.freeze(
  /** @type {import('../common/keys.js').Action[]} */ ([
    'accelerate',
    'brake',
    'left',
    'right',
    'doors',
    'camera',
    'resetView',
    'guidance',
    'map',
    'replace',
    'pause',
  ]),
);

/**
 * @typedef {object} Preferences
 * @property {string} language '' to follow the browser
 * @property {'low' | 'medium' | 'high'} quality
 * @property {'near' | 'medium' | 'far'} viewDistance
 * @property {'easy' | 'normal' | 'hard'} difficulty
 * @property {Partial<Record<import('../common/keys.js').Action, string>>} keys main key of an action, when changed
 */

/** @type {Readonly<Preferences>} */
export const DEFAULT_PREFERENCES = Object.freeze({
  language: '',
  quality: 'medium',
  viewDistance: 'far',
  difficulty: 'normal',
  keys: {},
});

/** Storage key in the browser. */
export const STORAGE_KEY = 'bus17.preferences';

/** A `KeyboardEvent.code` value, e.g. "KeyW", "Digit1", "ArrowUp". */
const KEY_CODE = /^[A-Za-z][A-Za-z0-9]{1,24}$/;

/**
 * Valid preferences from stored data: unknown or invalid fields fall back to their default, so that an
 * old or hand-edited entry never stops the game.
 * @param {unknown} raw parsed JSON @param {readonly string[]} languages supported languages
 * @returns {Preferences}
 */
export function parsePreferences(raw, languages) {
  const data = typeof raw === 'object' && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @template {string} T @param {readonly T[]} choices @param {unknown} value @param {T} fallback @returns {T} */
  const pick = (choices, value, fallback) =>
    choices.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback;
  /** @type {Preferences['keys']} */
  const keys = {};
  const storedKeys = typeof data.keys === 'object' && data.keys !== null ? data.keys : {};
  for (const [action, code] of Object.entries(storedKeys))
    if (REMAPPABLE.includes(/** @type {any} */ (action)) && typeof code === 'string' && KEY_CODE.test(code))
      keys[/** @type {import('../common/keys.js').Action} */ (action)] = code;
  return {
    language: pick(['', ...languages], data.language, DEFAULT_PREFERENCES.language),
    quality: pick(CHOICES.quality, data.quality, DEFAULT_PREFERENCES.quality),
    viewDistance: pick(CHOICES.viewDistance, data.viewDistance, DEFAULT_PREFERENCES.viewDistance),
    difficulty: pick(CHOICES.difficulty, data.difficulty, DEFAULT_PREFERENCES.difficulty),
    keys,
  };
}

/**
 * Stored preferences; defaults when the storage is empty, unreadable (private browsing, blocked site
 * data) or holds broken JSON.
 * @param {Pick<Storage, 'getItem'> | null} storage @param {readonly string[]} languages
 */
export function loadPreferences(storage, languages) {
  let raw = null;
  try {
    raw = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
  } catch {
    // unreadable storage or broken JSON: the defaults apply
  }
  return parsePreferences(raw, languages);
}

/**
 * Keep the preferences; returns false when the browser refuses to store them.
 * @param {Pick<Storage, 'setItem'> | null} storage @param {Preferences} preferences
 */
export function savePreferences(storage, preferences) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return Boolean(storage);
  } catch {
    return false;
  }
}

/**
 * Key bindings with the player's main keys: the changed key replaces the first key of its action, the
 * other keys (arrows) stay.
 * @param {Preferences['keys']} keys @returns {import('../common/keys.js').Bindings}
 */
export function bindingsWith(keys) {
  /** @type {Record<string, readonly string[]>} */
  const out = {};
  for (const [action, codes] of Object.entries(BINDINGS)) {
    const main = keys[/** @type {import('../common/keys.js').Action} */ (action)];
    out[action] = main ? [main, ...codes.slice(1).filter((c) => c !== main)] : codes;
  }
  return /** @type {import('../common/keys.js').Bindings} */ (out);
}

/**
 * Remappable action already bound to `code`, other than `action` (a key drives one action only).
 * @param {import('../common/keys.js').Bindings} bindings @param {import('../common/keys.js').Action} action
 * @param {string} code @returns {import('../common/keys.js').Action | null}
 */
export function keyConflict(bindings, action, code) {
  const fixed = /** @type {import('../common/keys.js').Action[]} */ (['menu']);
  for (const other of [...REMAPPABLE, ...fixed])
    if (other !== action && bindings[other].includes(code)) return other;
  return null;
}

/** @typedef {import('./settings.js').Settings} Settings */

/**
 * Settings with the presets of the preferences applied; the result goes through `parseSettings` again
 * only in the tests, the presets being validated with game.json.
 * @param {Settings} settings @param {Preferences} preferences @returns {Settings}
 */
export function applyPreferences(settings, preferences) {
  const { presets } = settings;
  const render = { ...settings.render },
    gameplay = { ...settings.gameplay };
  if (preferences.quality === 'low') Object.assign(render, presets.quality.low);
  if (preferences.quality === 'high') Object.assign(render, presets.quality.high);
  if (preferences.viewDistance === 'near') Object.assign(render, presets.viewDistance.near);
  if (preferences.viewDistance === 'medium') Object.assign(render, presets.viewDistance.medium);
  if (preferences.difficulty === 'easy') Object.assign(gameplay, presets.difficulty.easy);
  if (preferences.difficulty === 'hard') Object.assign(gameplay, presets.difficulty.hard);
  return { ...settings, render, gameplay };
}
