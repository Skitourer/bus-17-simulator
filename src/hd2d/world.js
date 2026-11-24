// @ts-check
/**
 * Construction du monde HD-2D a partir des donnees reelles :
 *  - relief IGN (grille fine texturee par la carte OSM peinte en pixel art + grille large pour les massifs) ;
 *  - rues OSM en rubans (chaussee, trottoirs, marquage) poses sur le relief ;
 *  - batiments OSM extrudes (facades a fenetres pixel art), arbres OSM en sprites, abris aux arrets ;
 *  - trace de la ligne 17 surligne au sol (guidage).
 * Conversion de repere : local (x est, y nord, z altitude) -> Three (X = x, Y = z, Z = -y).
 */
import * as THREE from 'three';
import { tree, shelter, stopPole } from './sprites.js';

/** @typedef {import('./ground.js').Ground} Ground */
/** @typedef {import('./ground.js').TileData} TileData */

/** @typedef {{ring: number[][], x0: number, y0: number, x1: number, y1: number}} Footprint */

/** @param {THREE.Texture} t */
const NEAREST = (t) => {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/** @param {number} w @param {number} h */
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.imageSmoothingEnabled = false;
  return { c, g };
}

/** @param {number} seed */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ relief
const GROUND = {
  land: '#a9a68c',
  park: '#7ea25a',
  forest: '#557c41',
  water: '#5d8fb5',
  tram: '#8b8377',
};

/** carte OSM peinte en texture de sol (1 pixel ~ 1,7 m) */
/** @param {import('../common/types.js').MapData | null} map @param {{x0: number, y0: number, x1: number, y1: number}} b */
function groundTexture(map, b) {
  const W = 4096,
    H = Math.round((4096 * (b.y1 - b.y0)) / (b.x1 - b.x0));
  const { c, g } = canvas(W, H);
  const sx = W / (b.x1 - b.x0),
    sy = H / (b.y1 - b.y0);
  g.setTransform(sx, 0, 0, -sy, -b.x0 * sx, b.y1 * sy);
  g.fillStyle = GROUND.land;
  g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  /** @param {number[][]} list @param {string} col */
  const poly = (list, col) => {
    g.fillStyle = col;
    g.beginPath();
    for (const p of list) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
      g.closePath();
    }
    g.fill('evenodd');
  };
  /** @param {number[][]} list @param {string} col @param {number} w */
  const lines = (list, col, w) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    for (const p of list) {
      g.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    }
    g.stroke();
  };
  if (map) {
    poly(map.polys.forest, GROUND.forest);
    poly(map.polys.park, GROUND.park);
    poly(map.polys.water, GROUND.water);
    lines(map.lines.river, GROUND.water, 30);
    lines(map.lines.rail, GROUND.tram, 5);
  }
  // grain pixel art : legeres variations aleatoires par pixel
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, W, H),
    d = img.data,
    r = rng(7);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = NEAREST(new THREE.CanvasTexture(c));
  t.anisotropy = 4;
  return t;
}

/**
 * Ground of the tiles (10 m grid shaped by the roads), one mesh per tile, triangles split like Ground.h().
 * @param {Ground} ground @param {Map<string, TileData>} tiles @param {import('../common/types.js').MapData | null} map
 */
