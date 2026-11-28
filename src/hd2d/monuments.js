// @ts-check
/**
 * Buildings drawn by hand (#16), from the `monuments` of data/grenoble/landmarks.json: the churches with
 * their bell towers and spires, the town hall, the cable car stations, the buildings of the Bastille fort and a
 * few others. Each block is extruded from the ground with a wall pattern of its material (stone courses,
 * bricks, windows, glazing), under a flat or gabled roof, a spire on the towers.
 */
import * as THREE from 'three';
import { gabledRoof, isGable, orientedBox } from './roofs.js';

/** @typedef {import('./ground.js').Ground} Ground */
/** @typedef {import('../settings/settings.js').Settings['monuments']} MonumentSettings */

/**
 * @typedef {object} Monument
 * @property {string} style stone, brick, concrete, glass, render or shelter
 * @property {number[][]} ring footprint [x, y] (m)
 * @property {number} height walls above the highest corner (m)
 * @property {'flat' | 'gabled'} roof @property {number} rise of a gabled roof (m) @property {number} spire (m)
 */

/** pixels per pattern repeat: the HD-2D resolution of the facades (8 px per metre for a 4 m repeat) */
const PATTERN = 32;

/** @param {(g: CanvasRenderingContext2D) => void} draw */
function pattern(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = PATTERN;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, PATTERN, PATTERN);
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Wall patterns in white and greys, tinted by the colour of each material. */
const PATTERNS = {
  /** @param {CanvasRenderingContext2D} g ashlar courses of 0.5 m, joints staggered */
  stone(g) {
    g.fillStyle = '#d6d6d6';
    for (let y = 0; y < PATTERN; y += 4) {
      g.fillRect(0, y + 3, PATTERN, 1);
      for (let x = (y / 4) % 2 ? 0 : 5; x < PATTERN; x += 10) g.fillRect(x, y, 1, 3);
    }
    g.fillStyle = '#3a3f47';
    g.fillRect(14, 6, 4, 10); // a narrow window
  },
  /** @param {CanvasRenderingContext2D} g brick courses */
  brick(g) {
    g.fillStyle = '#cfcfcf';
    for (let y = 0; y < PATTERN; y += 2) {
      g.fillRect(0, y + 1, PATTERN, 1);
      for (let x = (y / 2) % 2 ? 0 : 2; x < PATTERN; x += 4) g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = '#2f343b';
    g.fillRect(13, 4, 6, 14); // a tall arched window
    g.fillRect(14, 3, 4, 1);
  },
  /** @param {CanvasRenderingContext2D} g a band of windows every 3 m floor (12 px of the 4 m repeat) */
  concrete(g) {
    g.fillStyle = '#39414b';
    for (let y = 2; y < PATTERN; y += 12) for (let x = 1; x < PATTERN; x += 8) g.fillRect(x, y, 6, 7);
  },
  /** @param {CanvasRenderingContext2D} g glazing between steel mullions */
  glass(g) {
    g.fillStyle = '#4d5a66';
    g.fillRect(0, 0, PATTERN, PATTERN);
    g.fillStyle = '#d8dde2';
    for (let x = 0; x < PATTERN; x += 8) g.fillRect(x, 0, 1, PATTERN);
    g.fillRect(0, 15, PATTERN, 2);
  },
  /** @param {CanvasRenderingContext2D} g rendered walls with wide windows */
  render(g) {
    g.fillStyle = '#3c4652';
    for (let y = 3; y < PATTERN; y += 12) for (let x = 2; x < PATTERN; x += 16) g.fillRect(x, y, 12, 6);
    g.fillStyle = '#bfbfbf';
    for (let y = 10; y < PATTERN; y += 12) g.fillRect(0, y, PATTERN, 1);
  },
};

/**
 * Every hand-drawn building in one group.
 * @param {Ground} ground @param {Monument[]} blocks @param {MonumentSettings} p
 */
export function buildMonuments(ground, blocks, p) {
  const group = new THREE.Group();
  /** @type {Record<string, string>} */
  const wallColours = {
    stone: p.stone,
    brick: p.brick,
    concrete: p.concrete,
    glass: p.glass,
    render: p.render,
  };
  /** @type {Record<string, string>} */
  const roofColours = { slate: p.slate, tile: p.tile, flatRoof: p.flatRoof };
  /** @type {Record<string, {P: number[], U: number[]}>} wall triangles by material */
  const walls = {};
  /** @type {Record<string, number[]>} roof triangles by colour */
  const roofs = {};
  /** @param {string} key @param {number[]} tri */
  const roof = (key, ...tri) => (roofs[key] ??= []).push(...tri);
  for (const b of blocks) {
    const ring = b.ring;
    let low = Infinity,
      high = -Infinity;
    for (const [x, y] of ring) {
      const z = ground.h(x, y);
      low = Math.min(low, z);
      high = Math.max(high, z);
    }
    const base = low - 0.5,
      top = high + b.height;
    const style = b.style === 'shelter' ? 'stone' : b.style;
    const w = (walls[style] ??= { P: [], U: [] });
    // a shelter is a roof on four posts; every other block has walls all around
    if (b.style === 'shelter') posts(w, ring, base, top);
    else wallsOf(w, ring, base, top, p.textureMetres);
    const roofColour = b.style === 'brick' ? 'tile' : b.style === 'stone' ? 'slate' : 'flatRoof';
    const faces = b.roof === 'gabled' && b.rise > 0 ? gabledRoof(ring, b.rise, GABLE) : null;
    if (faces)
      for (const face of faces) {
        // the gable ends are walls of the block
        const target = isGable(face) ? null : roofColour;
        for (let k = 1; k + 1 < face.length; k++)
          for (const [x, y, z] of [face[0], face[k], face[k + 1]])
            if (target) roof(target, x, top + z, -y);
            else (w.P.push(x, top + z, -y), w.U.push(0, 0));
      }
    else flatTop(roofs, b.style === 'shelter' ? 'flatRoof' : roofColour, ring, top, b.roof === 'gabled');
    if (b.spire > 0) spire(roofs, b.style === 'brick' ? 'tile' : 'slate', ring, top, b.spire);
  }
  for (const [style, { P, U }] of Object.entries(walls)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.computeVertexNormals();
    const draw = PATTERNS[/** @type {keyof typeof PATTERNS} */ (style)] ?? PATTERNS.render;
    const colour = wallColours[style] ?? p.render;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ map: pattern(draw), color: colour, side: THREE.DoubleSide }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const [key, P] of Object.entries(roofs)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.computeVertexNormals();
    const colour = roofColours[key] ?? p.flatRoof;
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide, flatShading: true }),
    );
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** a gabled roof over any footprint: the ridge along its long axis, however irregular the outline */
const GABLE = { roofPitch: 2, roofCompactness: 0 };

