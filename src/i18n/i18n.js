// @ts-check
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

/**
 * Translated text for `key`, with `{name}` placeholders replaced by `params`.
 * @param {string} key dotted path, e.g. "toast.missedStop" @param {Record<string, string | number>} [params]
 */
export function t(key, params = {}) {
  /** @type {string | Messages | undefined} */
  let node = messages;
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') {
    if (strict) throw new Error(`missing translation: ${key}`);
    return `[${key}]`;
  }
  return node.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
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

/** Load the player's language file and translate the page; resolves once texts are ready. */
export async function initI18n() {
  const lang = pickLanguage(location.search, navigator.languages);
  const res = await fetch(new URL(`./${lang}.json`, import.meta.url));
  if (!res.ok) throw new Error(`language file ${lang}.json: HTTP ${res.status}`);
  const dev = ['localhost', '127.0.0.1'].includes(location.hostname);
  setMessages(await res.json(), { strict: dev });
  document.documentElement.lang = lang;
  translatePage(document);
}
