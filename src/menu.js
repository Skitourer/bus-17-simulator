// @ts-check
/**
 * Title screen (#46) with its three screens: the service choice (line, direction, bus, day, real GTFS
 * departure), the settings (preferences kept in the browser) and the credits. Choices are remembered
 * locally.
 */
import { alignDate, dateLabel, dayLabel, dayTypeDates, toSec, weekdaysOn } from './common/service.js';
import { departuresOf, directionsOf, routeNote } from './common/lines.js';
import { loadSettings } from './settings/settings.js';
import { dateOfDay } from './hd2d/season.js';
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
/** @type {{line?: string, direction?: number, bus?: string, season?: string, customDate?: string}} */
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
} catch (e) {
  saved = {};
}
const save = () => {
  try {
    const { line, direction, bus, season, customDate } = sel;
    localStorage.setItem(KEY, JSON.stringify({ line, direction, bus, season, customDate }));
  } catch (e) {
    /* stockage indisponible */
  }
};

const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const sel = {
  line: saved.line ?? '17',
  // GTFS direction id
  direction: saved.direction ?? 1,
  bus: saved.bus === 'art' ? 'art' : 'std',
  // day type and its service date "YYYYMMDD"
  dayType: '',
  day: '',
  // departure "HH:MM" and its route (index in the line file)
  dep: '',
  route: -1,
  date: '',
  // '' the service date, a season, or 'custom' for the date field (#70)
  season: SEASONS.includes(saved.season ?? '') || saved.season === 'custom' ? (saved.season ?? '') : '',
  customDate: /^\d{8}$/.test(saved.customDate ?? '') ? (saved.customDate ?? '') : '',
};
/** @type {import('./settings/settings.js').Settings['seasons']} */
let seasons;
/** @type {import('./common/types.js').LineIndex | null} */
let lineIndex = null;
/** line files already read, by line id @type {Map<string, import('./common/types.js').LineData>} */
const lineFiles = new Map();

/**
 * @template T
 * @param {HTMLElement} root
 * @param {{value: T, label: string, detail?: string, badge?: import('./common/types.js').LineSummary}[]} items
 * @param {T} current @param {(value: T) => void} onPick
 */
function chips(root, items, current, onPick) {
  root.replaceChildren();
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'chip' + (it.value === current ? ' on' : '');
    if (it.badge) b.append(lineBadge(it.badge));
    if (it.label) b.append(it.label);
    if (it.detail) {
      const small = document.createElement('small');
      small.textContent = it.detail;
      b.append(' ', small);
    }
    b.onclick = () => onPick(it.value);
    root.appendChild(b);
  }
}

/** Line number on its colour. @param {import('./common/types.js').LineSummary} summary */
function lineBadge(summary, big = false) {
  const badge = document.createElement('span');
  badge.className = 'badge line' + (big ? ' big' : '');
  badge.textContent = summary.id;
  badge.style.background = summary.color;
  badge.style.color = summary.text_color;
  return badge;
}

