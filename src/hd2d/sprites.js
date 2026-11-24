// @ts-check
/**
 * Pixel-art sprites drawn by code (placeholders, replaceable by hand-drawn PNGs as long as the anchor stays
 * bottom-centre): trees, bus shelter, stop pole, and the 3x5 font of the destination sign.
 */

/** @param {number} w @param {number} h @returns {[HTMLCanvasElement, CanvasRenderingContext2D]} */
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** @param {number} seed */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- police 3x5 pour les girouettes
/** @type {Record<string, string>} */
const DIG = {
  0: '111101101101111',
  1: '010110010010111',
  2: '111001111100111',
  3: '111001111001111',
  4: '101101111001001',
  5: '111100111001111',
  6: '111100111101111',
  7: '111001010010010',
  8: '111101111101111',
  9: '111101111001111',
};
/** @param {CanvasRenderingContext2D} g @param {string} str @param {number} x @param {number} y @param {string} color */
export function digits(g, str, x, y, color) {
  g.fillStyle = color;
  for (const ch of str) {
    const m = DIG[ch];
    if (m)
      for (let i = 0; i < 15; i++) if (m[i] === '1') g.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1);
    x += 4;
  }
}

// ---------------------------------------------------------------- decor
/** @param {number} seed */
export function tree(seed) {
  const r = rng(seed);
  const [c, g] = cv(40, 64);
  g.fillStyle = '#5a4030';
  g.fillRect(18, 34, 4, 30);
  g.fillStyle = '#7a5a40';
  g.fillRect(18, 34, 1, 30);
  const blobs = 14;
  for (let pass = 0; pass < 3; pass++) {
    g.fillStyle = ['#2f5d2a', '#3f7a35', '#62a04c'][pass];
    for (let i = 0; i < blobs; i++) {
      const a = r() * Math.PI * 2,
        d = r() * 11 * (1 - pass * 0.25);
      const x = 20 + Math.cos(a) * d * 1.2 - pass,
        y = 20 + Math.sin(a) * d - pass * 2;
      const rad = 7 - pass * 1.5 + r() * 3;
      for (let yy = -rad; yy <= rad; yy++) {
        const half = Math.sqrt(rad * rad - yy * yy);
        g.fillRect(Math.round(x - half), Math.round(y + yy), Math.round(half * 2), 1);
      }
    }
  }
  return c;
}

export function shelter() {
  const [c, g] = cv(64, 44);
  g.fillStyle = '#2c3038';
  g.fillRect(2, 6, 60, 4); // toit
  g.fillStyle = '#33a457';
  g.fillRect(2, 4, 60, 2);
  g.fillStyle = 'rgba(170,210,230,0.55)';
  g.fillRect(4, 10, 56, 30); // vitres
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 8; i++) g.fillRect(10 + i, 12 + i * 2, 1, 2);
  g.fillStyle = '#4a4f58';
  for (const x of [3, 22, 41, 60]) g.fillRect(x, 6, 2, 38);
  g.fillStyle = '#e8e2cf';
  g.fillRect(44, 14, 14, 22); // affiche
  g.fillStyle = '#c0392b';
  g.fillRect(46, 16, 10, 6);
  g.fillStyle = '#5a5e66';
  g.fillRect(8, 32, 24, 3); // banc
  return c;
}

export function stopPole() {
  const [c, g] = cv(16, 64);
  g.fillStyle = '#6a6f78';
  g.fillRect(7, 14, 2, 50);
  g.fillStyle = '#ffffff';
  g.fillRect(2, 2, 12, 14);
  g.fillStyle = '#33a457';
  g.fillRect(3, 3, 10, 6);
  digits(g, '17', 4, 4, '#ffffff');
  g.fillStyle = '#222';
  g.fillRect(3, 11, 10, 1);
  g.fillRect(3, 13, 7, 1);
  return c;
}