/**
 * Walls of a ring from `base` to `top`, the pattern repeating every `metres`.
 * @param {{P: number[], U: number[]}} w @param {number[][]} ring @param {number} base @param {number} top
 * @param {number} metres
 */
function wallsOf(w, ring, base, top, metres) {
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i],
      [x1, y1] = ring[(i + 1) % ring.length];
    const L = Math.hypot(x1 - x0, y1 - y0);
    const u0 = u / metres,
      u1 = (u + L) / metres,
      v0 = 0,
      v1 = (top - base) / metres;
    w.P.push(x0, base, -y0, x1, base, -y1, x1, top, -y1, x0, base, -y0, x1, top, -y1, x0, top, -y0);
    w.U.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    u += L;
  }
}

/**
 * Four square posts at the corners of the smallest rectangle around a ring.
 * @param {{P: number[], U: number[]}} w @param {number[][]} ring @param {number} base @param {number} top
 */
function posts(w, ring, base, top) {
  const box = orientedBox(ring);
  const vx = -box.uy,
    vy = box.ux,
    s = 0.25;
  for (const a of [-1, 1])
    for (const c of [-1, 1]) {
      const x = box.cx + box.ux * (a * (box.length / 2 - s)) + vx * (c * (box.width / 2 - s));
      const y = box.cy + box.uy * (a * (box.length / 2 - s)) + vy * (c * (box.width / 2 - s));
      wallsOf(
        w,
        [
          [x - s, y - s],
          [x + s, y - s],
          [x + s, y + s],
          [x - s, y + s],
        ],
        base,
        top,
        4,
      );
    }
}

/**
 * Flat top of a ring (a slab 0.4 m thick for a roof that could not be gabled).
 * @param {Record<string, number[]>} roofs @param {string} key @param {number[][]} ring @param {number} top
 * @param {boolean} slab
 */
function flatTop(roofs, key, ring, top, slab) {
  const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
  const out = (roofs[key] ??= []);
  for (const t of THREE.ShapeUtils.triangulateShape(contour, []))
    for (const k of [t[0], t[2], t[1]]) out.push(ring[k][0], top + (slab ? 0.4 : 0), -ring[k][1]);
}

/**
 * A four-sided spire over the smallest rectangle around a tower.
 * @param {Record<string, number[]>} roofs @param {string} key @param {number[][]} ring @param {number} top
 * @param {number} height
 */
function spire(roofs, key, ring, top, height) {
  const box = orientedBox(ring);
  const vx = -box.uy,
    vy = box.ux;
  /** @param {number} a @param {number} c */
  const corner = (a, c) => [
    box.cx + box.ux * (a * box.length) * 0.5 + vx * (c * box.width) * 0.5,
    box.cy + box.uy * (a * box.length) * 0.5 + vy * (c * box.width) * 0.5,
  ];
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const out = (roofs[key] ??= []);
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = corners[k],
      [bx, by] = corners[(k + 1) % 4];
    out.push(ax, top, -ay, bx, top, -by, box.cx, top + height, -box.cy);
  }
}

/**
 * Whether a point lies inside a hand-drawn building (its building of the data is then left out).
 * @param {Monument[]} blocks @param {number} x @param {number} y
 */
export function insideMonument(blocks, x, y) {
  return blocks.some((b) => {
    let inside = false;
    const r = b.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i],
        [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
