// @ts-check
/**
 * Instanced drawing (#47): many copies of one model in a single draw call. `BillboardPool` draws pixel-art
 * sprites from an atlas, standing upright and turned to the camera (trees, people, far vehicles);
 * `ModelPool` draws one 3D model at many places (near vehicles). Each frame the caller writes the visible
 * instances from 0 and sets their count.
 */
import * as THREE from 'three';

/**
 * Sprites of one atlas (variants side by side), anchored at their feet, turned around the vertical axis to
 * face the camera.
 */
/** Light on every billboard (#55): white by day, dark at night; billboards have no normals to light. */
const BILLBOARD_LIGHT = { value: new THREE.Color(1, 1, 1) };

/**
 * Colour the billboards are multiplied by, sRGB 0..1.
 * @param {[number, number, number]} tint
 */
export function setBillboardLight(tint) {
  BILLBOARD_LIGHT.value.setRGB(...tint, THREE.SRGBColorSpace);
}

export class BillboardPool {
  /**
   * @param {HTMLCanvasElement | THREE.Texture} atlas variants of equal width, side by side (a texture may be
   *   shared by several pools)
   * @param {number} variants number of variants in the atlas @param {number} capacity largest instance count
   */
  constructor(atlas, variants, capacity) {
    const map = atlas instanceof THREE.Texture ? atlas : new THREE.CanvasTexture(atlas);
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.colorSpace = THREE.SRGBColorSpace;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position);
    geometry.setAttribute('uv', quad.attributes.uv);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.scale = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    this.variant = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const attribute of [this.offset, this.scale, this.variant])
      attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('offset', this.offset);
    geometry.setAttribute('scale', this.scale);
    geometry.setAttribute('variant', this.variant);
    geometry.instanceCount = 0;
    this.geometry = geometry;
    this.capacity = capacity;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: map } }]);
    // shared by reference (merge would copy it): one update lights every pool
    uniforms.light = BILLBOARD_LIGHT;
    const material = new THREE.ShaderMaterial({
      uniforms,
      fog: true,
      vertexShader: `
        attribute vec3 offset; attribute vec2 scale; attribute float variant;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vUv = vec2((uv.x + variant) / ${variants}.0, uv.y);
          // cylindrical billboard: faces the camera, stays upright
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          vec3 wp = offset + right * position.x * scale.x + vec3(0.0, position.y * scale.y, 0.0);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 light;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb * light, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false; // instances spread over the map: the pool bounds mean nothing
  }

  /**
   * Instance `i` with its feet at world (x, height z, y north), `width` × `height` m, atlas variant `v`.
   * @param {number} i @param {number} x @param {number} y @param {number} z
   * @param {number} width @param {number} height @param {number} v
   */
  set(i, x, y, z, width, height, v) {
    this.offset.setXYZ(i, x, z, -y);
    this.scale.setXY(i, width, height);
    this.variant.setX(i, v);
  }

  /** Draw the first `count` instances. @param {number} count */
  show(count) {
    this.geometry.instanceCount = Math.min(count, this.capacity);
    for (const attribute of [this.offset, this.scale, this.variant]) attribute.needsUpdate = true;
  }
}

/**
 * Boxes merged into one geometry, origin on the ground at the middle of the model, +X forward.
 * @param {...number[]} list [length, height, width, x, y, z] of each box (y: bottom)
 */
export function boxes(...list) {
  const parts = list.map(([l, h, w, x, y, z]) => new THREE.BoxGeometry(l, h, w).translate(x, y + h / 2, z));
  /** @type {number[]} */
  const positions = [],
    normals = [],
    indices = [];
  let offset = 0;
  for (const part of parts) {
    positions.push(...part.attributes.position.array);
    normals.push(...part.attributes.normal.array);
    for (const i of /** @type {THREE.BufferAttribute} */ (part.index).array) indices.push(i + offset);
    offset += part.attributes.position.count;
    part.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** One 3D model at many places, each with its heading. */
export class ModelPool {
  /**
   * @param {THREE.BufferGeometry} geometry model with its origin on the ground, +X forward
   * @param {THREE.Material | THREE.Material[]} material @param {number} capacity
   */
  constructor(geometry, material, capacity) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.capacity = capacity;
    this.matrix = new THREE.Matrix4();
    this.rotation = new THREE.Quaternion();
    this.position = new THREE.Vector3();
    this.unit = new THREE.Vector3(1, 1, 1);
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  /**
   * Instance `i` at world (x, height z, y north), heading `h` (math angle, 0 = east), tilted by `pitch`
   * (nose up) and `roll` (left side up) like the player's bus.
   * @param {number} i @param {number} x @param {number} y @param {number} z @param {number} h
   * @param {number} [pitch] @param {number} [roll]
   */
  set(i, x, y, z, h, pitch = 0, roll = 0) {
    this.rotation.setFromEuler(this.euler.set(roll, h, pitch, 'YXZ'));
    this.matrix.compose(this.position.set(x, z, -y), this.rotation, this.unit);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  /** Draw the first `count` instances. @param {number} count */
  show(count) {
    this.mesh.count = Math.min(count, this.capacity);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
