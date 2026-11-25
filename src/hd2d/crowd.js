// @ts-check
/**
 * People of the service (#40), drawn as pixel-art sprites: waiting at the stops, walking to the front door to
 * board, walking away after getting off, and seated in the bus (seen from the inside views). The counts come
 * from StopService (stops.js); this module only shows them.
 */
import * as THREE from 'three';
import { person } from './sprites.js';

/** @typedef {import('../settings/settings.js').Settings['passengers']} PassengerSettings */
/** @typedef {import('./ground.js').Ground} Ground */

/** @typedef {{sprite: THREE.Sprite, from: THREE.Vector3, to: THREE.Vector3, t: number, duration: number, then: 'hide' | 'stay'}} Walker */

export class Crowd {
  /**
   * @param {THREE.Scene} scene @param {Ground} ground
   * @param {{x: number, y: number, h: number}[]} stops stop positions (m) and route heading there (rad)
   * @param {number[]} waiting people waiting at each stop
   * @param {PassengerSettings} params @param {THREE.Group} interior bus interior, with `userData.seats`
   */
  constructor(scene, ground, stops, waiting, params, interior) {
    this.scene = scene;
    this.ground = ground;
    this.p = params;
    this.materials = Array.from({ length: params.looks }, (_, k) => {
      const map = new THREE.CanvasTexture(person(k + 1));
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.colorSpace = THREE.SRGBColorSpace;
      return new THREE.SpriteMaterial({ map, alphaTest: 0.5 });
    });
    this.count = 0;
    /** @type {THREE.Sprite[][]} people waiting, by stop */
    this.waiting = stops.map((st, i) =>
      Array.from({ length: waiting[i] }, (_, k) => {
        // under the shelter, between its back wall and the kerb (stop frame: +x along the route, +z right)
        const along = (k - (waiting[i] - 1) / 2) * 0.9,
          across = 0.3 + (k % 2) * 0.35;
        const x = st.x + Math.cos(st.h) * along + Math.sin(st.h) * across,
          y = st.y + Math.sin(st.h) * along - Math.cos(st.h) * across;
        return this.add(new THREE.Vector3(x, ground.h(x, y), -y));
      }),
    );
    /** @type {Walker[]} */
    this.walkers = [];
    /** @type {THREE.Sprite[]} */
    this.seated = /** @type {number[][]} */ (interior.userData.seats ?? []).map(([x, y, z], k) => {
      const sprite = this.sprite(k);
      sprite.scale.set(params.height * 0.5 * 0.8, params.height * 0.8, 1);
      sprite.position.set(x, y, z);
      sprite.visible = false;
      interior.add(sprite);
      return sprite;
    });
  }

  /** @param {number} k */
  sprite(k) {
    const sprite = new THREE.Sprite(this.materials[k % this.materials.length]);
    sprite.center.set(0.5, 0); // anchor at the feet
    sprite.scale.set(this.p.height * 0.5, this.p.height, 1);
    return sprite;
  }

  /** A standing person in the world. @param {THREE.Vector3} at */
  add(at) {
    const sprite = this.sprite(this.count++);
    sprite.position.copy(at);
    this.scene.add(sprite);
    return sprite;
  }

  /**
   * Someone waiting at stop `index` walks to the front door and gets in.
   * @param {number} index @param {{x: number, y: number}} door world position (m)
   */
  board(index, door) {
    const sprite = this.waiting[index]?.shift();
    if (!sprite) return;
    this.walk(sprite, this.at(door.x, door.y), 'hide');
  }

  /**
   * Someone gets off through the front door and walks away from the bus.
   * @param {{x: number, y: number}} door world position (m) @param {number} heading bus heading (rad)
   */
  alight(door, heading) {
    const sprite = this.add(this.at(door.x, door.y));
    const away = this.p.walkAway,
      along = ((this.count % 5) - 2) * 0.8;
    // to the right of the bus (the kerb side), a little along it so that people do not stack up
    const x = door.x + Math.sin(heading) * away + Math.cos(heading) * along,
      y = door.y - Math.cos(heading) * away + Math.sin(heading) * along;
    this.walk(sprite, this.at(x, y), 'stay');
  }

  /** Position on the ground. @param {number} x @param {number} y */
  at(x, y) {
    return new THREE.Vector3(x, this.ground.h(x, y), -y);
  }

  /**
   * @param {THREE.Sprite} sprite @param {THREE.Vector3} to @param {'hide' | 'stay'} then
   */
  walk(sprite, to, then) {
    const from = sprite.position.clone();
    const duration = Math.max(0.2, from.distanceTo(to) / this.p.walkSpeed);
    this.walkers.push({ sprite, from, to, t: 0, duration, then });
  }

  /**
   * Move the walkers and seat the people on board.
   * @param {number} dt @param {number} onBoard
   */
  update(dt, onBoard) {
    this.walkers = this.walkers.filter((w) => {
      w.t = Math.min(w.duration, w.t + dt);
      w.sprite.position.lerpVectors(w.from, w.to, w.t / w.duration);
      if (w.t < w.duration) return true;
      if (w.then === 'hide') this.scene.remove(w.sprite);
      return false;
    });
    this.seated.forEach((sprite, k) => (sprite.visible = k < onBoard));
  }
}
