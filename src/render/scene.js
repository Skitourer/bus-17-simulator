// @ts-check
/**
 * Rendu pseudo-3D facon OutRun, mais sur la geometrie reelle :
 *  - chaque point du trace (tous les 2 m) est projete avec son cap et son altitude reels ;
 *  - la route est peinte de l'arriere vers l'avant (algorithme du peintre) par bandes imbriquees ;
 *  - le decor et le bus sont des sprites mis a l'echelle, intercales segment par segment.
 * Le fond (Belledonne, Vercors, Chartreuse, Bastille) est la vraie ligne de crete calculee depuis le MNT.
 */
import { W, H, F } from './camera.js';
import { ROAD } from '../world/road_geom.js';
import { makeBusFrames, makeSceneSprites, BUS_IMG_W, BUS_IMG_H, BUS_REAR_PX, FOG_LEVELS } from './sprites.js';

const DRAW_SEGS = 240; // 480 m de visibilite
const FOG = '#c9d6dc';
const PAL = {
  verge: ['#8f9a7c', '#87926f'],
  side: ['#b9b5aa', '#aeaa9f'],
  curb: ['#e6e3da', '#8d8b85'],
  road: ['#55585e', '#515459'],
  line: '#e8e8e0',
  ground: '#8a9478',
};

// ---------------------------------------------------------------- melange de couleurs (cache)
const _mix = new Map();
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
const FOGRGB = hex(FOG);
function fogged(c, t) {
  const q = Math.min(15, Math.max(0, Math.round(t * 15)));
  const key = c + q;
  let v = _mix.get(key);
  if (!v) {
    const a = hex(c),
      f = q / 15;
    v = `rgb(${a.map((x, i) => Math.round(x + (FOGRGB[i] - x) * f)).join(',')})`;
    _mix.set(key, v);
  }
  return v;
}

export class Scene {
  /** @param {CanvasRenderingContext2D} ctx @param {any} horizon */
  constructor(ctx, horizon) {
    this.ctx = ctx;
    this.horizon = horizon;
    this.bus = makeBusFrames();
    this.spr = makeSceneSprites(FOG);
    this.sky = this._makeSky();
    // tampons de projection : DRAW_SEGS points x 14 decalages
    this.OFFS = [
      -ROAD.VERGE,
      -ROAD.SW,
      -ROAD.CURB,
      -ROAD.HW,
      -(ROAD.HW - 0.22),
      -(ROAD.HW - 0.36),
      -0.08,
      0.08,
      ROAD.HW - 0.36,
      ROAD.HW - 0.22,
      ROAD.HW,
      ROAD.CURB,
      ROAD.SW,
      ROAD.VERGE,
    ];
    const n = DRAW_SEGS * this.OFFS.length;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.ok = new Uint8Array(DRAW_SEGS);
    this.fz = new Float32Array(DRAW_SEGS);
    this._p = { x: 0, y: 0, sc: 0, f: 0 };
  }

  _makeSky() {
    // ciel en bandes tramees (pixel art), horizon a la ligne H du tampon (hauteur 2H)
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H * 2;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const stops = ['#2f5fa8', '#3f77bf', '#5b90cf', '#7eaad9', '#a4c4e2', '#c6d9e6', FOG];
    const top = H - 330,
      band = 330 / (stops.length - 1);
    g.fillStyle = stops[0];
    g.fillRect(0, 0, W, H * 2);
    for (let i = 1; i < stops.length; i++) {
      const y = Math.round(top + band * i - band / 2);
      g.fillStyle = stops[i];
      g.fillRect(0, y, W, H * 2 - y);
      // trame de transition (damier 2 px sur 6 px de haut)
      g.fillStyle = stops[i];
      for (let yy = -6; yy < 0; yy += 2)
        for (let x = ((yy / 2) & 1) * 2; x < W; x += 4) g.fillRect(x, y + yy, 2, 2);
    }
    return c;
  }

