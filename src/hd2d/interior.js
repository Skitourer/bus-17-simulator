// @ts-check
/**
 * Inside of the bus (#18), seen from the cabin and passenger views: floor, ceiling, walls below and above
 * the windows, window pillars, seats, grab poles, dashboard and driver partition. Bus frame: +x forward, +y up,
 * +z right (door side), origin at the rear axle on the road. Hidden in the exterior views.
 */
import * as THREE from 'three';

/** @typedef {import('../settings/settings.js').Settings['bus']} BusSettings */

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
};

/** @param {BusSettings} bus */
export function makeInterior(bus) {
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
  box([front - 0.7, FLOOR, -half], [front, SILL + 0.1, half], 'dash');
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
  group.visible = false;
  return group;
}
