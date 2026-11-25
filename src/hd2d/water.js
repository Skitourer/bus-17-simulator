// @ts-check
/**
 * Rivers and lakes (ADR 0005): flat water surfaces at the level computed by tools/water.py, with a pixel-art
 * shader (sky reflection, ripples, foam along the banks), and stone quay walls along the banks.
 */
import * as THREE from 'three';
import { ShoreIndex } from './shore.js';

/** @typedef {import('./ground.js').Ground} Ground */
/** @typedef {import('./ground.js').TileData} TileData */
/** @typedef {import('../settings/settings.js').Settings} Settings */

const VERTEX = `
attribute float shore;
varying float vShore;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vShore = shore;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = `
uniform float time, pixel, rippleSpeed, foamWidth;
uniform vec3 deep, foam, skyTop, skyMid;
varying float vShore;
varying vec3 vWorld;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // world-space water pixels: the pattern stays put when the camera moves
  vec2 p = floor(vWorld.xz / pixel) * pixel;
  float t = time * rippleSpeed;
  vec3 view = normalize(cameraPosition - vWorld);
  // a flat mirror reflects the sky at the elevation of the view ray; grazing views reflect more (Fresnel)
  vec3 sky = mix(skyMid, skyTop, clamp(view.y * 1.6, 0.0, 1.0));
  float fresnel = pow(1.0 - clamp(view.y, 0.0, 1.0), 3.0);
  vec3 c = mix(deep, sky, 0.2 + 0.6 * fresnel);
  // two crossed wave trains, warped so the crests break into short pixel glints
  float wave = sin(p.x * 0.8 + t * 1.3 + 2.0 * sin(p.y * 0.55 + t * 0.7))
             + sin(p.y * 0.95 - t * 1.1 + 2.0 * sin(p.x * 0.5 - t * 0.4));
  c = mix(c, sky * 1.12, step(1.75, wave) * 0.55);
  c = mix(c, deep * 0.85, step(wave, -1.8) * 0.35);
  // foam: a ragged band along the banks (vShore is the distance to the bank in metres), lapping in time
  float edge = vShore + foamWidth * (0.5 * (hash(p) - 0.5) + 0.3 * sin(t * 1.8 + p.x * 0.7 + p.y * 0.5));
  c = mix(c, foam, step(edge, foamWidth) * 0.85);
  c = floor(c * 20.0 + 0.5) / 20.0;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Water surfaces of every tile, one mesh.
 * @param {Ground} ground @param {Map<string, TileData>} tiles
 * @param {Settings['water']} params @param {Settings['render']} render
 */
export function waterSurface(ground, tiles, params, render) {
  /** @type {number[]} */
  const P = [];
  /** @type {number[]} */
  const S = [];
  /** @type {number[]} */
  const I = [];
  const shore = shoreIndex(ground, tiles, params.foamWidth * 3);
  for (const [key, tile] of tiles) {
    const [ox, oy] = tileOrigin(ground, key);
    for (const rings of tile.water) {
      const flat = rings.map((ring) => {
        const out = [];
        for (let k = 0; k + 1 < ring.length; k += 2)
          out.push(new THREE.Vector2(ox + ring[k] / 10, oy + ring[k + 1] / 10));
        return out;
      });
      const base = P.length / 3;
      for (const v of flat.flat()) {
        P.push(v.x, ground.waterLevel(v.x, v.y) ?? ground.h(v.x, v.y), -v.y);
        S.push(shore.distance(v.x, v.y));
      }
      const [contour, ...holes] = flat;
      for (const tri of THREE.ShapeUtils.triangulateShape(contour, holes))
        I.push(base + tri[0], base + tri[2], base + tri[1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('shore', new THREE.Float32BufferAttribute(S, 1));
  geo.setIndex(I);
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        time: { value: 0 },
        pixel: { value: params.pixelSize },
        rippleSpeed: { value: params.rippleSpeed },
        foamWidth: { value: params.foamWidth },
        deep: { value: new THREE.Color(params.deepColor) },
        foam: { value: new THREE.Color(params.foamColor) },
        skyTop: { value: new THREE.Color(render.skyTopColor) },
        skyMid: { value: new THREE.Color(render.skyMiddleColor) },
      },
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true,
    side: THREE.DoubleSide, // ring orientation from shapely is not guaranteed
  });
  return new THREE.Mesh(geo, material);
}

/**
 * Quay walls along the banks, from the ground down below the water.
 * @param {Ground} ground @param {Map<string, TileData>} tiles @param {Settings['water']} params
 */
export function quayWalls(ground, tiles, params) {
  /** @type {number[]} */
  const P = [];
  for (const [key, tile] of tiles) {
    const [ox, oy] = tileOrigin(ground, key);
    for (const line of tile.banks) {
      /** @type {number[][]} */
      const ends = [];
      for (let k = 0; k + 1 < line.length; k += 2) {
        const x = ox + line[k] / 10,
          y = oy + line[k + 1] / 10;
        const level = ground.waterLevel(x, y) ?? ground.h(x, y);
        // the wall always shows above the water, even where the bank is lower than the computed level
        const top = Math.max(ground.h(x, y), level + 0.15);
        ends.push([x, top, -y, level - params.wallDepth]);
      }
      for (let k = 0; k + 1 < ends.length; k++) {
        const [ax, at, az, ab] = ends[k],
          [bx, bt, bz, bb] = ends[k + 1];
        P.push(ax, ab, az, bx, bb, bz, bx, bt, bz, ax, ab, az, bx, bt, bz, ax, at, az);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: params.quayColor, side: THREE.DoubleSide, flatShading: true }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Banks of every tile in world metres.
 * @param {Ground} ground @param {Map<string, TileData>} tiles @param {number} maxDistance
 */
function shoreIndex(ground, tiles, maxDistance) {
  /** @type {number[][]} */
  const lines = [];
  for (const [key, tile] of tiles) {
    const [ox, oy] = tileOrigin(ground, key);
    for (const line of tile.banks) lines.push(line.map((v, k) => (k % 2 ? oy : ox) + v / 10));
  }
  return new ShoreIndex(lines, maxDistance);
}

/** @param {Ground} ground @param {string} key "i_j" @returns {[number, number]} tile origin (m) */
function tileOrigin(ground, key) {
  const [ti, tj] = key.split('_').map(Number);
  return [ground.index.x0 + ti * ground.index.size, ground.index.y0 + tj * ground.index.size];
}
