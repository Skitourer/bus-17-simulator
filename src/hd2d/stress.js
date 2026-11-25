// @ts-check
/**
 * Performance test of the moving-object budget (#47), debug mode only (`?debug&stress=200`): dummy
 * vehicles drive along the route in both directions, spawned and removed in the ring around the player's
 * bus, drawn as 3D models near the camera and sprites farther, and simulated less often far away. It
 * measures what the traffic of #48 and #49 will cost.
 */
import * as THREE from 'three';
import { BillboardPool, ModelPool } from './instances.js';
import { SpawnRing, lodOf, simulationStep } from './budget.js';

/** @typedef {import('../settings/settings.js').Settings} Settings */
/** @typedef {{s: number, dir: 1 | -1, x: number, y: number, h: number, clock: {pending: number}}} Dummy */

/** Car body of the dummies (m), a plain box: they only stand for the cost of real vehicles. */
const CAR = { length: 4.2, width: 1.8, height: 1.5 };

export class StressTest {
  /**
   * @param {THREE.Scene} scene @param {import('../world/track.js').Track} track
   * @param {(s: number) => number} lane offset of the lane at `s` (m to the right)
   * @param {(x: number, y: number) => number} ground height of the ground
   * @param {number} count dummies to keep around the bus @param {Settings} settings
   */
  constructor(scene, track, lane, ground, count, settings) {
    this.track = track;
    this.lane = lane;
    this.ground = ground;
    this.count = Math.min(count, settings.budget.capacity);
    this.budget = settings.budget;
    this.speed = settings.debug.stressSpeed;
    this.ring = new SpawnRing(settings.budget);
    /** @type {Dummy[]} */
    this.dummies = [];
    /** @type {{x: number, y: number, s: number}[]} */
    this.candidates = [];
    for (let s = 0; s <= track.length; s += settings.debug.stressSpacing) {
      const p = track.pos(s);
      this.candidates.push({ x: p.x, y: p.y, s });
    }
    const box = new THREE.BoxGeometry(CAR.length, CAR.height, CAR.width);
    box.translate(0, CAR.height / 2, 0);
    this.models = new ModelPool(
      box,
      new THREE.MeshLambertMaterial({ color: '#c8513a' }),
      this.budget.capacity,
    );
    const sprite = document.createElement('canvas');
    sprite.width = 8;
    sprite.height = 6;
    const g = /** @type {CanvasRenderingContext2D} */ (sprite.getContext('2d'));
    g.fillStyle = '#c8513a';
    g.fillRect(0, 1, 8, 5);
    g.fillStyle = '#1c2a42';
    g.fillRect(1, 1, 6, 2);
    this.sprites = new BillboardPool(sprite, 1, this.budget.capacity);
    scene.add(this.models.mesh, this.sprites.mesh);
    this.shown = { models: 0, sprites: 0 };
  }

  /**
   * Move the dummies, remove the far ones and spawn new ones in the ring.
   * @param {number} dt @param {{x: number, y: number, h: number}} bus
   */
  update(dt, bus) {
    for (const d of this.dummies) {
      const step = simulationStep(d.clock, Math.hypot(d.x - bus.x, d.y - bus.y), dt, this.budget);
      if (step > 0) this.place(d, d.s + d.dir * this.speed * step);
    }
    const gone = new Set(this.ring.despawn(this.dummies, bus.x, bus.y));
    this.dummies = this.dummies.filter((d, i) => !gone.has(i) && d.s >= 0 && d.s <= this.track.length);
    const missing = this.count - this.dummies.length;
    if (missing <= 0) return;
    const places = this.ring.spawnPlaces(
      this.candidates,
      this.dummies,
      bus.x,
      bus.y,
      bus.h,
      missing,
      2 * CAR.length,
    );
    places.forEach((i, k) => {
      /** @type {Dummy} */
      const d = { s: 0, dir: k % 2 ? 1 : -1, x: 0, y: 0, h: 0, clock: { pending: 0 } };
      this.place(d, this.candidates[i].s);
      this.dummies.push(d);
    });
  }

  /** @param {Dummy} d @param {number} s */
  place(d, s) {
    // forward in the right lane, backward in the opposite one
    const p = this.track.pos(s, d.dir * this.lane(s));
    d.s = s;
    d.x = p.x;
    d.y = p.y;
    d.h = d.dir > 0 ? p.h : p.h + Math.PI;
  }

  /**
   * Draw each dummy with the level of detail of its distance to the camera.
   * @param {number} x @param {number} y camera position (m)
   */
  draw(x, y) {
    let models = 0,
      sprites = 0;
    for (const d of this.dummies) {
      const lod = lodOf(Math.hypot(d.x - x, d.y - y), this.budget);
      const z = this.ground(d.x, d.y);
      if (lod === 'model') this.models.set(models++, d.x, d.y, z, d.h);
      else if (lod === 'sprite') this.sprites.set(sprites++, d.x, d.y, z, CAR.length, CAR.height * 1.4, 0);
    }
    this.models.show(models);
    this.sprites.show(sprites);
    this.shown = { models, sprites };
  }
}
