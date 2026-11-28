// @ts-check
import { describe, expect, it } from 'vitest';
import { insideMonument } from '../../src/hd2d/monuments.js';

describe('insideMonument', () => {
  const blocks = [
    {
      style: 'stone',
      ring: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      height: 8,
      roof: /** @type {const} */ ('flat'),
      rise: 0,
      spire: 0,
    },
  ];

  it('finds the buildings of the data standing in a hand-drawn building', () => {
    expect(insideMonument(blocks, 5, 5)).toBe(true);
    expect(insideMonument(blocks, 15, 5)).toBe(false);
    expect(insideMonument([], 5, 5)).toBe(false);
  });
});
