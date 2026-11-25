// @ts-check
/**
 * Prototype HD-2D : Grenoble reelle (relief IGN, bati et arbres OSM) en 3D basse resolution + sprites,
 * conduite libre, suivi du parcours de la ligne 17, desserte des arrets aux horaires reels.
 */
import * as THREE from 'three';
import { Track } from '../world/track.js';
import { Minimap } from '../ui/minimap.js';
import { readParams, ServiceClock, serviceLabel, hms, hm, delta } from '../common/service.js';
import { Ground } from './ground.js';
import { buildWorld } from './world.js';
import { makeBus } from './bus3d.js';
import { Drive, obstacles } from './drive.js';
import { Post } from './post.js';
import { OrbitCamera } from './orbit.js';
import { FreeFly, findStop, stepStop, turboDrive } from './debug.js';
import { Doors, StopService, drawRequests, serviceSeed } from './stops.js';
/** @typedef {import('./stops.js').StopEvent} StopEvent */
import { initI18n, t } from '../i18n/i18n.js';
import { loadSettings } from '../settings/settings.js';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const P = readParams();
if (!location.search) location.replace('index.html');
const S = await boot();
const B = S.bus;

// ------------------------------------------------------------------ rendu
const canvas = /** @type {HTMLCanvasElement} */ ($('view'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const post = new Post(renderer, S.render.internalLines, S.render.tiltShiftBand);
const scene = new THREE.Scene();
const fogColor = new THREE.Color(S.render.fogColor);
scene.fog = new THREE.Fog(fogColor, S.render.fogNear, S.render.fogFar);
scene.background = fogColor;
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 1, S.render.viewDistance);

// ciel en degrade (dome qui suit la camera)
const sky = new THREE.Mesh(
  // just inside the far plane, so it is never clipped
  new THREE.SphereGeometry((S.render.viewDistance * 8) / 9, 24, 12),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(S.render.skyTopColor) },
      mid: { value: new THREE.Color(S.render.skyMiddleColor) },
      bot: { value: fogColor },
    },
    vertexShader:
      'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot; varying vec3 vDir;
    void main(){ float h = vDir.y; vec3 c = h < 0.03 ? bot : (h < 0.25 ? mix(bot, mid, (h-0.03)/0.22) : mix(mid, top, min(1.0,(h-0.25)/0.5)));
    float band = floor(h * 40.0) / 40.0; c = mix(c, c * 0.985, step(0.5, fract(band * 20.0)));
    gl_FragColor = vec4(c, 1.0);
    // a preprocessor directive must start its own line
    #include <colorspace_fragment>
    }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

// lumieres : soleil d'apres-midi au sud-ouest, ombres autour du bus
const hemi = new THREE.HemisphereLight('#dfeaff', '#6d6450', S.render.skyLightIntensity);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', S.render.sunIntensity);
const sunAzimuth = (S.render.sunAzimuth * Math.PI) / 180,
  sunElevation = (S.render.sunElevation * Math.PI) / 180;
const sunDir = new THREE.Vector3(
  Math.sin(sunAzimuth) * Math.cos(sunElevation),
  Math.sin(sunElevation),
  -Math.cos(sunAzimuth) * Math.cos(sunElevation),
);
sun.castShadow = true;
sun.shadow.mapSize.set(S.render.shadowMapSize, S.render.shadowMapSize);
const shadowRadius = S.render.shadowRadius;
Object.assign(sun.shadow.camera, {
  left: -shadowRadius,
  right: shadowRadius,
  top: shadowRadius,
  bottom: -shadowRadius,
  near: 10,
  far: 900,
});
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

