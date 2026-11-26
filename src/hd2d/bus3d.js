// @ts-check
/**
 * Bus standard 12 m en volume, habille de textures pixel art (8 px par metre), et bus articule 18 m (#54) :
 * caisse avant, soufflet et caisse arriere qui suit l'articulation.
 * Repere du modele : +X = avant, +Y = haut, +Z = cote droit (portes). Origine = essieu arriere, au sol.
 */
import * as THREE from 'three';
import { digits } from './sprites.js';
import { makeInterior } from './interior.js';

/** @typedef {import('./trailer.js').BusGeometry} BusSettings */
const C = {
  white: '#f1f1ec',
  shade: '#d4d7dc',
  glass: '#1c2a42',
  glassHi: '#4a6890',
  green: '#33a457',
  dgreen: '#1f6e38',
  dark: '#2a2e38',
  door: '#283445',
  doorway: '#0d0f14',
  red: '#c0262e',
  redHi: '#ff4b3e',
  amber: '#ffa41b',
  light: '#fff6cf',
  bumper: '#3a3d44',
};

/** @typedef {(g: CanvasRenderingContext2D, w: number, h: number) => void} Painter */

/** @param {number} w @param {number} h @param {Painter} draw */
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

/**
 * @typedef {object} SideSpec
 * @property {number} length length of the body (m)
 * @property {number[]} doors door positions, m from the front of the body (right side); empty on the left
 * @property {number[]} arches wheel arch centres, m from the back of the body
 * @property {boolean} [open] doors drawn open (dark doorways)
 */

/** Right side doors: front, middle and rear doors of a 12 m bus (m from the front). */
const STANDARD_DOORS = [0.6, 5.2, 9.0];
/** Articulated bus: two doors on each body (m from the front of the body). */
const FRONT_BODY_DOORS = [0.6, 5.2];
const REAR_BODY_DOORS = [0.8, 5.6];

/** @param {BusSettings} bus @param {SideSpec} spec */
function side(bus, spec) {
  const PPM = bus.texturePixelsPerMetre;
  const doors = spec.doors.length > 0;
  return tex(Math.round(spec.length * PPM), Math.round(bus.bodyHeight * PPM), (g, w, h) => {
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
      for (const xm of spec.doors) {
        const x = Math.round((spec.length - xm) * PPM) - 9;
        g.fillStyle = C.door;
        g.fillRect(x, 3, 9, h - 4);
        if (spec.open) {
          g.fillStyle = C.doorway;
          g.fillRect(x + 1, 3, 7, h - 4);
          continue;
        }
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
    for (const xm of spec.arches) {
      const x = Math.round(xm * PPM);
      g.fillRect(x - 6, h - 6, 12, 6);
    }
    g.fillStyle = C.bumper;
    g.fillRect(0, h - 2, w, 2);
  });
}

/** Destination sign of the front: line number and text. @param {CanvasRenderingContext2D} g @param {number} w */
function frontSign(g, w) {
  digits(g, '17', 9, 4, C.amber);
  g.fillStyle = C.amber;
  g.fillRect(19, 6, w - 28, 1);
  g.fillRect(19, 8, w - 32, 1);
}

/** @param {CanvasRenderingContext2D} g @param {number} w @param {string} colour */
function headlights(g, w, colour) {
  g.fillStyle = colour;
  g.fillRect(2, 42, 6, 4);
  g.fillRect(w - 8, 42, 6, 4);
}

/** Line number of the rear sign. @param {CanvasRenderingContext2D} g @param {number} w */
function rearSign(g, w) {
  digits(g, '17', w / 2 - 4, 4, C.amber);
}

/** @param {CanvasRenderingContext2D} g @param {number} w @param {string} colour */
function tailLights(g, w, colour) {
  g.fillStyle = colour;
  g.fillRect(1, 36, 4, 9);
  g.fillRect(w - 5, 36, 4, 9);
}

/**
 * What glows at night on the front or the back (#55): black but for the lights and the destination sign.
 * @param {BusSettings} bus @param {boolean} back
 */
function glow(bus, back) {
  const PPM = bus.texturePixelsPerMetre;
  return tex(Math.round(bus.bodyWidth * PPM) * 2, Math.round(bus.bodyHeight * PPM) * 2, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    if (back) {
      rearSign(g, w);
      tailLights(g, w, C.redHi);
    } else {
      frontSign(g, w);
      headlights(g, w, '#ffffff');
    }
  });
}