function terrainTiles(ground, tiles, map) {
  const grp = new THREE.Group();
  const b = ground.bounds,
    ix = ground.index,
    n = ground.n;
  const mat = new THREE.MeshLambertMaterial({ map: groundTexture(map, b) });
  for (const key of tiles.keys()) {
    const [ti, tj] = key.split('_').map(Number);
    const ox = ix.x0 + ti * ix.size,
      oy = ix.y0 + tj * ix.size;
    const grid = /** @type {Float32Array} */ (ground.grids.get(key));
    const P = new Float32Array(n * n * 3),
      U = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i,
          x = ox + i * ix.step,
          y = oy + j * ix.step;
        P.set([x, grid[k], -y], k * 3);
        U.set([(x - b.x0) / (b.x1 - b.x0), (y - b.y0) / (b.y1 - b.y0)], k * 2);
      }
    const I = [];
    for (let j = 0; j + 1 < n; j++)
      for (let i = 0; i + 1 < n; i++) {
        const a = j * n + i,
          c = a + n;
        // (a, b, d) and (a, d, c): counter-clockwise seen from above (y is mapped to -z)
        I.push(a, a + 1, c + 1, a, c + 1, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.setIndex(I);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

/** @param {import('./heightfield.js').Heightfield} hf */
function terrainCoarse(hf) {
  const g = hf.coarse,
    b = hf.bounds;
  const geo = new THREE.PlaneGeometry(1, 1, g.nx - 1, g.ny - 1);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  /** @param {string} h */
  const C = (h) => new THREE.Color(h);
  const cLow = C('#93a072'),
    cForest = C('#4b6b3e'),
    cRock = C('#8c8679'),
    cSnow = C('#f3f5f8');
  const tmp = new THREE.Color();
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = (g.ny - 1 - j) * g.nx + i;
      const x = g.x0 + i * g.step,
        y = g.y0 + j * g.step;
      let z = g.dm[j * g.nx + i] / 10;
      // sous la zone fine, on enfonce la grille large (elle ne doit pas traverser la ville)
      if (x > b.x0 - 150 && x < b.x1 + 150 && y > b.y0 - 150 && y < b.y1 + 150) z -= 40;
      pos.setXYZ(k, x, z, -y);
      if (z > 2050) tmp.copy(cSnow);
      else if (z > 1750) tmp.copy(cRock).lerp(cSnow, (z - 1750) / 300);
      else if (z > 1500) tmp.copy(cForest).lerp(cRock, (z - 1500) / 250);
      else if (z > 450) tmp.copy(cLow).lerp(cForest, Math.min(1, (z - 450) / 250));
      else tmp.copy(cLow);
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

// ------------------------------------------------------------------ rues
/**
 * Height of the road mesh above the shaped ground (m). Road pieces are cut along the ground triangles
 * (tools/streets.py), so they are coplanar with the ground; the lift only avoids depth fighting.
 */
const ROAD_LIFT = 0.05;

/** asphalt texture, mapped in world metres (4 m per repeat) */
function asphaltTexture() {
  const { c, g } = canvas(32, 32);
  const r = rng(11);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const v = 88 + (r() - 0.5) * 10;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(x, y, 1, 1);
    }
  const t = NEAREST(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Carriageway of every tile, laid on the shaped ground. Junctions and roundabouts come from the union
 * made by tools/build_streets.py, so there are no overlapping ribbons.
 * @param {Ground} ground @param {Map<string, TileData>} tiles
 */
function roadSurface(ground, tiles) {
  /** @type {number[]} */
  const P = [],
    U = [],
    I = [];
  const ix = ground.index;
  for (const [key, tile] of tiles) {
    const [ti, tj] = key.split('_').map(Number);
    const ox = ix.x0 + ti * ix.size,
      oy = ix.y0 + tj * ix.size;
    for (const rings of tile.road) {
      const vec = rings.map((ring) => {
        const out = [];
        for (let k = 0; k + 1 < ring.length; k += 2)
          out.push(new THREE.Vector2(ox + ring[k] / 10, oy + ring[k + 1] / 10));
        return out;
      });
      const [contour, ...holes] = vec;
      const base = P.length / 3;
      for (const v of vec.flat()) {
        P.push(v.x, ground.h(v.x, v.y) + ROAD_LIFT, -v.y);
        U.push(v.x / 4, v.y / 4);
      }
      for (const tri of THREE.ShapeUtils.triangulateShape(contour, holes))
        I.push(base + tri[0], base + tri[2], base + tri[1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    map: asphaltTexture(),
    side: THREE.DoubleSide, // ring orientation from shapely is not guaranteed
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

/**
 * Bridge decks (flat across, straight between their ends) with parapets and piers.
 * @param {Ground} ground
 */
function bridges(ground) {
  /** @type {number[]} */
  const P = [];
  /** @type {number[]} */
  const C = [];
  const deckCol = new THREE.Color('#5f6168'),
    sideCol = new THREE.Color('#b7b2a6'),
    pierCol = new THREE.Color('#9d988c');
  /** @param {number[][]} q quad corners @param {THREE.Color} col */
  const quad = (q, col) => {
    P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    for (let k = 0; k < 6; k++) C.push(col.r, col.g, col.b);
  };
  for (const deck of ground.decks) {
    const w = deck.halfWidth;
    let sinceLastPier = 15;
    for (let i = 0; i + 1 < deck.x.length; i++) {
      const dx = deck.x[i + 1] - deck.x[i],
        dy = deck.y[i + 1] - deck.y[i];
      const L = Math.hypot(dx, dy) || 1;
      const nx = dy / L,
        ny = -dx / L; // right of the direction of travel
      /** @param {number} k @param {number} side @param {number} dz */
      const p = (k, side, dz) => [deck.x[k] + nx * w * side, deck.z[k] + dz, -(deck.y[k] + ny * w * side)];
      quad([p(i, -1, 0.05), p(i, 1, 0.05), p(i + 1, 1, 0.05), p(i + 1, -1, 0.05)], deckCol);
      for (const side of [-1, 1]) {
        // parapet (0.9 m above the deck) and deck edge (0.8 m deep); double-sided material
        quad([p(i, side, -0.8), p(i + 1, side, -0.8), p(i + 1, side, 0.95), p(i, side, 0.95)], sideCol);
      }
      sinceLastPier += L;
      const below = ground.h(deck.x[i], deck.y[i]);
      if (sinceLastPier >= 25 && deck.z[i] - below > 2.5) {
        // pier: a square column from the river bed or the road below up to the deck
        sinceLastPier = 0;
        const s = 0.6,
          cx = deck.x[i],
          cy = deck.y[i];
        const top = deck.z[i] - 0.8,
          bot = below - 1;
        const corners = [
          [cx - s, cy - s],
          [cx + s, cy - s],
          [cx + s, cy + s],
          [cx - s, cy + s],
        ];
        for (let k = 0; k < 4; k++) {
          const [ax, ay] = corners[k],
            [bx, by] = corners[(k + 1) % 4];
          quad(
            [
              [ax, bot, -ay],
              [bx, bot, -by],
              [bx, top, -by],
              [ax, top, -ay],
            ],
            pierCol,
          );
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** trace de la ligne au sol : chevrons verts (guidage, touche G) */
/** @param {Ground} hf @param {import('../world/track.js').Track} track */
function routeStrip(hf, track) {
  const P = [],
    U = [],
    I = [];
  for (let i = 0; i < track.n; i += 2) {
    const h = track.h[i],
      x = track.x[i],
      y = track.y[i];
    const nx = Math.sin(h),
      ny = -Math.cos(h);
    // decale dans la voie de droite
    const cx = x + nx * 1.8,
      cy = y + ny * 1.8;
    const lx = cx - nx * 0.9,
      ly = cy - ny * 0.9,
      rx = cx + nx * 0.9,
      ry = cy + ny * 0.9;
    P.push(lx, hf.h(lx, ly) + 0.32, -ly, rx, hf.h(rx, ry) + 0.32, -ry);
    U.push(0, (i * track.step) / 3, 1, (i * track.step) / 3);
    if (i > 0) {
      const q = (i / 2 - 1) * 2;
      I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  }
  const { c, g } = canvas(16, 16);
  g.fillStyle = '#33a457';
  for (let y = 0; y < 8; y++) {
    g.fillRect(y, 15 - y - 4, 2, 2);
    g.fillRect(14 - y, 15 - y - 4, 2, 2);
  } // chevron ^
  const tex = NEAREST(new THREE.CanvasTexture(c));
  tex.wrapT = THREE.RepeatWrapping;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -20,
    }),
  );
  m.renderOrder = 6;
  return m;
}

// ------------------------------------------------------------------ batiments
const WALLS = [
  '#e8d6b0',
  '#dcc29b',
  '#efe6d4',
  '#cdb894',
  '#e6d0aa',
  '#c3c5c6',
  '#d9b48c',
  '#f0e2c4',
  '#bfb3a3',
  '#e2c7a6',
];
/** @type {Record<number, string>} roof colour by building kind (see tools/build_buildings.py) */
const ROOFS = { 0: '#8a8d93', 1: '#a0543c', 2: '#7c8086', 3: '#6e8a95' };

function facadeTexture() {
  // une travee x un etage (3 m x 3 m) : mur blanc (teinte par couleur de sommet), fenetre, appui
  const { c, g } = canvas(16, 16);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#eeeeee';
  g.fillRect(0, 15, 16, 1);
  g.fillStyle = '#2d3a4e';
  g.fillRect(5, 4, 6, 8);
  g.fillStyle = '#5d7896';
  g.fillRect(6, 5, 2, 2);
  g.fillStyle = '#d0d0d0';
  g.fillRect(4, 12, 8, 1);
  g.fillStyle = '#9a8a74';
  g.fillRect(3, 4, 2, 8);
  g.fillRect(11, 4, 2, 8); // volets
  const t = NEAREST(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** batiments extrudes, fusionnes en deux maillages (murs, toits) ; renvoie aussi un index pour les collisions */
/** @param {Ground} hf @param {import('../common/types.js').BuildingsData} data */
function buildings(hf, data) {
  const WP = [],
    WU = [],
    WC = [],
    RP = [],
    RC = [];
  const r = rng(3);
  const col = new THREE.Color();
  const footprints = [];
  for (const b of data.b) {
    const h = b[0] / 10,
      kind = b[1];
    const ring = [];
    for (let i = 2; i < b.length; i += 2) ring.push([b[i] / 10, b[i + 1] / 10]);
    let zmin = 1e9,
      zmax = -1e9;
    for (const [x, y] of ring) {
      const z = hf.h(x, y);
      zmin = Math.min(zmin, z);
      zmax = Math.max(zmax, z);
    }
    const top = zmax + h;
    col.set(kind === 3 ? '#d8cbb0' : WALLS[Math.floor(r() * WALLS.length)]);
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i],
        [x1, y1] = ring[(i + 1) % ring.length];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const z0 = hf.h(x0, y0) - 0.5,
        z1 = hf.h(x1, y1) - 0.5;
      const u0 = u / 3,
        u1 = (u + L) / 3;
      // deux triangles (ordre anti-horaire vu de l'exterieur : l'anneau est anti-horaire)
      WP.push(x0, z0, -y0, x1, z1, -y1, x1, top, -y1, x0, z0, -y0, x1, top, -y1, x0, top, -y0);
      WU.push(u0, (z0 - top) / 3, u1, (z1 - top) / 3, u1, 0, u0, (z0 - top) / 3, u1, 0, u0, 0);
      for (let k = 0; k < 6; k++) WC.push(col.r, col.g, col.b);
      u += L;
    }
    // toit plat triangule
    const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const rc = new THREE.Color(ROOFS[kind] || ROOFS[0]).offsetHSL(0, 0, (r() - 0.5) * 0.08);
    for (const t of tris) {
      for (const k of [t[0], t[2], t[1]]) {
        // normale vers le haut apres conversion Z = -y
        RP.push(ring[k][0], top, -ring[k][1]);
        RC.push(rc.r, rc.g, rc.b);
      }
    }
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1e9,
      y1 = -1e9;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    footprints.push({ ring, x0, y0, x1, y1 });
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(WP, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(WU, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(WC, 3));
  wg.computeVertexNormals();
  const walls = new THREE.Mesh(
    wg,
    new THREE.MeshLambertMaterial({ map: facadeTexture(), vertexColors: true, side: THREE.DoubleSide }),
  );
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(RP, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(RC, 3));
  rg.computeVertexNormals();
  const roofs = new THREE.Mesh(
    rg,
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  );
  for (const m of [walls, roofs]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.renderOrder = 10;
  }
  return { walls, roofs, footprints };
}

/** distance d'un point au contour d'un anneau */
/** @param {number[][]} p @param {number} x @param {number} y */
function edgeDist(p, x, y) {
  let best = 1e18;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][0],
      ay = p[j][1],
      dx = p[i][0] - ax,
      dy = p[i][1] - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    best = Math.min(best, (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2);
  }
  return Math.sqrt(best);
}
/** @param {number[][]} p @param {number} x @param {number} y */
function inside(p, x, y) {
  let r = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (
      p[i][1] > y !== p[j][1] > y &&
      x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]
    )
      r = !r;
  }
  return r;
}

/**
 * Grille spatiale des emprises pour les collisions bus / batiments.
 * Les emprises OSM debordent parfois sur la chaussee (passages couverts, traces imprecis) :
 *  - les batiments a moins de 3 m du parcours de la ligne sont ignores ;
 *  - un batiment ne bloque le bus que s'il y penetre de plus de 1 m.
 */
export class FootprintIndex {
  /** @param {Footprint[]} fps @param {import('../world/track.js').Track} track */
  constructor(fps, track) {
    this.C = 50;
    /** @type {Map<number, Footprint[]>} */
    this.cells = new Map();
    /** @type {Map<number, number[]>} */
    const tp = new Map(); // points du parcours par cellule
    for (let i = 0; i < track.n; i++) {
      const k = Math.floor(track.x[i] / this.C) * 100000 + Math.floor(track.y[i] / this.C);
      const cell = tp.get(k);
      if (cell) cell.push(i);
      else tp.set(k, [i]);
    }
    let skipped = 0;
    for (const f of fps) {
      let near = false;
      for (let cx = Math.floor((f.x0 - 3) / this.C); cx <= Math.floor((f.x1 + 3) / this.C) && !near; cx++)
        for (let cy = Math.floor((f.y0 - 3) / this.C); cy <= Math.floor((f.y1 + 3) / this.C) && !near; cy++)
          for (const i of tp.get(cx * 100000 + cy) || []) {
            const x = track.x[i],
              y = track.y[i];
            if (x < f.x0 - 3 || x > f.x1 + 3 || y < f.y0 - 3 || y > f.y1 + 3) continue;
            if (inside(f.ring, x, y) || edgeDist(f.ring, x, y) < 3) {
              near = true;
              break;
            }
          }
      if (near) {
        skipped++;
        continue;
      }
      for (let cx = Math.floor(f.x0 / this.C); cx <= Math.floor(f.x1 / this.C); cx++)
        for (let cy = Math.floor(f.y0 / this.C); cy <= Math.floor(f.y1 / this.C); cy++) {
          const k = cx * 100000 + cy;
          const cell = this.cells.get(k);
          if (cell) cell.push(f);
          else this.cells.set(k, [f]);
        }
    }
    this.skipped = skipped;
  }
  /** @param {number} x @param {number} y */
  hit(x, y) {
    const list = this.cells.get(Math.floor(x / this.C) * 100000 + Math.floor(y / this.C));
    if (!list) return false;
    for (const f of list) {
      if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) continue;
      if (inside(f.ring, x, y) && edgeDist(f.ring, x, y) > 1) return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ arbres (sprites en billboard, un seul appel de dessin)
/** @param {Ground} hf @param {number[]} positions flat [x, y, ...] */
function treeBillboards(hf, positions) {
  const VAR = 4,
    TW = 40,
    TH = 64;
  const { c, g } = canvas(TW * VAR, TH);
  for (let i = 0; i < VAR; i++) g.drawImage(tree(i + 1), i * TW, 0);
  const tex = NEAREST(new THREE.CanvasTexture(c));
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  const n = positions.length / 2;
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const off = new Float32Array(n * 3),
    sc = new Float32Array(n * 2),
    vr = new Float32Array(n);
  const r = rng(11);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 2],
      y = positions[i * 2 + 1];
    off[i * 3] = x;
    off[i * 3 + 1] = hf.h(x, y) - 0.3;
    off[i * 3 + 2] = -y;
    const s = 7 + r() * 5;
    sc[i * 2] = s * 0.66;
    sc[i * 2 + 1] = s;
    vr[i] = Math.floor(r() * VAR);
  }
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('scale', new THREE.InstancedBufferAttribute(sc, 2));
  geo.setAttribute('variant', new THREE.InstancedBufferAttribute(vr, 1));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { map: { value: tex }, tint: { value: new THREE.Color(1, 1, 1) } },
    ]),
    fog: true,
    vertexShader: `
      attribute vec3 offset; attribute vec2 scale; attribute float variant;
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = vec2((uv.x + variant) / ${VAR}.0, uv.y);
        // billboard cylindrique : face a la camera, tronc vertical
        vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
        vec3 wp = offset + right * position.x * scale.x + vec3(0.0, position.y * scale.y, 0.0);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 tint;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.5) discard;
        gl_FragColor = vec4(c.rgb * tint, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 12;
  return m;
}

/** arbres : OSM (natural=tree) + semis dans les parcs et bois */
/** @param {import('../common/types.js').MapData | null} map @param {number[]} trees @param {Ground} hf */
function treePositions(map, trees, hf) {
  const out = [];
  for (let i = 0; i < (trees || []).length; i += 2) out.push(trees[i] / 10, trees[i + 1] / 10);
  if (!map) return out;
  const r = rng(5),
    b = hf.bounds;
  /** @type {[string, number][]} */
  const densities = [
    ['park', 1 / 700],
    ['forest', 1 / 160],
  ];
  for (const [kind, dens] of densities) {
    for (const p of map.polys[kind]) {
      let x0 = 1e9,
        y0 = 1e9,
        x1 = -1e9,
        y1 = -1e9;
      for (let i = 0; i < p.length; i += 2) {
        x0 = Math.min(x0, p[i]);
        x1 = Math.max(x1, p[i]);
        y0 = Math.min(y0, p[i + 1]);
        y1 = Math.max(y1, p[i + 1]);
      }
      if (x1 < b.x0 || x0 > b.x1 || y1 < b.y0 || y0 > b.y1) continue;
      const n = Math.min(800, Math.round((x1 - x0) * (y1 - y0) * dens));
      for (let k = 0; k < n; k++) {
        const x = x0 + r() * (x1 - x0),
          y = y0 + r() * (y1 - y0);
        let inside = false;
        for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
          if (
            p[i + 1] > y !== p[j + 1] > y &&
            x < ((p[j] - p[i]) * (y - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]
          )
            inside = !inside;
        }
        if (inside) out.push(x, y);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ arrets
/** @param {Ground} hf @param {import('../world/track.js').Track} track */
function stops(hf, track) {
  const grp = new THREE.Group();
  const sh = NEAREST(new THREE.CanvasTexture(shelter()));
  const po = NEAREST(new THREE.CanvasTexture(stopPole()));
  const shMat = new THREE.MeshLambertMaterial({
    map: sh,
    transparent: true,
    alphaTest: 0.1,
    side: THREE.DoubleSide,
  });
  const poMat = new THREE.MeshLambertMaterial({
    map: po,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#2c3038' });
  for (const st of track.stops) {
    const h = track.heading(st.s);
    const x = st.x,
      y = st.y,
      z = hf.h(x, y);
    const g = new THREE.Group();
    g.position.set(x, z, -y);
    g.rotation.y = h; // repere local : +X = sens de marche, +Z = a droite (cote trottoir)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.1), shMat); // paroi du fond, cote exterieur
    back.position.set(0, 1.55, 1.0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.15, 2.0), roofMat);
    roof.position.set(0, 3.05, 0.1);
    roof.castShadow = true;
    const pole = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.4), poMat); // poteau, face au bus qui arrive
    pole.position.set(3.2, 1.7, -0.6);
    pole.rotation.y = Math.PI / 2;
    g.add(back, roof, pole);
    grp.add(g);
  }
  return grp;
}

// ------------------------------------------------------------------ assemblage
/**
 * @param {THREE.Scene} scene @param {Ground} hf
 * @param {{map: import('../common/types.js').MapData | null, buildings: import('../common/types.js').BuildingsData | null, tiles: Map<string, TileData>}} data @param {import('../world/track.js').Track} track
 */
export function buildWorld(scene, hf, data, track) {
  scene.add(terrainCoarse(hf.natural));
  scene.add(terrainTiles(hf, data.tiles, data.map));
  scene.add(roadSurface(hf, data.tiles));
  scene.add(bridges(hf));
  const route = routeStrip(hf, track);
  scene.add(route);
  /** @type {Footprint[]} */
  let footprints = [];
  if (data.buildings) {
    const b = buildings(hf, data.buildings);
    scene.add(b.walls, b.roofs);
    footprints = b.footprints;
    scene.add(treeBillboards(hf, treePositions(data.map, data.buildings.trees, hf)));
  }
  scene.add(stops(hf, track));
  return { route, index: new FootprintIndex(footprints, track) };
}