function resize() {
  const w = innerWidth,
    h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.resize(w, h);
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ etat de jeu
/** @type {import('../common/types.js').DriveInput} */
const keys = { up: false, down: false, left: false, right: false };
/** @type {Record<string, keyof import('../common/types.js').DriveInput>} */
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
// assigned once by load(), before the first frame
/** @type {Ground} */
let hf;
/** height of the bus on the drivable surface (decides between a bridge deck and the ground below) */
let busZ = 0;
/** @type {Track} */
let track;
/** @type {ReturnType<typeof buildWorld>} */
let world;
/** @type {ReturnType<typeof makeBus>} */
let bus;
/** @type {Minimap} */
let minimap;
/** @type {import('../common/types.js').LineData} */
let line;
const drive = new Drive(S.drive, B);
const clock = new ServiceClock(P.dep);
let bumps = 0,
  progress = 0,
  offT = 0,
  paused = false,
  running = false;
const CAMS = /** @type {const} */ (['hd2d', 'chase', 'sky']).map((id) => ({
  name: 'camera.' + id,
  ...S.camera[id],
}));
let camMode = +(new URLSearchParams(location.search).get('cam') || 0) % CAMS.length,
  zoom = 1,
  camYaw = 0;
const orbit = new OrbitCamera(S.camera.orbit);
const doors = new Doors(S.gameplay);
/** @type {StopService} */
let service;
// debug mode: free flight, collisions off (ghost), turbo
const fly = new FreeFly(S.debug, S.camera.orbit);
const turboParams = turboDrive(S.drive, S.debug);
const flyKeys = { up: false, down: false, fast: false };
let flying = false,
  ghost = false,
  fps = 60;

/** @param {string} text */
function toast(text, kind = 'info') {
  const d = document.createElement('div');
  d.className = 'toast ' + kind;
  d.textContent = text;
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), 2800);
}

/**
 * abscisse du point du trace le plus proche (recherche locale autour de `hint`, ou globale)
 * @param {number} x @param {number} y @param {number} hint @param {number} win 0 = global search
 */
