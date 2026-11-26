// @ts-check
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  STORAGE_KEY,
  applyPreferences,
  bindingsWith,
  keyConflict,
  loadPreferences,
  parsePreferences,
  savePreferences,
} from '../../src/settings/preferences.js';
import { SETTINGS } from './fixtures.js';

describe('parsePreferences', () => {
  it('keeps valid choices and drops the rest', () => {
    const prefs = parsePreferences(
      {
        language: 'fr',
        quality: 'high',
        viewDistance: 'huge',
        difficulty: 'hard',
        keys: { accelerate: 'KeyI', turbo: 'KeyT', doors: '<script>', brake: 5 },
      },
      ['fr'],
    );
    expect(prefs).toEqual({
      language: 'fr',
      quality: 'high',
      viewDistance: 'far',
      difficulty: 'hard',
      keys: { accelerate: 'KeyI' },
      debug: false,
    });
  });

  it('turns the debug mode on only for a stored true', () => {
    expect(parsePreferences({ debug: true }, ['fr']).debug).toBe(true);
    expect(parsePreferences({ debug: 'yes' }, ['fr']).debug).toBe(false);
    expect(parsePreferences({ debug: 1 }, ['fr']).debug).toBe(false);
  });

  it('falls back to the defaults for anything but an object', () => {
    expect(parsePreferences(null, ['fr'])).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('high', ['fr'])).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ language: 'xx', keys: 3 }, ['fr'])).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('loadPreferences and savePreferences', () => {
  it('round-trips through the storage', () => {
    /** @type {Map<string, string>} */
    const data = new Map();
    const storage = {
      getItem: (/** @type {string} */ k) => data.get(k) ?? null,
      setItem: (/** @type {string} */ k, /** @type {string} */ v) => void data.set(k, v),
    };
    const prefs = { ...DEFAULT_PREFERENCES, quality: /** @type {const} */ ('low'), debug: true };
    expect(savePreferences(storage, prefs)).toBe(true);
    expect(data.has(STORAGE_KEY)).toBe(true);
    expect(loadPreferences(storage, ['fr'])).toEqual(prefs);
  });

  it('survives a missing, broken or refusing storage', () => {
    expect(loadPreferences(null, ['fr'])).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences({ getItem: () => '{broken' }, ['fr'])).toEqual(DEFAULT_PREFERENCES);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadPreferences(blocked, ['fr'])).toEqual(DEFAULT_PREFERENCES);
    expect(savePreferences(null, DEFAULT_PREFERENCES)).toBe(false);
    const full = {
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(savePreferences(full, DEFAULT_PREFERENCES)).toBe(false);
  });
});

describe('bindingsWith and keyConflict', () => {
  it('replaces the main key of an action and keeps the arrows', () => {
    const bindings = bindingsWith({ accelerate: 'KeyI', brake: 'ArrowDown' });
    expect(bindings.accelerate).toEqual(['KeyI', 'ArrowUp']);
    expect(bindings.brake).toEqual(['ArrowDown']);
    expect(bindings.doors).toEqual(['Space']);
  });

  it('finds the action already using a key, Escape included', () => {
    const bindings = bindingsWith({});
    expect(keyConflict(bindings, 'accelerate', 'Space')).toBe('doors');
    expect(keyConflict(bindings, 'accelerate', 'Escape')).toBe('menu');
    expect(keyConflict(bindings, 'accelerate', 'F9')).toBe('debug');
    expect(keyConflict(bindings, 'accelerate', 'KeyW')).toBeNull();
    expect(keyConflict(bindings, 'accelerate', 'KeyF')).toBeNull(); // debug keys are not checked
  });
});

describe('applyPreferences', () => {
  it('keeps game.json for the middle choices', () => {
    const out = applyPreferences(SETTINGS, DEFAULT_PREFERENCES);
    expect(out.render).toEqual(SETTINGS.render);
    expect(out.gameplay).toEqual(SETTINGS.gameplay);
  });

  it('applies the presets of the other choices without touching the input', () => {
    const low = applyPreferences(SETTINGS, {
      ...DEFAULT_PREFERENCES,
      quality: 'low',
      viewDistance: 'near',
      difficulty: 'easy',
    });
    expect(low.render.internalLines).toBe(SETTINGS.presets.quality.low.internalLines);
    expect(low.render.fogFar).toBe(SETTINGS.presets.viewDistance.near.fogFar);
    expect(low.gameplay.stopDistance).toBe(SETTINGS.presets.difficulty.easy.stopDistance);
    expect(low.render.fogColor).toBe(SETTINGS.render.fogColor);
    const high = applyPreferences(SETTINGS, {
      ...DEFAULT_PREFERENCES,
      quality: 'high',
      viewDistance: 'medium',
      difficulty: 'hard',
    });
    expect(high.render.shadowMapSize).toBe(SETTINGS.presets.quality.high.shadowMapSize);
    expect(high.render.viewDistance).toBe(SETTINGS.presets.viewDistance.medium.viewDistance);
    expect(high.gameplay.onTimeTolerance).toBe(SETTINGS.presets.difficulty.hard.onTimeTolerance);
    expect(SETTINGS.render.internalLines).not.toBe(low.render.internalLines);
  });

  it('orders the presets around the game.json values', () => {
    const { presets, render, gameplay } = SETTINGS;
    expect(presets.quality.low.internalLines).toBeLessThan(render.internalLines);
    expect(presets.quality.high.internalLines).toBeGreaterThan(render.internalLines);
    expect(presets.viewDistance.near.fogFar).toBeLessThan(presets.viewDistance.medium.fogFar);
    expect(presets.viewDistance.medium.fogFar).toBeLessThan(render.fogFar);
    expect(presets.viewDistance.near.fogFar).toBeLessThan(presets.viewDistance.near.viewDistance);
    expect(presets.difficulty.easy.stopDistance).toBeGreaterThan(gameplay.stopDistance);
    expect(presets.difficulty.hard.stopDistance).toBeLessThan(gameplay.stopDistance);
  });
});
