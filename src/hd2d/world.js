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
import { hippedRoof } from './roofs.js';
import { tree, shelter, stopPole } from './sprites.js';
import { quayWalls, waterSurface } from './water.js';
import { BillboardPool } from './instances.js';
import { TileSet } from './tileset.js';
import { PlaceGrid, placesAlong } from './lamps.js';
import { mountainColour } from './season.js';

/** @typedef {ReturnType<typeof import('./season.js').seasonLook>} SeasonLook */

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

/** @type {Map<string, THREE.Texture>} */
const sharedTextures = new Map();
/**
 * One texture per kind for all the tiles (built once, never freed with a tile).
 * @param {string} name @param {() => THREE.Texture} make
 */
function shared(name, make) {
  let texture = sharedTextures.get(name);
  if (!texture) sharedTextures.set(name, (texture = make()));
  return texture;
}

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
  water: '#5d8fb5',
  tram: '#8b8377',
};

/** CSS colour of an sRGB [r, g, b] in 0..1. @param {number[]} c */
const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

/** carte OSM peinte en texture de sol (1 pixel ~ 1,7 m) */
/**
 * @param {import('../common/types.js').MapData | null} map @param {{x0: number, y0: number, x1: number, y1: number}} b
 * @param {SeasonLook} season colours of the ground for the date of the game
 */
