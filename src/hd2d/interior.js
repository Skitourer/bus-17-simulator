// @ts-check
/**
 * Inside of the bus (#18), seen from the cabin and passenger views: floor, ceiling, walls below and above
 * the windows, window pillars, seats, grab poles, driver partition, and the driver's cockpit of a city bus
 * (#42): wrap-around dashboard, instrument binnacle, door and ticket buttons, nearly flat steering wheel on
 * its column and sun blind. Bus frame: +x forward, +y up, +z right (door
 * side), origin at the rear axle on the road. Hidden in the exterior views.
 */
import * as THREE from 'three';
import { wheelPose } from './views.js';

/** @typedef {import('../settings/settings.js').Settings['bus']} BusSettings */

/** Render layer shared by every object inside the bus and the lights that light them. */
export const INTERIOR_LAYER = 1;

/**
 * Render the scene seen from inside the bus: the world without the interior, then the interior over it
 * with a cleared depth. The camera is inside the bus, so nothing of the world lies between it and the
 * interior, whereas the road decals, pulled towards the camera by their polygon offset, show through the
 * floor at grazing angles.
 * @param {THREE.WebGLRenderer} renderer @param {THREE.Scene} scene @param {THREE.Camera} camera
 * @param {THREE.Object3D} interior
 */
export function renderFromInside(renderer, scene, camera, interior) {
  interior.visible = false;
  renderer.render(scene, camera);
  interior.visible = true;
  const layers = camera.layers.mask,
    background = scene.background;
  // the interior casts no shadow: keep the shadow map of the world drawn by the first pass
  const shadows = renderer.shadowMap.autoUpdate;
  camera.layers.set(INTERIOR_LAYER);
  // a background colour would clear the first pass
  scene.background = null;
  renderer.autoClear = false;
  renderer.shadowMap.autoUpdate = false;
  renderer.clearDepth();
  renderer.render(scene, camera);
  renderer.autoClear = true;
  renderer.shadowMap.autoUpdate = shadows;
  scene.background = background;
  camera.layers.mask = layers;
}

/** Interior heights (m above the road) of a low-floor city bus; windows between the sill and the header. */
const LEVEL = { floor: 0.35, sill: 1.05, header: 2.45, ceiling: 2.95 };

const COLOURS = {
  floor: '#4b4f57',
  wall: '#d9dbe0',
  ceiling: '#eef0f2',
  pillar: '#3a3f48',
  seat: '#2f57a8',
  seatBack: '#24468a',
  pole: '#f2c230',
  dash: '#22252b',
  binnacle: '#16171b',
  wheel: '#1a1b1f',
  hub: '#33a457',
  blind: '#2b2e35',
};

/**
 * Face of the instrument binnacle: speedometer and rev counter dials and a row of warning lights, as on
 * the dashboard of a city bus.
 */
function instrumentFace() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 24;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.fillStyle = '#0d0e11';
  g.fillRect(0, 0, 64, 24);
  for (const x of [14, 50]) {
    g.fillStyle = '#c9ced6';
    g.beginPath();
    g.arc(x, 12, 9, 0, 2 * Math.PI);
    g.fill();
    g.fillStyle = '#1b1d22';
    g.beginPath();
    g.arc(x, 12, 7.5, 0, 2 * Math.PI);
    g.fill();
    g.fillStyle = '#ff6a3d';
    g.fillRect(x - 1, 6, 2, 6);
  }
  ['#3fbf5a', '#e8c03a', '#3a8ee8', '#e8c03a', '#3fbf5a'].forEach((colour, k) => {
    g.fillStyle = colour;
    g.fillRect(25 + k * 3, 17, 2, 2);
  });
  g.fillStyle = '#7dff9b';
  g.fillRect(26, 6, 12, 6);
  const texture = new THREE.CanvasTexture(c);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Driver's cockpit (#42), after the cabin of a low-floor city bus: a dashboard wrapping around the driver on
 * the left, the binnacle behind the steering wheel, a button panel on its right (doors, kneeling, ticket
 * machine), the nearly flat wheel on its column and a sun blind at the top of the windscreen.
 * Returns the part of the wheel that turns with the steering, about its +y axis.
 * @param {THREE.Group} group @param {(a: number[], b: number[], colour: string) => THREE.Mesh} box
 * @param {Record<string, THREE.MeshLambertMaterial>} mats
 * @param {{front: number, half: number, eye: {x: number, y: number, z: number}}} at
 * @param {import('../settings/settings.js').Settings['camera']['dashboard']} dash
 */
