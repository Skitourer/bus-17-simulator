// @ts-check
/**
 * Drawing of the traffic lights (#77): a pole and a head with three lamps at each approach of the
 * signalised junctions, in three instanced draws for the whole map. The lamps are unlit materials, bright
 * day and night; only the lamp of the current light is on.
 */
import * as THREE from 'three';

/** Lamp colours, top to bottom, on and off. */
const LAMPS = /** @type {const} */ ([
  ['red', '#ff3b2f'],
  ['amber', '#ffb020'],
  ['green', '#35e070'],
]);
const OFF = new THREE.Color('#2a2a2a');

export class SignalLook {
  /**
   * @param {THREE.Scene} scene @param {import('./signals.js').SignalMap} signals
   * @param {(x: number, y: number) => number} ground height of the sidewalk at (x, y)
   * @param {import('./signals.js').SignalSettings} settings
   */
  constructor(scene, signals, ground, settings) {
    this.signals = signals;
    // a head of three lenses one above the other, in a box a little wider than them
    const pole = settings.poleHeight,
      lens = settings.lensSize,
      lampStep = lens * 1.3,
      headHeight = lampStep * 3 + lens * 0.3,
      headWidth = lens * 1.5;
    const heads = signals.heads;
    const count = Math.max(1, heads.length);
    const poles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, pole + headHeight, 0.12).translate(0, (pole + headHeight) / 2, 0),
      new THREE.MeshLambertMaterial({ color: '#3b3f44' }),
      count,
    );
    const boxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2, headHeight, headWidth).translate(-0.12, pole + headHeight / 2, 0),
      new THREE.MeshLambertMaterial({ color: '#16181a' }),
      count,
    );
    // the lamps face the drivers coming along the approach: on the -x side of the head (x forward)
    this.lamps = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(lens, lens).rotateY(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      count * LAMPS.length,
    );
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      up = new THREE.Vector3(0, 1, 0),
      one = new THREE.Vector3(1, 1, 1);
    heads.forEach((head, i) => {
      const z = ground(head.x, head.y);
      q.setFromAxisAngle(up, head.h);
      m.compose(new THREE.Vector3(head.x, z, -head.y), q, one);
      poles.setMatrixAt(i, m);
      boxes.setMatrixAt(i, m);
      LAMPS.forEach((_, k) => {
        const lift = pole + headHeight / 2 + (1 - k) * lampStep;
        const local = new THREE.Vector3(-0.23, lift, 0).applyQuaternion(q);
        m.compose(new THREE.Vector3(head.x + local.x, z + local.y, -head.y + local.z), q, one);
        this.lamps.setMatrixAt(i * LAMPS.length + k, m);
        this.lamps.setColorAt(i * LAMPS.length + k, OFF);
      });
    });
    for (const mesh of [poles, boxes, this.lamps]) {
      mesh.count = heads.length * (mesh === this.lamps ? LAMPS.length : 1);
      mesh.castShadow = mesh !== this.lamps;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    }
    this.colours = LAMPS.map(([, colour]) => new THREE.Color(colour));
    /** @type {string[]} light shown by each head, to update only the lamps that change */
    this.shown = heads.map(() => '');
  }

  /** Switch the lamps to the lights of the moment. */
  update() {
    let changed = false;
    this.signals.heads.forEach((head, i) => {
      const light = this.signals.light(head.group, head.phase);
      if (light === this.shown[i]) return;
      this.shown[i] = light;
      changed = true;
      LAMPS.forEach(([name], k) =>
        this.lamps.setColorAt(i * LAMPS.length + k, name === light ? this.colours[k] : OFF),
      );
    });
    if (changed && this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
