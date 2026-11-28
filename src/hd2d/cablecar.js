// @ts-check
/**
 * The Bastille cable car (#16): the hanging cable between its supports and the two trains of cabins that
 * shuttle on it (a pulsed jig-back ropeway, "TPHP 5x6": two groups of five cabins, one on each track,
 * crossing half-way). Pure logic, metres and seconds.
 */

/** @typedef {[number, number, number]} Point3 x, y (north), z (up) */

/**
 * A cable hanging between supports: each span sags in a parabola, `sag` times its horizontal length at its
 * middle. Points are found by the distance along the ground (horizontal).
 * @param {Point3[]} supports from the lower station to the upper one @param {number} sag ratio
 */
export function cablePath(supports, sag) {
  /** @type {{ax: number, ay: number, az: number, bx: number, by: number, bz: number, length: number, start: number}[]} */
  const spans = [];
  let start = 0;
  for (let k = 0; k + 1 < supports.length; k++) {
    const [ax, ay, az] = supports[k],
      [bx, by, bz] = supports[k + 1];
    const length = Math.hypot(bx - ax, by - ay);
    spans.push({ ax, ay, az, bx, by, bz, length, start });
    start += length;
  }
  return {
    length: start,
    /**
     * Point of the cable `s` metres (horizontal) from the lower station, clamped to the ends, with the
     * heading of the line (rad, from east).
     * @param {number} s @returns {{x: number, y: number, z: number, h: number}}
     */
    at(s) {
      const d = Math.max(0, Math.min(start, s));
      const span = spans.find((p) => d <= p.start + p.length) ?? spans[spans.length - 1];
      const t = span.length > 0 ? (d - span.start) / span.length : 0;
      return {
        x: span.ax + (span.bx - span.ax) * t,
        y: span.ay + (span.by - span.ay) * t,
        z: span.az + (span.bz - span.az) * t - 4 * sag * span.length * t * (1 - t),
        h: Math.atan2(span.by - span.ay, span.bx - span.ax),
      };
    },
  };
}

/**
 * Distance of the first train from the lower station at time `t`: it climbs at `speed`, waits `dwell` at
 * the upper station, comes down and waits again; the second train is always at `length` minus that.
 * @param {number} t s @param {number} length m @param {{cableSpeed: number, cableDwell: number}} p
 */
export function shuttle(t, length, p) {
  const ride = length / p.cableSpeed,
    cycle = 2 * (ride + p.cableDwell);
  const u = ((t % cycle) + cycle) % cycle;
  if (u < ride) return u * p.cableSpeed;
  if (u < ride + p.cableDwell) return length;
  if (u < 2 * ride + p.cableDwell) return length - (u - ride - p.cableDwell) * p.cableSpeed;
  return 0;
}
