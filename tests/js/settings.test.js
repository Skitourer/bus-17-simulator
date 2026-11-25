// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, parseSettings, settingPaths } from '../../src/settings/settings.js';
import game from '../../src/settings/game.json';

/**
 * Source of every game module, except the settings module itself, read by Vite (no Node types needed).
 * @type {Record<string, string>}
 */
const RAW_SOURCES =
  // @ts-expect-error import.meta.glob is typed by vite/client, which this project does not load
  import.meta.glob(['../../src/**/*.js', '!../../src/settings/**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  });
const SOURCES = Object.entries(RAW_SOURCES).map(([file, text]) => ({ file, text }));

/** @param {unknown} entry a single documented entry under `group.key` */
const withEntry = (entry) => ({ group: { key: entry } });

const NUMBER = { value: 2, unit: 'm', min: 0, max: 5, doc: 'A length.' };

describe('game.json', () => {
  it('is valid and documents every parameter', () => {
    expect(() => parseSettings(game)).not.toThrow();
  });

  it('gives plain values', () => {
    const settings = parseSettings(game);
    expect(settings.drive.maxSpeed).toBe(game.drive.maxSpeed.value);
    expect(settings.render.fogColor).toBe(game.render.fogColor.value);
  });

  it.each(settingPaths(game))('%s is used by the game', (path) => {
    const name = /** @type {string} */ (path.split('.').pop());
    // read as a property (`settings.drive.maxSpeed`) or destructured (`const { maxSpeed } = drive`)
    const read = new RegExp(`\\.${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`);
    expect(SOURCES.some(({ text }) => read.test(text))).toBe(true);
  });

  it('reads every module of src/', () => {
    expect(SOURCES.map(({ file }) => file)).toContain('../../src/hd2d/drive.js');
  });

  it('leaves no tunable numeric constant in the code', () => {
    // a module-level UPPER_CASE name bound to a plain number (or arithmetic on numbers)
    const constant = /^(?:export )?const ([A-Z][A-Z0-9_]*) = -?[\d.]+(?:\s*[-+*/]\s*[\d.]+)*\s*[;,]/gm;
    // not tunable: texture coordinates of the plain wall texel of the facade texture
    const allowed = ['PLAIN_U'];
    const found = SOURCES.flatMap(({ text }) => [...text.matchAll(constant)].map((m) => m[1]));
    expect(found.filter((name) => !allowed.includes(name))).toEqual([]);
  });
});

describe('parseSettings', () => {
  it('accepts numbers, integers and colours', () => {
    const file = {
      a: { length: NUMBER, count: { ...NUMBER, value: 3, integer: true } },
      fog: { value: '#A0b1c2', unit: 'colour', doc: 'Fog.', source: 'Art' },
    };
    expect(parseSettings(file)).toEqual({ a: { length: 2, count: 3 }, fog: '#A0b1c2' });
  });

  it.each([
    ['out of range', { ...NUMBER, value: 9 }, 'group.key: 9 is outside [0, 5]'],
    ['not a number', { ...NUMBER, value: true }, 'group.key: value must be a number'],
    ['not finite', { ...NUMBER, value: null }, 'group.key: value must be a number'],
    ['without range', { value: 1, unit: 'm', doc: 'x' }, 'group.key: needs numeric "min" <= "max"'],
    ['with an inverted range', { ...NUMBER, min: 5, max: 0 }, 'group.key: needs numeric "min" <= "max"'],
    ['not an integer', { ...NUMBER, value: 2.5, integer: true }, 'group.key: 2.5 is not an integer'],
    ['with a bad integer flag', { ...NUMBER, integer: 'yes' }, 'group.key: "integer" must be true or false'],
    ['without doc', { ...NUMBER, doc: ' ' }, 'group.key: missing "doc"'],
    ['without unit', { ...NUMBER, unit: undefined }, 'group.key: missing "unit"'],
    ['with a bad source', { ...NUMBER, source: 3 }, 'group.key: "source" must be text'],
    ['with an unknown field', { ...NUMBER, maximum: 3 }, 'group.key: unknown field "maximum"'],
    ['a bad colour', { value: 'red', unit: 'colour', doc: 'x' }, 'group.key: "red" is not a #rrggbb colour'],
    [
      'a colour with a range',
      { value: '#000000', unit: 'c', doc: 'x', min: 0 },
      'group.key: unknown field "min"',
    ],
    ['not an object', 3, 'group.key: expected a group or a documented entry'],
  ])('rejects an entry %s', (_case, entry, message) => {
    expect(() => parseSettings(withEntry(entry))).toThrow(message);
  });

  it('lists every problem in one error', () => {
    const file = { a: { x: { ...NUMBER, value: -1 }, y: { ...NUMBER, doc: '' } } };
    expect(() => parseSettings(file)).toThrow('settings: a.x: -1 is outside [0, 5]; a.y: missing "doc"');
  });

  it('rejects a file that is not an object', () => {
    expect(() => parseSettings([])).toThrow('settings: the file must hold a JSON object');
  });
});

describe('loadSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches and validates game.json', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => game }));
    expect((await loadSettings()).bus.wheelbase).toBe(game.bus.wheelbase.value);
  });

  it('reports a missing file', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404 }));
    await expect(loadSettings()).rejects.toThrow('settings: game.json: HTTP 404');
  });

  it('reports a file that is not JSON', async () => {
    const json = async () => {
      throw new SyntaxError('Unexpected token');
    };
    vi.stubGlobal('fetch', async () => ({ ok: true, json }));
    await expect(loadSettings()).rejects.toThrow('settings: game.json is not valid JSON (Unexpected token)');
  });
});
