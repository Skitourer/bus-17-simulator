// @ts-check
import { describe, expect, it } from 'vitest';
import { Doors, StopService, drawRequests, random, serviceSeed } from '../../src/hd2d/stops.js';
import { SETTINGS } from './fixtures.js';

const G = SETTINGS.gameplay;

describe('stop requests', () => {
  it('draws the same requests for the same service', () => {
    expect(serviceSeed('08:00', 0)).toBe(serviceSeed('08:00', 0));
    expect(serviceSeed('08:00', 0)).not.toBe(serviceSeed('08:00', 1));
    const a = random(42),
      b = random(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(drawRequests(20, 7, G)).toEqual(drawRequests(20, 7, G));
  });

  it('follows the probabilities, with nobody off at the start and everybody off at the terminus', () => {
    const requests = drawRequests(2000, 3, G);
    const share = (/** @type {'alight' | 'board'} */ key) =>
      requests.filter((r) => r[key]).length / requests.length;
    expect(share('alight')).toBeCloseTo(G.alightProbability, 1);
    expect(share('board')).toBeCloseTo(G.boardProbability, 1);
    expect(requests[0].alight).toBe(false);
    expect(requests[requests.length - 1]).toEqual({ alight: true, board: false });
    const never = drawRequests(50, 3, { ...G, alightProbability: 0, boardProbability: 0 });
    expect(never.slice(0, -1).every((r) => !r.alight && !r.board)).toBe(true);
  });
});

describe('Doors', () => {
  it('open only when the bus is stopped, and take doorMoveTime to move', () => {
    const doors = new Doors(G);
    expect(doors.toggle(5)).toBe('tooFast');
    expect(doors.closed).toBe(true);
    expect(doors.toggle(0)).toBeNull();
    expect(doors.state).toBe('opening');
    doors.update(G.doorMoveTime / 2);
    expect(doors.open).toBe(false);
    doors.update(G.doorMoveTime / 2);
    expect(doors.open).toBe(true);
    doors.toggle(0);
    doors.update(G.doorMoveTime);
    expect(doors.closed).toBe(true);
  });

  it('reverse halfway in the time already spent, and close at once on reset', () => {
    const doors = new Doors(G);
    doors.toggle(0);
    doors.update(G.doorMoveTime * 0.25);
    doors.toggle(0); // close again after a quarter of the opening
    expect(doors.state).toBe('closing');
    doors.update(G.doorMoveTime * 0.25 + 0.001);
    expect(doors.closed).toBe(true);
    doors.toggle(0);
    doors.reset();
    expect(doors.closed).toBe(true);
    doors.update(1);
    expect(doors.closed).toBe(true);
  });
});

describe('StopService', () => {
  const stops = () => [
    { name: 'A', s: 0 },
    { name: 'B', s: 300 },
    { name: 'C', s: 600 },
  ];
  const requests = [
    { alight: false, board: true },
    { alight: false, board: false },
    { alight: true, board: false },
  ];
  const at = (/** @type {number} */ progress, doorsOpen = false, doorDistance = 100) => ({
    progress,
    doorDistance,
    doorsOpen,
    onRoute: true,
  });

  it('serves a stop once the doors stayed open long enough at it', () => {
    const service = new StopService(stops(), requests, G);
    expect(service.request).toEqual(requests[0]);
    expect(service.update(G.doorTime / 2, at(0, true, 2))).toBeNull();
    expect(service.update(G.doorTime / 2 + 0.01, at(0, true, 2))).toEqual({ type: 'served', index: 0 });
    expect(service.stops[0].served).toBe(true);
    expect(service.next).toBe(1);
  });

  it('does not serve with the doors open away from the stop', () => {
    const service = new StopService(stops(), requests, G);
    expect(service.update(10, at(0, true, G.stopDistance + 1))).toBeNull();
    expect(service.next).toBe(0);
  });

  it('counts a requested stop passed as missed, and an unrequested one as passed', () => {
    const service = new StopService(stops(), requests, G);
    expect(service.update(0.1, at(G.missedStopDistance + 1))).toEqual({ type: 'missed', index: 0 });
    expect(service.update(0.1, at(300 + G.missedStopDistance + 1))).toEqual({ type: 'passed', index: 1 });
    expect(service.stops[1].missed).toBe(false);
    expect(service.update(0.1, { ...at(700), onRoute: false })).toBeNull();
    expect(service.update(0.1, at(700))).toEqual({ type: 'missed', index: 2 });
    expect(service.update(0.1, at(800))).toBeNull();
    expect(service.request).toEqual({ alight: false, board: false });
  });

  it('restarts from a position along the route', () => {
    const service = new StopService(stops(), requests, G);
    service.reset(300);
    expect(service.next).toBe(1);
    expect(service.stops.map((st) => st.missed)).toEqual([true, false, false]);
    service.reset(1000);
    expect(service.next).toBe(3);
  });
});
