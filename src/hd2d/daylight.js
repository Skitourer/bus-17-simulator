// @ts-check
/**
 * Light of the scene from the sun and the moon (#55): sky, fog and ambient colours interpolated between
 * the key moments of game.json (`daylight.keys`, by sun elevation), and the one light that casts shadows,
 * the sun by day and the moon at night. Pure logic; colours are sRGB [r, g, b] in 0..1.
 */

/** @typedef {import('../settings/settings.js').Settings['daylight']} DaylightSettings */
/** @typedef {DaylightSettings['keys'][keyof DaylightSettings['keys']]} DaylightKey */
/** @typedef {[number, number, number]} Rgb */
/** @typedef {{azimuth: number, elevation: number}} Direction degrees, azimuth clockwise from north */

/** @param {string} hex "#rrggbb" @returns {Rgb} */
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** @param {Rgb} a @param {Rgb} b @param {number} f @returns {Rgb} */
const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * The two key moments around a sun elevation, highest first, and the blend from the first to the second.
 * @param {DaylightKey[]} keys sorted by decreasing elevation @param {number} elevation
 */
function bracket(keys, elevation) {
  if (elevation >= keys[0].elevation) return { a: keys[0], b: keys[0], f: 0 };
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (elevation >= b.elevation) return { a, b, f: (a.elevation - elevation) / (a.elevation - b.elevation) };
  }
  const last = keys[keys.length - 1];
  return { a: last, b: last, f: 0 };
}

/**
 * Colours and lights of the scene for a sun and a moon in the sky.
 * @param {Direction} sun @param {Direction} moon @param {number} moonLit lit fraction of the moon, 0..1
 * @param {DaylightSettings} settings
 */
export function skyLook(sun, moon, moonLit, settings) {
  const keys = Object.values(settings.keys).sort((p, q) => q.elevation - p.elevation);
  const { a, b, f } = bracket(keys, sun.elevation);
  /** @param {string} from @param {string} to */
  const colour = (from, to) => mix(rgb(from), rgb(to), f);
  /** @param {number} from @param {number} to */
  const value = (from, to) => from + (to - from) * f;
  const night = value(a.night, b.night);
  // the moon lights the night once it is a few degrees up, as much as its disc is lit
  const moonPart = settings.moonIntensity * moonLit * clamp(moon.elevation / 10, 0, 1) * night;
  const sunPart = value(a.lightIntensity, b.lightIntensity);
  const fromSun = sunPart >= moonPart;
  const source = fromSun ? sun : moon;
  const ambientIntensity = value(a.ambientIntensity, b.ambientIntensity);
  const ambientSky = colour(a.ambientSky, b.ambientSky);
  const brightest = keys[0].ambientIntensity + keys[0].lightIntensity / 2;
  const level = clamp((ambientIntensity + Math.max(sunPart, moonPart) / 2) / brightest, 0, 1);
  return {
    // sprites have no normals: white by day, darker and tinted by the sky as the light fades
    billboard: /** @type {Rgb} */ (mix([1, 1, 1], ambientSky, 1 - level).map((channel) => channel * level)),
    skyTop: colour(a.skyTop, b.skyTop),
    skyMiddle: colour(a.skyMiddle, b.skyMiddle),
    horizon: colour(a.horizon, b.horizon),
    ambientSky,
    ambientGround: colour(a.ambientGround, b.ambientGround),
    ambientIntensity,
    night,
    light: {
      colour: fromSun ? colour(a.light, b.light) : rgb(settings.moonColor),
      intensity: Math.max(sunPart, moonPart),
      azimuth: source.azimuth,
      // a light grazing the horizon would stretch the shadows across the whole map
      elevation: Math.max(source.elevation, settings.minLightElevation),
    },
  };
}

/**
 * Unit vector towards a direction of the sky, in the scene frame (x east, y up, z south).
 * @param {Direction} d @returns {[number, number, number]}
 */
export function towards(d) {
  const az = (d.azimuth * Math.PI) / 180,
    el = (d.elevation * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}
