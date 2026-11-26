// @ts-check
/**
 * Look of the landscape through the year (#70): ground, forest and foliage colours, leaves on the trees and
 * snow line, blended between the key days of game.json (`seasons.keys`), across the new year; and the
 * colour of the mountains by altitude for that look. Pure logic; colours are sRGB [r, g, b] in 0..1.
 */
import { rgb } from './daylight.js';

/** @typedef {import('../settings/settings.js').Settings['seasons']} SeasonSettings */
/** @typedef {SeasonSettings['keys'][keyof SeasonSettings['keys']]} SeasonKey */
/** @typedef {import('./daylight.js').Rgb} Rgb */

const YEAR_DAYS = 365;

/**
 * Day of the year of a date, 1 for January 1st.
 * @param {string} ymd "YYYYMMDD"
 */
export function dayOfYear(ymd) {
  const year = +ymd.slice(0, 4);
  const date = Date.UTC(year, +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  return Math.round((date - Date.UTC(year, 0, 1)) / 86400000) + 1;
}

/**
 * Date of a day of the year.
 * @param {number} year @param {number} day 1 for January 1st @returns {string} "YYYYMMDD"
 */
export function dateOfDay(year, day) {
  return new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10).replaceAll('-', '');
}

/** @param {Rgb} a @param {Rgb} b @param {number} f @returns {Rgb} */
const mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/**
 * Landscape of a day of the year.
 * @param {number} day 1..366 @param {SeasonSettings} settings
 */
export function seasonLook(day, settings) {
  const keys = Object.values(settings.keys).sort((p, q) => p.day - q.day);
  // the key day before (or on) `day` and the next one, across the new year
  let i = keys.length - 1;
  while (i >= 0 && keys[i].day > day) i--;
  const a = keys[(i + keys.length) % keys.length],
    b = keys[(i + 1) % keys.length];
  const span = (b.day - a.day + YEAR_DAYS) % YEAR_DAYS || YEAR_DAYS;
  const f = ((day - a.day + YEAR_DAYS) % YEAR_DAYS) / span;
  /** @param {string} from @param {string} to */
  const colour = (from, to) => mix(rgb(from), rgb(to), f);
  return {
    land: colour(a.land, b.land),
    park: colour(a.park, b.park),
    forest: colour(a.forest, b.forest),
    lowland: colour(a.lowland, b.lowland),
    mountainForest: colour(a.mountainForest, b.mountainForest),
    leafDark: colour(a.leafDark, b.leafDark),
    leafMiddle: colour(a.leafMiddle, b.leafMiddle),
    leafLight: colour(a.leafLight, b.leafLight),
    leaves: a.leaves + (b.leaves - a.leaves) * f,
    snowLine: a.snowLine + (b.snowLine - a.snowLine) * f,
  };
}

/** @param {number} x */
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Colour of the mountains at an altitude: lowland, forest, rock, then snow above the snow line of the
 * season, its edge moved up or down by `edge` (-1..1, a noise of the place) times `snowEdge` metres.
 * @param {number} z metres @param {number} edge -1..1 @param {ReturnType<typeof seasonLook>} look
 * @param {SeasonSettings} settings @returns {Rgb}
 */
export function mountainColour(z, edge, look, settings) {
  const rock = rgb(settings.rockColor),
    snow = rgb(settings.snowColor);
  /** @type {Rgb} */
  let base;
  if (z > settings.rockFrom) base = rock;
  else if (z > settings.treeLine)
    base = mix(look.mountainForest, rock, (z - settings.treeLine) / (settings.rockFrom - settings.treeLine));
  else
    base = mix(look.lowland, look.mountainForest, clamp01((z - settings.forestFrom) / settings.forestBlend));
  const line = look.snowLine + edge * settings.snowEdge;
  const cover = clamp01((z - line) / settings.snowFade);
  // snow lies on the ground under the trees: the forest only whitens partly
  const onTrees = z < settings.treeLine ? settings.snowOnForest : 1;
  return mix(base, snow, cover * onTrees);
}
