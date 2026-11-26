// @ts-check
/**
 * Title screen (#46) with its three screens: the service choice (direction, bus, day, real GTFS
 * departure), the settings (preferences kept in the browser) and the credits. Choices are remembered
 * locally.
 */
import { serviceLabel, sortedServices, todayService, toSec } from './common/service.js';
import { LANGUAGES, initI18n, keyLabelParams, t } from './i18n/i18n.js';
import {
  CHOICES,
  DEFAULT_PREFERENCES,
  REMAPPABLE,
  bindingsWith,
  keyConflict,
  loadPreferences,
  savePreferences,
} from './settings/preferences.js';

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const KEY = 'bus17.menu';
/** @type {{dir?: number, bus?: string}} */
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

const sel = { dir: saved.dir ?? 1, bus: saved.bus === 'art' ? 'art' : 'std', day: '', dep: '' };
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

  for (const chip of $('busChips').querySelectorAll('[data-bus]')) {
    const button = /** @type {HTMLButtonElement} */ (chip);
    button.classList.toggle('on', button.dataset.bus === sel.bus);
    button.onclick = () => {
      sel.bus = button.dataset.bus || 'std';
      render();
    };
  }

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

// ------------------------------------------------------------------ screens
const SCREENS = ['title', 'play', 'settings', 'credits'];

/** Show the screen named in the URL hash (title by default), so that the browser back button works. */
function showScreen() {
  const name = SCREENS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'title';
  for (const screen of SCREENS) $('screen-' + screen).hidden = screen !== name;
  // keyboard players land on the first button of the screen
  const first = /** @type {HTMLElement | null} */ (
    $('screen-' + name).querySelector('button:not(:disabled)')
  );
  first?.focus();
}

for (const button of document.querySelectorAll('[data-screen]'))
  /** @type {HTMLElement} */ (button).addEventListener('click', () => {
    const name = /** @type {HTMLElement} */ (button).dataset.screen || 'title';
    location.hash = name === 'title' ? '' : name;
  });
addEventListener('hashchange', showScreen);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !listening && location.hash) location.hash = '';
});

// ------------------------------------------------------------------ settings
/** The browser storage, or null where it is blocked (some private modes throw on access). */
function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

let preferences = loadPreferences(storage(), LANGUAGES);
/** Action waiting for its new key, if any. @type {import('./common/keys.js').Action | null} */
let listening = null;

/** Store the preferences and redraw the settings. */
async function changePreferences(/** @type {Partial<typeof preferences>} */ change) {
  const languageChanged = 'language' in change && change.language !== preferences.language;
  preferences = { ...preferences, ...change };
  const saved = savePreferences(storage(), preferences);
  if (languageChanged || 'keys' in change) await translate();
  renderSettings();
  $('saveMessage').textContent = t(saved ? 'settings.saved' : 'settings.notSaved');
}

/** Translate the page in the chosen language, with the labels of the chosen keys. */
async function translate() {
  await initI18n({ language: preferences.language, bindings: bindingsWith(preferences.keys) });
  document.title = t('menu.pageTitle');
  if (line) render();
}

function renderSettings() {
  chips(
    $('languageChips'),
    [
      { value: '', label: t('settings.languageAuto') },
      // each language is named in itself; only French exists so far
      ...LANGUAGES.map((lang) => ({ value: lang, label: t('settings.languageName') })),
    ],
    preferences.language,
    (language) => changePreferences({ language }),
  );
  const labels = {
    quality: { low: 'settings.low', medium: 'settings.medium', high: 'settings.high' },
    viewDistance: { near: 'settings.near', medium: 'settings.mediumDistance', far: 'settings.far' },
    difficulty: { easy: 'settings.easy', normal: 'settings.normal', hard: 'settings.hard' },
  };
  chips(
    $('qualityChips'),
    CHOICES.quality.map((value) => ({ value, label: t(labels.quality[value]) })),
    preferences.quality,
    (quality) => changePreferences({ quality }),
  );
  chips(
    $('viewDistanceChips'),
    CHOICES.viewDistance.map((value) => ({ value, label: t(labels.viewDistance[value]) })),
    preferences.viewDistance,
    (viewDistance) => changePreferences({ viewDistance }),
  );
  chips(
    $('difficultyChips'),
    CHOICES.difficulty.map((value) => ({ value, label: t(labels.difficulty[value]) })),
    preferences.difficulty,
    (difficulty) => changePreferences({ difficulty }),
  );
  chips(
    $('debugChips'),
    [
      { value: false, label: t('settings.off') },
      { value: true, label: t('settings.on') },
    ],
    preferences.debug,
    (debug) => changePreferences({ debug }),
  );
  renderKeys();
}

async function renderKeys() {
  const bindings = bindingsWith(preferences.keys);
  const labels = await keyLabelParams(bindings);
  const list = $('keyList');
  list.replaceChildren();
  for (const action of REMAPPABLE) {
    const row = document.createElement('label');
    row.className = 'key-row';
    row.textContent = t('settings.action.' + action);
    const button = document.createElement('button');
    button.className = 'key' + (listening === action ? ' listening' : '');
    button.textContent =
      listening === action
        ? t('settings.pressKey')
        : labels['key' + action[0].toUpperCase() + action.slice(1)];
    button.onclick = () => {
      listening = action;
      $('keyMessage').textContent = '';
      renderKeys();
    };
    row.append(button);
    list.append(row);
    if (listening === action) button.focus();
  }
}

// the new key of the action being changed: captured before the page reacts to it
addEventListener(
  'keydown',
  (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    const action = listening;
    listening = null;
    if (e.code === 'Escape') {
      renderKeys();
      return;
    }
    const taken = keyConflict(bindingsWith(preferences.keys), action, e.code);
    if (taken) {
      $('keyMessage').textContent = t('settings.keyTaken', { action: t('settings.action.' + taken) });
      renderKeys();
      return;
    }
    changePreferences({ keys: { ...preferences.keys, [action]: e.code } });
  },
  { capture: true },
);

$('resetBtn').onclick = () => {
  $('keyMessage').textContent = '';
  changePreferences({ ...DEFAULT_PREFERENCES, keys: {} });
};

async function start() {
  await translate();
  renderSettings();
  showScreen();
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