function groundTexture(map, b, season) {
  const W = 4096,
    H = Math.round((4096 * (b.y1 - b.y0)) / (b.x1 - b.x0));
  const { c, g } = canvas(W, H);
  const sx = W / (b.x1 - b.x0),
    sy = H / (b.y1 - b.y0);
  g.setTransform(sx, 0, 0, -sy, -b.x0 * sx, b.y1 * sy);
  g.fillStyle = css(season.land);
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
    poly(map.polys.forest, css(season.forest));
    poly(map.polys.park, css(season.park));
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
 * Fine ground of a tile (10 m grid shaped by the roads), triangles split like Ground.h().
 * @param {Ground} ground @param {string} key @param {TileData} tile @param {THREE.Material} material
 */
function terrainTile(ground, key, tile, material) {
  const b = ground.bounds,
    ix = ground.index,
    n = ground.n;
  const [ox, oy] = tileOrigin(ground, key);
  const grid = /** @type {Float32Array} */ (ground.grids.get(key));
  /** @type {number[]} */
  const P = [];
  /** @type {number[]} */
  const U = [];
  /** @type {number[]} */
  const I = [];
  /** @param {number} x @param {number} y @param {number} z */
  const vertex = (x, y, z) => {
    P.push(x, z, -y);
    U.push((x - b.x0) / (b.x1 - b.x0), (y - b.y0) / (b.y1 - b.y0));
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) vertex(ox + i * ix.step, oy + j * ix.step, grid[j * n + i]);
  // triangles under water are replaced by their dry parts (tools/water.py)
  const wet = new Set(tile.wet),
    cells = (n - 1) * (n - 1);
  for (let j = 0; j + 1 < n; j++)
    for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i,
        c = a + n,
        cell = j * (n - 1) + i;
      // (a, b, d) and (a, d, c): counter-clockwise seen from above (y is mapped to -z)
      if (!wet.has(cell)) I.push(a, a + 1, c + 1);
      if (!wet.has(cell + cells)) I.push(a, c + 1, c);
    }
  for (const rings of tile.dry) {
    const vec = rings.map((ring) => {
      const out = [];
      for (let k = 0; k + 1 < ring.length; k += 2)
        out.push(new THREE.Vector2(ox + ring[k] / 10, oy + ring[k + 1] / 10));
      return out;
    });
    const base = P.length / 3;
    for (const v of vec.flat()) vertex(v.x, v.y, ground.h(v.x, v.y));
    const [contour, ...holes] = vec;
    for (const tri of THREE.ShapeUtils.triangulateShape(contour, holes))
      I.push(base + tri[0], base + tri[2], base + tri[1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.receiveShadow = true;
  return m;
}

/**
 * Light ground of a far tile: one vertex out of `every` of the fine grid, the same texture. The water
 * surface hides the cells under water, so they are not cut out.
 * @param {Ground} ground @param {string} key @param {THREE.Material} material @param {number} every
 */
function terrainTileLight(ground, key, material, every) {
  const b = ground.bounds,
    ix = ground.index,
    n = ground.n;
  const [ox, oy] = tileOrigin(ground, key);
  const grid = /** @type {Float32Array} */ (ground.grids.get(key));
  const m = Math.floor((n - 1) / every) + 1;
  const P = new Float32Array(m * m * 3),
    U = new Float32Array(m * m * 2);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const k = j * m + i,
        x = ox + i * every * ix.step,
        y = oy + j * every * ix.step;
      P.set([x, grid[j * every * n + i * every], -y], k * 3);
      U.set([(x - b.x0) / (b.x1 - b.x0), (y - b.y0) / (b.y1 - b.y0)], k * 2);
    }
  /** @type {number[]} */
  const I = [];
  for (let j = 0; j + 1 < m; j++)
    for (let i = 0; i + 1 < m; i++) {
      const a = j * m + i,
        c = a + m;
      I.push(a, a + 1, c + 1, a, c + 1, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  geo.setIndex(I);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

/**
 * @param {import('./heightfield.js').Heightfield} hf @param {SeasonLook} season
 * @param {import('../settings/settings.js').Settings['seasons']} seasons
 */
function terrainCoarse(hf, season, seasons) {
  const g = hf.coarse,
    b = hf.bounds;
  const geo = new THREE.PlaneGeometry(1, 1, g.nx - 1, g.ny - 1);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
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
      // an irregular snow line: smooth waves over a few hundred metres, the same at every visit
      const edge = 0.6 * Math.sin(x / 700) + 0.4 * Math.sin(y / 530 + x / 1300);
      tmp.setRGB(...mountainColour(z, edge, season, seasons), THREE.SRGBColorSpace);
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
/** @typedef {import('../settings/settings.js').Settings['world']} WorldSettings */

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
 * @param {Ground} ground @param {Map<string, TileData>} tiles @param {WorldSettings} street
 */
function roadSurface(ground, tiles, street) {
  return piecesMesh(
    ground,
    tiles,
    (tile) => tile.road,
    street.roadLift,
    shared('asphalt', asphaltTexture),
    1,
  );
}

/**
 * Raised sidewalks beside the carriageway of the streets that have them.
 * @param {Ground} ground @param {Map<string, TileData>} tiles @param {WorldSettings} street
 */
function sidewalks(ground, tiles, street) {
  return piecesMesh(
    ground,
    tiles,
    (tile) => tile.sidewalks,
    street.kerbHeight,
    shared('paving', pavingTexture),
    2,
  );
}

/**
 * One mesh from polygon pieces (cut along the ground triangles, so coplanar with the ground), lifted by `lift`.
 * @param {Ground} ground @param {Map<string, TileData>} tiles
 * @param {(tile: TileData) => number[][][]} select @param {number} lift @param {THREE.Texture} map
 * @param {number} order render order and polygon offset strength
 */
function piecesMesh(ground, tiles, select, lift, map, order) {
  /** @type {number[]} */
  const P = [],
    U = [],
    I = [];
  for (const [key, tile] of tiles) {
    const [ox, oy] = tileOrigin(ground, key);
    for (const rings of select(tile)) {
      const vec = rings.map((ring) => {
        const out = [];
        for (let k = 0; k + 1 < ring.length; k += 2)
          out.push(new THREE.Vector2(ox + ring[k] / 10, oy + ring[k + 1] / 10));
        return out;
      });
      const [contour, ...holes] = vec;
      const base = P.length / 3;
      for (const v of vec.flat()) {
        P.push(v.x, ground.h(v.x, v.y) + lift, -v.y);
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
    map,
    side: THREE.DoubleSide, // ring orientation from shapely is not guaranteed
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4 * order,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.renderOrder = order;
  return m;
}

/** @param {Ground} ground @param {string} key "i_j" @returns {[number, number]} tile origin (m) */
function tileOrigin(ground, key) {
  const [ti, tj] = key.split('_').map(Number);
  return [ground.index.x0 + ti * ground.index.size, ground.index.y0 + tj * ground.index.size];
}

/** grey paving slabs, mapped in world metres (4 m per repeat) */
function pavingTexture() {
  const { c, g } = canvas(32, 32);
  const r = rng(13);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      let v = 172 + (r() - 0.5) * 10;
      if (x % 8 === 0 || y % 8 === 0) v -= 16; // 1 m slabs
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      g.fillRect(x, y, 1, 1);
    }
  const t = NEAREST(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Kerb faces (from the road up to the sidewalk) and white markings: dashed centre lines and zebra crossings.
 * @param {Ground} ground @param {Map<string, TileData>} tiles @param {WorldSettings} street
 */
function streetDetails(ground, tiles, street) {
  const { roadLift, kerbHeight, markingWidth, dashLength, dashGap } = street;
  const markingLift = roadLift + street.markingLift;
  /** @type {number[]} */
  const P = [];
  /** @type {number[]} */
  const C = [];
  const kerb = new THREE.Color('#c9c5bb'),
    paint = new THREE.Color('#f1efe6');
  /** @param {number[][]} q four corners [x, z, -y] @param {THREE.Color} col */
  const quad = (q, col) => {
    P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    for (let k = 0; k < 6; k++) C.push(col.r, col.g, col.b);
  };
  /** @param {number} x @param {number} y @param {number} lift */
  const at = (x, y, lift) => [x, ground.h(x, y) + lift, -y];
  /** flat strip of half-width w from (x0, y0) to (x1, y1) @param {number[]} seg */
  const strip = ([x0, y0, x1, y1], w = markingWidth / 2) => {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1,
      nx = ((y1 - y0) / L) * w,
      ny = (-(x1 - x0) / L) * w;
    quad(
      [
        at(x0 - nx, y0 - ny, markingLift),
        at(x0 + nx, y0 + ny, markingLift),
        at(x1 + nx, y1 + ny, markingLift),
        at(x1 - nx, y1 - ny, markingLift),
      ],
      paint,
    );
  };
  for (const [key, tile] of tiles) {
    const [ox, oy] = tileOrigin(ground, key);
    /** @param {number[]} flat @returns {number[][]} */
    const pts = (flat) => {
      const out = [];
      for (let k = 0; k + 1 < flat.length; k += 2) out.push([ox + flat[k] / 10, oy + flat[k + 1] / 10]);
      return out;
    };
    for (const line of tile.kerbs) {
      const p = pts(line);
      for (let k = 0; k + 1 < p.length; k++) {
        const [x0, y0] = p[k],
          [x1, y1] = p[k + 1];
        quad(
          [at(x0, y0, roadLift), at(x1, y1, roadLift), at(x1, y1, kerbHeight), at(x0, y0, kerbHeight)],
          kerb,
        );
      }
    }
    for (const line of tile.centre_lines) {
      // dashes of dashLength metres every dashLength + dashGap metres, continued across the points of the line
      const p = pts(line);
      let phase = 0;
      for (let k = 0; k + 1 < p.length; k++) {
        const [x0, y0] = p[k],
          [x1, y1] = p[k + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        for (let s = -phase; s < L; s += dashLength + dashGap) {
          const a = Math.max(0, s),
            b = Math.min(L, s + dashLength);
          if (b > a)
            strip([
              x0 + ((x1 - x0) * a) / L,
              y0 + ((y1 - y0) * a) / L,
              x0 + ((x1 - x0) * b) / L,
              y0 + ((y1 - y0) * b) / L,
            ]);
        }
        phase = (phase + L) % (dashLength + dashGap);
      }
    }
    for (const stripe of tile.crossings) {
      const p = pts(stripe);
      quad(
        p.map(([x, y]) => at(x, y, markingLift)),
        paint,
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -12,
    }),
  );
  m.receiveShadow = true;
  m.renderOrder = 3;
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
      const groundZ = ground.h(deck.x[i], deck.y[i]);
      // in a river the pier stands on the bed, below the water surface
      const below = Math.min(groundZ, (ground.waterLevel(deck.x[i], deck.y[i]) ?? groundZ) - 1);
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

/**
 * Guidance strip (key G): green chevrons along the guidance line, on the drivable surface (the bridge deck
 * at the height of the route, not the ground below).
 * @param {Ground} hf @param {import('../world/track.js').Track} track
 * @param {import('./guidance.js').GuidanceLine} guide one point per route point
 */
function routeStrip(hf, track, guide) {
  const P = [],
    U = [],
    I = [];
  const last = track.n - 1;
  for (let i = 0; i < track.n; i += 2) {
    const a = Math.max(0, i - 1),
      b = Math.min(last, i + 1);
    const h = Math.atan2(guide.y[b] - guide.y[a], guide.x[b] - guide.x[a]);
    const nx = Math.sin(h),
      ny = -Math.cos(h);
    const cx = guide.x[i],
      cy = guide.y[i];
    const lx = cx - nx * 0.9,
      ly = cy - ny * 0.9,
      rx = cx + nx * 0.9,
      ry = cy + ny * 0.9;
    const z = track.z[i];
    P.push(lx, hf.surface(lx, ly, z) + 0.32, -ly, rx, hf.surface(rx, ry, z) + 0.32, -ry);
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

/**
 * Tunnel mouths (#14): a concrete box over the first metres of each tunnel, open towards the road, dark
 * inside. The ground is not dug: the road disappears into the box.
 * @param {Ground} hf @param {string} key tile @param {number[][]} portals [x, y, heading (mrad), width] (dm)
 */
function tunnelMouths(hf, key, portals) {
  const [ox, oy] = tileOrigin(hf, key);
  /** @type {number[]} */
  const P = [];
  /** @type {number[]} */
  const C = [];
  const concrete = new THREE.Color('#9d998f'),
    dark = new THREE.Color('#0b0b0c');
  const m = new THREE.Matrix4();
  // a cut-and-cover mouth: the clearance of the building passages, 1 m walls and roof, 10 m deep
  const clearance = 4.5,
    wall = 1,
    depth = 10;
  /** @param {THREE.BufferGeometry} g @param {THREE.Color} col */
  const add = (g, col) => {
    const flat = g.toNonIndexed().applyMatrix4(m);
    P.push(...flat.attributes.position.array);
    for (let k = 0; k < flat.attributes.position.count; k++) C.push(col.r, col.g, col.b);
  };
  for (const [xd, yd, mrad, widthDm] of portals) {
    const x = ox + xd / 10,
      y = oy + yd / 10,
      w = widthDm / 10 + 1;
    m.makeRotationY(mrad / 1000).setPosition(x, hf.h(x, y), -y);
    // local frame: +x into the tunnel, +y up, +z across the road
    for (const side of [-1, 1])
      add(
        new THREE.BoxGeometry(depth, clearance, wall).translate(
          depth / 2,
          clearance / 2,
          (side * (w + wall)) / 2,
        ),
        concrete,
      );
    add(
      new THREE.BoxGeometry(depth, wall, w + 2 * wall).translate(depth / 2, clearance + wall / 2, 0),
      concrete,
    );
    // the dark inside, a little behind the mouth
    add(new THREE.PlaneGeometry(w, clearance).rotateY(-Math.PI / 2).translate(0.3, clearance / 2, 0), dark);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ batiments
/**
 * Facade families (#56), in the order of tools/buildings.py: old-town and faubourg blocks, post-war
 * slabs, modern offices and shops, houses, sheds, public buildings. Each has its wall colours (tinting
 * the white of the texture), the windows of one 3 m x 3 m bay (16 px) and how to draw the rest of it.
 * @type {{walls: string[], windows: number[][], draw: (g: CanvasRenderingContext2D, x: number, y: number) => void}[]}
 */
const FACADES = [
  {
    walls: ['#e8d6b0', '#dcc29b', '#efe6d4', '#cdb894', '#e6d0aa', '#d9b48c', '#f0e2c4', '#e2c7a6'],
    windows: [[5, 4, 6, 8]],
    draw(g, x, y) {
      // window, sill and shutters
      g.fillStyle = '#d0d0d0';
      g.fillRect(x + 4, y + 12, 8, 1);
      g.fillStyle = '#9a8a74';
      g.fillRect(x + 3, y + 4, 2, 8);
      g.fillRect(x + 11, y + 4, 2, 8);
    },
  },
  {
    walls: ['#e9e6df', '#d8d6d0', '#cfc9bd', '#e3ddd0', '#bfc3c6', '#d6cfc4'],
    windows: [[2, 5, 12, 6]],
    draw(g, x, y) {
      // balcony rail under a wide window
      g.fillStyle = '#b4b4b4';
      g.fillRect(x, y + 12, 16, 2);
    },
  },
  {
    walls: ['#c9ccd0', '#b9c0c7', '#d6d3cc', '#aeb6bd'],
    windows: [[1, 2, 14, 11]],
    draw(g, x, y) {
      // glazing bars
      g.fillStyle = '#8c9298';
      g.fillRect(x + 8, y + 2, 1, 11);
      g.fillRect(x, y + 14, 16, 2);
    },
  },
  {
    walls: ['#efe3cc', '#e8d2b4', '#f2e6d8', '#e0c9a8', '#ead9c6'],
    windows: [[6, 6, 4, 5]],
    draw(g, x, y) {
      g.fillStyle = '#7f9a6a';
      g.fillRect(x + 4, y + 6, 2, 5);
      g.fillRect(x + 10, y + 6, 2, 5);
    },
  },
  {
    walls: ['#b8bcc0', '#9fa7ad', '#c4c0b6', '#8f9aa3'],
    windows: [[2, 2, 12, 2]],
    draw(g, x, y) {
      // corrugated cladding
      g.fillStyle = '#dedede';
      for (let k = 0; k < 16; k += 2) g.fillRect(x + k, y + 5, 1, 11);
    },
  },
  {
    walls: ['#d8cbb0', '#cfc2a6', '#e0d6c2'],
    windows: [[6, 3, 4, 10]],
    draw(g, x, y) {
      // stone courses and a round-headed window
      g.fillStyle = '#e4e4e4';
      for (let k = 3; k < 16; k += 4) g.fillRect(x, y + k, 16, 1);
      g.fillStyle = '#ffffff';
      g.fillRect(x + 6, y + 3, 1, 1);
      g.fillRect(x + 9, y + 3, 1, 1);
    },
  },
];
/** stone plinth colour, and a texel of the facade texture without window (plain wall) */
const PLINTH = new THREE.Color('#8f8a80');
const PLAIN_U = 0.02,
  PLAIN_V = 0.5;

/** Tile roofs of the pitched roofs, slate on public buildings. */
const TILES = ['#a0543c', '#8f4a35', '#9c5a44', '#a86a4c'],
  SLATE = '#5f656d';

/** @type {Record<number, string>} flat roof colour by building kind (see geo.building_kind) */
const ROOFS = { 0: '#8a8d93', 1: '#a0543c', 2: '#7c8086', 3: '#6e8a95' };

/** Bays and floors of the facade texture: the lit windows repeat every FACADE_BAYS bays and floors. */
const FACADE_BAYS = 8;

/**
 * One bay by one floor (3 m x 3 m) of a facade family, 16 px, at (x, y) of the canvas.
 * @param {CanvasRenderingContext2D} g @param {number} style @param {number} x @param {number} y
 */
function facadeBay(g, style, x, y) {
  // white wall (tinted by the vertex colour), windows, then the details of the family
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, 16, 16);
  g.fillStyle = '#eeeeee';
  g.fillRect(x, y + 15, 16, 1);
  for (const [wx, wy, ww, wh] of FACADES[style].windows) {
    g.fillStyle = '#2d3a4e';
    g.fillRect(x + wx, y + wy, ww, wh);
    g.fillStyle = '#5d7896';
    g.fillRect(x + wx + 1, y + wy + 1, 2, 2);
  }
  FACADES[style].draw(g, x, y);
}

/** @param {THREE.Texture} t */
function facadeRepeat(t) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // the building UVs count bays and floors; each family of the atlas holds FACADE_BAYS of each
  t.repeat.set(1 / FACADE_BAYS, 1 / FACADE_BAYS);
  return t;
}

/** Atlas of the facade families side by side, FACADE_BAYS bays by FACADE_BAYS floors each. */
function facadeTexture() {
  const size = 16 * FACADE_BAYS;
  const { c, g } = canvas(size * FACADES.length, size);
  FACADES.forEach((_, style) => {
    for (let i = 0; i < FACADE_BAYS; i++)
      for (let j = 0; j < FACADE_BAYS; j++) facadeBay(g, style, style * size + i * 16, j * 16);
  });
  return facadeRepeat(NEAREST(new THREE.CanvasTexture(c)));
}

/**
 * Windows lit at night (#55), in the same atlas: grey to white where a window glows, black elsewhere.
 * @param {number} share lit share of the windows
 */
function windowGlowTexture(share) {
  const size = 16 * FACADE_BAYS;
  const { c, g } = canvas(size * FACADES.length, size);
  g.fillStyle = '#000000';
  g.fillRect(0, 0, size * FACADES.length, size);
  const r = rng(55);
  FACADES.forEach(({ windows }, style) => {
    for (let i = 0; i < FACADE_BAYS; i++)
      for (let j = 0; j < FACADE_BAYS; j++) {
        if (r() >= share) continue;
        // curtains: not every lit window is as bright
        const level = Math.round(170 + r() * 85);
        g.fillStyle = 'rgb(' + [level, level, level].join(',') + ')';
        for (const [wx, wy, ww, wh] of windows) g.fillRect(style * size + i * 16 + wx, j * 16 + wy, ww, wh);
      }
  });
  return facadeRepeat(NEAREST(new THREE.CanvasTexture(c)));
}

/**
 * Sampling of the facade atlas: the family of each vertex (`facade` attribute) picks its column, the bays
 * repeat inside it. The gradients of the unwrapped UVs keep the mipmap level steady across the repeats.
 * @param {THREE.MeshLambertMaterial} material
 */
function facadeAtlas(material) {
  const n = FACADES.length.toFixed(1);
  /** @param {string} map @param {string} uv */
  const sample = (map, uv) =>
    `textureGrad(${map}, vec2((vFacade + fract(${uv}.x)) / ${n}, fract(${uv}.y)), ` +
    `dFdx(${uv}) * vec2(1.0 / ${n}, 1.0), dFdy(${uv}) * vec2(1.0 / ${n}, 1.0))`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float facade;\nvarying float vFacade;\n' +
      shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vFacade = facade;');
    shader.fragmentShader = ('varying float vFacade;\n' + shader.fragmentShader)
      .replace('texture2D( map, vMapUv )', sample('map', 'vMapUv'))
      .replace('texture2D( emissiveMap, vEmissiveMapUv )', sample('emissiveMap', 'vEmissiveMapUv'));
  };
  material.customProgramCacheKey = () => 'facade-atlas';
  return material;
}

/** @type {THREE.MeshLambertMaterial | null} */
let wallMaterial = null;
/**
 * Material of the walls of every tile, with the lit windows (off by day).
 * @param {import('../settings/settings.js').Settings['lights']} lights
 */
function walls(lights) {
  wallMaterial ??= facadeAtlas(
    new THREE.MeshLambertMaterial({
      map: shared('facade', facadeTexture),
      emissiveMap: shared('windows', () => windowGlowTexture(lights.windowShare)),
      emissive: new THREE.Color(lights.windowColor),
      emissiveIntensity: 0,
      vertexColors: true,
      side: THREE.DoubleSide,
    }),
  );
  return wallMaterial;
}

/**
 * Buildings of a tile, extruded and merged into two meshes (walls, roofs): facade family and colour from
 * the data, flat or hipped roofs (#56). With `lifts`, each building starts that high above the ground (parts
 * over a passage, #14): no plinth, and an underside.
 * @param {Ground} hf @param {import('../common/types.js').BuildingsData} data @param {number} seed colour stream
 * @param {THREE.Material} wallMaterial @param {{roofPitch: number, roofCompactness: number}} roofShape
 * @param {number[]} [lifts] m, one per building
 */
function buildings(hf, data, seed, wallMaterial, roofShape, lifts) {
  /** @type {number[][]} positions, uvs, colours and families of the walls; positions and colours of the roofs */
  const [WP, WU, WC, WF, RP, RC] = [[], [], [], [], [], []];
  const r = rng(seed);
  const col = new THREE.Color();
  data.b.forEach((b, index) => {
    const [height, kind, style, riseDm] = b;
    const h = height / 10;
    const ring = [];
    for (let i = 4; i < b.length; i += 2) ring.push([b[i] / 10, b[i + 1] / 10]);
    const family = FACADES[style] ?? FACADES[0];
    // window rhythm of the building: bays of 3 to 4 m
    const bay = 3 + Math.floor(r() * 3) * 0.5;
    let zmin = 1e9,
      zmax = -1e9;
    for (const [x, y] of ring) {
      const z = hf.h(x, y);
      zmin = Math.min(zmin, z);
      zmax = Math.max(zmax, z);
    }
    const lift = lifts?.[index] ?? 0;
    const top = zmax + h,
      base = lift ? zmax + lift : zmin - 0.5,
      floor = lift ? base : zmax + 0.2;
    col.set(family.walls[Math.floor(r() * family.walls.length)]);
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i],
        [x1, y1] = ring[(i + 1) % ring.length];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const u0 = u / bay,
        u1 = (u + L) / bay;
      // deux triangles par quad (ordre anti-horaire vu de l'exterieur : l'anneau est anti-horaire)
      // socle en pierre du point le plus bas au rez-de-chaussee : aucun mur n'est coupe par le relief
      if (!lift) {
        WP.push(x0, base, -y0, x1, base, -y1, x1, floor, -y1, x0, base, -y0, x1, floor, -y1, x0, floor, -y0);
        for (let k = 0; k < 6; k++) WU.push(PLAIN_U, PLAIN_V);
        for (let k = 0; k < 6; k++) WC.push(PLINTH.r, PLINTH.g, PLINTH.b);
        for (let k = 0; k < 6; k++) WF.push(0);
      }
      // facade du rez-de-chaussee au toit
      WP.push(x0, floor, -y0, x1, floor, -y1, x1, top, -y1, x0, floor, -y0, x1, top, -y1, x0, top, -y0);
      const vf = (floor - top) / 3;
      WU.push(u0, vf, u1, vf, u1, 0, u0, vf, u1, 0, u0, 0);
      for (let k = 0; k < 6; k++) WC.push(col.r, col.g, col.b);
      for (let k = 0; k < 6; k++) WF.push(style);
      u += L;
    }
    const shade = (r() - 0.5) * 0.08;
    const faces = riseDm > 0 ? hippedRoof(ring, riseDm / 10, roofShape) : null;
    if (faces) {
      const rc = new THREE.Color(kind === 3 ? SLATE : TILES[Math.floor(r() * TILES.length)]).offsetHSL(
        0,
        0,
        shade,
      );
      for (const face of faces)
        for (let k = 1; k + 1 < face.length; k++)
          for (const [x, y, z] of [face[0], face[k], face[k + 1]]) {
            RP.push(x, top + z, -y);
            RC.push(rc.r, rc.g, rc.b);
          }
      return;
    }
    // toit plat triangule
    const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const rc = new THREE.Color(ROOFS[kind] || ROOFS[0]).offsetHSL(0, 0, shade);
    for (const t of tris) {
      for (const k of [t[0], t[2], t[1]]) {
        // normale vers le haut apres conversion Z = -y
        RP.push(ring[k][0], top, -ring[k][1]);
        RC.push(rc.r, rc.g, rc.b);
      }
      // underside of a building over a passage, in the plinth colour
      if (lift)
        for (const k of t) {
          RP.push(ring[k][0], base, -ring[k][1]);
          RC.push(PLINTH.r, PLINTH.g, PLINTH.b);
        }
    }
  });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(WP, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(WU, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(WC, 3));
  wg.setAttribute('facade', new THREE.Float32BufferAttribute(WF, 1));
  wg.computeVertexNormals();
  const walls = new THREE.Mesh(wg, wallMaterial);
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
  return { walls, roofs };
}

/**
 * Outlines of the buildings (world metres) with their bounding boxes, for the collisions.
 * @param {import('../common/types.js').BuildingsData} data @returns {Footprint[]}
 */
function footprintsOf(data) {
  return data.b.map((b) => {
    const ring = [];
    for (let i = 4; i < b.length; i += 2) ring.push([b[i] / 10, b[i + 1] / 10]);
    const xs = ring.map((p) => p[0]),
      ys = ring.map((p) => p[1]);
    return { ring, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
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
/** @param {Ground} hf @param {number[]} positions flat [x, y, ...] @param {SeasonLook} season */
function treeBillboards(hf, positions, season) {
  const VAR = 4,
    TW = 40,
    TH = 64;
  const atlas = shared('trees', () => {
    const { c, g } = canvas(TW * VAR, TH);
    const foliage = {
      dark: css(season.leafDark),
      middle: css(season.leafMiddle),
      light: css(season.leafLight),
      leaves: season.leaves,
    };
    for (let i = 0; i < VAR; i++) g.drawImage(tree(i + 1, foliage), i * TW, 0);
    return new THREE.CanvasTexture(c);
  });
  const n = positions.length / 2;
  const pool = new BillboardPool(atlas, VAR, Math.max(1, n));
  const r = rng(11 + Math.round(positions[0] ?? 0));
  for (let i = 0; i < n; i++) {
    const x = positions[i * 2],
      y = positions[i * 2 + 1];
    const s = 7 + r() * 5;
    pool.set(i, x, y, hf.h(x, y) - 0.3, s * 0.66, s, Math.floor(r() * VAR));
  }
  pool.show(n);
  pool.mesh.renderOrder = 12;
  return pool.mesh;
}

// ------------------------------------------------------------------ lampadaires
/**
 * Kerb lines of tiles in world metres, flat [x0, y0, x1, y1, ...].
 * @param {Ground} ground @param {Map<string, TileData>} tiles
 */
function kerbLines(ground, tiles) {
  const out = [];
  for (const [key, tile] of tiles) {
    const [ox, oy] = tileOrigin(ground, key);
    for (const line of tile.kerbs) out.push(line.map((v, k) => (k % 2 ? oy : ox) + v / 10));
  }
  return out;
}

/** Soft round halo of the street lights. */
function glowTexture() {
  const { c, g } = canvas(16, 16);
  const gradient = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(c);
}

/** @type {THREE.PointsMaterial | null} */
let lampGlow = null;
/** @param {import('../settings/settings.js').Settings['lights']} lights */
function glowMaterial(lights) {
  lampGlow ??= new THREE.PointsMaterial({
    color: lights.lampColor,
    size: lights.lampGlowSize,
    map: shared('glow', glowTexture),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return lampGlow;
}

/**
 * Street lights of a tile (#55): a pole with its lamp every lampSpacing metres along the kerbs, and the
 * halo of the lamp, shown at night.
 * @param {Ground} ground @param {number[]} places flat [x, y, ...] world metres
 * @param {import('../settings/settings.js').Settings['lights']} lights
 */
function streetLamps(ground, places, lights) {
  const group = new THREE.Group();
  const n = places.length / 2;
  if (!n) return group;
  const pole = new THREE.BoxGeometry(0.18, lights.lampHeight, 0.18).translate(0, lights.lampHeight / 2, 0);
  const head = new THREE.BoxGeometry(0.7, 0.22, 0.4).translate(0, lights.lampHeight, 0);
  const material = new THREE.MeshLambertMaterial({ color: '#4a4f57' });
  const poles = new THREE.InstancedMesh(pole, material, n);
  const heads = new THREE.InstancedMesh(head, material, n);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const x = places[i * 2],
      y = places[i * 2 + 1],
      z = ground.h(x, y);
    matrix.makeTranslation(x, z, -y);
    poles.setMatrixAt(i, matrix);
    heads.setMatrixAt(i, matrix);
  }
  group.add(poles, heads);
  return group;
}

/**
 * Halos of all the street lights in one mesh, drawn whatever the tiles around the bus: the city lights
 * stay on in the distance instead of appearing with each tile.
 * @param {Ground} ground @param {number[]} places flat [x, y, ...] world metres
 * @param {import('../settings/settings.js').Settings['lights']} lights
 */
function lampHalos(ground, places, lights) {
  const n = places.length / 2;
  const glow = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = places[i * 2],
      y = places[i * 2 + 1];
    // just under the lamp head, so that the head does not hide it from above
    glow.set([x, ground.h(x, y) + lights.lampHeight - 0.4, -y], i * 3);
  }
  const points = new THREE.BufferGeometry();
  points.setAttribute('position', new THREE.BufferAttribute(glow, 3));
  const halos = new THREE.Points(points, glowMaterial(lights));
  halos.renderOrder = 20;
  halos.frustumCulled = false;
  return halos;
}

// ------------------------------------------------------------------ arrets
/**
 * True when a building stands where the shelter would go: some streets of the route have a sidewalk too
 * narrow for it (or none in OSM), and the stop then only gets its pole.
 * @param {Footprint[]} footprints @param {import('./kerb.js').StopPlace} place
 */
function shelterBlocked(footprints, place) {
  const ax = Math.cos(place.h),
    ay = Math.sin(place.h),
    rx = Math.sin(place.h),
    ry = -Math.cos(place.h);
  // middle and back corners of the shelter (2.4 m on each side along the route, 0.9 m behind its middle)
  const probes = [0, -2.4, 2.4].map((along) => [
    place.shelterX + ax * along + (along ? rx * 0.9 : 0),
    place.shelterY + ay * along + (along ? ry * 0.9 : 0),
  ]);
  return footprints.some(
    (f) =>
      place.shelterX > f.x0 - 4 &&
      place.shelterX < f.x1 + 4 &&
      place.shelterY > f.y0 - 4 &&
      place.shelterY < f.y1 + 4 &&
      probes.some(([x, y]) => inside(f.ring, x, y)),
  );
}

/**
 * @param {Ground} hf @param {import('./kerb.js').StopPlace[]} places @param {boolean[]} blocked
 */
function stops(hf, places, blocked) {
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
  places.forEach((place, i) => {
    const h = place.h;
    const x = place.shelterX,
      y = place.shelterY,
      z = hf.h(x, y);
    const g = new THREE.Group();
    g.position.set(x, z, -y);
    g.rotation.y = h; // local frame: +X = direction of travel, +Z = right (away from the kerb), origin mid-shelter
    const back = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.1), shMat); // paroi du fond, cote exterieur
    back.position.set(0, 1.55, 0.9);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.15, 2.0), roofMat);
    roof.position.set(0, 3.05, 0);
    roof.castShadow = true;
    const pole = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.4), poMat); // poteau, face au bus qui arrive
    pole.position.set(3.2, 1.7, -0.7); // near the kerb
    pole.rotation.y = Math.PI / 2;
    if (blocked[i]) g.add(pole);
    else g.add(back, roof, pole);
    grp.add(g);
  });
  return grp;
}

/**
 * Buildings (clipped off the carriageway) and trees (off roads and buildings) of all tiles, in the world
 * frame: buildings as BuildingsData records in decimetres, trees as flat [x, y, ...] in metres.
 * @param {Ground} ground @param {Map<string, TileData>} tiles
 */
function tileObjects(ground, tiles) {
  /** @type {import('../common/types.js').BuildingsData} */
  const out = { attribution: '', b: [], trees: [] };
  /** @type {import('../common/types.js').BuildingsData} parts of buildings over the passages */
  const over = { attribution: '', b: [], trees: [] };
  /** @type {number[]} height of each part of `over` above the ground (m) */
  const lifts = [];
  /** @type {number[]} */
  const trees = [];
  const ix = ground.index;
  for (const [key, tile] of tiles) {
    const [ti, tj] = key.split('_').map(Number);
    const ox = (ix.x0 + ti * ix.size) * 10,
      oy = (ix.y0 + tj * ix.size) * 10;
    for (const [h, kind, style, rise, ...ring] of tile.buildings)
      out.b.push([h, kind, style, rise, ...ring.map((v, k) => v + (k % 2 ? oy : ox))]);
    for (const [h, kind, style, rise, base, ...ring] of tile.lintels ?? []) {
      over.b.push([h, kind, style, rise, ...ring.map((v, k) => v + (k % 2 ? oy : ox))]);
      lifts.push(base / 10);
    }
    for (let k = 0; k + 1 < tile.trees.length; k += 2)
      trees.push((tile.trees[k] + ox) / 10, (tile.trees[k + 1] + oy) / 10);
  }
  return { buildings: out, trees, over, lifts };
}

// ------------------------------------------------------------------ assemblage
/**
 * @param {THREE.Scene} scene @param {Ground} hf
 * @param {{map: import('../common/types.js').MapData | null, tiles: Map<string, TileData>, stops: import('./kerb.js').StopPlace[], guide: import('./guidance.js').GuidanceLine}} data
 * @param {import('../world/track.js').Track} track
 * @param {import('../settings/settings.js').Settings} settings
 * @param {SeasonLook} season landscape of the date of the game (#70)
 */
export function buildWorld(scene, hf, data, track, settings, season) {
  const street = settings.world;
  const { lights } = settings;
  scene.add(terrainCoarse(hf.natural, season, settings.seasons));
  const groundMaterial = new THREE.MeshLambertMaterial({ map: groundTexture(data.map, hf.bounds, season) });
  const ix = hf.index;
  const keys = [...data.tiles.keys()];
  const tiles = keys.map((key) => {
    const [x0, y0] = tileOrigin(hf, key);
    return { key, rect: { x0, y0, x1: x0 + ix.size, y1: y0 + ix.size } };
  });
  const tileSet = new TileSet(
    scene,
    tiles,
    (key) => terrainTileLight(hf, key, groundMaterial, settings.tiles.lightGroundStep),
    (key) => {
      const tile = /** @type {TileData} */ (data.tiles.get(key));
      const one = new Map([[key, tile]]);
      const objects = tileObjects(hf, one);
      const streets = new THREE.Group();
      streets.add(
        roadSurface(hf, one, street),
        sidewalks(hf, one, street),
        streetDetails(hf, one, street),
        streetLamps(hf, placesAlong(kerbLines(hf, one), lights.lampSpacing), lights),
      );
      const houses = buildings(hf, objects.buildings, 3 + keys.indexOf(key), walls(lights), street);
      const block = new THREE.Group();
      block.add(houses.walls, houses.roofs);
      if (objects.over.b.length) {
        const above = buildings(
          hf,
          objects.over,
          3 + keys.indexOf(key),
          walls(lights),
          street,
          objects.lifts,
        );
        block.add(above.walls, above.roofs);
      }
      if (tile.portals?.length) streets.add(tunnelMouths(hf, key, tile.portals));
      return {
        fineGround: terrainTile(hf, key, tile, groundMaterial),
        streets,
        trees: treeBillboards(hf, objects.trees, season),
        buildings: block,
      };
    },
    settings.tiles,
  );
  scene.add(bridges(hf));
  const water = waterSurface(hf, data.tiles, settings.water);
  scene.add(water, quayWalls(hf, data.tiles, settings.water));
  const route = routeStrip(hf, track, data.guide);
  scene.add(route);
  // collisions need every building from the start, drawn or not: their outlines are light
  const footprints = footprintsOf(tileObjects(hf, data.tiles).buildings);
  const blocked = data.stops.map((place) => shelterBlocked(footprints, place));
  scene.add(stops(hf, data.stops, blocked));
  // every street light: halos everywhere, and the few real lights that follow the bus at night
  const lampPlaces = placesAlong(kerbLines(hf, data.tiles), lights.lampSpacing);
  scene.add(lampHalos(hf, lampPlaces, lights));
  const lamps = new PlaceGrid(lampPlaces, 100);
  return {
    route,
    lamps,
    /**
     * Night level of the street lights and the windows, 0 (day) to 1 (night).
     * @param {number} level
     */
    setNight(level) {
      walls(lights).emissiveIntensity = level * lights.windowGlow;
      const glow = glowMaterial(lights);
      glow.opacity = level;
      glow.visible = level > 0.01;
    },
    index: new FootprintIndex(footprints, track),
    water: water.material,
    shelters: blocked.map((b) => !b),
    tiles: tileSet,
  };
}
