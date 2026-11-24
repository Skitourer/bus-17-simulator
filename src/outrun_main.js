// @ts-check
/** Prototype pseudo-3D (OutRun) : chargement, boucle de jeu a pas fixe. Parametres : voir common/service.js. */
import { Track } from './world/track.js';
import { buildScenery } from './world/scenery.js';
import { ROAD } from './world/road_geom.js';
import { Camera } from './render/camera.js';
import { Scene } from './render/scene.js';
import { Bus, BUS_LEN } from './sim/bus.js';
import { Minimap } from './ui/minimap.js';
import { drawHud } from './ui/hud.js';
import { readParams, ServiceClock } from './common/service.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: false }));
/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {import('./common/types.js').DriveInput} */
const keys = { up: false, down: false, left: false, right: false };
/** @type {Record<string, keyof import('./common/types.js').DriveInput>} */
const KEYMAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

// assigned by load() and start(), before the game state becomes 'play'
/** @type {import('./common/types.js').LineData} */
let line;
/** @type {import('./common/types.js').MapData | null} */
let map;
/** @type {Scene} */
let scene;
/** @type {Minimap} */
let minimap;
/** @type {Track} */
let track;
/** @type {{key: string, d: number}[][]} */
let scenery;
/** @type {Bus} */
let bus;
/** @type {Camera} */
let cam;
let state = 'menu',
  paused = false;
let next = 0,
  served = 0,
  doors = 0,
  msg = '',
  msgT = 0;

const P = readParams();
const clock = new ServiceClock(P.dep);

async function load() {
  const [l, m] = await Promise.all([
    fetch('data/grenoble/17.json').then((r) => r.json()),
    fetch('data/grenoble/map.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  line = l;
  map = m;
  scene = new Scene(ctx, line.horizon);
  minimap = new Minimap($('map'), map, line);
  start(P.dir);
  // mode test : outrun.html?dir=0&s=1500&auto  (position de depart, pilote automatique)
  if (P.s !== null) {
    bus.s = P.s;
    cam.ready = false;
    cam.follow(track, bus, STEP);
  }
  autopilot = P.auto;
  if (P.map) minimap.zoomBy(P.map);
}
let autopilot = false;
window.addEventListener('error', (e) => {
  document.body.dataset.error = String(e.message);
});

/** @param {number} i direction index */
function start(i) {
  const d = line.directions[i];
  track = new Track(d, line.step);
  track.stops.forEach((s) => {
    s.served = false;
  });
  scenery = P.nodecor ? Array.from({ length: track.n }, () => []) : buildScenery(track, map);
  bus = new Bus();
  bus.s = Math.max(-4, track.stops[0].s - BUS_LEN - 18);
  cam = new Camera();
  cam.follow(track, bus, 1 / 60);
  minimap.setTrack(track);
  next = 0;
  served = 0;
  doors = 0;
  say('Départ ' + P.dep + ' : ' + track.stops[0].name, 3);
  state = 'play';
  $('start').hidden = true;
  $('map').hidden = false;
}

/** @param {string} t */
function say(t, dur = 2.5) {
  msg = t;
  msgT = dur;
}

/** @param {number} dt */
function update(dt) {
  clock.tick(dt);
  if (doors > 0) {
    doors -= dt;
    bus.update(track, { up: false, down: true, left: false, right: false }, dt);
    if (doors <= 0)
      say(
        next < track.stops.length
          ? 'Prochain arrêt : ' + track.stops[next].name
          : 'Terminus ! Fin du service.',
        3,
      );
  } else if (autopilot) {
    // pilote de test : tient la voie de droite a ~35 km/h
    const want = ROAD.LANE - track.curv(bus.s + 15) * bus.v * bus.v * 0.4;
    bus.update(
      track,
      { up: bus.v < 10, down: false, left: bus.lat > want + 0.15, right: bus.lat < want - 0.15 },
      dt,
    );
  } else bus.update(track, keys, dt);
  cam.follow(track, bus, dt);

  // desserte : l'avant du bus (porte avant) a hauteur de l'arret, contre le trottoir, a l'arret
  const st = track.stops[next];
  if (st && doors <= 0) {
    const front = bus.s + BUS_LEN - 2;
    const d = front - st.s;
    if (Math.abs(d) < 7 && Math.abs(bus.v) < 0.3 && bus.lat > ROAD.LANE - 0.6) {
      st.served = true;
      served++;
      next++;
      doors = 2.8;
      say(st.name, 2.8);
    } else if (d > 25) {
      // arret depasse
      st.served = false;
      next++;
      say('Arrêt manqué : ' + st.name, 3);
    }
  }
  if (msgT > 0 && (msgT -= dt) <= 0) msg = '';
}

let perfAcc = 0,
  perfN = 0;
function render() {
  const t0 = performance.now();
  scene.draw(track, cam, scenery, bus);
  drawHud(ctx, { bus, track, next: track.stops[next], served, msg, doors, paused, clock });
  minimap.draw(track.pos(bus.s + 6, bus.lat), next);
  perfAcc += performance.now() - t0;
  if (++perfN === 60) {
    document.body.dataset.ms = (perfAcc / 60).toFixed(2);
    perfAcc = 0;
    perfN = 0;
  }
}

let last = performance.now(),
  acc = 0;
const STEP = 1 / 60;
/** @param {number} t */
function frame(t) {
  requestAnimationFrame(frame);
  const el = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (state !== 'play') return;
  if (!paused) {
    acc += el;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
  }
  render();
}
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) {
    keys[k] = true;
    e.preventDefault();
  }
  if (state !== 'play') return;
  if (e.code === 'KeyM') minimap.cycleSize();
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'Escape') {
    if (paused) location.href = 'index.html';
    else paused = true;
  }
  if (e.code === 'KeyR') {
    bus.lat = ROAD.LANE;
    bus.v = 0;
    say('Bus replacé');
  }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') minimap.zoomBy(1.5);
  if (e.code === 'Minus' || e.code === 'Digit6' || e.code === 'NumpadSubtract') minimap.zoomBy(1 / 1.5);
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
addEventListener('blur', () => {
  keys.up = keys.down = keys.left = keys.right = false;
});

load().catch((e) => {
  $('loading').textContent = 'Erreur de chargement : ' + e.message + ' (lancer via un serveur http local)';
});
if (!location.search) location.replace('index.html');
