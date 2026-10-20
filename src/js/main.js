import { h, icon, toast } from './h.js';
import { call, listen, native } from './api.js';
import { get, onChange } from './prefs.js';
import { weather, onWeather, refresh as refreshWeather } from './weather.js';
import * as timer from './timer.js';
import { sceneDataUrl } from './scenes.js';
import { today } from './tabs/today.js';
import { controls } from './tabs/controls.js';
import { stats } from './tabs/stats.js';
import { clipboard } from './tabs/clipboard.js';
import { apps } from './tabs/apps.js';
import { wallpaper, applyDailyWallpaper } from './tabs/wallpaper.js';
import { ask, dictateDown, dictateUp, dictating } from './tabs/ask.js';
import { settings } from './tabs/settings.js';

const TABS = [today, controls, stats, clipboard, apps, wallpaper, ask, settings];
const island = document.getElementById('island');
const views = document.getElementById('views');
const tabBar = document.getElementById('tabs');
let active = null;
let expanded = false;

const params = new URLSearchParams(location.search);
if (!native) {
  document.documentElement.classList.add('preview');
  if (params.has('stage')) document.documentElement.classList.add('stage');
  else document.body.style.backgroundImage = `url("${sceneDataUrl(params.get('scene') || 'moss-valley')}")`;
}

for (const tab of TABS) {
  tab.view = h('div', { class: `view view-${tab.id}`, role: 'tabpanel', hidden: true });
  views.append(tab.view);
  tab.button = h('button', { class: 'tab', type: 'button', role: 'tab', onClick: () => show(tab.id) }, icon(tab.icon), h('span', {}, tab.label));
  tabBar.append(tab.button);
  tab.mount(tab.view, { collapse, show });
}

function show(id) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  if (active === tab) return tab.focus?.();
  active?.hide?.();
  for (const t of TABS) {
    t.view.hidden = t !== tab;
    t.button.setAttribute('aria-selected', String(t === tab));
  }
  active = tab;
  tab.show?.();
  tab.focus?.();
}

export async function expand(id) {
  if (!expanded) {
    expanded = true;
    await call('set_mode', { expanded: true });
    island.classList.remove('collapsed');
    island.classList.add('expanded');
  }
  show(id || active?.id || 'today');
}

export async function collapse() {
  if (!expanded) return;
  expanded = false;
  active?.hide?.();
  island.classList.remove('expanded');
  island.classList.add('collapsed');
  await new Promise((r) => setTimeout(r, 140));
  if (!expanded) await call('set_mode', { expanded: false });
}

const toggle = () => (expanded ? collapse() : expand());

// Pill
const pill = document.getElementById('pill');
pill.addEventListener('click', () => expand());
pill.addEventListener('wheel', (e) => e.deltaY > 0 && expand(), { passive: true });

function clockText(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !get().clock24 });
}

function paintPill() {
  const time = clockText();
  document.getElementById('pill-time').textContent = time;
  document.getElementById('head-time').textContent = time;
  const extra = document.getElementById('pill-extra');
  const bits = [];
  if (dictating()) bits.push(h('span', { class: 'chip rec' }, h('i'), 'Listening'));
  else if (timer.running()) bits.push(h('span', { class: 'chip timer' }, icon('play'), timer.format(timer.remaining())));
  const w = weather();
  if (w && w.temp != null) bits.push(h('span', { class: 'chip' }, `${w.temp}°`));
  extra.replaceChildren(...bits);
}
setInterval(paintPill, 1000);
onWeather(paintPill);
onChange(paintPill);
timer.onTimer(paintPill);
timer.onDone(() => {
  toast('Focus session done. Take a breather.');
  pill.classList.add('ping');
  setTimeout(() => pill.classList.remove('ping'), 3000);
});

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && expanded) {
    e.preventDefault();
    collapse();
  }
  if ((e.ctrlKey || e.metaKey) && /^[1-8]$/.test(e.key)) {
    e.preventDefault();
    show(TABS[Number(e.key) - 1].id);
  }
});

// Leaving the island (clicking another app) tucks it away again.
window.addEventListener('blur', () => {
  if (expanded && native && !document.documentElement.classList.contains('keep-open')) collapse();
});

listen('atoll://toggle', toggle);
listen('atoll://ask', () => expand('ask').then(() => ask.prepare({ withScreen: true })));
listen('atoll://dictate', (state) => (state === 'down' ? dictateDown() : dictateUp()));
listen('atoll://clip', (clip) => clipboard.add(clip));

paintPill();
refreshWeather();
applyDailyWallpaper();

// Preview helpers for screenshots: ?open=stats etc.
if (params.has('open')) expand(params.get('open'));
