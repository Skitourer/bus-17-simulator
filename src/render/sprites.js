// @ts-check
/**
 * Sprites pixel art generes par le code (provisoires : seront remplacables par des PNG dessines a la main
 * sans toucher au moteur, tant que l'ancrage reste le meme : centre en bas).
 * Chaque sprite : { img: canvas, w: largeur monde (m), h: hauteur monde (m), fog: [canvas par niveau de brouillard] }
 */

/** @returns {[HTMLCanvasElement, CanvasRenderingContext2D]} */
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const FOG_LEVELS = 6;
/** variantes pre-embrumees (evite tout filtre couteau a l'execution) */
export function withFog(img, fogColor) {
  const out = [img];
  for (let l = 1; l < FOG_LEVELS; l++) {
    const [c, g] = cv(img.width, img.height);
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = l / FOG_LEVELS;
    g.fillStyle = fogColor;
    g.fillRect(0, 0, c.width, c.height);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- police 3x5 pour les girouettes
const DIG = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111',
};
export function digits(g, str, x, y, color) {
  g.fillStyle = color;
  for (const ch of str) {
    const m = DIG[ch];
    if (m) for (let i = 0; i < 15; i++) if (m[i] === '1') g.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1);
    x += 4;
  }
}

// ---------------------------------------------------------------- bus du joueur
const P = {
  white: '#f1f1ec', shade: '#c8ccd2', dshade: '#9aa0aa', roof: '#d9dce2', dark: '#2a2e38', glass: '#1b2944',
  glassHi: '#46638f', green: '#33a457', dgreen: '#1f6e38', red: '#b3202a', redHi: '#ff4b3e', amber: '#ffa41b',
  tyre: '#141414', rim: '#6d727b', bumper: '#373a42', plate: '#e9e9e9',
};
export const BUS_FRAMES = 5;           // indice -2..+2 (> 0 : flanc droit visible)
const BW = 56, BH = 64, BM = 34;      // face arriere (px) et marge laterale pour le flanc
export const BUS_IMG_W = BW + 2 * BM, BUS_IMG_H = BH + 12;
export const BUS_REAR_PX = BW;         // largeur de la face arriere dans l'image (pour l'echelle)

/** bandes horizontales de la caisse, en fraction de hauteur (0 = toit, 1 = bas de caisse) */
const BANDS = [
  [0.00, 0.06, 'roof'], [0.06, 0.62, 'glass'], [0.62, 0.71, 'green'], [0.71, 1.0, 'white'],
];

