// @ts-check
/** Fictitious routes and grids shared by the unit tests. */
import { Track } from '../../src/world/track.js';
import { parseSettings } from '../../src/settings/settings.js';
import gameSettings from '../../src/settings/game.json';

/**
 * Route through the given flat [x, y, z, ...] points, without stops.
 * @param {number[]} pts @param {number} step
 */
export function trackFromPoints(pts, step) {
  const length = (pts.length / 3 - 1) * step;
  return new Track({ id: 9, headsign: 'Test', length, pts, stops: [], services: {} }, step);
}

/**
 * Straight route heading east from (0, 0), one point every `step` metres, with a constant grade.
 * @param {number} length @param {number} [grade] m/m @param {number} [step]
 */
export function straightTrack(length, grade = 0, step = 2) {
  const pts = [];
  for (let s = 0; s <= length; s += step) pts.push(s, 0, 100 + grade * s);
  return new Track(
    {
      id: 0,
      headsign: 'Terminus Test, Ville',
      length,
      pts,
      stops: [
        { name: 'Départ', commune: 'Ville', s: 0, off: 3, x: 0, y: 0, t: 0 },
        { name: 'Milieu', commune: 'Ville', s: length / 2, off: 3, x: length / 2, y: 0, t: 60 },
      ],
      services: { svc: ['08:00'] },
    },
    step,
  );
}

/**
 * Quarter circle of radius `radius` turning left (counter-clockwise) from heading east.
 * @param {number} radius @param {number} [step]
 */
export function leftTurnTrack(radius, step = 2) {
  const pts = [];
  const n = Math.floor(((Math.PI / 2) * radius) / step);
  for (let i = 0; i <= n; i++) {
    const a = (i * step) / radius;
    pts.push(radius * Math.sin(a), radius * (1 - Math.cos(a)), 0);
  }
  return trackFromPoints(pts, step);
}

/**
 * Terrain whose elevation is 200 m + slope * x, on a fine and a coarse grid.
 * @param {number} slope m/m along x
 * @returns {import('../../src/common/types.js').TerrainData}
 */
export function tiltedTerrain(slope) {
  /** @param {number} x0 @param {number} y0 @param {number} n @param {number} step */
  const grid = (x0, y0, n, step) => {
    const dm = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) dm.push(Math.round((200 + slope * (x0 + i * step)) * 10));
    return { x0, y0, nx: n, ny: n, step, dm };
  };
  return { fine: grid(-400, -400, 21, 40), coarse: grid(-3000, -3000, 21, 300) };
}

/** @type {import('../../src/common/types.js').DriveInput} */
export const NO_INPUT = { up: false, down: false, left: false, right: false };

/** Settings of the game, validated like at start-up. */
export const SETTINGS = parseSettings(gameSettings);