function cockpit(group, box, mats, at, dash) {
  const { front, half, eye } = at;
  const wheel = wheelPose(eye, dash);
  // dashboard: low shelf under the windscreen across the bus, higher wrap-around panel at the driver
  box([front - 0.7, LEVEL.floor, -half], [front, LEVEL.sill + 0.1, half], 'dash');
  const top = wheel.y - 0.12;
  box([wheel.x + 0.12, LEVEL.floor, -half], [front - 0.02, top, eye.z + 0.85], 'dash');
  // instrument binnacle behind the wheel, its face towards the driver
  const binnacle = box(
    [wheel.x + 0.3, top, eye.z - 0.32],
    [wheel.x + 0.48, top + 0.16, eye.z + 0.32],
    'binnacle',
  );
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.11).rotateY(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: instrumentFace() }),
  );
  face.position.set(wheel.x + 0.299, top + 0.06, eye.z);
  binnacle.parent?.add(face);
  // button panel on the right of the wheel: doors, kneeling, ticket machine
  box([wheel.x + 0.1, top, eye.z + 0.45], [wheel.x + 0.45, top + 0.06, eye.z + 0.85], 'binnacle');
  const buttons = ['#3fbf5a', '#3fbf5a', '#e8c03a', '#d04a3a', '#3a8ee8', '#e8e8e8'];
  buttons.forEach((colour, k) => {
    const button = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.02, 0.05),
      new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.25 }),
    );
    button.position.set(wheel.x + 0.17 + (k % 3) * 0.1, top + 0.07, eye.z + 0.55 + Math.floor(k / 3) * 0.15);
    group.add(button);
  });
  // steering wheel: column from the dashboard, the wheel tilted towards the driver
  const pivot = new THREE.Group();
  pivot.position.set(wheel.x, wheel.y, wheel.z);
  pivot.rotation.z = wheel.tilt;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 8), mats.wheel);
  column.position.y = -0.25;
  pivot.add(column);
  const spin = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(dash.wheelRadius, 0.022, 6, 28).rotateX(Math.PI / 2),
    mats.wheel,
  );
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), mats.hub);
  spin.add(rim, hub);
  // three spokes: left, right and towards the driver
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(dash.wheelRadius, 0.02, 0.04), mats.wheel);
    spoke.position.set(
      (Math.cos(angle) * dash.wheelRadius) / 2,
      0,
      (-Math.sin(angle) * dash.wheelRadius) / 2,
    );
    spoke.rotation.y = angle;
    spin.add(spoke);
  }
  pivot.add(spin);
  group.add(pivot);
  // sun blind rolled at the top of the windscreen on the driver's side
  box([front - 0.12, LEVEL.header - 0.08, -half + 0.1], [front - 0.04, LEVEL.header, 0.1], 'blind');
  return spin;
}

/**
 * @param {BusSettings} bus
 * @param {{eye: {x: number, y: number, z: number}, dash: import('../settings/settings.js').Settings['camera']['dashboard']}} driver
 * the driver's eye and the dashboard (#42)
 */
export function makeInterior(bus, driver) {
  const group = new THREE.Group();
  /** @type {Record<string, THREE.MeshLambertMaterial>} */
  const mats = {};
  for (const [k, c] of Object.entries(COLOURS)) mats[k] = new THREE.MeshLambertMaterial({ color: c });
  const front = bus.bodyLength - bus.rearOverhang - 0.05,
    rear = -bus.rearOverhang + 0.05,
    half = bus.bodyWidth / 2 - 0.06;
  /**
   * Box between two corners of the bus frame.
   * @param {number[]} a [x, y, z] @param {number[]} b @param {string} colour
   */
  const box = (a, b, colour) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])),
      mats[colour],
    );
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    group.add(mesh);
    return mesh;
  };
  const { floor: FLOOR, sill: SILL, header: HEADER, ceiling: CEILING } = LEVEL;
  const length = front - rear;
  box([rear, FLOOR - 0.04, -half], [front, FLOOR, half], 'floor');
  box([rear, CEILING, -half], [front, CEILING + 0.04, half], 'ceiling');
  box([rear - 0.04, FLOOR, -half], [rear, CEILING, half], 'wall');
  for (const side of [-1, 1]) {
    const z = side * half;
    box([rear, FLOOR, z - 0.03], [front, SILL, z + 0.03], 'wall');
    box([rear, HEADER, z - 0.03], [front, CEILING, z + 0.03], 'wall');
    // window pillars every 1.5 m; none beside the driver, where one would hide half of the side window
    for (let x = rear; x <= front - 1.5; x += 1.5)
      box([x, SILL, z - 0.05], [x + 0.12, HEADER, z + 0.05], 'pillar');
  }
  // windscreen frame: header and corner pillars; dashboard in front of the driver
  box([front - 0.05, HEADER, -half], [front, CEILING, half], 'pillar');
  for (const side of [-1, 1])
    box([front - 0.08, SILL, side * (half - 0.08)], [front, HEADER, side * half], 'pillar');
  group.userData.wheel = cockpit(group, box, mats, { front, half, eye: driver.eye }, driver.dash);
  // driver partition behind the seat, on the left
  box([front - 1.9, FLOOR, -half], [front - 1.85, 1.8, -0.35], 'pillar');
  // seat pairs on both sides, leaving the door areas on the right free (front and middle doors)
  const middleDoor = rear + length * 0.45;
  /** @type {number[][]} where the people on board sit: [x, y, z] in the bus frame */
  const seats = [];
  for (let x = rear + 0.4; x < front - 2.2; x += 0.95)
    for (const side of [-1, 1]) {
      if (side > 0 && Math.abs(x - middleDoor) < 1.1) continue;
      const z0 = side * 0.35,
        z1 = side * (half - 0.05);
      box([x, FLOOR, z0], [x + 0.45, 0.8, z1], 'seat');
      box([x, 0.8, z0], [x + 0.08, 1.4, z1], 'seatBack');
      for (const share of [0.25, 0.75]) seats.push([x + 0.25, FLOOR + 0.15, z0 + (z1 - z0) * share]);
    }
  // fill the seats in a scattered order over the whole bus (golden ratio sequence), not front to back
  const order = seats.map((_, k) => (k * 0.618034) % 1);
  group.userData.seats = seats
    .map((seat, k) => ({ seat, key: order[k] }))
    .sort((a, b) => a.key - b.key)
    .map((e) => e.seat);
  // grab poles along the aisle
  const pole = new THREE.CylinderGeometry(0.035, 0.035, CEILING - FLOOR, 6);
  for (let x = rear + 1; x < front - 1.5; x += 2)
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(pole, mats.pole);
      mesh.position.set(x, (FLOOR + CEILING) / 2, side * 0.33);
      group.add(mesh);
    }
  group.traverse((object) => object.layers.enable(INTERIOR_LAYER));
  group.visible = false;
  return group;
}
