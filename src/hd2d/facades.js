// @ts-check
/**
 * Building levels and wall colours (#16): where the facade starts on sloping ground, and the colour of each
 * building. Pure logic, metres and RGB components in [0, 1].
 */

/**
 * Heights of a building: `base` (bottom of the plinth), `floor` (bottom of the facade) and `top` (eaves).
 * The facade starts at the lowest corner, so the ground floor meets the street on the low side and goes into
 * the slope on the high side: no tall stone wall under the downhill facade. A building over a passage starts
 * `lift` above the highest corner, without plinth.
 * @param {number} zmin lowest ground height under the corners @param {number} zmax highest
 * @param {number} height building height (eaves above the highest corner)
 * @param {number} lift height of the underside above the highest corner, 0 for a building on the ground
 * @param {{plinthHeight: number, plinthDepth: number}} params
 */
export function buildingLevels(zmin, zmax, height, lift, params) {
  const top = zmax + height;
  if (lift) return { base: zmax + lift, floor: zmax + lift, top };
  return { base: zmin - params.plinthDepth, floor: Math.min(zmin + params.plinthHeight, top), top };
}

/**
 * A colour of a facade family, varied by building: a slight shift of hue, saturation and lightness, so that
 * two neighbours of the same family rarely look the same.
 * @param {string[]} palette '#rrggbb' wall colours of the family @param {() => number} random in [0, 1)
 * @param {{hue: number, saturation: number, lightness: number}} spread largest shift of each component
 * @returns {[number, number, number]}
 */
export function wallColour(palette, random, spread) {
  const [h, s, l] = hsl(hexRgb(palette[Math.floor(random() * palette.length)]));
  const shift = (/** @type {number} */ range) => (random() * 2 - 1) * range;
  return rgbOf(
    (h + shift(spread.hue) + 1) % 1,
    clamp01(s + shift(spread.saturation)),
    clamp01(l + shift(spread.lightness)),
  );
}

/**
 * Plinth colour of a building: its wall colour, darker and greyer (rendered stone or concrete).
 * @param {[number, number, number]} wall @param {number} darken share of the lightness taken away
 * @returns {[number, number, number]}
 */
export function plinthColour(wall, darken) {
  const [h, s, l] = hsl(wall);
  return rgbOf(h, s * 0.6, l * (1 - darken));
}

/** @param {number} v */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** @param {string} hex '#rrggbb' @returns {[number, number, number]} */
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** @param {[number, number, number]} rgb @returns {[number, number, number]} hue, saturation, lightness */
function hsl([r, g, b]) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2,
    d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

/** @param {number} h @param {number} s @param {number} l @returns {[number, number, number]} */
function rgbOf(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const k = (/** @type {number} */ n) => (n + h * 12) % 12;
  const f = (/** @type {number} */ n) => l - (c / 2) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
