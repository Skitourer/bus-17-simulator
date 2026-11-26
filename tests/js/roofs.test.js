// @ts-check
import { describe, expect, it } from 'vitest';
import { hippedRoof, orientedBox, ringArea } from '../../src/hd2d/roofs.js';

const shape = { roofPitch: 0.6, roofCompactness: 0.75 };
/** 20 m x 10 m rectangle, counter-clockwise, turned by `angle`. @param {number} [angle] */
function rectangle(angle = 0) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [
    [0, 0],
    [20, 0],
    [20, 10],
    [0, 10],
  ].map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

describe('orientedBox', () => {
  it('finds the long axis of a turned rectangle', () => {
    const box = orientedBox(rectangle(0.5));
    expect(box.length).toBeCloseTo(20);
    expect(box.width).toBeCloseTo(10);
    expect(Math.abs(box.ux * Math.cos(0.5) + box.uy * Math.sin(0.5))).toBeCloseTo(1);
    expect(box.cx).toBeCloseTo(10 * Math.cos(0.5) - 5 * Math.sin(0.5));
  });

  it('puts the long axis along the long side even when the first edge is short', () => {
    const box = orientedBox([
      [0, 0],
      [10, 0],
      [10, 30],
      [0, 30],
    ]);
    expect(box.length).toBeCloseTo(30);
    expect(Math.abs(box.uy)).toBeCloseTo(1);
  });

  it('ignores repeated points', () => {
    expect(
      orientedBox([
        [0, 0],
        [0, 0],
        [4, 0],
        [4, 2],
      ]).length,
    ).toBeCloseTo(4);
  });
});

describe('ringArea', () => {
  it('is positive counter-clockwise', () => {
    expect(ringArea(rectangle())).toBeCloseTo(200);
    expect(ringArea([...rectangle()].reverse())).toBeCloseTo(-200);
  });
});

describe('hippedRoof', () => {
  it('gives a rectangle two long faces and two hips up to a centred ridge', () => {
    const faces = /** @type {number[][][]} */ (hippedRoof(rectangle(), 2, shape));
    expect(faces.map((f) => f.length)).toEqual([4, 3, 4, 3]);
    const top = faces.flat().filter((p) => p[2] > 0);
    for (const [, y, z] of top) {
      expect(y).toBeCloseTo(5);
      expect(z).toBeCloseTo(2);
    }
    expect(Math.min(...top.map((p) => p[0]))).toBeCloseTo(5);
    expect(Math.max(...top.map((p) => p[0]))).toBeCloseTo(15);
  });

  it('is never steeper than the pitch allows', () => {
    const faces = /** @type {number[][][]} */ (hippedRoof(rectangle(), 9, shape));
    expect(Math.max(...faces.flat().map((p) => p[2]))).toBeCloseTo(3);
  });

  it('leaves L shapes and flat roofs flat', () => {
    const l = [
      [0, 0],
      [20, 0],
      [20, 4],
      [4, 4],
      [4, 20],
      [0, 20],
    ];
    expect(hippedRoof(l, 2, shape)).toBeNull();
    expect(hippedRoof(rectangle(), 0, shape)).toBeNull();
    expect(
      hippedRoof(
        [
          [0, 0],
          [1, 0],
        ],
        2,
        shape,
      ),
    ).toBeNull();
  });
});
