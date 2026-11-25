// @ts-check
/**
 * Mini-carte : fond OSM vectoriel (eau, parcs, routes, tram), trace de la ligne, arrets, bus.
 * Nord en haut. Zoom molette / boutons (autour du curseur), glisser pour deplacer, suivi du bus.
 * Les chemins sont construits une fois (Path2D en metres) puis dessines avec une transformation.
 */
const STYLE = {
  land: '#ece7da',
  water: '#9cc9e6',
  river: '#7fb6db',
  park: '#c3dcaa',
  forest: '#a9cc93',
  minor: '#ffffff',
  secondary: '#fbe3a1',
  primary: '#f5c46b',
  casing: '#c9c2b0',
  tram: '#8a6fa8',
  rail: '#8d8d8d',
};

export class Minimap {
  /**
   * @param {HTMLElement} root @param {import('../common/types.js').MapData | null} map
   * @param {import('../common/types.js').LineData} line
   */
  constructor(root, map, line) {
    this.root = root;
    this.cv = /** @type {HTMLCanvasElement} */ (root.querySelector('canvas'));
    this.g = /** @type {CanvasRenderingContext2D} */ (this.cv.getContext('2d'));
    this.color = line.color;
    this.zoom = 0.6; // pixels CSS par metre
    this.cx = 0;
    this.cy = 0; // centre de la vue (metres)
    this.follow = true;
    /** @type {((x: number, y: number) => void) | null} called with the world point of a click (debug mode) */
    this.onPick = null;
    /** @type {import('../world/track.js').Track | null} */
    this.track = null;
    /** @type {Record<string, Path2D>} */
    this.paths = {};
    this.route = new Path2D();
    if (map) this._build(map);
    this.attrib = map ? map.attribution : '';
    this._ui();
  }

  /** @param {import('../common/types.js').MapData} map */
  _build(map) {
    /** @param {number[][]} list */
    const mk = (list) => {
      const p = new Path2D();
      for (const a of list) {
        p.moveTo(a[0], -a[1]);
        for (let i = 2; i < a.length; i += 2) p.lineTo(a[i], -a[i + 1]);
      }
      return p;
    };
    for (const k in map.polys) this.paths[k] = mk(map.polys[k]);
    for (const k in map.lines) this.paths['l_' + k] = mk(map.lines[k]);
  }

  /** @param {import('../world/track.js').Track} track */
  setTrack(track) {
    this.track = track;
    const p = new Path2D();
    p.moveTo(track.x[0], -track.y[0]);
    for (let i = 1; i < track.n; i++) p.lineTo(track.x[i], -track.y[i]);
    this.route = p;
    this.follow = true;
    this._syncBtn();
  }