/** Front and back materials of every bus, lit together at night. @type {Set<THREE.MeshLambertMaterial>} */
const glowing = new Set();

/**
 * Face of a bus with its lights, registered to glow at night.
 * @param {THREE.Texture} map @param {THREE.Texture} emissiveMap
 */
function lightedFace(map, emissiveMap) {
  const material = new THREE.MeshLambertMaterial({
    map,
    emissiveMap,
    emissive: '#ffffff',
    emissiveIntensity: 0,
  });
  glowing.add(material);
  return material;
}

/**
 * Light that glows at night with the buses' lights (the cars of the traffic, #49).
 * @param {THREE.MeshLambertMaterial} material
 */
export function glowAtNight(material) {
  glowing.add(material);
}

/**
 * Head, tail and sign lights of all the buses, 0 (off) and up.
 * @param {number} level
 */
export function setBusLights(level) {
  lightLevel = level;
  for (const material of glowing)
    material.emissiveIntensity = braking.has(material) ? Math.max(level, brakeGlow) : level;
}

/** Light level of the last setBusLights call. */
let lightLevel = 0;
/** Brightness of the brake lights, set by makeBus. */
let brakeGlow = 1;
/** Back faces whose brake lights are on. @type {Set<THREE.MeshLambertMaterial>} */
const braking = new Set();

/** @param {BusSettings} bus */
function front(bus) {
  const PPM = bus.texturePixelsPerMetre;
  return tex(Math.round(bus.bodyWidth * PPM) * 2, Math.round(bus.bodyHeight * PPM) * 2, (g, w, h) => {
    g.fillStyle = C.white;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    g.fillRect(6, 3, w - 12, 7); // girouette
    frontSign(g, w);
    g.fillStyle = C.glass;
    g.fillRect(2, 11, w - 4, 22); // pare-brise
    g.fillStyle = C.glassHi;
    for (let i = 0; i < 8; i++) g.fillRect(8 + i, 13 + i * 2, 2, 2);
    g.fillStyle = C.dark;
    g.fillRect(w / 2 - 1, 11, 1, 22);
    g.fillStyle = C.green;
    g.fillRect(0, 35, w, 4);
    headlights(g, w, C.light);
    g.fillStyle = C.amber;
    g.fillRect(2, 47, 3, 2);
    g.fillRect(w - 5, 47, 3, 2);
    g.fillStyle = C.bumper;
    g.fillRect(0, h - 4, w, 4);
  });
}

/** @param {BusSettings} bus @param {boolean} brake */
function rear(bus, brake) {
  const PPM = bus.texturePixelsPerMetre;
  return tex(Math.round(bus.bodyWidth * PPM) * 2, Math.round(bus.bodyHeight * PPM) * 2, (g, w, h) => {
    g.fillStyle = C.white;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#111';
    g.fillRect(12, 3, w - 24, 7);
    rearSign(g, w);
    g.fillStyle = C.glass;
    g.fillRect(4, 12, w - 8, 15);
    g.fillStyle = C.green;
    g.fillRect(0, 30, w, 5);
    g.fillStyle = C.shade;
    for (let i = 0; i < 4; i++) g.fillRect(14, 38 + i * 2, w - 28, 1);
    tailLights(g, w, brake ? C.redHi : C.red);
    g.fillStyle = C.amber;
    g.fillRect(1, 33, 4, 2);
    g.fillRect(w - 5, 33, 4, 2);
    g.fillStyle = C.bumper;
    g.fillRect(0, h - 5, w, 5);
    g.fillStyle = '#e9e9e9';
    g.fillRect(w / 2 - 7, h - 4, 14, 3);
  });
}