function drawFlank(g, k, side, top, bot, xEdge) {
  // flanc vu en perspective : colonnes de pixels interpolees vers le point de fuite (au-dessus du bus)
  const fw = Math.round(Math.abs(k) * 15);
  for (let c = 1; c <= fw; c++) {
    const u = c / (fw + 0.001);
    const x = xEdge + side * c;
    const t = top - Math.round(c * 0.08);
    const b = bot - Math.round(c * 0.42);
    const hgt = b - t;
    const pillar = (c % 9) < 2;           // montants entre les vitres
    for (const [a0, a1, col] of BANDS) {
      let color = P[col];
      if (col === 'glass') color = pillar ? P.dark : (c % 9 === 3 ? P.glassHi : P.glass);
      if (col === 'white') color = P.shade;
      if (col === 'roof') color = P.dshade;
      g.fillStyle = color;
      const y0 = t + Math.round(a0 * hgt), y1 = t + Math.round(a1 * hgt);
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    // roues du flanc (arriere puis avant)
    const wheel = (c > 3 && c < 9) || (c > fw - 6 && c < fw - 1 && fw > 18);
    if (wheel) { g.fillStyle = P.tyre; g.fillRect(x, b - 2, 1, 6 - Math.round(u * 2)); }
    // porte (avant) : bande sombre verticale
    if (fw > 18 && c > fw - 11 && c < fw - 7) { g.fillStyle = P.dark; g.fillRect(x, t + Math.round(0.08 * hgt), 1, Math.round(0.85 * hgt)); }
  }
  // toit en perspective
  g.fillStyle = P.roof;
  for (let c = 0; c <= fw; c++) {
    const x = xEdge + side * c;
    const t = top - Math.round(c * 0.08);
    g.fillRect(x, t - 1, 1, 1);
  }
}

/** @param {number} k orientation -2..2 @param {boolean} brake feux stop */
function busFrame(k, brake) {
  const [c, g] = cv(BUS_IMG_W, BUS_IMG_H);
  const x0 = BM, x1 = BM + BW, top = 8, bot = 8 + BH - 6;
  // ombre au sol
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x0 - 3 + Math.min(0, k * 6), bot + 2, BW + 6 + Math.abs(k * 9), 4);
  // roues arriere (sous le pare-chocs)
  g.fillStyle = P.tyre;
  g.fillRect(x0 + 2, bot - 2, 12, 8); g.fillRect(x1 - 14, bot - 2, 12, 8);
  // flanc visible
  if (k > 0.05) drawFlank(g, k, 1, top, bot, x1 - 1);
  if (k < -0.05) drawFlank(g, k, -1, top, bot, x0);
  // toit vu de dessus (la camera est plus haute que le bus)
  g.fillStyle = P.roof; g.fillRect(x0 + 2, top - 3, BW - 4, 3);
  g.fillStyle = P.dshade; g.fillRect(x0 + 8, top - 5, BW - 16, 2); // bloc de climatisation
  // face arriere
  const H = bot - top;
  g.fillStyle = P.white; g.fillRect(x0, top, BW, H);
  g.fillStyle = P.roof; g.fillRect(x0, top, BW, 3);
  // girouette "17"
  g.fillStyle = '#111'; g.fillRect(x0 + 14, top + 4, BW - 28, 8);
  digits(g, '17', x0 + BW / 2 - 4, top + 5, P.amber);
  // lunette arriere
  g.fillStyle = P.glass; g.fillRect(x0 + 4, top + 14, BW - 8, 16);
  g.fillStyle = P.glassHi;
  for (let i = 0; i < 6; i++) g.fillRect(x0 + 10 + i, top + 15 + i, 2, 1);
  for (let i = 0; i < 4; i++) g.fillRect(x0 + 18 + i, top + 15 + i, 1, 1);
  // bandeau de livree
  g.fillStyle = P.green; g.fillRect(x0, top + 32, BW, 6);
  g.fillStyle = P.dgreen; g.fillRect(x0, top + 37, BW, 1);
  // grille moteur
  g.fillStyle = P.shade;
  for (let i = 0; i < 4; i++) g.fillRect(x0 + 16, top + 41 + i * 2, BW - 32, 1);
  // feux arriere
  g.fillStyle = brake ? P.redHi : P.red;
  g.fillRect(x0 + 1, top + 39, 4, 10); g.fillRect(x1 - 5, top + 39, 4, 10);
  g.fillStyle = P.amber; g.fillRect(x0 + 1, top + 35, 4, 3); g.fillRect(x1 - 5, top + 35, 4, 3);
  if (brake) { g.fillStyle = P.redHi; g.fillRect(x0 + BW / 2 - 6, top + 2, 12, 1); }
  // pare-chocs et plaque
  g.fillStyle = P.bumper; g.fillRect(x0 - 1, bot - 6, BW + 2, 6);
  g.fillStyle = P.plate; g.fillRect(x0 + BW / 2 - 8, bot - 5, 16, 4);
  g.fillStyle = '#333'; g.fillRect(x0 + BW / 2 - 6, bot - 4, 12, 1); g.fillRect(x0 + BW / 2 - 6, bot - 2, 12, 1);
  // contour sombre (lisibilite pixel art)
  g.fillStyle = P.dark;
  g.fillRect(x0 - 1, top, 1, H); g.fillRect(x1, top, 1, H);
  return c;
}

export function makeBusFrames() {
  const frames = { normal: [], brake: [] };
  for (let i = 0; i < BUS_FRAMES; i++) {
    const k = i - 2;
    frames.normal.push(busFrame(k, false));
    frames.brake.push(busFrame(k, true));
  }
  return frames;
}

// ---------------------------------------------------------------- decor
export function tree(seed) {
  const r = rng(seed);
  const [c, g] = cv(40, 64);
  g.fillStyle = '#5a4030'; g.fillRect(18, 34, 4, 30);
  g.fillStyle = '#7a5a40'; g.fillRect(18, 34, 1, 30);
  const blobs = 14;
  for (let pass = 0; pass < 3; pass++) {
    g.fillStyle = ['#2f5d2a', '#3f7a35', '#62a04c'][pass];
    for (let i = 0; i < blobs; i++) {
      const a = r() * Math.PI * 2, d = r() * 11 * (1 - pass * 0.25);
      const x = 20 + Math.cos(a) * d * 1.2 - pass, y = 20 + Math.sin(a) * d - pass * 2;
      const rad = 7 - pass * 1.5 + r() * 3;
      for (let yy = -rad; yy <= rad; yy++) {
        const half = Math.sqrt(rad * rad - yy * yy);
        g.fillRect(Math.round(x - half), Math.round(y + yy), Math.round(half * 2), 1);
      }
    }
  }
  return c;
}

function lamp() {
  const [c, g] = cv(16, 64);
  g.fillStyle = '#4a4f58'; g.fillRect(7, 6, 2, 58);
  g.fillRect(7, 5, 8, 2);
  g.fillStyle = '#2c3038'; g.fillRect(11, 6, 5, 3);
  g.fillStyle = '#fff3c4'; g.fillRect(12, 9, 3, 1);
  return c;
}

