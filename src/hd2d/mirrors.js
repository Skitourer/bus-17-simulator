// @ts-check
/**
 * Mirrors of the cabin view: the exterior ones (#18), the scene seen backwards from each front corner of
 * the bus, and the interior one (#42), the convex mirror above the windscreen that shows the passengers and
 * the doors. Rendered at a low resolution (HD-2D pixels), flipped like a mirror and drawn over the
 * windscreen.
 */
import * as THREE from 'three';
import { mirrorRects } from './views.js';

/** @typedef {import('../settings/settings.js').Settings} Settings */

export class Mirrors {
  /**
   * @param {THREE.WebGLRenderer} renderer @param {Settings['camera']['mirrors']} params
   * @param {Settings['bus']} bus
   */
  constructor(renderer, params, bus) {
    this.r = renderer;
    this.p = params;
    this.bus = bus;
    const lines = params.lines,
      width = Math.round(lines * params.aspect);
    /** @param {number} w @param {number} h */
    const pixels = (w, h) => {
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
      target.texture.magFilter = THREE.NearestFilter;
      target.texture.minFilter = THREE.NearestFilter;
      return target;
    };
    /** @type {{target: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera, side: number}[]} */
    this.sides = [-1, 1].map((side) => ({
      target: pixels(width, lines),
      camera: new THREE.PerspectiveCamera(params.fov, params.aspect, 0.3, 4000),
      side,
    }));
    this.inside = {
      target: pixels(Math.round(lines * params.insideAspect), lines),
      camera: new THREE.PerspectiveCamera(params.insideFov, params.insideAspect, 0.1, 60),
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // mirrored left to right
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(map, vec2(1.0 - vUv.x, vUv.y));
        #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.local = new THREE.Vector3();
    this.ahead = new THREE.Vector3();
  }

  /**
   * Screen rectangles of the mirrors for the current window size.
   * @param {number} width @param {number} height
   */
  rects(width, height) {
    return mirrorRects(width, height, this.p);
  }

  /**
   * Render one mirror into its pixels, then flipped into its rectangle of the screen.
   * @param {THREE.Scene} scene @param {THREE.Camera} camera @param {THREE.WebGLRenderTarget} target
   * @param {{x: number, y: number, w: number, h: number}} rect @param {number} height screen height
   */
  draw(scene, camera, target, rect, height) {
    const r = this.r;
    r.setRenderTarget(target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    // WebGL viewports start at the bottom left
    r.setViewport(rect.x, height - rect.y - rect.h, rect.w, rect.h);
    r.setScissor(rect.x, height - rect.y - rect.h, rect.w, rect.h);
    r.setScissorTest(true);
    this.mat.uniforms.map.value = target.texture;
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
  }

  /**
   * Render the three mirrors over the screen, after the main view.
   * @param {THREE.Scene} scene @param {THREE.Object3D} body bus body (mirrors move with it)
   * @param {number} width @param {number} height screen size (CSS pixels)
   */
  render(scene, body, width, height) {
    const r = this.r,
      b = this.bus;
    const rects = this.rects(width, height);
    // the shadow map of the main view is still valid: do not redraw it for each mirror
    r.shadowMap.autoUpdate = false;
    body.updateMatrixWorld();
    for (const { target, camera, side } of this.sides) {
      // mirror head just outside the front corner, at the driver's eye height, looking back along the side
      const x = b.bodyLength - b.rearOverhang - 0.3,
        z = side * (b.bodyWidth / 2 + 0.35);
      camera.position.copy(body.localToWorld(this.local.set(x, this.p.height, z)));
      camera.lookAt(
        body.localToWorld(this.ahead.set(x - 10, this.p.height - 0.6, z + side * this.p.outward)),
      );
      this.draw(scene, camera, target, side < 0 ? rects.left : rects.right, height);
    }
    // interior mirror above the middle of the windscreen, looking down the aisle towards the rear
    const x = b.bodyLength - b.rearOverhang - 0.25;
    const { camera, target } = this.inside;
    camera.position.copy(body.localToWorld(this.local.set(x, this.p.insideHeight, 0)));
    camera.lookAt(body.localToWorld(this.ahead.set(x - 10, this.p.insideHeight - this.p.insideDrop, 0)));
    this.draw(scene, camera, target, rects.inside, height);
    r.setViewport(0, 0, width, height);
    r.shadowMap.autoUpdate = true;
  }
}
