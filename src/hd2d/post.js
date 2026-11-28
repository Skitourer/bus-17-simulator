// @ts-check
/**
 * Rendu HD-2D : la scene est rendue en basse resolution (pixels visibles), puis recomposee a l'ecran
 * avec un flou de mise au point en haut et en bas de l'image (effet maquette / tilt-shift),
 * un vignettage et un leger etalonnage chaud.
 */
import * as THREE from 'three';
import { renderFromInside } from './interior.js';

export class Post {
  /**
   * @param {THREE.WebGLRenderer} renderer @param {number} lines height of the internal image (px)
   * @param {number} band half height of the sharp band (share of the screen height)
   */
  constructor(renderer, lines, band) {
    this.r = renderer;
    this.lines = lines;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { samples: 0, type: THREE.HalfFloatType });
    this.rt.texture.magFilter = THREE.NearestFilter;
    this.rt.texture.minFilter = THREE.NearestFilter;
    this.rt.texture.generateMipmaps = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        texel: { value: new THREE.Vector2() },
        focus: { value: 0.58 },
        band: { value: band },
        blur: { value: 2.2 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 texel; uniform float focus, band, blur;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          float d = max(0.0, abs(vUv.y - focus) - band);
          float rad = min(1.0, d * 3.0) * blur;
          vec3 c = base.rgb;
          if (rad > 0.05) {
            vec3 acc = c; float n = 1.0;
            for (int i = 0; i < 12; i++) {
              float a = float(i) * 2.39996;
              float r = rad * sqrt(float(i + 1) / 12.0);
              acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * texel).rgb; n += 1.0;
            }
            c = acc / n;
          }
          // etalonnage : un peu de chaleur et de saturation, vignettage doux
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(vec3(l), c, 1.12) * vec3(1.03, 1.0, 0.96);
          vec2 q = vUv - 0.5;
          c *= 1.0 - dot(q, q) * 0.45;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /** taille de l'ecran (pixels CSS) -> resolution interne @param {number} w @param {number} h */
  resize(w, h) {
    const ih = this.lines,
      iw = Math.round((ih * w) / h);
    this.rt.setSize(iw, ih);
    this.mat.uniforms.texel.value.set(1 / iw, 1 / ih);
    return { iw, ih };
  }

  /**
   * @param {THREE.Scene} scene @param {THREE.Camera} camera
   * @param {THREE.Object3D | null} interior inside of the bus when the camera is in it
   */
  render(scene, camera, interior) {
    this.r.setRenderTarget(this.rt);
    if (interior) renderFromInside(this.r, scene, camera, interior);
    else this.r.render(scene, camera);
    this.r.setRenderTarget(null);
    this.r.render(this.scene, this.cam);
  }
}
