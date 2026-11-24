// @ts-check
/** Affichage tete haute sur le canvas de jeu (960 x 540). */
import { W, H } from '../render/camera.js';
import { hms, hm, delta } from '../common/service.js';

const FONT = '"Press Start 2P", monospace';

function box(g, x, y, w, h) {
  g.fillStyle = 'rgba(14,16,32,0.78)';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#f4efe2';
  g.fillRect(x, y, w, 2);
  g.fillRect(x, y + h - 2, w, 2);
  g.fillRect(x, y, 2, h);
  g.fillRect(x + w - 2, y, 2, h);
}

function text(g, s, x, y, size, color = '#f4efe2', align = 'left') {
  g.font = `${size}px ${FONT}`;
  g.textAlign = /** @type {CanvasTextAlign} */ (align);
  g.textBaseline = 'top';
  g.fillStyle = '#000';
  g.fillText(s, x + 2, y + 2);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

/** @param {CanvasRenderingContext2D} g */
export function drawHud(g, st) {
  const { bus, track, next, served, msg, doors, paused, clock } = st;
  // prochain arret
  box(g, 16, 16, 420, 74);
  g.fillStyle = '#33a457';
  g.fillRect(26, 26, 40, 24);
  text(g, '17', 31, 31, 14, '#ffffff');
  text(g, '→ ' + track.headsign.split(', ').pop(), 76, 32, 9, '#9aa6c8');
  if (next) {
    const d = next.s - (bus.s + 10);
    text(g, next.name.length > 24 ? next.name.slice(0, 23) + '…' : next.name, 26, 60, 12);
    text(
      g,
      d > 0 ? `${Math.round(d)} m` : 'ici',
      424,
      31,
      9,
      d < 15 && d > -6 ? '#ffd54a' : '#f4efe2',
      'right',
    );
    if (clock) {
      const late = clock.t - clock.sched(next);
      text(g, `prévu ${hm(clock.sched(next))}`, 424, 62, 8, '#9aa6c8', 'right');
      text(g, late > 0 ? delta(late) : '', 424, 76, 8, late > 60 ? '#ff8a6a' : '#9aa6c8', 'right');
    }
  } else text(g, 'Terminus', 26, 60, 12);

  // vitesse, altitude, pente
  box(g, 16, H - 92, 260, 76);
  const kmh = Math.round(Math.abs(bus.v) * 3.6);
  text(g, String(kmh).padStart(2, ' '), 30, H - 78, 28, bus.v < -0.1 ? '#ffb02e' : '#f4efe2');
  text(g, bus.v < -0.1 ? 'km/h  R' : 'km/h', 112, H - 62, 9, '#9aa6c8');
  const alt = track.alt(bus.s + 6),
    sl = track.slope(bus.s + 6, 20) * 100;
  text(g, `${Math.round(alt)} m`, 182, H - 80, 9);
  text(g, `${sl > 0 ? '+' : ''}${sl.toFixed(1)} %`, 182, H - 58, 9, Math.abs(sl) > 6 ? '#ffd54a' : '#9aa6c8');
  text(g, `${served}/${track.stops.length} arrêts`, 30, H - 34, 8, '#9aa6c8');

  if (clock) {
    box(g, W - 196, 16, 180, 44);
    text(g, hms(clock.t), W - 106, 30, 12, '#ffd54a', 'center');
  }
  if (doors > 0) text(g, '◀▶ PORTES OUVERTES', W / 2, 110, 10, '#ffd54a', 'center');
  if (msg) text(g, msg, W / 2, 140, 12, '#ffffff', 'center');
  if (bus.offroad && Math.abs(bus.v) > 1)
    text(g, 'Attention à la bordure !', W / 2, 170, 9, '#ff8a6a', 'center');
  if (paused) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, 0, W, H);
    text(g, 'PAUSE', W / 2, H / 2 - 10, 20, '#ffffff', 'center');
  }
}