/**
 * @param {BusSettings} bus
 * @param {import('../settings/settings.js').Settings['lights']} lights
 */
export function makeBus(bus, lights) {
  brakeGlow = lights.brakeLightGlow;
  const PPM = bus.texturePixelsPerMetre;
  const grp = new THREE.Group();
  const body = new THREE.Group(); // caisse (inclinee selon le relief et le roulis)
  grp.add(body);
  const interior = makeInterior(bus);
  body.add(interior);
  const roofTex = tex(bus.bodyLength * PPM, Math.round(bus.bodyWidth * PPM), (g, w, h) => {
    g.fillStyle = '#e4e6ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9bdc4';
    g.fillRect(Math.round(w * 0.55), 3, 22, h - 6); // climatisation
    g.fillStyle = '#c9ccd2';
    g.fillRect(8, 4, 14, h - 8); // moteur/batteries
  });
  const rearN = rear(bus, false),
    rearB = rear(bus, true);
  const arches = [bus.rearOverhang, bus.rearOverhang + bus.wheelbase];
  const doors = bus.trailer ? FRONT_BODY_DOORS : STANDARD_DOORS;
  const rearMat = lightedFace(rearN, glow(bus, true));
  const joint = new THREE.MeshLambertMaterial({ color: C.bumper });
  const mats = [
    lightedFace(front(bus), glow(bus, false)), // +X avant
    bus.trailer ? joint : rearMat, // -X arriere (soufflet pour un bus articule)
    new THREE.MeshLambertMaterial({ map: roofTex }), // +Y toit
    new THREE.MeshLambertMaterial({ color: '#222' }), // -Y dessous
    new THREE.MeshLambertMaterial({ map: side(bus, { length: bus.bodyLength, doors, arches }) }), // +Z droit
    new THREE.MeshLambertMaterial({ map: leftSide(bus, { length: bus.bodyLength, doors: [], arches }) }), // -Z
  ];
  const geo = new THREE.BoxGeometry(bus.bodyLength, bus.bodyHeight - 0.35, bus.bodyWidth);
  const box = new THREE.Mesh(geo, mats);
  box.position.set(bus.bodyLength / 2 - bus.rearOverhang, 0.35 + (bus.bodyHeight - 0.35) / 2, 0);
  box.castShadow = true;
  body.add(box);
  // roues
  const wg = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 10);
  wg.rotateX(Math.PI / 2);
  const wm = new THREE.MeshLambertMaterial({ color: '#151515' });
  const wheels = [];
  for (const x of [0, bus.wheelbase])
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
    interior,
    wheels,
    trailer: bus.trailer ? makeRearBody(bus, bus.trailer, rearMat, joint, wg, wm) : null,
    /** @param {boolean} on */
    setBrake(on) {
      rearMat.map = on ? rearB : rearN;
      if (on) braking.add(rearMat);
      else braking.delete(rearMat);
      rearMat.emissiveIntensity = on ? Math.max(lightLevel, brakeGlow) : lightLevel;
    },
  };
}

/** Left side: the texture is seen mirrored, so it is flipped to keep the front at the front. @param {BusSettings} bus @param {SideSpec} spec */
function leftSide(bus, spec) {
  const texture = side(bus, spec);
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = -1;
  return texture;
}

/**
 * Bellows and rear body of an articulated bus. Frame: origin at the joint on the road, +X towards the front
 * body along the rear body, +Z right.
 * @param {BusSettings} bus @param {import('./trailer.js').TrailerGeometry} t
 * @param {THREE.MeshLambertMaterial} rearMat back face, shared with the brake lights
 * @param {THREE.MeshLambertMaterial} joint @param {THREE.BufferGeometry} wheelGeometry
 * @param {THREE.Material} wheelMaterial
 */
