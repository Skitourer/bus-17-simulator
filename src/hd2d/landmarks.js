// @ts-check
/**
 * Landmarks drawn by hand (#16), from data/grenoble/landmarks.json (tools/build_landmarks.py): the Tour
 * Perret, the walls of the Bastille fortifications and the Bastille cable car with its two trains of
 * spherical cabins. The buildings of the BD TOPO at the place of the tower are left out (see `skips`).
 */
import * as THREE from 'three';
import { cablePath, shuttle } from './cablecar.js';

/** @typedef {import('./ground.js').Ground} Ground */
/** @typedef {import('../settings/settings.js').Settings['landmarks']} LandmarkSettings */

/**
 * @typedef {object} LandmarksData
 * @property {{stations: number[][], pylons: number[][]}} cable_car stations (lower, upper) and pylons, [x, y]
 * @property {{name: string, x: number, y: number, radius: number}[]} towers centre and base radius (m)
 * @property {number[][][]} walls fortification walls, [[x, y], ...]
 */

/**
 * Whether a building centred at (x, y) stands where a landmark is drawn instead.
 * @param {LandmarksData | null} data @param {number} x @param {number} y
 */
export function skips(data, x, y) {
  return !!data && data.towers.some((t) => Math.hypot(x - t.x, y - t.y) < t.radius + 3);
}

/**
 * Every landmark, added to the scene; `update(t)` moves the cabins.
 * @param {THREE.Scene} scene @param {Ground} ground @param {LandmarksData} data @param {LandmarkSettings} p
 */
export function buildLandmarks(scene, ground, data, p) {
  for (const t of data.towers) scene.add(towerPerret(ground, t, p));
  scene.add(walls(ground, data.walls, p));
  const cable = cableCar(ground, data.cable_car, p);
  scene.add(cable.group);
  return { update: cable.update };
}

/**
 * The Tour Perret: an octagonal concrete shaft narrowing up to the platform, ringed every few metres and
 * edged by its eight posts, then an open lantern, a cap and the spire.
 * @param {Ground} ground @param {{x: number, y: number, radius: number}} t @param {LandmarkSettings} p
 */
function towerPerret(ground, t, p) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: p.towerColor, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: '#2e3136' });
  const base = t.radius,
    top = base * p.towerTaper,
    platform = p.towerPlatform;
  /** @param {THREE.BufferGeometry} g @param {THREE.Material} m */
  const add = (g, m) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  // the shaft, octagonal, and the rings of its floors
  add(new THREE.CylinderGeometry(top, base, platform, 8).translate(0, platform / 2, 0), concrete);
  for (let h = 6; h < platform; h += 6) {
    const r = base + (top - base) * (h / platform) + 0.3;
    add(new THREE.CylinderGeometry(r, r, 0.6, 8).translate(0, h, 0), concrete);
  }
  // the eight posts at the corners, standing out of the shaft
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const post = new THREE.CylinderGeometry(0.35, 0.5, platform, 4).translate(0, platform / 2, 0);
    const mid = (base + top) / 2 + 0.2;
    add(post.translate(Math.cos(a) * mid, 0, Math.sin(a) * mid), concrete);
  }
  // the platform, then the lantern: a dark core inside eight posts, under a cap
  add(new THREE.CylinderGeometry(top + 1.2, top + 0.6, 1, 8).translate(0, platform + 0.5, 0), concrete);
  const lantern = p.towerLantern - platform - 2;
  add(
    new THREE.CylinderGeometry(top * 0.55, top * 0.7, lantern, 8).translate(0, platform + 1 + lantern / 2, 0),
    dark,
  );
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const r = top * 0.75;
    add(
      new THREE.BoxGeometry(0.5, lantern, 0.5).translate(
        Math.cos(a) * r,
        platform + 1 + lantern / 2,
        Math.sin(a) * r,
      ),
      concrete,
    );
  }
  add(new THREE.CylinderGeometry(top * 0.5, top * 0.85, 2, 8).translate(0, p.towerLantern - 1, 0), concrete);
  const spire = p.towerHeight - p.towerLantern;
  add(new THREE.ConeGeometry(top * 0.3, spire, 8).translate(0, p.towerLantern + spire / 2, 0), concrete);
  group.position.set(t.x, ground.h(t.x, t.y) - 0.5, -t.y);
  return group;
}

/**
 * The fortification walls: a stone band of wallThickness following the ground, wallHeight above it.
 * @param {Ground} ground @param {number[][][]} lines @param {LandmarkSettings} p
 */