/** Pick a line: its file is read once, then the screen is drawn again. @param {string} id */
async function pickLine(id) {
  sel.line = id;
  sel.dep = '';
  render();
  if (lineFiles.has(id)) return;
  try {
    const res = await fetch(`data/grenoble/lines/${encodeURIComponent(id)}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lineFiles.set(id, await res.json());
  } catch (e) {
    $('dirChips').replaceChildren(emptyNote(t('menu.loadError', { error: String(e) })));
    return;
  }
  if (sel.line === id) render();
}

function render() {
  if (!lineIndex) return;
  const summary = lineIndex.lines.find((l) => l.id === sel.line) ?? lineIndex.lines[0];
  for (const badge of document.querySelectorAll('header .badge')) {
    const el = /** @type {HTMLElement} */ (badge);
    el.textContent = summary.id;
    el.style.background = summary.color;
    el.style.color = summary.text_color;
  }
  chips(
    $('lineChips'),
    lineIndex.lines.map((l) => ({
      value: l.id,
      label: '',
      badge: l,
      detail: t('menu.termini', { from: l.termini[0], to: l.termini[1] }),
    })),
    sel.line,
    (id) => void pickLine(id),
  );
  const goButton = /** @type {HTMLButtonElement} */ ($('goBtn'));
  goButton.disabled = true;
  const line = lineFiles.get(sel.line);
  if (!line) {
    $('dirChips').replaceChildren(emptyNote(t('menu.loading')));
    return;
  }
  const directions = directionsOf(line);
  if (!directions.some((d) => d.direction === sel.direction)) sel.direction = directions[0].direction;
  chips(
    $('dirChips'),
    directions.map(({ direction, routes }) => {
      const d = line.routes[routes[0]];
      const z = d.pts,
        dz = z[z.length - 1] - z[2];
      const hint = t(dz > 20 ? 'menu.uphill' : dz < -20 ? 'menu.downhill' : 'menu.flat');
      return {
        value: direction,
        label: t('menu.towards', { stop: d.stops[d.stops.length - 1].name }),
        detail: t('menu.directionInfo', {
          hint,
          km: (d.length / 1000).toFixed(1),
          stops: d.stops.length,
        }),
      };
    }),
    sel.direction,
    (v) => {
      sel.direction = v;
      sel.dep = '';
      render();
    },
  );

  const routes = directions.find((d) => d.direction === sel.direction)?.routes ?? [];
  const days = dayTypeDates(line.calendar, new Date()).filter(
    (d) => departuresOf(line, routes, d.date).length,
  );
  const chosen = days.find((d) => d.type === sel.dayType) ?? days[0];
  sel.dayType = chosen?.type ?? '';
  sel.day = chosen?.date ?? '';
  chips(
    $('dayChips'),
    days.map((d) => ({ value: d.type, label: dayLabel(d.type) })),
    sel.dayType,
    (v) => {
      sel.dayType = v;
      sel.dep = '';
      render();
    },
  );
  renderSeason(line);
  renderDepartures(line, routes);

  for (const chip of $('busChips').querySelectorAll('[data-bus]')) {
    const button = /** @type {HTMLButtonElement} */ (chip);
    button.classList.toggle('on', button.dataset.bus === sel.bus);
    button.onclick = () => {
      sel.bus = button.dataset.bus || 'std';
      render();
    };
  }

  goButton.disabled = !sel.dep;
  save();
}

/**
 * Departures of the direction on the service date, each with its terminus when it is not the main one.
 * @param {import('./common/types.js').LineData} line @param {number[]} routes
 */
function renderDepartures(line, routes) {
  const deps = sel.day ? departuresOf(line, routes, sel.day) : [];
  const now = new Date(),
    nowS = now.getHours() * 3600 + now.getMinutes() * 60;
  const next = deps.find((d) => toSec(d.time) >= nowS) || deps[0];
  if (!deps.some((d) => d.time === sel.dep && d.route === sel.route)) {
    sel.dep = next?.time ?? '';
    sel.route = next?.route ?? -1;
  }
  const box = $('deps');
  box.replaceChildren();
  for (const d of deps) {
    const b = document.createElement('button');
    const on = d.time === sel.dep && d.route === sel.route;
    b.className = 'dep' + (on ? ' on' : '') + (d === next ? ' next' : '');
    b.textContent = d.time;
    const note = routeNote(line, d.route, routes[0]);
    if (note) {
      const small = document.createElement('small');
      small.textContent = t(note.kind === 'to' ? 'menu.routeTo' : 'menu.routeFrom', { stop: note.stop });
      b.append(' ', small);
    }
    b.title = d === next ? t('menu.nextDeparture') : '';
    b.onclick = () => {
      sel.dep = d.time;
      sel.route = d.route;
      render();
    };
    box.appendChild(b);
  }
  if (!deps.length) box.append(emptyNote(t('menu.noDeparture')));
}

$('goBtn').onclick = () => {
  const q = new URLSearchParams({
    line: sel.line,
    route: String(sel.route),
    day: sel.day,
    date: sel.date,
    dep: sel.dep,
    bus: sel.bus,
  });
  location.href = 'hd2d.html?' + q;
};

/**
 * Date of the game (#55, #70): the service date, the middle of a season or a date of the player, moved to
 * the nearest day of the chosen day type.
 * @param {import('./common/types.js').LineData} line
 */
function renderSeason(line) {
  const serviceDay = sel.day;
  if (!serviceDay) return;
  const year = +serviceDay.slice(0, 4);
  /** @type {string} */
  let wanted = serviceDay;
  if (sel.season === 'custom' && sel.customDate) wanted = sel.customDate;
  else if (SEASONS.includes(sel.season))
    wanted = dateOfDay(year, seasons.keys[/** @type {keyof typeof seasons.keys} */ (sel.season)].day);
  sel.date = alignDate(wanted, weekdaysOn(line.calendar, serviceDay));
  chips(
    $('seasonChips'),
    [
      { value: '', label: t('menu.seasonService') },
      ...SEASONS.map((value) => ({ value, label: t('menu.' + value) })),
    ],
    sel.season,
    (season) => {
      sel.season = season;
      render();
    },
  );
  const input = /** @type {HTMLInputElement} */ ($('dateInput'));
  input.value = `${sel.date.slice(0, 4)}-${sel.date.slice(4, 6)}-${sel.date.slice(6, 8)}`;
  input.onchange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;
    sel.season = 'custom';
    sel.customDate = input.value.replaceAll('-', '');
    render();
  };
  $('dateNote').textContent = t('menu.gameDate', {
    date: dateLabel(sel.date, document.documentElement.lang),
  });
}

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
  render();
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
    traffic: {
      none: 'settings.trafficNone',
      low: 'settings.trafficLow',
      medium: 'settings.trafficMedium',
      high: 'settings.trafficHigh',
    },
    pedestrians: {
      none: 'settings.pedestriansNone',
      low: 'settings.pedestriansLow',
      medium: 'settings.pedestriansMedium',
      high: 'settings.pedestriansHigh',
    },
    volume: {
      off: 'settings.volumeOff',
      low: 'settings.volumeLow',
      medium: 'settings.volumeMedium',
      high: 'settings.volumeHigh',
    },
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
    $('trafficChips'),
    CHOICES.traffic.map((value) => ({ value, label: t(labels.traffic[value]) })),
    preferences.traffic,
    (traffic) => changePreferences({ traffic }),
  );
  chips(
    $('pedestrianChips'),
    CHOICES.pedestrians.map((value) => ({ value, label: t(labels.pedestrians[value]) })),
    preferences.pedestrians,
    (pedestrians) => changePreferences({ pedestrians }),
  );
  chips(
    $('volumeChips'),
    CHOICES.volume.map((value) => ({ value, label: t(labels.volume[value]) })),
    preferences.volume,
    (volume) => changePreferences({ volume }),
  );
  chips(
    $('announcementChips'),
    [
      { value: false, label: t('settings.off') },
      { value: true, label: t('settings.on') },
    ],
    preferences.announcements,
    (announcements) => changePreferences({ announcements }),
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
    seasons = (await loadSettings()).seasons;
    const res = await fetch('data/grenoble/lines/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lineIndex = /** @type {import('./common/types.js').LineIndex} */ (await res.json());
  } catch (e) {
    $('lineChips').replaceChildren(emptyNote(t('menu.loadError', { error: String(e) })));
    return;
  }
  const lines = lineIndex.lines;
  if (!lines.some((l) => l.id === sel.line)) sel.line = lines[0].id;
  $('titleBadges').replaceChildren(...lines.map((l) => lineBadge(l, true)));
  await pickLine(sel.line);
}

start().catch((e) => {
  // the language file itself failed: nothing to translate with
  document.body.textContent = String(e);
});