function makeRearBody(bus, t, rearMat, joint, wheelGeometry, wheelMaterial) {
  const PPM = bus.texturePixelsPerMetre;
  const group = new THREE.Group();
  const body = new THREE.Group(); // tilted with the ground like the front body
  group.add(body);
  const length = t.trailerWheelbase - t.bellowsLength / 2 + t.trailerRearOverhang;
  const arches = [t.trailerRearOverhang];
  const roof = tex(Math.round(length * PPM), Math.round(bus.bodyWidth * PPM), (g, w, h) => {
    g.fillStyle = '#e4e6ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9ccd2';
    g.fillRect(6, 4, 18, h - 8); // moteur (a l'arriere sur un articule pousseur)
  });
  const mats = [
    joint, // +X soufflet
    rearMat, // -X arriere
    new THREE.MeshLambertMaterial({ map: roof }),
    new THREE.MeshLambertMaterial({ color: '#222' }),
    new THREE.MeshLambertMaterial({ map: side(bus, { length, doors: REAR_BODY_DOORS, arches }) }),
    new THREE.MeshLambertMaterial({ map: leftSide(bus, { length, doors: [], arches }) }),
  ];
  const height = bus.bodyHeight - 0.35;
  const box = new THREE.Mesh(new THREE.BoxGeometry(length, height, bus.bodyWidth), mats);
  box.position.set(-t.bellowsLength / 2 - length / 2, 0.35 + height / 2, 0);
  box.castShadow = true;
  // soufflet : un peu plus etroit et plus bas que les caisses
  const bellows = new THREE.Mesh(
    new THREE.BoxGeometry(t.bellowsLength + 0.2, height - 0.3, bus.bodyWidth - 0.2),
    new THREE.MeshLambertMaterial({ color: '#30343c' }),
  );
  bellows.position.set(0, 0.35 + height / 2, 0);
  body.add(box, bellows);
  const wheels = [-1.05, 1.05].map((z) => {
    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.position.set(-t.trailerWheelbase, 0.5, z);
    wheel.castShadow = true;
    group.add(wheel);
    return wheel;
  });
  return { group, body, wheels };
}

/**
 * Look of the other buses of the line (#48), drawn instanced: the body box with the same textures, origin
 * at the middle of the bus on the road, +X forward. No wheels nor interior (seen from outside only).
 * @param {BusSettings} bus @param {boolean} open doors open (bus dwelling at a stop)
 */
export function busLook(bus, open) {
  const arches = [bus.rearOverhang, bus.rearOverhang + bus.wheelbase];
  const roof = tex(
    bus.bodyLength * bus.texturePixelsPerMetre,
    Math.round(bus.bodyWidth * bus.texturePixelsPerMetre),
    (g, w, h) => {
      g.fillStyle = '#e4e6ea';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b9bdc4';
      g.fillRect(Math.round(w * 0.55), 3, 22, h - 6);
    },
  );
  const materials = [
    lightedFace(front(bus), glow(bus, false)),
    lightedFace(rear(bus, false), glow(bus, true)),
    new THREE.MeshLambertMaterial({ map: roof }),
    new THREE.MeshLambertMaterial({ color: '#222' }),
    new THREE.MeshLambertMaterial({
      map: side(bus, { length: bus.bodyLength, doors: STANDARD_DOORS, arches, open }),
    }),
    new THREE.MeshLambertMaterial({ map: leftSide(bus, { length: bus.bodyLength, doors: [], arches }) }),
  ];
  const height = bus.bodyHeight - 0.35;
  const geometry = new THREE.BoxGeometry(bus.bodyLength, height, bus.bodyWidth);
  geometry.translate(0, 0.35 + height / 2, 0);
  return { geometry, materials };
}
