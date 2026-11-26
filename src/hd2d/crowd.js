// @ts-check
/**
 * People of the service (#40), drawn as pixel-art sprites: waiting at the stops, walking to the front door to
 * board, walking away after getting off, and seated in the bus (seen from the inside views). The counts come
 * from StopService (stops.js); this module only shows them. The people in the street are drawn in one
 * instanced call, the nearest ones only (#47).
 */
import * as THREE from 'three';
import { person } from './sprites.js';
import { BillboardPool } from './instances.js';
import { nearestWithin } from './budget.js';

/** @typedef {import('../settings/settings.js').Settings['passengers']} PassengerSettings */
/** @typedef {import('../settings/settings.js').Settings['budget']} BudgetSettings */
/** @typedef {import('./ground.js').Ground} Ground */

/** @typedef {{x: number, y: number, z: number, look: number}} Person a person standing in the street (m) */
/** @typedef {{who: Person, from: Person, to: {x: number, y: number}, t: number, duration: number, then: 'hide' | 'stay'}} Walker */

/** Size of a person sprite (sprites.js `person`), in pixels. */
const SPRITE = { width: 12, height: 24 };

/**
 * The people sprites side by side, one per look.
 * @param {number} looks
 */
export function peopleAtlas(looks) {
  const atlas = document.createElement('canvas');
  atlas.width = SPRITE.width * looks;
  atlas.height = SPRITE.height;
  const g = /** @type {CanvasRenderingContext2D} */ (atlas.getContext('2d'));
  for (let k = 0; k < looks; k++) g.drawImage(person(k + 1), k * SPRITE.width, 0);
  return atlas;
}

export class Crowd {
  /**
   * @param {THREE.Scene} scene @param {Ground} ground
   * @param {{x: number, y: number, h: number}[]} stops stop positions (m) and route heading there (rad)
   * @param {number[]} waiting people waiting at each stop
   * @param {PassengerSettings} params @param {BudgetSettings} budget
   * @param {THREE.Group} interior bus interior, with `userData.seats`
   */
  constructor(scene, ground, stops, waiting, params, budget, interior) {
    this.ground = ground;
    this.p = params;
    this.budget = budget;
    this.pool = new BillboardPool(peopleAtlas(params.looks), params.looks, budget.capacity);
    scene.add(this.pool.mesh);
    this.count = 0;
    /** @type {Person[][]} people waiting, by stop */
    this.waiting = stops.map((st, i) =>
      Array.from({ length: waiting[i] }, (_, k) => {
        // under the shelter, between its middle and its back wall (stop frame: +x along the route, +z right)
        const along = (k - (waiting[i] - 1) / 2) * 0.9,
          across = 0.3 + (k % 2) * 0.35;
        const x = st.x + Math.cos(st.h) * along + Math.sin(st.h) * across,
          y = st.y + Math.sin(st.h) * along - Math.cos(st.h) * across;
        return this.add(x, y);
      }),
    );
    /** @type {Person[]} people who got off, standing where they stopped */
    this.standing = [];
    /** @type {Walker[]} */
    this.walkers = [];
    /** @type {THREE.Sprite[]} */
    this.seated = /** @type {number[][]} */ (interior.userData.seats ?? []).map(([x, y, z], k) => {
      const map = new THREE.CanvasTexture(person((k % params.looks) + 1));
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, alphaTest: 0.5 }));
      sprite.center.set(0.5, 0); // anchor at the feet
      sprite.scale.set(params.height * 0.5 * 0.8, params.height * 0.8, 1);
      sprite.position.set(x, y, z);
      sprite.visible = false;
      interior.add(sprite);
      return sprite;
    });
  }

  /** A new person standing at (x, y). @param {number} x @param {number} y @returns {Person} */
  add(x, y) {
    return { x, y, z: this.ground.h(x, y), look: this.count++ % this.p.looks };
  }

  /**
   * Someone waiting at stop `index` walks to the front door and gets in.
   * @param {number} index @param {{x: number, y: number}} door world position (m)
   */
  board(index, door) {
    const who = this.waiting[index]?.shift();
    if (!who) return;
    this.walk(who, door, 'hide');
  }

  /**
   * Someone gets off through the front door and walks away from the bus.
   * @param {{x: number, y: number}} door world position (m) @param {number} heading bus heading (rad)
   */
  alight(door, heading) {
    const who = this.add(door.x, door.y);
    const away = this.p.walkAway,
      along = ((this.count % 5) - 2) * 0.8;
    // to the right of the bus (the kerb side), a little along it so that people do not stack up
    const x = door.x + Math.sin(heading) * away + Math.cos(heading) * along,
      y = door.y - Math.cos(heading) * away + Math.sin(heading) * along;
    this.walk(who, { x, y }, 'stay');
  }

  /**
   * @param {Person} who @param {{x: number, y: number}} to @param {'hide' | 'stay'} then
   */
  walk(who, to, then) {
    const from = { ...who };
    const duration = Math.max(0.2, Math.hypot(to.x - from.x, to.y - from.y) / this.p.walkSpeed);
    this.walkers.push({ who, from, to, t: 0, duration, then });
  }

  /**
   * Move the walkers and seat the people on board.
   * @param {number} dt @param {number} onBoard
   */
  update(dt, onBoard) {
    this.walkers = this.walkers.filter((w) => {
      w.t = Math.min(w.duration, w.t + dt);
      const f = w.t / w.duration;
      w.who.x = w.from.x + (w.to.x - w.from.x) * f;
      w.who.y = w.from.y + (w.to.y - w.from.y) * f;
      w.who.z = this.ground.h(w.who.x, w.who.y);
      if (w.t < w.duration) return true;
      if (w.then === 'stay') this.standing.push(w.who);
      return false;
    });
    this.seated.forEach((sprite, k) => (sprite.visible = k < onBoard));
  }

  /**
   * Draw the people in the street nearest to the camera, up to the sprite distance and the pool capacity.
   * @param {number} x @param {number} y camera position (m)
   */
  draw(x, y) {
    const people = [...this.waiting.flat(), ...this.standing, ...this.walkers.map((w) => w.who)];
    const shown = nearestWithin(people, x, y, this.budget.spriteDistance, this.pool.capacity);
    const h = this.p.height;
    shown.forEach((index, i) => {
      const who = people[index];
      this.pool.set(i, who.x, who.y, who.z, h * 0.5, h, who.look);
    });
    this.pool.show(shown.length);
  }
}
