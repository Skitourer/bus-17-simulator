// @ts-check
import { describe, expect, it } from 'vitest';
import { IndicatorSwitch, blinkOn, carSignal, turnSide } from '../../src/hd2d/indicators.js';
import { SETTINGS } from './fixtures.js';

const I = SETTINGS.indicators;

describe('blinkOn', () => {
  it('flashes blinkRate times a second, lit for duty of each flash', () => {
    const period = 1 / I.blinkRate;
    expect(blinkOn(0, I)).toBe(true);
    expect(blinkOn(period * (I.duty + 0.01), I)).toBe(false);
    expect(blinkOn(period * 1.01, I)).toBe(true);
    expect(blinkOn(0, I, period * (I.duty + 0.01))).toBe(false);
  });
});

describe('IndicatorSwitch', () => {
  it('switches on, over and off with the two keys', () => {
    const s = new IndicatorSwitch(I);
    s.press('left');
    expect(s.side).toBe('left');
    s.press('right');
    expect(s.side).toBe('right');
    s.press('right');
    expect(s.side).toBeNull();
  });

  it('cancels itself once the wheel comes back after the turn, not before', () => {
    const s = new IndicatorSwitch(I);
    s.press('left');
    s.update(0); // straight before the turn: stays on
    s.update(-2 * I.cancelSteer); // turning the other way: stays on
    s.update(0);
    expect(s.side).toBe('left');
    s.update(2 * I.cancelSteer); // turning left
    expect(s.side).toBe('left');
    s.update(I.straightSteer / 2); // back straight
    expect(s.side).toBeNull();
    s.update(0);
    expect(s.side).toBeNull();
  });

  it('cancels a right turn on a right turn', () => {
    const s = new IndicatorSwitch(I);
    s.press('right');
    s.update(-2 * I.cancelSteer);
    s.update(0);
    expect(s.side).toBeNull();
  });
});

describe('turnSide', () => {
  it('tells left from right, and straight on', () => {
    expect(turnSide(0, Math.PI / 2, I)).toBe('left');
    expect(turnSide(0, -Math.PI / 2, I)).toBe('right');
    expect(turnSide(0, 0.1, I)).toBeNull();
    // across the ±π seam: heading west, then south-west is a left turn
    expect(turnSide(Math.PI - 0.1, -Math.PI + 0.8, I)).toBe('left');
  });
});

describe('carSignal', () => {
  it('signals the turn ahead near the junction and the turn just taken for a few metres', () => {
    expect(carSignal(I.carSignalDistance + 1, 'left', 50, null, I)).toBeNull();
    expect(carSignal(I.carSignalDistance - 1, 'left', 50, null, I)).toBe('left');
    expect(carSignal(I.carSignalDistance - 1, null, 50, null, I)).toBeNull();
    expect(carSignal(100, null, I.carSignalAfter - 1, 'right', I)).toBe('right');
    expect(carSignal(100, null, I.carSignalAfter + 1, 'right', I)).toBeNull();
  });
});
