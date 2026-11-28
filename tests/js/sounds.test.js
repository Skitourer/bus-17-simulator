// @ts-check
import { describe, expect, it } from 'vitest';
import { doorSound, engineTone, masterGain, stopBell } from '../../src/hd2d/sounds.js';
import { SETTINGS } from './fixtures.js';

const A = SETTINGS.audio;

describe('engineTone', () => {
  it('idles low and quiet, and rises with the speed up to its top', () => {
    const idle = engineTone(0, 0, A);
    expect(idle).toEqual({ frequency: A.engineIdleHz, gain: A.engineIdleGain, cutoff: A.engineCutoffHz });
    expect(engineTone(A.engineTopSpeed, 0, A).frequency).toBeCloseTo(A.engineTopHz);
    expect(engineTone(2 * A.engineTopSpeed, 0, A).frequency).toBeCloseTo(A.engineTopHz);
    expect(engineTone(-A.engineTopSpeed / 2, 0, A).frequency).toBeGreaterThan(A.engineIdleHz);
  });

  it('is louder and brighter under throttle', () => {
    const pushed = engineTone(5, 1, A);
    expect(pushed.gain).toBeCloseTo(A.engineLoadGain);
    expect(pushed.cutoff).toBeCloseTo(2 * A.engineCutoffHz);
    expect(engineTone(5, 0, A).gain).toBeLessThan(pushed.gain);
  });
});

describe('masterGain', () => {
  it('follows the volume chosen in the settings', () => {
    expect(masterGain('off', A)).toBe(0);
    expect(masterGain('low', A)).toBe(A.volumeLow);
    expect(masterGain('medium', A)).toBe(A.volumeMedium);
    expect(masterGain('high', A)).toBe(A.volumeHigh);
  });
});

describe('door and bell events', () => {
  it('hisses when the doors start to open and beeps when they start to close', () => {
    expect(doorSound('closed', 'opening')).toBe('open');
    expect(doorSound('open', 'closing')).toBe('close');
    expect(doorSound('opening', 'open')).toBeNull();
    expect(doorSound('open', 'open')).toBeNull();
  });

  it('rings when someone asks for the next stop', () => {
    expect(stopBell(0, 1)).toBe(true);
    expect(stopBell(1, 2)).toBe(false);
    expect(stopBell(2, 0)).toBe(false);
  });
});