function walls(ground, lines, p) {
  /** @type {number[]} */
  const P = [];
  /** @param {number[][]} q */
  const quad = (q) => P.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
  for (const line of lines)
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay] = line[k],
        [bx, by] = line[k + 1];
      const L = Math.hypot(bx - ax, by - ay) || 1;
      const nx = ((by - ay) / L) * (p.wallThickness / 2),
        ny = (-(bx - ax) / L) * (p.wallThickness / 2);
      const za = ground.h(ax, ay),
        zb = ground.h(bx, by);
      /** @param {number} x @param {number} y @param {number} z */
      const v = (x, y, z) => [x, z, -y];
      for (const s of [-1, 1])
        quad([
          v(ax + nx * s, ay + ny * s, za - 1),
          v(bx + nx * s, by + ny * s, zb - 1),
          v(bx + nx * s, by + ny * s, zb + p.wallHeight),
          v(ax + nx * s, ay + ny * s, za + p.wallHeight),
        ]);
      quad([
        v(ax - nx, ay - ny, za + p.wallHeight),
        v(bx - nx, by - ny, zb + p.wallHeight),
        v(bx + nx, by + ny, zb + p.wallHeight),
        v(ax + nx, ay + ny, za + p.wallHeight),
      ]);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: p.wallColor, side: THREE.DoubleSide, flatShading: true }),
  );
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * The cable car: two tracks of hanging cables from the lower station over the pylon to the Bastille, a
 * lattice pylon, and on each track a train of spherical cabins hanging under the cable.
 * @param {Ground} ground @param {{stations: number[][], pylons: number[][]}} data @param {LandmarkSettings} p
 */
function cableCar(ground, data, p) {
  const group = new THREE.Group();
  const [low, high] = data.stations;
  const steel = new THREE.MeshLambertMaterial({ color: '#5d6066' });
  /** @type {[number, number, number][]} */
  const supports = [
    [low[0], low[1], ground.h(low[0], low[1]) + p.lowerStationHeight],
    ...data.pylons.map(
      ([x, y]) => /** @type {[number, number, number]} */ ([x, y, ground.h(x, y) + p.pylonHeight]),
    ),
    [high[0], high[1], ground.h(high[0], high[1]) + p.upperStationHeight],
  ];
  // the two tracks, side by side across the line
  const heading = Math.atan2(high[1] - low[1], high[0] - low[0]);
  const ox = Math.sin(heading) * (p.trackGap / 2),
    oy = -Math.cos(heading) * (p.trackGap / 2);
  const tracks = [1, -1].map((s) =>
    cablePath(
      supports.map(([x, y, z]) => /** @type {[number, number, number]} */ ([x + ox * s, y + oy * s, z])),
      p.cableSag,
    ),
  );
  const lineMaterial = new THREE.LineBasicMaterial({ color: '#2b2d31' });
  for (const track of tracks) {
    const pts = [];
    for (let s = 0; s <= track.length; s += 5) {
      const q = track.at(s);
      pts.push(new THREE.Vector3(q.x, q.z, -q.y));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMaterial));
  }
  // the pylon: a tapering steel mast with a cross-arm carrying both tracks
  for (const [x, y, z] of supports.slice(1, -1)) {
    const base = ground.h(x, y) - 1;
    const height = z - base;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.8, height, 4).translate(0, height / 2, 0),
      steel,
    );
    mast.position.set(x, base, -y);
    mast.rotation.y = -heading + Math.PI / 4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, p.trackGap + 2), steel);
    arm.position.set(x, z - 0.4, -y);
    arm.rotation.y = -heading;
    mast.castShadow = arm.castShadow = true;
    group.add(mast, arm);
  }
  // the cabins: glass spheres with a hanger, five per train
  const glass = new THREE.MeshLambertMaterial({ color: p.cabinColor, transparent: true, opacity: 0.85 });
  const sphere = new THREE.SphereGeometry(p.cabinRadius, 10, 8);
  const hanger = new THREE.CylinderGeometry(0.06, 0.06, p.cabinHang, 4).translate(0, p.cabinHang / 2, 0);
  /** @type {THREE.Group[][]} */
  const trains = tracks.map(() =>
    Array.from({ length: p.cabinsPerTrain }, () => {
      const cabin = new THREE.Group();
      const ball = new THREE.Mesh(sphere, glass);
      ball.castShadow = true;
      cabin.add(ball, new THREE.Mesh(hanger, steel));
      group.add(cabin);
      return cabin;
    }),
  );
  const length = Math.min(...tracks.map((t) => t.length));
  return {
    group,
    /**
     * Cabins at game time `t` (s): the first train at the shuttle position, the second one opposite.
     * @param {number} t
     */
    update(t) {
      const s = shuttle(t, length, p);
      // a train stays whole inside the line: its middle runs from half its length to the other end
      const half = ((p.cabinsPerTrain - 1) / 2) * p.cabinSpacing;
      trains.forEach((cabins, k) => {
        const head = half + ((k === 0 ? s : length - s) / length) * (length - 2 * half);
        cabins.forEach((cabin, i) => {
          const along = head + (i - (p.cabinsPerTrain - 1) / 2) * p.cabinSpacing;
          const q = tracks[k].at(along);
          cabin.position.set(q.x, q.z - p.cabinHang, -q.y);
        });
      });
    },
  };
}
