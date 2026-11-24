// @ts-check
/**
 * Bus standard 12 m en volume, habille de textures pixel art (8 px par metre).
 * Repere du modele : +X = avant, +Y = haut, +Z = cote droit (portes). Origine = essieu arriere, au sol.
 */
import * as THREE from 'three';
import { digits } from '../render/sprites.js';

export const BUS = { L: 12, W: 2.55, H: 3.1, REAR: 3.0, WB: 6.0 }; // longueur, largeur, hauteur, porte-a-faux arriere, empattement
const PPM = 8;
const C = {
  white: '#f1f1ec',
  shade: '#d4d7dc',
  glass: '#1c2a42',
  glassHi: '#4a6890',
  green: '#33a457',
  dgreen: '#1f6e38',
  dark: '#2a2e38',
  door: '#283445',
  red: '#c0262e',
  redHi: '#ff4b3e',
  amber: '#ffa41b',
  light: '#fff6cf',
  bumper: '#3a3d44',
};

function tex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** flanc : `doors` = cote droit (portes avant, milieu, arriere) */
function side(doors) {
  return tex(BUS.L * PPM, Math.round(BUS.H * PPM), (g, w, h) => {
    g.fillStyle = C.white;
    g.fillRect(0, 0, w, h);
    g.fillStyle = C.shade;
    g.fillRect(0, 0, w, 2);
    // vitres
    g.fillStyle = C.glass;
    g.fillRect(2, 4, w - 4, 9);
    g.fillStyle = C.dark;
    for (let x = 2; x < w; x += 13) g.fillRect(x, 4, 1, 9);
    g.fillStyle = C.glassHi;
    for (let x = 6; x < w; x += 13) g.fillRect(x, 5, 3, 1);
    // bandeau de livree
    g.fillStyle = C.green;
    g.fillRect(0, 14, w, 3);
    g.fillStyle = C.dgreen;
    g.fillRect(0, 17, w, 1);
    // portes (cote droit) : x en metres depuis l'avant -> la texture va de l'arriere (u=0) vers l'avant (u=1)
    if (doors) {
      for (const xm of [0.6, 5.2, 9.0]) {
        const x = Math.round((BUS.L - xm) * PPM) - 9;
        g.fillStyle = C.door;
        g.fillRect(x, 3, 9, h - 4);
        g.fillStyle = C.glassHi;
        g.fillRect(x + 1, 5, 3, 8);
        g.fillRect(x + 5, 5, 3, 8);
        g.fillStyle = C.dark;
        g.fillRect(x + 4, 3, 1, h - 4);
      }
    } else {
      g.fillStyle = C.amber;
      g.fillRect(w - 3, 18, 2, 1); // repetiteur de clignotant
    }
    // passages de roues
    g.fillStyle = C.dark;
    for (const xm of [BUS.REAR, BUS.REAR + BUS.WB]) {
      const x = Math.round(xm * PPM);
      g.fillRect(x - 6, h - 6, 12, 6);
    }
    g.fillStyle = C.bumper;
    g.fillRect(0, h - 2, w, 2);
  });
}

function front() {
  return tex(Math.round(BUS.W * PPM) * 2, Math.round(BUS.H * PPM) * 2, (g, w, h) => {
    g.fillStyle = C.white;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    g.fillRect(6, 3, w - 12, 7); // girouette
    digits(g, '17', 9, 4, C.amber);
    g.fillStyle = C.amber;
    g.fillRect(19, 6, w - 28, 1);
    g.fillRect(19, 8, w - 32, 1);
    g.fillStyle = C.glass;
    g.fillRect(2, 11, w - 4, 22); // pare-brise
    g.fillStyle = C.glassHi;
    for (let i = 0; i < 8; i++) g.fillRect(8 + i, 13 + i * 2, 2, 2);
    g.fillStyle = C.dark;
    g.fillRect(w / 2 - 1, 11, 1, 22);
    g.fillStyle = C.green;
    g.fillRect(0, 35, w, 4);
    g.fillStyle = C.light;
    g.fillRect(2, 42, 6, 4);
    g.fillRect(w - 8, 42, 6, 4); // phares
    g.fillStyle = C.amber;
    g.fillRect(2, 47, 3, 2);
    g.fillRect(w - 5, 47, 3, 2);
    g.fillStyle = C.bumper;
    g.fillRect(0, h - 4, w, 4);
  });
}