  /** @param {import('../world/track.js').Track} track @param {import('./camera.js').Camera} cam
   *  @param {any[]} scenery @param {any} bus */
  draw(track, cam, scenery, bus) {
    const g = this.ctx;
    g.imageSmoothingEnabled = false;
    const yH = cam.horizonY(0);
    g.drawImage(this.sky, 0, Math.round(yH - H));
    this._clouds(cam, yH);
    this._mountains(cam);
    g.fillStyle = fogged(PAL.ground, 0.55);
    g.fillRect(0, Math.round(yH), W, H - Math.round(yH) + 1);

    // ---- projection des points du trace
    const OFFS = this.OFFS,
      NO = OFFS.length,
      p = this._p;
    const i0 = Math.floor(cam.s / track.step) + 1;
    for (let j = 0; j < DRAW_SEGS; j++) {
      const i = i0 + j,
        s = i * track.step;
      const k = track.curv(s);
      const lim = Math.abs(k) > 1e-4 ? 0.9 / Math.abs(k) : 1e9; // pas de repliement a l'interieur des virages
      const c = track.pos(s, 0);
      const sn = Math.sin(c.h),
        cs = Math.cos(c.h);
      let ok = 1;
      for (let o = 0; o < NO; o++) {
        let d = OFFS[o];
        if (k > 0 && d < 0) d = -Math.min(-d, lim);
        if (k < 0 && d > 0) d = Math.min(d, lim);
        if (!cam.project(c.x + sn * d, c.y - cs * d, c.z, p)) {
          ok = 0;
          break;
        }
        this.px[j * NO + o] = p.x;
        this.py[j * NO + o] = p.y;
      }
      this.ok[j] = ok;
      this.fz[j] = p.f;
    }

    // ---- peinture arriere -> avant, decor intercale
    const busSeg = Math.floor(bus.s / track.step) - i0;
    for (let j = DRAW_SEGS - 2; j >= 0; j--) {
      const i = i0 + j;
      if (this.ok[j] && this.ok[j + 1]) this._segment(j, i, i >= track.n - 1);
      if (i >= 0 && i < track.n) for (const it of scenery[i]) this._sprite(track, cam, i * track.step, it);
      if (j === busSeg) this._bus(track, cam, bus);
    }
    if (busSeg < 0) this._bus(track, cam, bus);
  }

  _segment(j, i, beyond) {
    const g = this.ctx,
      NO = this.OFFS.length,
      X = this.px,
      Y = this.py;
    const a = j * NO,
      b = (j + 1) * NO;
    const t = Math.min(1, Math.max(0, (this.fz[j] - 30) / (DRAW_SEGS * 2 - 30)));
    const fog = t * t * 0.95;
    const alt = (i >> 1) & 1;
    const quad = (l, r, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(X[a + l], Y[a + l]);
      g.lineTo(X[a + r], Y[a + r]);
      g.lineTo(X[b + r], Y[b + r] - 0.5);
      g.lineTo(X[b + l], Y[b + l] - 0.5);
      g.fill();
    };
    quad(0, 13, fogged(PAL.verge[alt], fog));
    quad(1, 12, fogged(PAL.side[alt], fog));
    if (beyond) return;
    quad(2, 11, fogged(PAL.curb[alt], fog));
    quad(3, 10, fogged(PAL.road[alt], fog));
    const lc = fogged(PAL.line, fog);
    quad(4, 5, lc);
    quad(8, 9, lc);
    if (alt) quad(6, 7, lc);
  }

  _sprite(track, cam, s, it) {
    const S = this.spr[it.key];
    if (!S) return;
    const pt = track.pos(s, it.d),
      p = this._p;
    if (!cam.project(pt.x, pt.y, pt.z, p)) return;
    if (p.f > DRAW_SEGS * 2) return;
    const w = S.w * p.sc,
      h = S.h * p.sc;
    if (w < 1 || p.x + w / 2 < 0 || p.x - w / 2 > W) return;
    const t = Math.min(1, Math.max(0, (p.f - 30) / (DRAW_SEGS * 2 - 30)));
    const lvl = Math.min(FOG_LEVELS - 1, Math.round(t * t * 0.95 * FOG_LEVELS));
    this.ctx.drawImage(
      S.fog[lvl],
      Math.round(p.x - w / 2),
      Math.round(p.y - h),
      Math.round(w),
      Math.round(h),
    );
  }

  _bus(track, cam, bus) {
    const pt = track.pos(bus.s, bus.lat),
      p = this._p;
    if (!cam.project(pt.x, pt.y, pt.z, p)) return;
    // choix de la vue : orientation du bus par rapport a la camera + decalage lateral
    const rel = track.meanHeading(bus.s, 8) - cam.yaw;
    let k = -rel * 9 + bus.steer * 0.9 - (bus.lat - cam.lat) * 0.35;
    k = Math.max(-2, Math.min(2, k));
    const fr = Math.round(k) + 2;
    const img = (bus.braking ? this.bus.brake : this.bus.normal)[fr];
    const scale = (2.55 * p.sc) / BUS_REAR_PX;
    const w = BUS_IMG_W * scale,
      h = BUS_IMG_H * scale;
    const bounce = bus.v > 0.5 ? Math.round(Math.sin(bus.s * 1.7) * 0.6) : 0;
    this.ctx.drawImage(
      img,
      Math.round(p.x - w / 2),
      Math.round(p.y - h * (68 / BUS_IMG_H)) + bounce,
      Math.round(w),
      Math.round(h),
    );
  }

