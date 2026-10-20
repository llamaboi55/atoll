// Small UI preferences kept in the webview's local storage (settings that matter to the
// Rust side, like shortcuts and AI, live in the app's config file instead).
const KEY = 'atoll:prefs';
const DEFAULTS = {
  clock24: !new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12,
  units: ['US', 'LR', 'MM'].includes(navigator.language.split('-')[1]) ? 'f' : 'c',
  city: null,
  wallpaperDaily: false,
  wallpaperDay: '',
  todos: [],
  appLaunches: {},
};

let prefs = load();
const listeners = new Set();

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const get = () => prefs;

export function set(patch) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  for (const fn of listeners) fn(prefs);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
