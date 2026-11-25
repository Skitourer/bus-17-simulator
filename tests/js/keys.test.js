// @ts-check
import { describe, expect, it } from 'vitest';
import { BINDINGS, guessLayout, isAction, keyLabel, keyPlaceholders } from '../../src/common/keys.js';

/** @param {string} code */
const named = (code) => ({ Space: 'Espace', ShiftLeft: 'Maj', ShiftRight: 'Maj' })[code];

describe('isAction', () => {
  it('binds physical keys, whatever the layout', () => {
    expect(isAction('accelerate', 'KeyW')).toBe(true);
    expect(isAction('accelerate', 'ArrowUp')).toBe(true);
    expect(isAction('accelerate', 'KeyZ')).toBe(false);
    expect(isAction('doors', 'Space', { ...BINDINGS, doors: ['KeyO'] })).toBe(false);
  });

  it('gives every action at least one key, and no key to two driving actions', () => {
    for (const codes of Object.values(BINDINGS)) expect(codes.length).toBeGreaterThan(0);
    const driving = [...BINDINGS.accelerate, ...BINDINGS.brake, ...BINDINGS.left, ...BINDINGS.right];
    expect(new Set(driving).size).toBe(driving.length);
  });
});

describe('guessLayout', () => {
  it('guesses AZERTY for French from France and Belgium only', () => {
    expect(guessLayout(['fr-FR', 'en'])).toBe('azerty');
    expect(guessLayout(['fr'])).toBe('azerty');
    expect(guessLayout(['fr-BE'])).toBe('azerty');
    expect(guessLayout(['fr-CA'])).toBe('qwerty');
    expect(guessLayout(['fr-CH'])).toBe('qwertz');
    expect(guessLayout(['de-DE'])).toBe('qwertz');
    expect(guessLayout(['en-GB'])).toBe('qwerty');
    expect(guessLayout([])).toBe('qwerty');
  });
});

describe('keyLabel', () => {
  it('prefers the browser layout map', () => {
    const map = new Map([['KeyW', 'z']]);
    expect(keyLabel('KeyW', map, 'qwerty', named)).toBe('Z');
  });

  it('falls back on the guessed layout, then on the QWERTY name', () => {
    expect(keyLabel('KeyW', null, 'azerty', named)).toBe('Z');
    expect(keyLabel('KeyA', new Map(), 'azerty', named)).toBe('Q');
    expect(keyLabel('KeyW', null, 'qwerty', named)).toBe('W');
    expect(keyLabel('KeyZ', null, 'qwertz', named)).toBe('Y');
    expect(keyLabel('Digit1', null, 'qwerty', named)).toBe('1');
    expect(keyLabel('Backquote', null, 'qwerty', named)).toBe('Backquote');
  });

  it('draws the arrows and names the other keys', () => {
    expect(keyLabel('ArrowLeft', null, 'qwerty', named)).toBe('←');
    expect(keyLabel('Space', null, 'qwerty', named)).toBe('Espace');
  });
});

describe('keyPlaceholders', () => {
  it('fills the help texts for an AZERTY keyboard', () => {
    const keys = keyPlaceholders((code) => keyLabel(code, null, 'azerty', named));
    expect(keys.keyAccelerate).toBe('Z / ↑');
    expect(keys.keySteer).toBe('Q D / ← →');
    expect(keys.keyMove).toBe('ZQSD / ↑←↓→');
    expect(keys.keyDoors).toBe('Espace');
    expect(keys.keyTurbo).toBe('Maj'); // both Shift keys, one label
  });

  it('fills the help texts for a QWERTY keyboard', () => {
    const keys = keyPlaceholders((code) => keyLabel(code, null, 'qwerty', named));
    expect(keys.keySteer).toBe('A D / ← →');
    expect(keys.keyMove).toBe('WASD / ↑←↓→');
  });
});
