// @ts-check
import { describe, expect, it } from 'vitest';
import { buildingLevels, plinthColour, wallColour } from '../../src/hd2d/facades.js';

const PARAMS = { plinthHeight: 0.2, plinthDepth: 0.5 };

/** A random stream returning the given values in turn. @param {number[]} values */
function stream(values) {
  let k = 0;
  return () => values[k++ % values.length];
}

describe('buildingLevels', () => {
  it('starts the facade at the lowest corner, not on a plinth up to the highest one', () => {
    // a 9 m building on a slope from 100 m to 103 m
    expect(buildingLevels(100, 103, 9, 0, PARAMS)).toEqual({ base: 99.5, floor: 100.2, top: 112 });
  });

  it('starts a building over a passage above the highest corner, without plinth', () => {
    expect(buildingLevels(100, 101, 12, 4.5, PARAMS)).toEqual({ base: 105.5, floor: 105.5, top: 113 });
  });

  it('never puts the facade bottom above the eaves', () => {
    expect(buildingLevels(100, 100, 0.1, 0, PARAMS).floor).toBeCloseTo(100.1);
  });
});

describe('wallColour', () => {
  const spread = { hue: 0.05, saturation: 0.1, lightness: 0.1 };

  it('keeps the palette colour when the shifts are zero', () => {
    const [r, g, b] = wallColour(['#ff0000', '#336699'], stream([0.5, 0.5, 0.5, 0.5]), spread);
    expect([r, g, b].map((v) => Math.round(v * 255))).toEqual([0x33, 0x66, 0x99]);
  });

  it('shifts hue, saturation and lightness within the spread', () => {
    const base = wallColour(['#c08040'], stream([0, 0.5, 0.5, 0.5]), spread);
    const lighter = wallColour(['#c08040'], stream([0, 0.5, 0.5, 1]), spread);
    const lightness = (/** @type {number[]} */ c) => (Math.max(...c) + Math.min(...c)) / 2;
    expect(lightness(lighter) - lightness(base)).toBeCloseTo(0.1, 5);
    const other = wallColour(['#c08040'], stream([0, 0, 0, 0]), spread);
    expect(other).not.toEqual(base);
    for (const v of other) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('keeps greys grey and wraps the hue', () => {
    const grey = wallColour(['#808080'], stream([0, 0.9, 0.5, 0.5]), spread);
    expect(grey[0]).toBeCloseTo(grey[1]);
    const red = wallColour(['#ff0000'], stream([0, 0, 0.5, 0.5]), spread);
    expect(red[2]).toBeGreaterThan(red[1]); // hue shifted just below red: towards magenta
    const green = wallColour(['#00ff00'], stream([0, 0.5, 0.5, 0.5]), spread);
    const blue = wallColour(['#0000ff'], stream([0, 0.5, 0.5, 0.5]), spread);
    expect(green[1]).toBeCloseTo(1);
    expect(blue[2]).toBeCloseTo(1);
  });
});

describe('plinthColour', () => {
  it('is darker and greyer than the wall', () => {
    const [r, g, b] = plinthColour([0.9, 0.7, 0.5], 0.25);
    expect((Math.max(r, g, b) + Math.min(r, g, b)) / 2).toBeCloseTo(0.7 * 0.75);
    expect(r - b).toBeLessThan(0.4);
    expect(r).toBeGreaterThan(b);
  });
});
