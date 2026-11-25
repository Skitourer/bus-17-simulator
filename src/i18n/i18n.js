// @ts-check
import { BINDINGS, guessLayout, keyLabel, keyPlaceholders } from '../common/keys.js';

/**
 * Translations: every player-facing text lives in src/i18n/<lang>.json, looked up by a dotted key.
 * Place names (stops, communes) are data and stay in the local language.
 */

/** Languages with a complete file in src/i18n/, French first (reference and fallback). */
export const LANGUAGES = ['fr'];

/** @typedef {{[key: string]: string | Messages}} Messages */

/** @type {Messages} */
let messages = {};
/** Missing keys throw on a development host and show `[key]` elsewhere. */
let strict = true;
/** Placeholders available to every text, such as the key labels (`{keyAccelerate}`). */
let globals = {};

/**
 * Language for the player: `?lang=` in the URL, else the first supported browser language, else French.
 * @param {string} search URL query string @param {readonly string[]} preferred browser languages
 */
export function pickLanguage(search, preferred) {
  const wanted = [new URLSearchParams(search).get('lang') || '', ...preferred];
  for (const tag of wanted) {
    const base = tag.toLowerCase().split('-')[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return LANGUAGES[0];
}

/** @param {Messages} dict @param {{strict?: boolean}} [options] */
export function setMessages(dict, options = {}) {
  messages = dict;
  strict = options.strict ?? true;
}

/** @param {Record<string, string>} params placeholders filled in every text unless a call overrides them */
export function setGlobalParams(params) {
  globals = params;
}

/** @param {string} key @returns {string | undefined} */
function lookup(key) {
  /** @type {string | Messages | undefined} */
  let node = messages;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  return typeof node === 'string' ? node : undefined;
}

/**
 * Translated text for `key`, with `{name}` placeholders replaced by `params`.
 * @param {string} key dotted path, e.g. "toast.missedStop" @param {Record<string, string | number>} [params]
 */
export function t(key, params = {}) {
  const text = lookup(key);
  if (text === undefined) {
    if (strict) throw new Error(`missing translation: ${key}`);
    return `[${key}]`;
  }
  /** @type {Record<string, string | number>} */
  const all = { ...globals, ...params };
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in all ? String(all[name]) : whole));
}

/**
 * Key labels of the player's keyboard layout (#44), as placeholders. The browser layout map
 * (`navigator.keyboard`, Chromium only) may be missing or refused (e.g. in a frame); the layout is then
 * guessed from the language.
 * @param {import('../common/keys.js').Bindings} [bindings] @returns {Promise<Record<string, string>>}
 */
export async function keyLabelParams(bindings = BINDINGS) {
  /** @type {{getLayoutMap?: () => Promise<Map<string, string>>} | undefined} */
  const keyboard = /** @type {any} */ (navigator).keyboard;
  /** @type {Map<string, string> | null} */
  let layoutMap = null;
  if (keyboard?.getLayoutMap) layoutMap = await keyboard.getLayoutMap().catch(() => null);
  const layout = guessLayout(navigator.languages);
  return keyPlaceholders((code) => keyLabel(code, layoutMap, layout, (c) => lookup('keys.' + c)), bindings);
}

/**
 * Fill the static texts of a page: `data-i18n` (text), `data-i18n-html` (our own markup, never user data)
 * and `data-i18n-title` (tooltip).
 * @param {ParentNode} root
 */
export function translatePage(root) {
  for (const el of root.querySelectorAll('[data-i18n]'))
    el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n || '');
  for (const el of root.querySelectorAll('[data-i18n-html]'))
    el.innerHTML = t(/** @type {HTMLElement} */ (el).dataset.i18nHtml || '');
  for (const el of root.querySelectorAll('[data-i18n-title]'))
    /** @type {HTMLElement} */ (el).title = t(/** @type {HTMLElement} */ (el).dataset.i18nTitle || '');
}

/**
 * Load the player's language file and translate the page; resolves once texts are ready.
 * @param {{language?: string, bindings?: import('../common/keys.js').Bindings}} [options] language chosen in
 * the settings ('' or none: the browser's), and the player's key bindings for the key labels
 */
export async function initI18n(options = {}) {
  const preferred = options.language ? [options.language, ...navigator.languages] : navigator.languages;
  const lang = pickLanguage(location.search, preferred);
  const res = await fetch(new URL(`./${lang}.json`, import.meta.url));
  if (!res.ok) throw new Error(`language file ${lang}.json: HTTP ${res.status}`);
  const dev = ['localhost', '127.0.0.1'].includes(location.hostname);
  setMessages(await res.json(), { strict: dev });
  setGlobalParams(await keyLabelParams(options.bindings));
  document.documentElement.lang = lang;
  translatePage(document);
}
