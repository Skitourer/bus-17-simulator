// @ts-check
/**
 * Trace reel d'un sens de la ligne : polyline reechantillonnee (pas constant), altitude, cap, courbure.
 * Toute la simulation repose sur l'abscisse curviligne `s` (metres depuis le terminus de depart).
 * Repere local : x = est, y = nord (metres), z = altitude (metres). Cap `h` = angle math (0 = est, sens trigo).
 */
export class Track {
  /** @param {{pts:number[], length:number, stops:any[], headsign:string, services:Object}} dir @param {number} step */
  constructor(dir, step) {
    const n = dir.pts.length / 3;
    this.n = n;
    this.step = step;
    this.length = (n - 1) * step;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = dir.pts[i * 3];
      this.y[i] = dir.pts[i * 3 + 1];
      this.z[i] = dir.pts[i * 3 + 2];
    }
    // cap deroule (continu, sans saut de 2pi) -> interpolation et moyennes faciles
    this.h = new Float64Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let h = Math.atan2(this.y[b] - this.y[a], this.x[b] - this.x[a]);
      if (i > 0) { while (h - prev > Math.PI) h -= 2 * Math.PI; while (h - prev < -Math.PI) h += 2 * Math.PI; }
      this.h[i] = h; prev = h;
    }
    // courbure lissee (1/m, > 0 = virage a gauche)
    this.k = new Float64Array(n);
    const W = 4;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - W), b = Math.min(n - 1, i + W);
      this.k[i] = b > a ? (this.h[b] - this.h[a]) / ((b - a) * step) : 0;
    }
    this.stops = dir.stops;
    this.headsign = dir.headsign;
    this.services = dir.services;
  }

  /** valeur interpolee d'un tableau a l'abscisse s (extrapolation lineaire hors trace) */
  _lerp(arr, s) {
    const f = s / this.step;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(f)));
    const t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  heading(s) { return this._lerp(this.h, Math.max(0, Math.min(this.length, s))); }
  curv(s) { return this._lerp(this.k, Math.max(0, Math.min(this.length, s))); }
  alt(s) { return this._lerp(this.z, Math.max(0, Math.min(this.length, s))); }
  /** pente (m/m) moyenne sur [s, s+span] */
  slope(s, span = 10) { return (this.alt(s + span) - this.alt(s)) / span; }

  /** position monde d'un point a l'abscisse s, decale lateralement de d (m, > 0 = a droite) */
  pos(s, d = 0) {
    let x, y;
    if (s < 0 || s > this.length) { // prolongement en ligne droite au-dela des terminus
      const e = s < 0 ? 0 : this.length, h = this.heading(e);
      x = this._lerp(this.x, e) + Math.cos(h) * (s - e);
      y = this._lerp(this.y, e) + Math.sin(h) * (s - e);
    } else { x = this._lerp(this.x, s); y = this._lerp(this.y, s); }
    const h = this.heading(s);
    return { x: x + Math.sin(h) * d, y: y - Math.cos(h) * d, z: this.alt(s), h };
  }

  /** cap moyen sur [s, s+span] (pour une camera qui ne tremble pas) */
  meanHeading(s, span) {
    let acc = 0; const N = 6;
    for (let i = 0; i <= N; i++) acc += this.heading(s + span * i / N);
    return acc / (N + 1);
  }
}