  _azAngle(arr, azDeg) {
    const st = this.horizon.step,
      n = arr.length;
    const f = (((azDeg % 360) + 360) % 360) / st;
    const i = Math.floor(f),
      t = f - i;
    return arr[i % n] * (1 - t) + arr[(i + 1) % n] * t;
  }

  _mountains(cam) {
    const g = this.ctx,
      hz = this.horizon;
    if (!hz) return;
    const COL = 3;
    const yawDeg = (cam.yaw * 180) / Math.PI;
    const yBase = cam.horizonY(0);
    // plan lointain : massifs enneiges
    for (let x = 0; x < W; x += COL) {
      const az = 90 - (yawDeg - (Math.atan((x + COL / 2 - W / 2) / F) * 180) / Math.PI);
      const a = this._azAngle(hz.far, az);
      const y = Math.round(cam.horizonY(a));
      g.fillStyle = '#8b9cbc';
      g.fillRect(x, y, COL, yBase - y + 2);
      const snow = a - 0.085;
      if (snow > 0) {
        const ys = Math.round(cam.horizonY(a - Math.min(snow, 0.02) - snow * 0.6));
        g.fillStyle = '#eef3f8';
        g.fillRect(x, y, COL, ys - y);
        g.fillStyle = '#c5d0e2';
        if ((x / COL) & 1) g.fillRect(x, ys, COL, 2);
      }
      g.fillStyle = '#a9b6cc';
      g.fillRect(x, Math.round(yBase - (yBase - y) * 0.25), COL, Math.round((yBase - y) * 0.25) + 2);
    }
    // plan proche : collines boisees (Bastille, Rachais, Saint-Eynard...), vues depuis les 2 points
    // de vue precalcules les plus proches de la camera (ponderation inverse de la distance)
    let v1 = null,
      v2 = null,
      d1 = 1e18,
      d2 = 1e18;
    for (const v of hz.views) {
      const d = (v.x - cam.x) ** 2 + (v.y - cam.y) ** 2;
      if (d < d1) {
        v2 = v1;
        d2 = d1;
        v1 = v;
        d1 = d;
      } else if (d < d2) {
        v2 = v;
        d2 = d;
      }
    }
    const w1 = 1 / (Math.sqrt(d1) + 1),
      w2 = v2 ? 1 / (Math.sqrt(d2) + 1) : 0;
    const dz = cam.z - (v1.z * w1 + (v2 ? v2.z : 0) * w2) / (w1 + w2);
    for (let x = 0; x < W; x += COL) {
      const az = 90 - (yawDeg - (Math.atan((x + COL / 2 - W / 2) / F) * 180) / Math.PI);
      let a = (this._azAngle(v1.near, az) * w1 + (v2 ? this._azAngle(v2.near, az) * w2 : 0)) / (w1 + w2);
      a -= dz / 2000; // camera plus haute que le point de vue : les collines baissent un peu
      if (a <= 0.002) continue;
      const y = Math.round(cam.horizonY(a));
      g.fillStyle = '#5f7a66';
      g.fillRect(x, y, COL, yBase - y + 2);
      g.fillStyle = '#6e8a72';
      g.fillRect(x, y, COL, 2);
      g.fillStyle = '#8fa48d';
      g.fillRect(x, Math.round(yBase - (yBase - y) * 0.3), COL, Math.round((yBase - y) * 0.3) + 2);
    }
  }

  _clouds(cam, yH) {
    const g = this.ctx;
    const yawDeg = (cam.yaw * 180) / Math.PI;
    g.fillStyle = '#eef4f8';
    for (let i = 0; i < 9; i++) {
      const az = i * 40 + 13;
      const b = 90 - az; // angle math du nuage
      let rel = ((((b - yawDeg) % 360) + 540) % 360) - 180;
      if (Math.abs(rel) > 50) continue;
      const x = W / 2 - Math.tan((rel * Math.PI) / 180) * F;
      const y = yH - 150 - ((i * 37) % 90);
      const w = 60 + ((i * 53) % 70);
      g.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w), 6);
      g.fillRect(Math.round(x - w / 3), Math.round(y - 5), Math.round(w * 0.55), 5);
      g.fillRect(Math.round(x - w / 6), Math.round(y - 9), Math.round(w * 0.3), 4);
    }
  }
}