export function shelter() {
  const [c, g] = cv(64, 44);
  g.fillStyle = '#2c3038'; g.fillRect(2, 6, 60, 4);          // toit
  g.fillStyle = '#33a457'; g.fillRect(2, 4, 60, 2);
  g.fillStyle = 'rgba(170,210,230,0.55)'; g.fillRect(4, 10, 56, 30);  // vitres
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 8; i++) g.fillRect(10 + i, 12 + i * 2, 1, 2);
  g.fillStyle = '#4a4f58';
  for (const x of [3, 22, 41, 60]) g.fillRect(x, 6, 2, 38);
  g.fillStyle = '#e8e2cf'; g.fillRect(44, 14, 14, 22);       // affiche
  g.fillStyle = '#c0392b'; g.fillRect(46, 16, 10, 6);
  g.fillStyle = '#5a5e66'; g.fillRect(8, 32, 24, 3);          // banc
  return c;
}

export function stopPole() {
  const [c, g] = cv(16, 64);
  g.fillStyle = '#6a6f78'; g.fillRect(7, 14, 2, 50);
  g.fillStyle = '#ffffff'; g.fillRect(2, 2, 12, 14);
  g.fillStyle = '#33a457'; g.fillRect(3, 3, 10, 6);
  digits(g, '17', 4, 4, '#ffffff');
  g.fillStyle = '#222'; g.fillRect(3, 11, 10, 1); g.fillRect(3, 13, 7, 1);
  return c;
}

const FACADES = ['#e9d9b8', '#d9c3a0', '#ece6d8', '#c9b79c', '#e3cfae', '#bfc3c7', '#d8b48f', '#efe1c6'];
function building(seed) {
  const r = rng(seed * 7919 + 13);
  const floors = 3 + Math.floor(r() * 4);
  const bays = 4 + Math.floor(r() * 4);
  const fh = 9, bw = 8;
  const w = bays * bw + 4, h = floors * fh + 10;
  const [c, g] = cv(w, h);
  const wall = FACADES[Math.floor(r() * FACADES.length)];
  g.fillStyle = wall; g.fillRect(0, 4, w, h - 4);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(w - 3, 4, 3, h - 4);   // arete ombree
  // toit
  const flat = r() < 0.6;
  g.fillStyle = flat ? '#7b7f86' : '#9a4a36';
  g.fillRect(0, 0, w, 5);
  if (!flat) { g.fillStyle = '#7a3526'; g.fillRect(0, 4, w, 1); }
  // fenetres
  const shut = r() < 0.5 ? (r() < 0.5 ? '#5f8a5a' : '#b9a07a') : null;
  for (let f = 1; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      const x = 3 + b * bw, y = 6 + (f - 1) * fh + 2;
      g.fillStyle = r() < 0.25 ? '#6d8fb3' : '#34465e';
      g.fillRect(x + 1, y, bw - 4, fh - 4);
      if (shut) { g.fillStyle = shut; g.fillRect(x, y, 1, fh - 4); g.fillRect(x + bw - 3, y, 1, fh - 4); }
      if (r() < 0.3) { g.fillStyle = '#3a3a3a'; g.fillRect(x, y + fh - 4, bw - 2, 1); } // balcon
    }
  }
  // rez-de-chaussee : commerces
  const gy = h - fh - 1;
  g.fillStyle = '#3b3f46'; g.fillRect(0, gy, w, fh + 1);
  for (let b = 0; b < bays; b++) {
    g.fillStyle = r() < 0.5 ? '#9bc0d6' : '#58738a';
    g.fillRect(3 + b * bw, gy + 2, bw - 3, fh - 2);
  }
  if (r() < 0.6) {
    const aw = ['#c0392b', '#2e86c1', '#33a457', '#d4ac0d'][Math.floor(r() * 4)];
    for (let x = 0; x < w; x++) { g.fillStyle = (x >> 2) % 2 ? aw : '#f2f2f2'; g.fillRect(x, gy - 2, 1, 3); }
  }
  return { img: c, w: w / 3, h: h / 3 };   // 3 px par metre (un etage = 9 px = 3 m)
}

export function makeSceneSprites(fogColor) {
  const S = {};
  const add = (key, img, w, h) => { S[key] = { img, w, h, fog: withFog(img, fogColor) }; };
  for (let i = 0; i < 4; i++) add('tree' + i, tree(i + 1), 7, 11);
  add('lamp', lamp(), 2, 8);
  add('shelter', shelter(), 4.6, 3.1);
  add('pole', stopPole(), 0.9, 3.4);
  for (let i = 0; i < 10; i++) { const b = building(i + 1); add('bld' + i, b.img, b.w, b.h); }
  return S;
}
