// @ts-check
/**
 * Drawing of the ambient traffic (#49): cars and bikes as a few instanced low-poly models (body, cabin,
 * head and tail lights; frame and rider), the nearest ones to the camera only. The lights glow at night
 * with the buses' (`glowAtNight`); a braking car shows its three brake lights (#87).
 */
import * as THREE from 'three';
import { ModelPool, boxes } from './instances.js';
import { brakeMaterial, glowAtNight, indicatorMaterial, tailGlow } from './bus3d.js';
import { blinkOn } from './indicators.js';
import { groundPose } from './traffic.js';

/** Car body colours, picked by the vehicle's look. */
const CAR_COLOURS = ['#c8ccd2', '#2b2f36', '#a8322c', '#2f5d9a', '#e8e4da', '#6b7a5a', '#d9a440', '#7a7f88'];
/** Shirt colours of the cyclists. */
const RIDER_COLOURS = ['#d04a3a', '#3a6fd0', '#e0c040', '#40a060', '#e8e8e8', '#303030'];

/**
 * Pool of light thrown on the road by the headlights: bright near the car, widening and fading ahead.
 */
function beamTexture() {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const image = g.createImageData(size, size);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const along = i / (size - 1),
        across = Math.abs(j / (size - 1) - 0.5) * 2;
      const spread = 0.35 + 0.65 * along;
      const level = Math.pow(1 - along, 1.5) * Math.max(0, 1 - across / spread);
      image.data.set([255, 241, 204, Math.round(255 * level)], (j * size + i) * 4);
    }
  g.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** @param {string} colour @param {string} [glow] emissive colour of a light */
function material(colour, glow) {
  const m = new THREE.MeshLambertMaterial({ color: colour });
  if (glow) {
    m.emissive.set(glow);
    m.emissiveIntensity = 0;
    glowAtNight(m);
  }
  return m;
}

