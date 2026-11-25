// @ts-check
import { describe, expect, it } from 'vitest';
import { Doors, Exchange, StopService, drawService, random, serviceSeed } from '../../src/hd2d/stops.js';
import { SETTINGS } from './fixtures.js';

const G = SETTINGS.gameplay,
  PX = SETTINGS.passengers;

/** @typedef {import('../../src/hd2d/stops.js').StopRequest} StopRequest */

describe('service draw', () => {
  it('draws the same passengers for the same service', () => {
    expect(serviceSeed('08:00', 0)).toBe(serviceSeed('08:00', 0));
    expect(serviceSeed('08:00', 0)).not.toBe(serviceSeed('08:00', 1));
    const a = random(42),
      b = random(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(drawService(20, 7, G, PX)).toEqual(drawService(20, 7, G, PX));
  });

  it('follows the probabilities and keeps the counts consistent with the people on board', () => {
    const plan = drawService(2000, 3, G, PX);
    const share = (/** @type {(r: StopRequest) => boolean} */ test) =>
      plan.stops.filter(test).length / plan.stops.length;
    expect(share((r) => r.board > 0)).toBeCloseTo(G.boardProbability, 1);
    expect(plan.stops[0].alight).toBe(0);
    expect(plan.stops.every((r) => r.board <= PX.boardMax && r.alight >= 0)).toBe(true);
    let aboard = plan.onBoard;
    for (const r of plan.stops) {
      expect(r.alight).toBeLessThanOrEqual(aboard);
      aboard += r.board - r.alight;
    }
    expect(aboard).toBe(0); // everybody got off at the terminus
    expect(plan.stops[plan.stops.length - 1].board).toBe(0);
  });

  it('has no request at all with zero probabilities, except the terminus', () => {
    const plan = drawService(30, 3, { ...G, alightProbability: 0, boardProbability: 0 }, PX);
    expect(plan.stops.slice(0, -1).every((r) => r.alight === 0 && r.board === 0)).toBe(true);
    expect(plan.stops[29].alight).toBe(plan.onBoard);
  });
});

describe('Exchange', () => {
  it('lets people off first, then on, one every interval', () => {
    const exchange = new Exchange(1);
    exchange.start(2, 1);
    expect(exchange.update(0.5)).toEqual([]);
    expect(exchange.update(0.6)).toEqual(['alight']);
    expect(exchange.update(2)).toEqual(['alight', 'board']);
    expect(exchange.done).toBe(true);
    expect(exchange.update(5)).toEqual([]);
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
  // two on board; 1 waits at A, nobody at B, everybody off at C
  const plan = () => ({
    onBoard: 2,
    stops: [
      { alight: 0, board: 1 },
      { alight: 0, board: 0 },
      { alight: 3, board: 0 },
    ],
  });
  const at = (/** @type {number} */ progress, doorsOpen = false, doorDistance = 100) => ({
    progress,
    doorDistance,
    doorsOpen,
    onRoute: true,
  });
  const make = () => new StopService(stops(), plan(), G, PX);

  it('serves a stop once everybody got on and the doors stayed open long enough', () => {
    const service = make();
    expect(service.request).toEqual({ alight: 0, board: 1 });
    let moves = service.update(PX.interval + 0.01, at(0, true, 2)).moves;
    expect(moves).toEqual(['board']);
    expect(service.onBoard).toBe(3);
    expect(service.request).toEqual({ alight: 0, board: 0 });
    const result = service.update(G.doorTime, at(0, true, 2));
    expect(result.event).toEqual({ type: 'served', index: 0 });
    expect(service.stops[0].served).toBe(true);
    expect(service.next).toBe(1);
    moves = service.update(1, at(10)).moves;
    expect(moves).toEqual([]);
  });

  it('does not serve with the doors open away from the stop', () => {
    const service = make();
    expect(service.update(10, at(0, true, G.stopDistance + 1)).event).toBeNull();
    expect(service.next).toBe(0);
  });

  it('counts a stop left with people waiting as missed, an empty one as passed', () => {
    const service = make();
    expect(service.update(0.1, at(G.missedStopDistance + 1)).event).toEqual({ type: 'missed', index: 0 });
    expect(service.update(0.1, at(300 + G.missedStopDistance + 1)).event).toEqual({
      type: 'passed',
      index: 1,
    });
    expect(service.stops[1].missed).toBe(false);
    expect(service.update(0.1, { ...at(700), onRoute: false }).event).toBeNull();
  });

  it('lets everybody off at the terminus, however many were planned', () => {
    const service = make();
    service.reset(600);
    expect(service.request).toEqual({ alight: 2, board: 0 });
    service.update(2 * PX.interval + 0.01, at(600, true, 1));
    expect(service.onBoard).toBe(0);
    expect(service.update(G.doorTime, at(600, true, 1)).event).toEqual({ type: 'served', index: 2 });
    expect(service.request).toEqual({ alight: 0, board: 0 });
    expect(service.update(1, at(700)).event).toBeNull();
  });

  it('pauses the exchange with the doors closed, and misses the stop when leaving early', () => {
    const service = make();
    service.reset(600);
    service.update(PX.interval + 0.01, at(600, true, 1));
    expect(service.request).toEqual({ alight: 1, board: 0 });
    expect(service.update(5, at(600, false, 1)).moves).toEqual([]);
    expect(service.update(0.1, at(600 + G.missedStopDistance + 1)).event).toEqual({
      type: 'missed',
      index: 2,
    });
  });

  it('restarts from a position along the route', () => {
    const service = make();
    service.reset(300);
    expect(service.next).toBe(1);
    expect(service.stops.map((st) => st.missed)).toEqual([true, false, false]);
    service.reset(1000);
    expect(service.next).toBe(3);
  });
});
