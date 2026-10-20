import { h, icon, toast } from '../h.js';
import { call } from '../api.js';
import { get, set } from '../prefs.js';

let all = [];
let els;
let ctx;

const HUES = [150, 172, 196, 32, 18, 260, 210, 88];
function hue(name) {
  let n = 0;
  for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[n % HUES.length];
}
function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}

function ranked() {
  const q = els.search.value.trim().toLowerCase();
  const launches = get().appLaunches;
  let list = all;
  if (q) {
    list = all.filter((a) => a.name.toLowerCase().includes(q));
    list.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || (launches[b.path] || 0) - (launches[a.path] || 0));
  } else {
    list = [...all].sort((a, b) => (launches[b.path] || 0) - (launches[a.path] || 0) || a.name.localeCompare(b.name));
  }
  return list;
}

async function launch(app) {
  try {
    await call('app_launch', { path: app.path });
    const launches = { ...get().appLaunches, [app.path]: (get().appLaunches[app.path] || 0) + 1 };
    set({ appLaunches: launches });
    ctx.collapse();
  } catch (e) {
    toast(String(e));
  }
}

function paint() {
  const list = ranked();
  els.grid.replaceChildren(
    ...list.slice(0, 60).map((a, i) =>
      h('button', { class: `app ${i === 0 && els.search.value ? 'first' : ''}`, type: 'button', title: a.name, onClick: () => launch(a) },
        h('span', { class: 'mono', style: { '--h': hue(a.name) } }, initials(a.name)),
        h('span', { class: 'app-name' }, a.name))),
  );
  if (!list.length) els.grid.append(h('p', { class: 'muted' }, all.length ? 'No app by that name.' : 'Looking for apps…'));
}

export const apps = {
  id: 'apps',
  label: 'Apps',
  icon: 'grid',
  mount(view, context) {
    ctx = context;
    els = {
      search: h('input', { type: 'search', placeholder: 'Type to find an app, Enter to open', 'aria-label': 'Find an app' }),
      grid: h('div', { class: 'app-grid' }),
    };
    els.search.addEventListener('input', paint);
    els.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = ranked()[0];
        if (first) launch(first);
      }
    });
    view.append(h('div', { class: 'card full' }, h('div', { class: 'search' }, icon('search'), els.search), els.grid));
  },
  async show() {
    if (!all.length) {
      all = (await call('apps_list')) || [];
    }
    paint();
  },
  focus() {
    els.search.select();
    els.search.focus();
  },
};
