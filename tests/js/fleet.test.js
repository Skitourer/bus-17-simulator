// @ts-check
import { describe, expect, it } from 'vitest';
import { Fleet, projectOnTrack, scheduledPosition } from '../../src/hd2d/fleet.js';
import { SETTINGS, straightTrack } from './fixtures.js';

const params = { ...SETTINGS.fleet, dwellTime: 20, maxDwellShare: 0.4, catchUpSpeed: 14, gap: 4 };
const stops = [
  { s: 0, t: 0 },
  { s: 500, t: 100 },
  { s: 800, t: 130 },
];
const bus = { bodyLength: 12, bodyWidth: 2.55, frontDoorSetback: 0.9 };

describe('scheduledPosition', () => {
  it('is not running before the departure nor after the last dwell', () => {
    expect(scheduledPosition(stops, -1, params)).toBeNull();
    expect(scheduledPosition(stops, 151, params)).toBeNull();
    expect(scheduledPosition([], 10, params)).toBeNull();
  });

  it('dwells at the stops, then drives with a smooth start and stop', () => {
    expect(scheduledPosition(stops, 10, params)).toEqual({ s: 0, dwelling: true });
    // leaves at 20 s, arrives at 100 s: halfway in time is halfway in distance (symmetric easing)
    expect(scheduledPosition(stops, 60, params)?.s).toBeCloseTo(250);
    const early = /** @type {{s: number}} */ (scheduledPosition(stops, 30, params));
    expect(early.s).toBeLessThan(((30 - 20) / 80) * 500); // slower than constant speed after leaving
    expect(scheduledPosition(stops, 150, params)).toEqual({ s: 800, dwelling: true });
  });

  it('shortens the dwell when the next stop is close in time', () => {
    // 30 s to the next stop: at most 40 % of it (12 s) at the stop
    expect(scheduledPosition(stops, 113, params)?.dwelling).toBe(false);
    expect(scheduledPosition(stops, 111, params)?.dwelling).toBe(true);
  });
});

describe('projectOnTrack', () => {
  const track = straightTrack(400);

  it('finds the nearest point, in a window or on the whole route', () => {
    expect(projectOnTrack(track, 101, 3, 0, 0)).toMatchObject({ s: 101, d: 3 });
    expect(projectOnTrack(track, 300, 0, 100, 50).s).toBe(150); // outside the window: its edge
  });
});

/**
 * Fleet on a straight route heading east: one direction only.
 * @param {number[]} departures @param {{dir: number, dep: number}} [own]
 * @param {import('../../src/hd2d/fleet.js').FleetSignals | null} [signals] lights of a stop line 600 m along
 */
function fleetOf(departures, own = { dir: 0, dep: -1 }, signals = null) {
  const track = straightTrack(2000);
  track.stops = [
    { name: 'A', commune: 'V', s: 0, off: 0, x: 0, y: 0, t: 0 },
    { name: 'B', commune: 'V', s: 1800, off: 0, x: 1800, y: 0, t: 300 },
  ];
  const lines = [{ s: 600, group: 0, phase: /** @type {0 | 1} */ (0) }];
  return new Fleet([{ track, departures, lane: () => 0, lines }], params, bus, own, signals);
}

const far = { x: 0, y: 5000, h: 0, length: 12 };

describe('Fleet', () => {
  it('runs the services of the day, except the player own one', () => {
    const fleet = fleetOf([0, 100, 1000], { dir: 0, dep: 100 });
    fleet.update(150, 0.1, far);
    expect(fleet.buses.map((b) => b.dep)).toEqual([0]);
    expect(fleet.buses[0].x).toBeGreaterThan(0);
    expect(fleet.buses[0].h).toBeCloseTo(0);
  });

  it('waits behind the player bus in its lane, then catches up with its timetable', () => {
    const fleet = fleetOf([0]);
    fleet.update(30, 0.1, far);
    const start = fleet.buses[0].s;
    // the player stands 60 m ahead, in the lane, heading the same way
    const player = { x: start + 60, y: 0, h: 0, length: 12 };
    for (let t = 30; t < 90; t += 0.1) fleet.update(t, 0.1, player);
    const waiting = fleet.buses[0];
    // within one route step (2 m): the player is found at the nearest route point
    expect(Math.abs(waiting.s + bus.frontDoorSetback - (player.x - 6 - params.gap))).toBeLessThanOrEqual(2);
    // the player leaves: the bus catches up at catchUpSpeed at most
    fleet.update(90.1, 0.1, far);
    expect(fleet.buses[0].s - waiting.s).toBeLessThanOrEqual(params.catchUpSpeed * 0.1 + 1e-9);
    expect(fleet.buses[0].s).toBeGreaterThan(waiting.s);
  });

  it('is not blocked by a player heading the other way, and keeps behind the bus ahead', () => {
    const fleet = fleetOf([0, 30]);
    fleet.update(25, 0.1, far);
    const lead = fleet.buses.find((b) => b.dep === 0);
    const player = { x: (lead?.s ?? 0) + 30, y: 0, h: Math.PI, length: 12 };
    for (let t = 25; t < 60; t += 0.1) fleet.update(t, 0.1, player);
    expect(fleet.buses.find((b) => b.dep === 0)?.s).toBeGreaterThan(player.x);
    const [first, second] = fleet.buses;
    expect(first.s - second.s).toBeGreaterThanOrEqual(bus.bodyLength + params.gap - 1e-6);
  });

  it('never appears on top of the player, and stops the player bus', () => {
    const fleet = fleetOf([0]);
    fleet.update(5, 0.1, { x: -5, y: 0, h: 0, length: 12 });
    expect(fleet.buses).toHaveLength(0);
    fleet.update(5.1, 0.1, far);
    const b = fleet.buses[0];
    expect(fleet.hit(b.x, b.y)).toBe(true);
    expect(fleet.hit(b.x + 5.9, b.y + 1.2)).toBe(true);
    expect(fleet.hit(b.x + 6.1, b.y)).toBe(false);
    expect(fleet.hit(b.x, b.y + 1.3)).toBe(false);
  });

  it('waits at the stop line of a red light, then goes on when it turns green', () => {
    /** @type {import('../../src/hd2d/signals.js').Light} */
    let light = 'red';
    const fleet = fleetOf([0], undefined, { light: () => light, braking: 1.5, maxBraking: 4, atLine: 0.5 });
    for (let t = 30; t < 200; t += 0.1) fleet.update(t, 0.1, far);
    const waiting = fleet.buses[0];
    expect(waiting.s + bus.frontDoorSetback).toBeCloseTo(600, 0);
    expect(waiting.v).toBeCloseTo(0);
    // standing at the line: brake lights on (#87)
    expect(waiting.braking).toBe(true);
    light = 'green';
    fleet.update(200.1, 0.1, far);
    expect(fleet.buses[0].s).toBeGreaterThan(waiting.s);
    // driving off: brake lights off
    for (let t = 200.2; t < 203; t += 0.1) fleet.update(t, 0.1, far);
    expect(fleet.buses[0].braking).toBe(false);
  });
});
