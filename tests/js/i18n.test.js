// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGES,
  initI18n,
  keyLabelParams,
  pickLanguage,
  setGlobalParams,
  setMessages,
  t,
  translatePage,
} from '../../src/i18n/i18n.js';
import fr from '../../src/i18n/fr.json';
import { BINDINGS } from '../../src/common/keys.js';

/** @typedef {import('../../src/i18n/i18n.js').Messages} Messages */

/**
 * Every leaf key with its sorted placeholders, e.g. "toast.missedStop" -> "stop".
 * @param {Messages} dict @param {string} [prefix] @returns {Record<string, string>}
 */
function shape(dict, prefix = '') {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(dict)) {
    const key = prefix + k;
    if (typeof v === 'string')
      out[key] = [...v.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    else Object.assign(out, shape(v, key + '.'));
  }
  return out;
}

describe('language files', () => {
  it.each(LANGUAGES)('%s.json has the same keys and placeholders as fr.json', async (lang) => {
    const dict = (await import(`../../src/i18n/${lang}.json`)).default;
    expect(shape(dict)).toEqual(shape(fr));
  });

  it('has no empty text', () => {
    setMessages(fr);
    for (const key of Object.keys(shape(fr))) expect(t(key).trim()).not.toBe('');
  });
});

describe('t', () => {
  afterEach(() => setMessages(fr));

  it('replaces placeholders and leaves unknown ones visible', () => {
    setMessages({ a: { b: 'Arrêt {stop} à {time}' } });
    expect(t('a.b', { stop: 'Chavant', time: '08:30' })).toBe('Arrêt Chavant à 08:30');
    expect(t('a.b', { stop: 'Chavant' })).toBe('Arrêt Chavant à {time}');
  });

  it('fills the global placeholders unless the call overrides them', () => {
    setMessages({ a: { b: '{keyDoors} {stop}' } });
    setGlobalParams({ keyDoors: 'Espace', stop: 'X' });
    expect(t('a.b', { stop: 'Chavant' })).toBe('Espace Chavant');
    setGlobalParams({});
  });

  it('fails loudly on a missing key in strict mode, shows the key otherwise', () => {
    setMessages({ a: { b: 'x' } });
    expect(() => t('a.c')).toThrow('missing translation: a.c');
    expect(() => t('a')).toThrow();
    setMessages({ a: { b: 'x' } }, { strict: false });
    expect(t('a.c')).toBe('[a.c]');
  });
});

describe('pickLanguage', () => {
  it('prefers ?lang=, then the browser languages, then French', () => {
    expect(pickLanguage('?lang=fr', ['de-DE'])).toBe('fr');
    expect(pickLanguage('', ['de-DE', 'fr-CA'])).toBe('fr');
    expect(pickLanguage('?lang=xx', ['de'])).toBe('fr');
  });
});

/** Minimal stand-in for a page: elements found by attribute selector. */
function fakePage() {
  const text = { dataset: { i18n: 'game.pause' }, textContent: '' };
  const html = { dataset: { i18nHtml: 'game.keys' }, innerHTML: '' };
  const title = { dataset: { i18nTitle: 'game.follow' }, title: '' };
  /** @type {Record<string, object[]>} */
  const bySelector = { '[data-i18n]': [text], '[data-i18n-html]': [html], '[data-i18n-title]': [title] };
  const root = /** @type {ParentNode} */ (
    /** @type {unknown} */ ({ querySelectorAll: (/** @type {string} */ s) => bySelector[s] })
  );
  return { root, text, html, title };
}

describe('translatePage and initI18n', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setMessages(fr);
  });

  it('fills text, markup and tooltips from the keys in data attributes', () => {
    setMessages(fr);
    const page = fakePage();
    translatePage(page.root);
    expect(page.text.textContent).toBe('PAUSE');
    expect(page.html.innerHTML).toContain('<b>');
    expect(page.title.title).toBe('Recentrer sur le bus');
  });

  it('loads the language file and translates the document', async () => {
    const page = fakePage();
    const documentElement = { lang: '' };
    vi.stubGlobal('location', { search: '', hostname: 'example.org' });
    vi.stubGlobal('navigator', { languages: ['fr-FR'] });
    vi.stubGlobal('document', { documentElement, querySelectorAll: page.root.querySelectorAll });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => fr }));
    await initI18n();
    expect(documentElement.lang).toBe('fr');
    expect(page.text.textContent).toBe('PAUSE');
    expect(page.html.innerHTML).toContain('<b>Z / ↑</b>');
    expect(t('no.such.key')).toBe('[no.such.key]'); // not a development host: lenient
  });

  it('labels the keys from the browser layout map, or from the language without one', async () => {
    setMessages(fr);
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      keyboard: {
        getLayoutMap: async () =>
          new Map([
            ['KeyW', 'z'],
            ['KeyA', 'q'],
            ['KeyS', 's'],
            ['KeyD', 'd'],
          ]),
      },
    });
    expect((await keyLabelParams()).keyMove).toBe('ZQSD / ↑←↓→');
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      keyboard: { getLayoutMap: () => Promise.reject(new Error('frame')) },
    });
    expect((await keyLabelParams()).keyMove).toBe('WASD / ↑←↓→');
    vi.stubGlobal('navigator', { languages: ['fr-FR'] });
    const keys = await keyLabelParams();
    expect(keys.keyMove).toBe('ZQSD / ↑←↓→');
    expect(keys.keyDoors).toBe('Espace');
  });

  it('follows the language and the keys chosen in the settings', async () => {
    const page = fakePage();
    vi.stubGlobal('location', { search: '', hostname: 'example.org' });
    vi.stubGlobal('navigator', { languages: ['en-US'] });
    vi.stubGlobal('document', {
      documentElement: { lang: '' },
      querySelectorAll: page.root.querySelectorAll,
    });
    /** @type {string[]} */
    const urls = [];
    vi.stubGlobal('fetch', async (/** @type {URL} */ url) => {
      urls.push(String(url));
      return { ok: true, json: async () => fr };
    });
    const bindings = { ...BINDINGS, accelerate: ['KeyI', 'ArrowUp'] };
    await initI18n({ language: 'fr', bindings });
    expect(urls[0]).toMatch(/fr\.json$/);
    expect(page.html.innerHTML).toContain('<b>I / ↑</b>');
  });

  it('reports a missing language file', async () => {
    vi.stubGlobal('location', { search: '', hostname: 'localhost' });
    vi.stubGlobal('navigator', { languages: [] });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    await expect(initI18n()).rejects.toThrow('fr.json: HTTP 404');
  });
});