  _ui() {
    /** @param {string} act */
    const btn = (act) => /** @type {HTMLButtonElement} */ (this.root.querySelector(`[data-act="${act}"]`));
    btn('in').onclick = () => this.zoomBy(1.5);
    btn('out').onclick = () => this.zoomBy(1 / 1.5);
    btn('follow').onclick = () => {
      this.follow = true;
      this._syncBtn();
    };
    btn('size').onclick = () => this.cycleSize();
    this.cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.cv.getBoundingClientRect();
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    /** @type {{x: number, y: number, cx: number, cy: number} | null} */
    let drag = null;
    this.cv.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
      this.cv.setPointerCapture(e.pointerId);
      this.cv.classList.add('drag');
    });
    this.cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (this.follow && Math.hypot(dx, dy) < 4) return;
      this.follow = false;
      this._syncBtn();
      this.cx = drag.cx - dx / this.zoom;
      this.cy = drag.cy + dy / this.zoom;
    });
    const end = () => {
      drag = null;
      this.cv.classList.remove('drag');
    };
    this.cv.addEventListener('pointerup', (e) => {
      // a click (no drag) picks a world point
      if (drag && this.onPick && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) {
        const r = this.cv.getBoundingClientRect();
        this.onPick(
          this.cx + (e.clientX - r.left - r.width / 2) / this.zoom,
          this.cy - (e.clientY - r.top - r.height / 2) / this.zoom,
        );
      }
      end();
    });
    this.cv.addEventListener('pointercancel', end);
  }

  _syncBtn() {
    const b = this.root.querySelector('[data-act="follow"]');
    if (b) b.classList.toggle('on', this.follow);
  }

  /**
   * zoom autour d'un point ecran (par defaut le centre)
   * @param {number} f @param {number} [sx] @param {number} [sy]
   */
  zoomBy(f, sx, sy) {
    const w = this.cv.clientWidth,
      h = this.cv.clientHeight;
    if (sx === undefined || sy === undefined) {
      sx = w / 2;
      sy = h / 2;
    }
    const nz = Math.max(0.03, Math.min(12, this.zoom * f));
    if (!this.follow) {
      // le point sous le curseur reste fixe
      const wx = this.cx + (sx - w / 2) / this.zoom,
        wy = this.cy - (sy - h / 2) / this.zoom;
      this.cx = wx - (sx - w / 2) / nz;
      this.cy = wy + (sy - h / 2) / nz;
    }
    this.zoom = nz;
  }

  cycleSize() {
    const c = this.root.classList;
    if (c.contains('small')) {
      c.replace('small', 'large');
    } else if (c.contains('large')) {
      c.replace('large', 'hidden');
    } else {
      c.remove('hidden');
      c.add('small');
    }
  }

  /** @param {{x:number, y:number, h:number}} bp position et cap du bus @param {number} nextStop */
  draw(bp, nextStop) {
    if (this.root.classList.contains('hidden') || !this.track) return;
    const cv = this.cv,
      g = this.g,
      dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const tr = this.track;
    if (this.follow) {
      this.cx = bp.x;
      this.cy = bp.y;
    }
    const z = this.zoom;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = STYLE.land;
    g.fillRect(0, 0, w, h);
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - this.cx * z), dpr * (h / 2 + this.cy * z));
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const P = this.paths;
    /** @param {number} n */
    const px = (n) => n / z; // epaisseur en pixels -> metres
    if (P.forest) {
      g.fillStyle = STYLE.forest;
      g.fill(P.forest, 'evenodd');
    }
    if (P.park) {
      g.fillStyle = STYLE.park;
      g.fill(P.park);
    }
    if (P.water) {
      g.fillStyle = STYLE.water;
      g.fill(P.water);
    }
    if (P.l_river) {
      g.strokeStyle = STYLE.river;
      g.lineWidth = Math.max(px(2), 12);
      g.stroke(P.l_river);
    }
    /** @param {string} key @param {number} wm @param {string} col @param {number} minPx */
    const road = (key, wm, col, minPx) => {
      if (!P[key]) return;
      const lw = Math.max(px(minPx), wm);
      g.strokeStyle = STYLE.casing;
      g.lineWidth = lw + px(1.5);
      g.stroke(P[key]);
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.stroke(P[key]);
    };
    if (z > 0.12) road('l_minor', 6, STYLE.minor, 0.8);
    road('l_secondary', 9, STYLE.secondary, 1.2);
    road('l_primary', 13, STYLE.primary, 1.8);
    if (P.l_rail) {
      g.strokeStyle = STYLE.rail;
      g.lineWidth = px(1.2);
      g.setLineDash([px(4), px(3)]);
      g.stroke(P.l_rail);
      g.setLineDash([]);
    }
    if (P.l_tram) {
      g.strokeStyle = STYLE.tram;
      g.lineWidth = px(1.4);
      g.stroke(P.l_tram);
    }

    // trace de la ligne
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(px(7), 9);
    g.stroke(this.route);
    g.strokeStyle = this.color;
    g.lineWidth = Math.max(px(4.5), 6);
    g.stroke(this.route);

    // retour en pixels pour arrets et bus
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    /** @param {number} x @param {number} y */
    const toS = (x, y) => [w / 2 + (x - this.cx) * z, h / 2 - (y - this.cy) * z];
    g.font = '8px "Press Start 2P", monospace';
    tr.stops.forEach((st, i) => {
      const p = tr.pos(st.s, 0);
      const [sx, sy] = toS(p.x, p.y);
      if (sx < -40 || sy < -20 || sx > w + 40 || sy > h + 20) return;
      const next = i === nextStop;
      g.fillStyle = st.served ? '#9aa0aa' : '#ffffff';
      g.strokeStyle = next ? '#d0302a' : '#1f6e38';
      g.lineWidth = next ? 3 : 2;
      g.beginPath();
      g.arc(sx, sy, next ? 5 : 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (z > 1.2 || next) {
        g.fillStyle = '#1a1a1a';
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 3;
        g.strokeText(st.name, sx + 8, sy + 3);
        g.fillText(st.name, sx + 8, sy + 3);
      }
    });
    // bus : fleche orientee
    const [bx, by] = toS(bp.x, bp.y);
    g.save();
    g.translate(bx, by);
    g.rotate(-bp.h);
    g.fillStyle = '#ff7a1a';
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(10, 0);
    g.lineTo(-7, -7);
    g.lineTo(-3, 0);
    g.lineTo(-7, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // echelle
    const m = [20, 50, 100, 200, 500, 1000, 2000].find((v) => v * z > 50) || 5000;
    g.fillStyle = '#222';
    g.fillRect(8, h - 22, m * z, 3);
    g.font = '7px "Press Start 2P", monospace';
    g.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', 8, h - 26);
  }
}
