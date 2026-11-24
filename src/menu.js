// @ts-check
/** Page d'accueil : direction, bus, jour, depart reel (GTFS), moteur. Choix memorises localement. */
import { serviceLabel, sortedServices, todayService, toSec } from './common/service.js';

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const KEY = 'bus17.menu';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(sel)); } catch (e) { /* stockage indisponible */ } };

const sel = { dir: saved.dir ?? 1, bus: 'std', day: '', dep: '', eng: saved.eng || 'hd2d' };
let line;

function chips(root, items, current, onPick) {
  root.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'chip' + (it.value === current ? ' on' : '');
    b.innerHTML = it.html;
    b.onclick = () => onPick(it.value);
    root.appendChild(b);
  }
}

function render() {
  const dirs = line.directions;
  chips($('dirChips'), dirs.map((d, i) => {
    const z = d.pts, dz = z[z.length - 1] - z[2];
    const hint = dz > 20 ? 'ça monte !' : dz < -20 ? 'ça descend' : 'plat';
    return { value: i, html: `Vers ${d.stops[d.stops.length - 1].name} <small>(${hint} · ${(d.length / 1000).toFixed(1)} km · ${d.stops.length} arrêts)</small>` };
  }), sel.dir, (v) => { sel.dir = v; sel.dep = ''; render(); });

  const d = dirs[sel.dir];
  const sids = sortedServices(d.services, line.calendar).filter(s => d.services[s].length);
  if (!sids.includes(sel.day)) sel.day = todayService(d.services, line.calendar) || sids[0];
  chips($('dayChips'), sids.map(s => ({ value: s, html: serviceLabel(s, line.calendar) })), sel.day,
    (v) => { sel.day = v; sel.dep = ''; render(); });

  const deps = d.services[sel.day] || [];
  const now = new Date(), nowS = now.getHours() * 3600 + now.getMinutes() * 60;
  const next = deps.find(t => toSec(t) >= nowS) || deps[0];
  if (!deps.includes(sel.dep)) sel.dep = next;
  const box = $('deps');
  box.innerHTML = '';
  for (const t of deps) {
    const b = document.createElement('button');
    b.className = 'dep' + (t === sel.dep ? ' on' : '') + (t === next ? ' next' : '');
    b.textContent = t;
    b.title = t === next ? 'Prochain départ réel' : '';
    b.onclick = () => { sel.dep = t; render(); };
    box.appendChild(b);
  }
  if (!deps.length) box.innerHTML = '<span class="empty">Aucun départ ce jour-là.</span>';

  document.querySelectorAll('#engChips .chip').forEach(b => {
    const el = /** @type {HTMLElement} */ (b);
    el.classList.toggle('on', el.dataset.eng === sel.eng);
    el.onclick = () => { sel.eng = el.dataset.eng || 'hd2d'; render(); };
  });
  /** @type {HTMLButtonElement} */ ($('goBtn')).disabled = !sel.dep;
  save();
}

$('goBtn').onclick = () => {
  const q = new URLSearchParams({ dir: String(sel.dir), day: sel.day, dep: sel.dep, bus: sel.bus });
  location.href = (sel.eng === 'outrun' ? 'outrun.html?' : 'hd2d.html?') + q;
};

fetch('data/grenoble/17.json').then(r => r.json()).then(l => { line = l; render(); })
  .catch(e => { $('dirChips').innerHTML = `<span class="empty">Erreur de chargement (${e.message}). Lance le jeu via un serveur http local.</span>`; });