export class TrafficLook {
  /**
   * @param {THREE.Scene} scene @param {import('../settings/settings.js').Settings['traffic']} p
   * @param {import('../settings/settings.js').Settings['lights']} lights @param {number} capacity most
   * vehicles drawn @param {import('../settings/settings.js').Settings['indicators']} indicators turn signals
   */
  constructor(scene, p, lights, capacity, indicators) {
    this.p = p;
    const L = p.carLength,
      W = p.carWidth;
    const pool = (/** @type {THREE.BufferGeometry} */ geometry, /** @type {THREE.Material} */ m) => {
      const models = new ModelPool(geometry, m, capacity);
      scene.add(models.mesh);
      return models;
    };
    const lamp = 0.18;
    this.cars = {
      body: pool(boxes([L, 0.75, W, 0, 0.3, 0]), material('#ffffff')),
      cabin: pool(boxes([L * 0.5, 0.55, W * 0.9, -L * 0.06, 1.05, 0]), material('#1f2a38')),
      wheels: pool(
        boxes([0.65, 0.6, W + 0.08, L * 0.3, 0, 0], [0.65, 0.6, W + 0.08, -L * 0.3, 0, 0]),
        material('#151515'),
      ),
      front: pool(
        boxes([0.06, lamp, 0.3, L / 2, 0.65, W / 2 - 0.25], [0.06, lamp, 0.3, L / 2, 0.65, -W / 2 + 0.25]),
        material('#f4f0dc', '#fff4d0'),
      ),
      back: pool(
        boxes([0.06, lamp, 0.3, -L / 2, 0.75, W / 2 - 0.25], [0.06, lamp, 0.3, -L / 2, 0.75, -W / 2 + 0.25]),
        material('#8a1c16', tailGlow(lights)),
      ),
    };
    // over the tail lights, a little larger, and the third one at the top of the rear window (UN ECE R48)
    this.brakes = pool(
      boxes(
        [0.08, lamp + 0.04, 0.34, -L / 2 - 0.01, 0.73, W / 2 - 0.25],
        [0.08, lamp + 0.04, 0.34, -L / 2 - 0.01, 0.73, -W / 2 + 0.25],
        [0.06, 0.07, 0.45, -L * 0.31 - 0.03, 1.48, 0],
      ),
      brakeMaterial(lights),
    );
    // turn signals (#119): front and rear corner lamps of each side, +Z being the right
    this.indicators = indicators;
    /** @param {number} z */
    const corners = (z) =>
      boxes(
        [0.06, 0.1, 0.18, L / 2 + 0.01, 0.62, z * (W / 2 - 0.08)],
        [0.06, 0.1, 0.18, -L / 2 - 0.04, 0.78, z * (W / 2 - 0.08)],
      );
    this.signals = {
      left: pool(corners(-1), indicatorMaterial(indicators)),
      right: pool(corners(1), indicatorMaterial(indicators)),
    };
    for (const side of Object.values(this.signals)) side.mesh.castShadow = false;
    const B = p.bikeLength;
    this.bikes = {
      frame: pool(
        boxes([B * 0.9, 0.6, 0.08, 0, 0.05, 0], [0.5, 0.06, 0.12, B * 0.1, 1.0, 0]),
        material('#2a2a2a'),
      ),
      rider: pool(
        boxes([0.35, 0.7, 0.45, -B * 0.1, 0.95, 0], [0.25, 0.25, 0.25, -B * 0.05, 1.65, 0]),
        material('#ffffff'),
      ),
      light: pool(boxes([0.06, 0.1, 0.1, B * 0.46, 0.8, 0]), material('#f4f0dc', '#fff4d0')),
    };
    // light of the headlights on the road, shown at night only
    this.beamMaterial = new THREE.MeshBasicMaterial({
      map: beamTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
    this.beam = pool(
      new THREE.PlaneGeometry(p.beamLength, p.beamWidth)
        .rotateX(-Math.PI / 2)
        .translate(L / 2 + p.beamLength / 2, 0.3, 0),
      this.beamMaterial,
    );
    this.beam.mesh.castShadow = false;
    this.beam.mesh.renderOrder = 15;
    this.colour = new THREE.Color();
    // the colour attribute exists from the start: adding it later would rebuild the shaders
    for (const mesh of [this.cars.body.mesh, this.bikes.rider.mesh])
      for (let i = 0; i < capacity; i++) mesh.setColorAt(i, this.colour.set('#ffffff'));
    this.shown = 0;
  }

  /**
   * Night level of the headlight pools, 0 (day) to 1 (night).
   * @param {number} level
   */
  setNight(level) {
    this.beamMaterial.opacity = level * this.p.beamGlow;
    this.beamMaterial.visible = level > 0.01;
  }

  /**
   * Draw the vehicles nearest to the camera.
   * @param {import('./traffic.js').Vehicle[]} vehicles @param {number} x @param {number} y camera (m)
   * @param {(x: number, y: number, zRef: number | undefined) => number} heightAt drivable surface height near
   * the height of a vehicle's road (`zRef`, unknown without heights)
   * @param {number} time game time (s), for the blinking of the turn signals
   */
  draw(vehicles, x, y, heightAt, time) {
    const near = vehicles
      .map((v) => ({ v, d: Math.hypot(v.x - x, v.y - y) }))
      .filter((item) => item.d <= this.p.drawDistance)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.cars.body.capacity);
    let cars = 0,
      bikes = 0,
      braking = 0;
    const lit = { left: 0, right: 0 };
    for (const { v } of near) {
      // on the slope of the road under the wheels (#93)
      const { z, pitch, roll } = groundPose(v, v.length * this.p.wheelbaseShare, (px, py) =>
        heightAt(px, py, v.z),
      );
      if (v.bike) {
        for (const part of Object.values(this.bikes)) part.set(bikes, v.x, v.y, z, v.h, pitch, roll);
        this.bikes.rider.mesh.setColorAt(
          bikes,
          this.colour.set(RIDER_COLOURS[v.variant % RIDER_COLOURS.length]),
        );
        bikes++;
      } else {
        for (const part of Object.values(this.cars)) part.set(cars, v.x, v.y, z, v.h, pitch, roll);
        this.beam.set(cars, v.x, v.y, z, v.h, pitch, roll);
        if (v.braking) this.brakes.set(braking++, v.x, v.y, z, v.h, pitch, roll);
        // each car blinks with its own phase
        if (v.signal && blinkOn(time, this.indicators, v.id * 0.37))
          this.signals[v.signal].set(lit[v.signal]++, v.x, v.y, z, v.h, pitch, roll);
        this.cars.body.mesh.setColorAt(cars, this.colour.set(CAR_COLOURS[v.variant % CAR_COLOURS.length]));
        cars++;
      }
    }
    for (const part of Object.values(this.cars)) part.show(cars);
    this.beam.show(this.beamMaterial.visible ? cars : 0);
    this.brakes.show(braking);
    this.signals.left.show(lit.left);
    this.signals.right.show(lit.right);
    for (const part of Object.values(this.bikes)) part.show(bikes);
    for (const mesh of [this.cars.body.mesh, this.bikes.rider.mesh])
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.shown = cars + bikes;
  }
}
