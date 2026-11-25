// @ts-check
/**
 * Key bindings (#44): every game action is bound to physical keys (`KeyboardEvent.code`), so the keys sit
 * at the same place whatever the keyboard layout (WASD on QWERTY is ZQSD on AZERTY). The labels shown to
 * the player follow the layout: the browser layout map when it has one, else a layout guessed from the
 * language. Pure logic, no DOM.
 */

/** Physical keys of each action; the first key of an action is its main one. */
export const BINDINGS = Object.freeze({
  accelerate: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  doors: ['Space'],
  camera: ['KeyC'],
  resetView: ['KeyV'],
  guidance: ['KeyG'],
  map: ['KeyM'],
  replace: ['KeyR'],
  pause: ['KeyP'],
  menu: ['Escape'],
  // debug mode only
  turbo: ['ShiftLeft', 'ShiftRight'],
  nextStop: ['KeyN'],
  previousStop: ['KeyB'],
  ghost: ['KeyK'],
  fly: ['KeyF'],
  flyUp: ['Space'],
  flyDown: ['KeyX'],
  land: ['Enter'],
});

/** @typedef {keyof typeof BINDINGS} Action */
/** @typedef {Readonly<Record<Action, readonly string[]>>} Bindings */

/**
 * Whether the physical key `code` triggers `action`.
 * @param {Action} action @param {string} code @param {Bindings} [bindings]
 */
export function isAction(action, code, bindings = BINDINGS) {
  return bindings[action].includes(code);
}

/**
 * Characters printed on the keys that differ from QWERTY, by layout (code → label).
 * Sources: Windows keyboard layouts "French" (AZERTY) and "German" (QWERTZ).
 */
const LAYOUT_DIFFERENCES = Object.freeze({
  qwerty: {},
  azerty: { KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', KeyM: ',', Semicolon: 'M' },
  qwertz: { KeyY: 'Z', KeyZ: 'Y' },
});

/** @typedef {keyof typeof LAYOUT_DIFFERENCES} Layout */

/**
 * Layout guessed from the browser languages, when the browser cannot tell the real one: AZERTY for French
 * from France and Belgium, QWERTZ for German, QWERTY otherwise (Canadian and Swiss French use QWERTY and
 * QWERTZ, hence the regions).
 * @param {readonly string[]} languages BCP 47 tags, most preferred first
 * @returns {Layout}
 */
export function guessLayout(languages) {
  const tag = (languages[0] || '').toLowerCase();
  if (tag === 'fr' || tag === 'fr-fr' || tag === 'fr-be') return 'azerty';
  if (tag.startsWith('de') || tag === 'fr-ch') return 'qwertz';
  return 'qwerty';
}

/** Arrow keys are drawn, not named. */
const ARROWS = Object.freeze({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' });

/**
 * Label of a physical key for the player.
 * @param {string} code `KeyboardEvent.code`
 * @param {{get: (code: string) => string | undefined} | null} layoutMap browser layout map, if any
 * @param {Layout} fallback layout used when the map does not know the key
 * @param {(code: string) => string | undefined} named translated name of a non-character key (Space, Enter…)
 */
export function keyLabel(code, layoutMap, fallback, named) {
  if (code in ARROWS) return ARROWS[/** @type {keyof typeof ARROWS} */ (code)];
  const name = named(code);
  if (name) return name;
  const printed = layoutMap?.get(code);
  if (printed) return printed.toUpperCase();
  /** @type {Record<string, string>} */
  const differences = LAYOUT_DIFFERENCES[fallback];
  if (code in differences) return differences[code];
  if (code.startsWith('Key') || code.startsWith('Digit')) return code.replace(/^(Key|Digit)/, '');
  return code;
}

/**
 * Placeholders for the help texts: `{keyAccelerate}` → "Z / ↑", plus `{keySteer}` ("Q D / ← →") and
 * `{keyMove}` ("ZQSD / ↑←↓→") that pair the four driving actions.
 * @param {(code: string) => string} label @param {Bindings} [bindings]
 * @returns {Record<string, string>}
 */
export function keyPlaceholders(label, bindings = BINDINGS) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [action, codes] of Object.entries(bindings)) {
    const labels = [...new Set(codes.map(label))];
    out['key' + action[0].toUpperCase() + action.slice(1)] = labels.join(' / ');
  }
  const { accelerate, brake, left, right } = bindings;
  /** @param {number} k */
  const pair = (k) => label(left[k]) + ' ' + label(right[k]);
  out.keySteer = [0, 1].map(pair).join(' / ');
  /** @param {number} k */
  const four = (k) => [accelerate[k], left[k], brake[k], right[k]].map(label).join('');
  out.keyMove = four(0) + ' / ' + four(1);
  return out;
}
