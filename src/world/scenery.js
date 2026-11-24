// @ts-check
/**
 * Decor de bord de route genere a partir du trace et du fond OSM :
 *  - immeubles le long des rues, remplaces par des arbres dans les parcs/bois, rien sur l'eau ;
 *  - arbres d'alignement, lampadaires ;
 *  - abri + poteau a chaque arret (cote droit).
 * Resultat : tableau indexe par segment (point du trace) -> liste de { key, d } (d = decalage lateral).
 */
import { ROAD } from './road_geom.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** index spatial grossier des polygones OSM pour tester l'occupation du sol */
class LandUse {
  constructor(map) {
    this.cells = new Map();
    this.C = 200;
    if (!map) return;
    for (const kind of ['water', 'park', 'forest']) {
      for (const p of map.polys[kind] || []) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < p.length; i += 2) {
          x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
        }
        const poly = { kind, p, x0, y0, x1, y1 };
        for (let cx = Math.floor(x0 / this.C); cx <= Math.floor(x1 / this.C); cx++)
          for (let cy = Math.floor(y0 / this.C); cy <= Math.floor(y1 / this.C); cy++) {
            const key = cx + ',' + cy;
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key).push(poly);
          }
      }
    }
  }
  /** 'water' | 'park' | 'forest' | null */
  at(x, y) {
    const list = this.cells.get(Math.floor(x / this.C) + ',' + Math.floor(y / this.C));
    if (!list) return null;
    let found = null;
    for (const q of list) {
      if (x < q.x0 || x > q.x1 || y < q.y0 || y > q.y1) continue;
      const p = q.p;
      let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
      }
      if (inside) { if (q.kind === 'water') return 'water'; found = q.kind; }
    }
    return found;
  }
}

/** @param {import('./track.js').Track} track @param {any} map */
export function buildScenery(track, map) {
  const land = new LandUse(map);
  const segs = Array.from({ length: track.n }, () => /** @type {{key:string,d:number}[]} */ ([]));
  const put = (s, key, d) => { const i = Math.round(s / track.step); if (i >= 0 && i < track.n) segs[i].push({ key, d }); };
  const nearStop = (s, m) => track.stops.some(st => Math.abs(st.s - s) < m);
  const r = rng(17);

  // arrets
  for (const st of track.stops) {
    put(st.s, 'shelter', ROAD.SW - 1.6);
    put(st.s + 3, 'pole', ROAD.HW + 0.7);
  }

  for (const side of [-1, 1]) {
    // immeubles / vegetation, cote par cote
    let s = 5 + r() * 10;
    while (s < track.length) {
      const k = track.curv(s);
      const inner = Math.sign(k) === -side;   // cote interieur du virage
      const p = track.pos(s, side * (ROAD.SW + 9));
      const use = land.at(p.x, p.y);
      if (use === 'water') { s += 8; continue; }
      if (use === 'park' || use === 'forest') {
        put(s, 'tree' + Math.floor(r() * 4), side * (ROAD.SW + 3 + r() * 10));
        s += 5 + r() * 5;
        continue;
      }
      if (inner && Math.abs(k) > 1 / 60) { s += 6; continue; }   // n'obstrue pas la vue dans les virages serres
      const b = 'bld' + Math.floor(r() * 10);
      put(s, b, side * (ROAD.SW + 13 + r() * 4));
      s += 16 + r() * 8;
    }
    // arbres d'alignement et lampadaires
    for (let t = 6 + (side > 0 ? 0 : 6); t < track.length; t += 13) {
      if (nearStop(t, 9) && side > 0) continue;
      if (Math.abs(track.curv(t)) > 1 / 25) continue;
      if (r() < 0.75) put(t, 'tree' + Math.floor(r() * 4), side * (ROAD.SW - 1.0));
    }
    for (let t = side > 0 ? 3 : 18; t < track.length; t += 30) {
      if (nearStop(t, 5) && side > 0) continue;
      put(t, 'lamp', side * (ROAD.HW + 0.6));
    }
  }
  return segs;
}
