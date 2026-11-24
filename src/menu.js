// @ts-check
/** Page d'accueil : direction, bus, jour, depart reel (GTFS). Choix memorises localement. */
import { serviceLabel, sortedServices, todayService, toSec } from './common/service.js';
import { initI18n, t } from './i18n/i18n.js';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const KEY = 'bus17.menu';
/** @type {{dir?: number}} */
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
} catch (e) {
  saved = {};
}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(sel));
  } catch (e) {
    /* stockage indisponible */
  }
};

const sel = { dir: saved.dir ?? 1, bus: 'std', day: '', dep: '' };
/** @type {import('./common/types.js').LineData} */
let line;

/**
 * @template T
 * @param {HTMLElement} root @param {{value: T, label: string, detail?: string}[]} items @param {T} current
 * @param {(value: T) => void} onPick
 */
function chips(root, items, current, onPick) {
  root.replaceChildren();
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'chip' + (it.value === current ? ' on' : '');
    b.textContent = it.label;
    if (it.detail) {
      const small = document.createElement('small');
      small.textContent = it.detail;
      b.append(' ', small);
    }
    b.onclick = () => onPick(it.value);
    root.appendChild(b);
  }
}

function render() {
  const dirs = line.directions;
  chips(
    $('dirChips'),
    dirs.map((d, i) => {
      const z = d.pts,
        dz = z[z.length - 1] - z[2];
      const hint = t(dz > 20 ? 'menu.uphill' : dz < -20 ? 'menu.downhill' : 'menu.flat');
      return {
        value: i,
        label: t('menu.towards', { stop: d.stops[d.stops.length - 1].name }),
        detail: t('menu.directionInfo', {
          hint,
          km: (d.length / 1000).toFixed(1),
          stops: d.stops.length,
        }),
      };
    }),
    sel.dir,
    (v) => {
      sel.dir = v;
      sel.dep = '';
      render();
    },
  );

  const d = dirs[sel.dir];
  const sids = sortedServices(d.services).filter((s) => d.services[s].length);
  if (!sids.includes(sel.day)) sel.day = todayService(d.services, line.calendar) || sids[0];
  chips(
    $('dayChips'),
    sids.map((s) => ({ value: s, label: serviceLabel(s, line.calendar) })),
    sel.day,
    (v) => {
      sel.day = v;
      sel.dep = '';
      render();
    },
  );

  const deps = d.services[sel.day] || [];
  const now = new Date(),
    nowS = now.getHours() * 3600 + now.getMinutes() * 60;
  const next = deps.find((time) => toSec(time) >= nowS) || deps[0];
  if (!deps.includes(sel.dep)) sel.dep = next;
  const box = $('deps');
  box.replaceChildren();
  for (const time of deps) {
    const b = document.createElement('button');
    b.className = 'dep' + (time === sel.dep ? ' on' : '') + (time === next ? ' next' : '');
    b.textContent = time;
    b.title = time === next ? t('menu.nextDeparture') : '';
    b.onclick = () => {
      sel.dep = time;
      render();
    };
    box.appendChild(b);
  }
  if (!deps.length) box.append(emptyNote(t('menu.noDeparture')));

  /** @type {HTMLButtonElement} */ ($('goBtn')).disabled = !sel.dep;
  save();
}

$('goBtn').onclick = () => {
  const q = new URLSearchParams({ dir: String(sel.dir), day: sel.day, dep: sel.dep, bus: sel.bus });
  location.href = 'hd2d.html?' + q;
};

/** @param {string} text */
function emptyNote(text) {
  const span = document.createElement('span');
  span.className = 'empty';
  span.textContent = text;
  return span;
}

async function start() {
  await initI18n();
  document.title = t('menu.pageTitle');
  try {
    const res = await fetch('data/grenoble/17.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    line = await res.json();
  } catch (e) {
    $('dirChips').replaceChildren(emptyNote(t('menu.loadError', { error: String(e) })));
    return;
  }
  render();
}

start().catch((e) => {
  // the language file itself failed: nothing to translate with
  document.body.textContent = String(e);
});
