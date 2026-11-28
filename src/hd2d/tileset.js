// @ts-check
/**
 * World tiles in the scene (#12): every tile has a light ground, always drawn when its detailed layers are
 * not; the detailed layers (5 m ground, streets, trees, buildings) are built as the bus comes near, a few
 * milliseconds per frame, shown by distance and freed once the bus is far (tiling.js).
 */
import * as THREE from 'three';
import { buildOrder, rectDistance, tileLevels } from './tiling.js';

/**
 * @typedef {object} TileLayers
 * @property {THREE.Object3D} fineGround @property {THREE.Object3D} streets
 * @property {THREE.Object3D} trees @property {THREE.Object3D} buildings
 */

/** @param {THREE.Object3D} object */
function dispose(object) {
  object.traverse((child) => {
    const mesh = /** @type {THREE.Mesh} */ (child);
    if (!mesh.geometry) return;
    mesh.geometry.dispose();
    for (const material of [mesh.material].flat()) material.dispose(); // textures are shared: kept
  });
}

export class TileSet {
  /**
   * @param {THREE.Scene} scene
   * @param {{key: string, rect: import('./tiling.js').Rect}[]} tiles
   * @param {(key: string) => THREE.Object3D} light light ground of a tile, built at once for all tiles
   * @param {(key: string) => TileLayers} build detailed layers of a tile
   * @param {import('../settings/settings.js').Settings['tiles']} params
   */
  constructor(scene, tiles, light, build, params) {
    this.scene = scene;
    this.tiles = tiles;
    this.build = build;
    this.p = params;
    /** @type {Map<string, THREE.Object3D>} */
    this.light = new Map(tiles.map((t) => [t.key, light(t.key)]));
    for (const ground of this.light.values()) scene.add(ground);
    /** @type {Map<string, TileLayers>} */
    this.built = new Map();
  }

  /**
   * Build the tiles near the bus within `budget` ms (at least one), free the far ones, and show each layer
   * by distance.
   * @param {number} x @param {number} y bus position (m) @param {number} budget milliseconds
   */
  update(x, y, budget) {
    const start = performance.now();
    for (const key of buildOrder(this.tiles, new Set(this.built.keys()), x, y, this.p)) {
      const layers = this.build(key);
      for (const layer of Object.values(layers)) this.scene.add(layer);
      this.built.set(key, layers);
      if (performance.now() - start > budget) break;
    }
    for (const { key, rect } of this.tiles) {
      const levels = tileLevels(rectDistance(rect, x, y), this.p);
      const layers = this.built.get(key);
      if (layers && !levels.keep) {
        for (const layer of Object.values(layers)) {
          this.scene.remove(layer);
          dispose(layer);
        }
        this.built.delete(key);
      }
      const fine = Boolean(layers && levels.keep && levels.fineGround);
      /** @type {THREE.Object3D} */ (this.light.get(key)).visible = !fine;
      if (!layers || !levels.keep) continue;
      layers.fineGround.visible = fine;
      layers.streets.visible = levels.streets;
      layers.trees.visible = levels.trees;
    }
  }

  /** Number of tiles with their detailed layers built, for the debug panel. */
  get count() {
    return this.built.size;
  }
}