function nearest(x, y, hint, win) {
  const st = track.step;
  const i0 = win ? Math.max(0, Math.floor((hint - win) / st)) : 0;
  const i1 = win ? Math.min(track.n - 1, Math.ceil((hint + win) / st)) : track.n - 1;
  let best = 1e18,
    bi = i0;
  for (let i = i0; i <= i1; i++) {
    const d = (track.x[i] - x) ** 2 + (track.y[i] - y) ** 2;
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return { s: bi * st, d: Math.sqrt(best) };
}

/** @param {number} s */
function placeOnRoute(s) {
  const p = track.pos(s, S.gameplay.laneOffset);
  drive.place(p.x, p.y, p.h);
  busZ = p.z; // route altitude: picks the deck when the route is on a bridge
  progress = s + B.rearOverhang;
  camYaw = p.h;
}

// ------------------------------------------------------------------ chargement
async function load() {
  document.title = t('game.pageTitle');
  $('loadMsg').textContent = t('game.loadingCity');
  /** @param {string} f */
  const get = (f) =>
    fetch('data/grenoble/' + f).then((r) => {
      if (!r.ok) throw new Error(f);
      return r.json();
    });
  const [l, map, terrain, tileIndex] = await Promise.all([
    get('17.json'),
    get('map.json').catch(() => null),
    get('terrain.json'),
    get('tiles/index.json'),
  ]);
  /** @type {Map<string, import('./ground.js').TileData>} */
  const tiles = new Map();
  /** @type {Promise<void>[]} */
  const loads = [];
  for (let j = 0; j < tileIndex.ny; j++)
    for (let i = 0; i < tileIndex.nx; i++)
      loads.push(get(`tiles/t_${i}_${j}.json`).then((tile) => void tiles.set(`${i}_${j}`, tile)));
  await Promise.all(loads);
  line = l;
  hf = new Ground(terrain, tileIndex, tiles, S.world.deckCatch, S.world.deckMargin);
  track = new Track(line.directions[P.dir], line.step);
  track.stops.forEach((s) => {
    s.served = false;
    s.missed = false;
  });
  $('loadMsg').textContent = t('game.loadingStreets');
  await new Promise((r) => setTimeout(r, 30));
  world = buildWorld(scene, hf, { map, tiles }, track, S);
  bus = makeBus(B);
  scene.add(bus.group);
  minimap = new Minimap($('map'), map, line);
  minimap.setTrack(track);
  if (P.map) minimap.zoomBy(P.map);
  buildSynoptic();
  $('svc').textContent = t('game.serviceInfo', { day: serviceLabel(P.day, line.calendar), time: P.dep });
  placeOnRoute(P.s !== null ? P.s : Math.max(0, track.stops[0].s - 4));
  // arrets deja derriere le point de depart (mode test)
  service = new StopService(
    track.stops,
    drawRequests(track.stops.length, serviceSeed(P.dep, P.dir), S.gameplay),
    S.gameplay,
  );
  service.reset(progress);
  if (P.stop) {
    const i = findStop(track.stops, P.stop);
    if (i >= 0) placeAtStop(i);
    else
      toast(
        t('debug.unknownStop', { stop: P.stop, stops: track.stops.map((st) => st.name).join(', ') }),
        'bad',
      );
  }
  if (P.debug) {
    $('debug').hidden = false;
    minimap.onPick = (x, y) => void teleport(x, y);
    toast(t('debug.on'), 'info');
  }
  // mode test : ?auto&ff=40 -> simule 40 s d'un coup (pilote automatique)
  const ff = +(new URLSearchParams(location.search).get('ff') || 0);
  for (let i = 0; i < ff * S.simulation.stepsPerSecond; i++) update(STEP);
  document.body.dataset.progress =
    progress.toFixed(1) +
    ' / off ' +
    offT.toFixed(1) +
    ' / v ' +
    drive.v.toFixed(2) +
    ' / next ' +
    service.next +
    ' / bumps ' +
    bumps +
    ' / lat ' +
    nearest(drive.center.x, drive.center.y, progress, 60).d.toFixed(1);
  $('loading').hidden = true;
  running = true;
  toast(t('toast.serviceStart', { time: P.dep, stop: track.stops[track.stops.length - 1].name }), 'info');
}

function buildSynoptic() {
  const box = $('trStops');
  box.innerHTML = '';
  track.stops.forEach((st, i) => {
    const d = document.createElement('div');
    d.className = 'st';
    d.id = 'st' + i;
    d.title = st.name;
    d.style.left = (st.s / track.length) * 100 + '%';
    box.appendChild(d);
  });
}

// ------------------------------------------------------------------ simulation
/** @param {number} dt */
function update(dt) {
  const G = S.gameplay;
  clock.tick(dt);
  /** @type {import('../common/types.js').DriveInput} */
  let inp = flying ? { up: false, down: false, left: false, right: false } : keys;
  if (P.auto) inp = autopilot();
  const wasClosed = doors.closed;
  doors.update(dt);
  if (!wasClosed && doors.closed) announceNextStop();
  const walls = obstacles(world.index, hf, () => busZ, ghost);
  // the bus stands still until the doors are closed again (brake on, even on a slope)
  /** @type {'bump' | null} */
  let ev = null;
  if (doors.closed) ev = drive.update(inp, dt, { slope: (x, y, hd) => hf.slopeAt(x, y, hd, busZ) }, walls);
  else drive.hold();
  // height on the drivable surface, kept by the simulation (fast-forward runs without rendering)
  busZ = hf.surface(drive.x, drive.y, busZ);
  if (drive.bump === 0) bumps++;
  if (ev) toast(t('toast.' + ev), 'bad');

  // suivi du parcours
  const c = drive.center;
  let n = nearest(c.x, c.y, progress, 60);
  if (n.d > 25) {
    const g = nearest(c.x, c.y, 0, 0);
    if (g.d < n.d) n = g;
  }
  progress = n.s;
  offT = n.d > G.offRouteDistance ? offT + dt : 0;
  $('offroute').hidden = offT < G.offRouteDelay;

  // stop service: the front door (front right of the bus) at the stop, doors open long enough
  const st = track.stops[service.next];
  const door = drive.point(doorAhead(), B.bodyWidth / 2);
  const event = service.update(dt, {
    progress,
    doorDistance: st ? Math.hypot(door.x - st.x, door.y - st.y) : Infinity,
    doorsOpen: doors.open,
    onRoute: n.d < 25,
  });
  if (event) stopToast(event);
}

/** pilote de test (?auto) : suit le trace dans la voie de droite */
function autopilot() {
  // 8 m ahead: a longer look cuts the corners onto the bridges, over the quays (water collision)
  const look = track.pos(progress + 8, S.gameplay.laneOffset);
  const c = drive.point(B.wheelbase, 0);
  const want = Math.atan2(look.y - c.y, look.x - c.x);
  let err = want - drive.h;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  return { up: drive.v < 8, down: false, left: err > 0.03, right: err < -0.03 };
}

/** Toast for a stop that was served, missed or passed without request. @param {StopEvent} event */
function stopToast(event) {
  const st = track.stops[event.index];
  if (event.type === 'served') {
    const late = clock.t - clock.sched(st);
    toast(
      Math.abs(late) < S.gameplay.onTimeTolerance
        ? t('toast.servedOnTime', { stop: st.name })
        : t('toast.servedDelta', { stop: st.name, delta: delta(late) }),
      'good',
    );
  } else if (event.type === 'missed') toast(t('toast.missedStop', { stop: st.name }), 'bad');
  else toast(t('toast.passedStop', { stop: st.name }), 'info');
}

/** Toast once the doors are closed: the next stop, or the end of the service. */
function announceNextStop() {
  const st = track.stops[service.next];
  if (st) toast(t('toast.nextStop', { stop: st.name }), 'info');
  else toast(t('toast.endOfService'), 'good');
}

// ------------------------------------------------------------------ rendu
const tmpV = new THREE.Vector3();
/** @param {number} dt */
function render(dt) {
  // bus : position, cap, assiette selon le relief
  const g = bus.group,
    c = drive.center;
  /** @param {number} x @param {number} y */
  const sh = (x, y) => hf.surface(x, y, busZ);
  busZ = sh(drive.x, drive.y);
  const z = sh(c.x, c.y);
  g.position.set(drive.x, busZ, -drive.y);
  g.rotation.set(0, drive.h, 0);
  const fr = drive.point(B.bodyLength - B.rearOverhang, 0),
    rr = drive.point(-B.rearOverhang, 0);
  const pitch = Math.atan2(sh(fr.x, fr.y) - sh(rr.x, rr.y), B.bodyLength);
  const lt = drive.point(B.wheelbase / 2, -1.2),
    rt = drive.point(B.wheelbase / 2, 1.2);
  const roll =
    Math.atan2(sh(lt.x, lt.y) - sh(rt.x, rt.y), 2.4) +
    ((drive.v * drive.v * Math.tan(drive.delta)) / B.wheelbase) * 0.012;
  bus.body.rotation.set(roll, 0, pitch);
  bus.setBrake(drive.braking || !doors.closed);
  for (const w of bus.wheels) w.rotation.z -= (drive.v * dt) / 0.5;

  // camera
  const m = CAMS[camMode];
  if (flying) flyCamera(dt);
  else followCamera(dt, m, sh);
  if (camera.fov !== m.fov) {
    camera.fov = m.fov;
    camera.updateProjectionMatrix();
  }
  sky.position.copy(camera.position);
  world.water.uniforms.time.value += dt;

  // soleil et ombres centres sur le bus
  sun.target.position.set(c.x, z, -c.y);
  sun.position.copy(tmpV.copy(sunDir).multiplyScalar(400).add(sun.target.position));
  post.mat.uniforms.focus.value = m.focus;
  post.mat.uniforms.blur.value = m.blur;
  post.render(scene, camera);

  hud();
  minimap.draw({ x: c.x, y: c.y, h: drive.h }, service.next);
}

/**
 * Camera following the bus in the current camera mode, or orbiting it after a mouse drag.
 * @param {number} dt @param {(typeof CAMS)[number]} m @param {(x: number, y: number) => number} sh
 */
function followCamera(dt, m, sh) {
  const c = drive.center;
  let dy = drive.h - camYaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  camYaw += dy * (1 - Math.exp(-dt / m.followTime));
  const view = orbit.view(dt, camYaw, m.pitch);
  const D = m.distance * zoom;
  const tx = c.x + Math.cos(drive.h) * m.ahead,
    ty = c.y + Math.sin(drive.h) * m.ahead;
  const tz = sh(tx, ty) + S.camera.targetHeight;
  const cx = tx - Math.cos(view.yaw) * Math.cos(view.pitch) * D,
    cy = ty - Math.sin(view.yaw) * Math.cos(view.pitch) * D;
  const cz = Math.max(tz + Math.sin(view.pitch) * D, hf.h(cx, cy) + S.camera.groundClearance);
  $('camReset').hidden = orbit.state === 'auto';
  camera.position.set(cx, cz, -cy);
  camera.lookAt(tx, tz, -ty);
}

/** Debug free flight: arrows / ZQSD move, Space / X rise and sink, Shift goes faster. @param {number} dt */
function flyCamera(dt) {
  fly.update(
    {
      forward: keys.up,
      back: keys.down,
      left: keys.left,
      right: keys.right,
      up: flyKeys.up,
      down: flyKeys.down,
      fast: flyKeys.fast,
    },
    dt,
    (x, y) => hf.h(x, y),
  );
  const look = fly.target;
  $('camReset').hidden = true;
  camera.position.set(fly.x, fly.z, -fly.y);
  camera.lookAt(look.x, look.z, -look.y);
}

let lastHud = 0;
function hud() {
  const now = performance.now();
  if (now - lastHud < 100) return;
  lastHud = now;
  if (P.debug) debugPanel();
  $('clk').textContent = hms(clock.t);
  $('spd').textContent = String(Math.round(Math.abs(drive.v) * 3.6));
  const c = drive.center;
  $('alt').textContent = Math.round(busZ) + ' m';
  const sl = hf.slopeAt(c.x, c.y, drive.h, busZ, 10) * 100;
  $('slope').textContent = (sl > 0 ? '+' : '') + sl.toFixed(1) + ' %';
  const st = track.stops[service.next];
  const request = service.request;
  $('saeAlight').classList.toggle('on', request.alight);
  $('saeBoard').classList.toggle('on', request.board);
  $('doorsState').textContent = t('game.doors.' + doors.state);
  $('doorsState').className = 'doors ' + doors.state;
  if (st) {
    $('saeStop').textContent = st.name;
    const d = Math.max(0, st.s - progress - (B.bodyLength - B.rearOverhang));
    $('saeDist').textContent = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m';
    $('saeSched').textContent = t('game.scheduled', { time: hm(clock.sched(st)) });
    const late = clock.t - clock.sched(st);
    const e = $('saeDelta');
    const shown = S.gameplay.saeDeltaThreshold,
      coloured = S.gameplay.onTimeTolerance;
    e.textContent =
      late > shown
        ? t('game.late', { delta: delta(late) })
        : late < -shown
          ? t('game.early', { delta: delta(late) })
          : t('game.onTime');
    e.className = late > coloured ? 'late' : late < -coloured ? 'early' : '';
  } else {
    $('saeStop').textContent = t('game.terminus');
    $('saeDist').textContent = '';
    $('saeSched').textContent = '';
    $('saeDelta').textContent = '';
  }
  $('trDone').style.width = (progress / track.length) * 100 + '%';
  $('trBus').style.left = (progress / track.length) * 100 + '%';
  track.stops.forEach((s, i) => {
    const el = $('st' + i);
    el.className = 'st' + (s.served ? ' ok' : s.missed ? ' miss' : i === service.next ? ' nx' : '');
  });
}

// ------------------------------------------------------------------ debug (?debug, src/hd2d/debug.js)
/** Distance along the route of the front door when the bus stands at a stop. */
const doorAhead = () => B.bodyLength - B.rearOverhang - B.frontDoorSetback;

/** Place the bus with its front door at stop `i`. @param {number} i */
function placeAtStop(i) {
  placeOnRoute(Math.max(0, track.stops[i].s - doorAhead()));
  service.reset(progress);
  doors.reset();
  toast(t('debug.teleported', { stop: track.stops[i].name }));
}

/**
 * Move the bus anywhere: its centre at (x, y), heading `h` (by default its own); refused where a building or
 * the water touches it, unless collisions are off (K). Returns whether the bus moved.
 * @param {number} x @param {number} y @param {number} [h]
 */
function teleport(x, y, h = drive.h) {
  const before = { x: drive.x, y: drive.y, h: drive.h, z: busZ };
  drive.placeCentre(x, y, h);
  // on a bridge the deck wins over the ground below (within reach of the ground height)
  busZ = hf.surface(x, y, hf.h(x, y));
  if (drive.blocked(obstacles(world.index, hf, () => busZ, ghost))) {
    drive.place(before.x, before.y, before.h);
    busZ = before.z;
    toast(t('debug.blocked'), 'bad');
    return false;
  }
  progress = nearest(x, y, 0, 0).s;
  camYaw = drive.h;
  service.reset(progress);
  doors.reset();
  const st = track.stops[service.next];
  toast(t('debug.moved', { stop: st ? st.name : t('game.terminus') }));
  return true;
}

/** @param {boolean} on */
function setFlying(on) {
  flying = on;
  if (on) {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    fly.start(
      camera.position.x,
      -camera.position.z,
      camera.position.y,
      Math.atan2(-dir.z, dir.x),
      -Math.asin(dir.y),
    );
  } else orbit.snap();
  toast(t(on ? 'debug.flyOn' : 'debug.flyOff'));
}

/** Debug keys; returns true when the key was used. @param {KeyboardEvent} e */
function debugKey(e) {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    flyKeys.fast = true;
    drive.tune(turboParams);
  } else if (e.code === 'KeyN' || e.code === 'KeyB') {
    placeAtStop(stepStop(track.stops, progress - B.rearOverhang + doorAhead(), e.code === 'KeyN' ? 1 : -1));
  } else if (e.code === 'KeyK') {
    ghost = !ghost;
    toast(t(ghost ? 'debug.ghostOn' : 'debug.ghostOff'));
  } else if (e.code === 'KeyF') setFlying(!flying);
  else if (e.code === 'Space') flyKeys.up = true;
  else if (e.code === 'KeyX') flyKeys.down = true;
  else if (e.code === 'Enter' && flying) {
    // the bus lands below the camera, facing where the camera looks
    if (teleport(fly.x, fly.y, fly.yaw)) setFlying(false);
  } else return false;
  return true;
}