function rear(brake) {
  return tex(Math.round(BUS.W * PPM) * 2, Math.round(BUS.H * PPM) * 2, (g, w, h) => {
    g.fillStyle = C.white;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    g.fillRect(12, 3, w - 24, 7);
    digits(g, '17', w / 2 - 4, 4, C.amber);
    g.fillStyle = C.glass;
    g.fillRect(4, 12, w - 8, 15);
    g.fillStyle = C.green;
    g.fillRect(0, 30, w, 5);
    g.fillStyle = C.shade;
    for (let i = 0; i < 4; i++) g.fillRect(14, 38 + i * 2, w - 28, 1);
    g.fillStyle = brake ? C.redHi : C.red;
    g.fillRect(1, 36, 4, 9);
    g.fillRect(w - 5, 36, 4, 9);
    g.fillStyle = C.amber;
    g.fillRect(1, 33, 4, 2);
    g.fillRect(w - 5, 33, 4, 2);
    g.fillStyle = C.bumper;
    g.fillRect(0, h - 5, w, 5);
    g.fillStyle = '#e9e9e9';
    g.fillRect(w / 2 - 7, h - 4, 14, 3);
  });
}

export function makeBus() {
  const grp = new THREE.Group();
  const body = new THREE.Group(); // caisse (inclinee selon le relief et le roulis)
  grp.add(body);
  const roofTex = tex(BUS.L * PPM, Math.round(BUS.W * PPM), (g, w, h) => {
    g.fillStyle = '#e4e6ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9bdc4';
    g.fillRect(Math.round(w * 0.55), 3, 22, h - 6); // climatisation
    g.fillStyle = '#c9ccd2';
    g.fillRect(8, 4, 14, h - 8); // moteur/batteries
  });
  const rearN = rear(false),
    rearB = rear(true);
  const mats = [
    new THREE.MeshLambertMaterial({ map: front() }), // +X avant
    new THREE.MeshLambertMaterial({ map: rearN }), // -X arriere
    new THREE.MeshLambertMaterial({ map: roofTex }), // +Y toit
    new THREE.MeshLambertMaterial({ color: '#222' }), // -Y dessous
    new THREE.MeshLambertMaterial({ map: side(true) }), // +Z droit (portes)
    new THREE.MeshLambertMaterial({ map: side(false) }), // -Z gauche
  ];
  // la texture du flanc gauche est vue en miroir : on la retourne pour garder l'avant a l'avant
  mats[5].map.wrapS = THREE.RepeatWrapping;
  mats[5].map.repeat.x = -1;
  const geo = new THREE.BoxGeometry(BUS.L, BUS.H - 0.35, BUS.W);
  const box = new THREE.Mesh(geo, mats);
  box.position.set(BUS.L / 2 - BUS.REAR, 0.35 + (BUS.H - 0.35) / 2, 0);
  box.castShadow = true;
  body.add(box);
  // roues
  const wg = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10);
  wg.rotateX(Math.PI / 2);
  const wm = new THREE.MeshLambertMaterial({ color: '#151515' });
  const wheels = [];
  for (const x of [0, BUS.WB])
    for (const z of [-1.05, 1.05]) {
      const w = new THREE.Mesh(wg, wm);
      w.position.set(x, 0.5, z);
      w.castShadow = true;
      grp.add(w);
      wheels.push(w);
    }
  return {
    group: grp,
    body,
    wheels,
    setBrake(on) {
      mats[1].map = on ? rearB : rearN;
    },
  };
}
