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
/**
 * A street tree with the foliage of the season (#70): bare branches show through as the leaves thin out.
 * @param {number} seed
 * @param {{dark: string, middle: string, light: string, leaves: number}} foliage CSS colours and leafiness 0..1
 */
export function tree(seed, foliage) {
  const r = rng(seed);
  const [c, g] = cv(40, 64);
  g.fillStyle = '#5a4030';
  g.fillRect(18, 34, 4, 30);
  g.fillStyle = '#7a5a40';
  g.fillRect(18, 34, 1, 30);
  // branches: forks from the trunk up into the crown
  g.fillStyle = '#5a4030';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.2,
      length = 10 + r() * 10;
    for (let k = 0; k < length; k++)
      g.fillRect(Math.round(20 + Math.cos(a) * k), Math.round(34 + Math.sin(a) * k * 1.1), 1, 1);
  }
  const blobs = Math.round(14 * foliage.leaves);
  for (let pass = 0; pass < 3; pass++) {
    g.fillStyle = [foliage.dark, foliage.middle, foliage.light][pass];
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

/** Colours of the people: skin tones, hair, tops and trousers (picked by seed). */
const PEOPLE = {
  skin: ['#f1c7a5', '#d9a27a', '#a8714d', '#6e4630'],
  hair: ['#2b1d14', '#5a3a22', '#c9a15a', '#8b8b8b', '#111111'],
  top: ['#c0262e', '#2f57a8', '#33a457', '#ffa41b', '#7b4fa8', '#e9e9e9', '#2a2e38'],
  legs: ['#283445', '#3a3d44', '#6b5a43', '#1f3d6b'],
};

/**
 * A standing person, 12 x 24 px (anchor bottom-centre), colours picked by `seed`.
 * @param {number} seed
 */
export function person(seed) {
  const [c, g] = cv(12, 24);
  const r = rng(seed * 7919 + 1);
  /** @param {string[]} list */
  const pick = (list) => list[Math.floor(r() * list.length)];
  const skin = pick(PEOPLE.skin),
    hair = pick(PEOPLE.hair),
    top = pick(PEOPLE.top),
    legs = pick(PEOPLE.legs);
  g.fillStyle = hair;
  g.fillRect(3, 0, 6, 3);
  g.fillStyle = skin;
  g.fillRect(3, 2, 6, 5);
  g.fillStyle = top;
  g.fillRect(2, 7, 8, 8);
  g.fillStyle = skin;
  g.fillRect(1, 9, 1, 5);
  g.fillRect(10, 9, 1, 5);
  g.fillStyle = legs;
  g.fillRect(3, 15, 6, 7);
  g.fillStyle = '#111111';
  g.fillRect(3, 22, 2, 2);
  g.fillRect(7, 22, 2, 2);
  return c;
}
