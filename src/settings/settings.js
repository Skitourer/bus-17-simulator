// @ts-check
/**
 * Game parameters: every tunable value lives in src/settings/game.json, one documented entry per parameter
 * ({value, unit, doc, source?, min, max, integer?} for numbers, {value, unit, doc} for "#rrggbb" colours).
 * The file is validated at start-up and the game reads plain values (`settings.drive.maxSpeed`).
 */

/** @typedef {typeof import('./game.json')} SettingsFile */
/**
 * Values of a settings file: each documented entry replaced by its value.
 * @template T
 * @typedef {T extends {value: infer V} ? (V extends number ? number : string) : {[K in keyof T]: Values<T[K]>}} Values
 */
/** @typedef {Values<SettingsFile>} Settings */

const COLOUR = /^#[0-9a-f]{6}$/i;
const NUMBER_FIELDS = new Set(['value', 'unit', 'doc', 'source', 'min', 'max', 'integer']);
const COLOUR_FIELDS = new Set(['value', 'unit', 'doc', 'source']);

/** @param {unknown} x @returns {x is Record<string, unknown>} */
function isObject(x) {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Problems of one documented entry (empty when valid).
 * @param {string} path @param {Record<string, unknown>} entry @returns {string[]}
 */
function entryErrors(path, entry) {
  const errors = [];
  const { value } = entry;
  if (typeof entry.doc !== 'string' || !entry.doc.trim()) errors.push(`${path}: missing "doc"`);
  if (typeof entry.unit !== 'string' || !entry.unit.trim()) errors.push(`${path}: missing "unit"`);
  if ('source' in entry && typeof entry.source !== 'string') errors.push(`${path}: "source" must be text`);
  const allowed = typeof value === 'string' ? COLOUR_FIELDS : NUMBER_FIELDS;
  for (const field of Object.keys(entry))
    if (!allowed.has(field)) errors.push(`${path}: unknown field "${field}"`);
  if (typeof value === 'string') {
    if (!COLOUR.test(value)) errors.push(`${path}: "${value}" is not a #rrggbb colour`);
    return errors;
  }
  if (typeof value !== 'number' || !Number.isFinite(value))
    return [...errors, `${path}: value must be a number`];
  const { min, max } = entry;
  if (typeof min !== 'number' || typeof max !== 'number' || min > max)
    return [...errors, `${path}: needs numeric "min" <= "max"`];
  if (value < min || value > max) errors.push(`${path}: ${value} is outside [${min}, ${max}]`);
  if (entry.integer === true && !Number.isInteger(value)) errors.push(`${path}: ${value} is not an integer`);
  else if ('integer' in entry && typeof entry.integer !== 'boolean')
    errors.push(`${path}: "integer" must be true or false`);
  return errors;
}

/**
 * Plain values of a group, collecting the problems of every entry.
 * @param {string} path @param {Record<string, unknown>} group @param {string[]} errors
 * @returns {Record<string, unknown>}
 */
function groupValues(path, group, errors) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, node] of Object.entries(group)) {
    const at = path ? `${path}.${key}` : key;
    if (!isObject(node)) errors.push(`${at}: expected a group or a documented entry`);
    else if ('value' in node) {
      errors.push(...entryErrors(at, node));
      out[key] = node.value;
    } else out[key] = groupValues(at, node, errors);
  }
  return out;
}

/**
 * Validated values of a parsed settings file; throws one error listing every problem.
 * @param {unknown} file @returns {Settings}
 */
export function parseSettings(file) {
  if (!isObject(file)) throw new Error('settings: the file must hold a JSON object');
  /** @type {string[]} */
  const errors = [];
  const values = groupValues('', file, errors);
  if (errors.length) throw new Error(`settings: ${errors.join('; ')}`);
  return /** @type {Settings} */ (/** @type {unknown} */ (values));
}

/**
 * Every parameter path of a settings file, e.g. "drive.maxSpeed".
 * @param {Record<string, unknown>} file @returns {string[]}
 */
export function settingPaths(file, prefix = '') {
  return Object.entries(file).flatMap(([key, node]) =>
    isObject(node) && !('value' in node) ? settingPaths(node, `${prefix}${key}.`) : [prefix + key],
  );
}

/** Fetch and validate src/settings/game.json. */
export async function loadSettings() {
  const res = await fetch(new URL('./game.json', import.meta.url));
  if (!res.ok) throw new Error(`settings: game.json: HTTP ${res.status}`);
  let file;
  try {
    file = await res.json();
  } catch (e) {
    throw new Error(`settings: game.json is not valid JSON (${e instanceof Error ? e.message : e})`);
  }
  return parseSettings(file);
}
