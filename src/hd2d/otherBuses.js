// @ts-check
/**
 * Drawing of the other buses of the line (#48): one instanced model with the doors shut and one with the
 * doors open (dwelling at a stop), the nearest buses within the drawing distance only (#47).
 */
import { ModelPool } from './instances.js';
import { busLook } from './bus3d.js';
import { lodOf, nearestWithin } from './budget.js';

export class OtherBuses {
  /**
   * @param {import('three').Scene} scene @param {import('./trailer.js').BusGeometry} bus standard bus
   * @param {import('../settings/settings.js').Settings['budget']} budget
   */
  constructor(scene, bus, budget) {
    this.budget = budget;
    const shut = busLook(bus, false),
      open = busLook(bus, true);
    this.shut = new ModelPool(shut.geometry, shut.materials, budget.capacity);
    this.open = new ModelPool(open.geometry, open.materials, budget.capacity);
    scene.add(this.shut.mesh, this.open.mesh);
    this.shown = 0;
  }

  /**
   * Draw the buses near the camera. A bus is big and few are running: it stays a 3D model up to the sprite
   * distance, then disappears.
   * @param {import('./fleet.js').FleetBus[]} buses @param {number} x @param {number} y camera position (m)
   */
  draw(buses, x, y) {
    let shut = 0,
      open = 0;
    for (const i of nearestWithin(buses, x, y, this.budget.spriteDistance, this.budget.capacity)) {
      const b = buses[i];
      if (lodOf(Math.hypot(b.x - x, b.y - y), this.budget) === 'hidden') continue;
      if (b.dwelling) this.open.set(open++, b.x, b.y, b.z, b.h);
      else this.shut.set(shut++, b.x, b.y, b.z, b.h);
    }
    this.shut.show(shut);
    this.open.show(open);
    this.shown = shut + open;
  }
}
