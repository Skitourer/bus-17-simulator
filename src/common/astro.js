// @ts-check
/**
 * Position of the sun and the moon in the sky of a place at a given instant (#55), with the low-precision
 * formulas of J. Meeus, "Astronomical Algorithms" (2nd ed., 1998): chapters 12 (sidereal time), 13
 * (horizontal coordinates), 25 (sun, about 0.01°), 47 (moon, main periodic terms only, about 0.1°) and 48
 * (illuminated fraction). Universal time stands for dynamical time (ΔT ≈ 1 min, below the precision) and
 * the moon is seen from the centre of the Earth (no parallax): enough to light a game. Pure logic.
 */

const RAD = Math.PI / 180;
/** Julian day of the Unix epoch, 1970-01-01 0h UT. */
const UNIX_EPOCH_JD = 2440587.5;
/** Julian day of the J2000.0 epoch. */
const J2000 = 2451545;

/** @param {number} deg */
const sin = (deg) => Math.sin(deg * RAD);
/** @param {number} deg */
const cos = (deg) => Math.cos(deg * RAD);
/** Angle in [0, 360). @param {number} deg */
const wrap = (deg) => ((deg % 360) + 360) % 360;

/**
 * Julian day of an instant.
 * @param {number} utcMs milliseconds since 1970-01-01 0h UT
 */
export function julianDay(utcMs) {
  return utcMs / 86400000 + UNIX_EPOCH_JD;
}

/** Julian centuries since J2000.0. @param {number} jd */
const centuries = (jd) => (jd - J2000) / 36525;

/** Obliquity of the ecliptic (Meeus 22.2, with the main nutation term), degrees. @param {number} T */
function obliquity(T) {
  const omega = 125.04 - 1934.136 * T;
  return 23.4392911 - 0.0130042 * T + 0.00256 * cos(omega);
}

/**
 * Equatorial coordinates of ecliptic ones (Meeus 13.3 and 13.4), degrees.
 * @param {number} lambda longitude @param {number} beta latitude @param {number} epsilon obliquity
 */
function equatorial(lambda, beta, epsilon) {
  const ra = Math.atan2(sin(lambda) * cos(epsilon) - Math.tan(beta * RAD) * sin(epsilon), cos(lambda));
  const dec = Math.asin(sin(beta) * cos(epsilon) + cos(beta) * sin(epsilon) * sin(lambda));
  return { ra: wrap(ra / RAD), dec: dec / RAD };
}

/**
 * Apparent right ascension and declination of the sun (Meeus chapter 25, low accuracy), degrees.
 * @param {number} jd
 */
export function sunEquatorial(jd) {
  const T = centuries(jd);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) +
    (0.019993 - 0.000101 * T) * sin(2 * M) +
    0.000289 * sin(3 * M);
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * sin(omega);
  return equatorial(lambda, 0, obliquity(T));
}

/**
 * Periodic terms of the moon (Meeus table 47.A and 47.B, terms above 0.004°): multiples of D, M, M', F
 * and the coefficient in 1e-6 degree.
 */
const MOON_LONGITUDE = [
  [0, 0, 1, 0, 6288774],
  [2, 0, -1, 0, 1274027],
  [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618],
  [0, 1, 0, 0, -185116],
  [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793],
  [2, -1, -1, 0, 57066],
  [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758],
  [0, 1, -1, 0, -40923],
  [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383],
  [2, 0, 0, -2, 15327],
  [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980],
  [4, 0, -1, 0, 10675],
  [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548],
  [2, 1, -1, 0, -7888],
  [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163],
  [1, 1, 0, 0, 4987],
  [2, -1, 1, 0, 4036],
];
const MOON_LATITUDE = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
];

/** Fundamental arguments of the moon (Meeus 47.1 to 47.5), degrees. @param {number} T */
function moonArguments(T) {
  return {
    L: 218.3164477 + 481267.88123421 * T,
    D: 297.8501921 + 445267.1114034 * T,
    M: 357.5291092 + 35999.0502909 * T,
    Mp: 134.9633964 + 477198.8675055 * T,
    F: 93.272095 + 483202.0175233 * T,
  };
}

/**
 * Sum of periodic terms; terms with the sun's anomaly M are scaled by the Earth's eccentricity factor E.
 * @param {number[][]} terms @param {ReturnType<typeof moonArguments>} a @param {number} E
 */
function periodic(terms, a, E) {
  let sum = 0;
  for (const [d, m, mp, f, c] of terms)
    sum += c * Math.pow(E, Math.abs(m)) * sin(d * a.D + m * a.M + mp * a.Mp + f * a.F);
  return sum / 1e6;
}

/**
 * Geocentric ecliptic and equatorial coordinates of the moon (Meeus chapter 47, main terms), degrees.
 * @param {number} jd
 */
export function moonEquatorial(jd) {
  const T = centuries(jd);
  const a = moonArguments(T);
  const E = 1 - 0.002516 * T;
  const lambda = wrap(a.L + periodic(MOON_LONGITUDE, a, E));
  const beta = periodic(MOON_LATITUDE, a, E);
  return { lambda, beta, ...equatorial(lambda, beta, obliquity(T)) };
}

/**
 * Illuminated fraction of the moon's disc, 0 (new moon) to 1 (full moon) (Meeus 48.4 and 48.1).
 * @param {number} jd
 */
export function moonIllumination(jd) {
  const a = moonArguments(centuries(jd));
  const phase =
    180 -
    a.D -
    6.289 * sin(a.Mp) +
    2.1 * sin(a.M) -
    1.274 * sin(2 * a.D - a.Mp) -
    0.658 * sin(2 * a.D) -
    0.214 * sin(2 * a.Mp) -
    0.11 * sin(a.D);
  return (1 + cos(phase)) / 2;
}

/** Mean sidereal time at Greenwich (Meeus 12.4), degrees. @param {number} jd */
export function siderealTime(jd) {
  const T = centuries(jd);
  return wrap(280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/**
 * Azimuth (clockwise from north) and elevation of a star seen from a place (Meeus 13.5 and 13.6), degrees.
 * @param {{ra: number, dec: number}} star @param {number} jd
 * @param {number} latitude degrees north @param {number} longitude degrees east
 */
export function horizontal(star, jd, latitude, longitude) {
  const H = siderealTime(jd) + longitude - star.ra;
  const elevation = Math.asin(sin(latitude) * sin(star.dec) + cos(latitude) * cos(star.dec) * cos(H)) / RAD;
  const azimuth = Math.atan2(
    -sin(H) * cos(star.dec),
    sin(star.dec) * cos(latitude) - cos(star.dec) * sin(latitude) * cos(H),
  );
  return { azimuth: wrap(azimuth / RAD), elevation };
}

/**
 * Sun and moon in the sky of a place at an instant: directions in degrees and the moon's lit fraction.
 * @param {number} utcMs @param {number} latitude degrees north @param {number} longitude degrees east
 */
export function skyAt(utcMs, latitude, longitude) {
  const jd = julianDay(utcMs);
  return {
    sun: horizontal(sunEquatorial(jd), jd, latitude, longitude),
    moon: horizontal(moonEquatorial(jd), jd, latitude, longitude),
    moonLit: moonIllumination(jd),
  };
}