/** @param {KeyboardEvent} e */
function debugKeyUp(e) {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    flyKeys.fast = false;
    drive.tune(S.drive);
  }
  if (e.code === 'Space') flyKeys.up = false;
  if (e.code === 'KeyX') flyKeys.down = false;
}

function debugPanel() {
  const c = drive.center,
    water = hf.waterLevel(c.x, c.y);
  $('debugInfo').textContent = t('debug.panel', {
    x: c.x.toFixed(1),
    y: c.y.toFixed(1),
    s: progress.toFixed(0),
    ground: hf.h(c.x, c.y).toFixed(1),
    water: water === null ? t('debug.noWater') : water.toFixed(1) + ' m',
    fps: Math.round(fps),
  });
}

// ------------------------------------------------------------------ boucle
let last = performance.now(),
  acc = 0;
const STEP = 1 / S.simulation.stepsPerSecond;
/** @param {number} t */
function frame(t) {
  requestAnimationFrame(frame);
  const el = Math.min(0.1, (t - last) / 1000);
  if (el > 0) fps += (1 / el - fps) * 0.05;
  last = t;
  if (!running) return;
  if (!paused) {
    acc += el;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
  }
  render(el);
}
requestAnimationFrame(frame);

/** @param {boolean} p */
function setPause(p) {
  paused = p;
  $('pause').hidden = !p;
}
addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) {
    keys[k] = true;
    e.preventDefault();
  }
  if (!running) return;
  if (e.code === 'Space' && !flying) {
    if (doors.toggle(drive.v)) toast(t('toast.doorsTooFast'), 'bad');
    e.preventDefault();
  }
  if (e.code === 'KeyM') minimap.cycleSize();
  if (e.code === 'KeyP') setPause(!paused);
  if (e.code === 'Escape') {
    if (paused) location.href = 'index.html';
    else setPause(true);
  }
  if (e.code === 'KeyC') {
    camMode = (camMode + 1) % CAMS.length;
    zoom = 1;
    orbit.snap();
    toast(t('toast.camera', { name: t(CAMS[camMode].name) }));
  }
  if (e.code === 'KeyV') orbit.reset();
  if (e.code === 'KeyG') {
    world.route.visible = !world.route.visible;
    toast(t(world.route.visible ? 'toast.guidanceOn' : 'toast.guidanceOff'));
  }
  if (e.code === 'KeyR') {
    placeOnRoute(progress - B.rearOverhang);
    toast(t('toast.busReplaced'));
  }
  if (P.debug && debugKey(e)) e.preventDefault();
});
addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
  if (P.debug) debugKeyUp(e);
});
addEventListener('blur', () => {
  keys.up = keys.down = keys.left = keys.right = false;
});
// camera libre : glisser avec le bouton gauche sur la vue 3D
/** @type {{x: number, y: number} | null} */
let orbitDrag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !running) return;
  orbitDrag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('drag');
});
canvas.addEventListener('pointermove', (e) => {
  if (!orbitDrag) return;
  if (flying) fly.turn(e.clientX - orbitDrag.x, e.clientY - orbitDrag.y);
  else orbit.drag(e.clientX - orbitDrag.x, e.clientY - orbitDrag.y, camYaw, CAMS[camMode].pitch);
  orbitDrag = { x: e.clientX, y: e.clientY };
});
const endOrbitDrag = () => {
  orbitDrag = null;
  canvas.classList.remove('drag');
};
canvas.addEventListener('pointerup', endOrbitDrag);
canvas.addEventListener('pointercancel', endOrbitDrag);
$('camReset').onclick = () => orbit.reset();
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const C = S.camera;
    zoom = Math.max(C.zoomMin, Math.min(C.zoomMax, zoom * Math.exp(e.deltaY * C.zoomPerWheelUnit)));
  },
  { passive: false },
);
$('resume').onclick = () => setPause(false);
$('quit').onclick = () => {
  location.href = 'index.html';
};
window.addEventListener('error', (e) => {
  document.body.dataset.error = String(e.message);
});

load().catch(showLoadError);

/** Language and settings, needed before anything is built; a failure stays on the loading screen. */
async function boot() {
  try {
    await initI18n();
    return await loadSettings();
  } catch (e) {
    showLoadError(e);
    throw e;
  }
}

/** @param {unknown} e */
function showLoadError(e) {
  const message = e instanceof Error ? e.message : String(e);
  let text = message;
  try {
    text = t('game.loadError', { error: message });
  } catch {
    // the language file itself is missing: show the raw error
  }
  $('loadMsg').textContent = text;
  document.body.dataset.error = message;
}
