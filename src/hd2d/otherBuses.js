// @ts-check
/**
 * Drawing of the other buses of the line (#48): one instanced model with the doors shut and one with the
 * doors open (dwelling at a stop), the nearest buses within the drawing distance only (#47).
 */
import { ModelPool } from './instances.js';
import { brakeLampGeometry, brakeMaterial, busLook } from './bus3d.js';
import { lodOf, nearestWithin } from './budget.js';
import { groundPose } from './traffic.js';

export class OtherBuses {
  /**
   * @param {import('three').Scene} scene @param {import('./trailer.js').BusGeometry} bus standard bus
   * @param {import('../settings/settings.js').Settings['budget']} budget
   * @param {import('../settings/settings.js').Settings['lights']} lights
   */
  constructor(scene, bus, budget, lights) {
    this.budget = budget;
    const shut = busLook(bus, false),
      open = busLook(bus, true);
    this.shut = new ModelPool(shut.geometry, shut.materials, budget.capacity);
    this.open = new ModelPool(open.geometry, open.materials, budget.capacity);
    // brake lights of the buses that brake or stand (#87)
    this.brakes = new ModelPool(
      brakeLampGeometry(bus).translate(-bus.bodyLength / 2, 0, 0),
      brakeMaterial(lights),
      budget.capacity,
    );
    this.brakes.mesh.castShadow = false;
    this.wheelbase = bus.wheelbase;
    this.width = bus.bodyWidth;
    scene.add(this.shut.mesh, this.open.mesh, this.brakes.mesh);
    this.shown = 0;
  }

  /**
   * Draw the buses near the camera. A bus is big and few are running: it stays a 3D model up to the sprite
   * distance, then disappears.
   * The buses stand on the drawn ground, like the player's bus and the cars, and not at the altitude of
   * their route, which is smoothed differently.
   * @param {import('./fleet.js').FleetBus[]} buses @param {number} x @param {number} y camera position (m)
   * @param {(x: number, y: number, zRef: number) => number} heightAt drawn surface nearest to an altitude
   */
  draw(buses, x, y, heightAt) {
    let shut = 0,
      open = 0,
      braking = 0;
    for (const i of nearestWithin(buses, x, y, this.budget.spriteDistance, this.budget.capacity)) {
      const b = buses[i];
      if (lodOf(Math.hypot(b.x - x, b.y - y), this.budget) === 'hidden') continue;
      // the route altitude picks the deck or the ground below at a bridge
      const pose = groundPose({ x: b.x, y: b.y, h: b.h, width: this.width }, this.wheelbase, (px, py) =>
        heightAt(px, py, b.z),
      );
      const { z, pitch, roll } = pose;
      if (b.dwelling) this.open.set(open++, b.x, b.y, z, b.h, pitch, roll);
      else this.shut.set(shut++, b.x, b.y, z, b.h, pitch, roll);
      if (b.braking) this.brakes.set(braking++, b.x, b.y, z, b.h, pitch, roll);
    }
    this.brakes.show(braking);
    this.shut.show(shut);
    this.open.show(open);
    this.shown = shut + open;
  }
}
