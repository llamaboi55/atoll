import { h, icon, iconButton, uid } from '../h.js';
import { get, set, onChange } from '../prefs.js';
import { weather, onWeather, describe } from '../weather.js';
import * as timer from '../timer.js';

let els;

function week() {
  const w = weather();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const f = w?.days?.[i];
    return h('div', { class: `day ${i === 0 ? 'now' : ''}` },
      h('span', { class: 'dow' }, i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })),
      h('span', { class: 'dom' }, d.getDate()),
      f ? h('span', { class: 'hilo' }, `${f[0]}° `, h('em', {}, `${f[1]}°`)) : null,
    );
  });
}

function paintClock() {
  const now = new Date();
  els.time.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !get().clock24 });
  els.date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function paintWeather() {
  const w = weather();
  if (!w || w.temp == null) {
    els.weather.replaceChildren(h('span', { class: 'muted' }, 'Pick your city in Settings for weather.'));
  } else {
    const d = describe(w.code);
    els.weather.replaceChildren(h('span', { class: `wx wx-${d.kind}` }), h('b', {}, `${w.temp}°`), h('span', {}, `${d.label} in ${w.city}`));
  }
  els.week.replaceChildren(...week());
}

function paintTodos() {
  const { todos } = get();
  els.todoList.replaceChildren(
    ...todos.map((t) =>
      h('li', { class: t.done ? 'done' : '' },
        h('button', { class: 'check', type: 'button', 'aria-label': t.done ? 'Mark not done' : 'Mark done', onClick: () => set({ todos: get().todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) }) }, t.done ? icon('check') : null),
        h('span', {}, t.text),
        iconButton('x', 'Remove', () => set({ todos: get().todos.filter((x) => x.id !== t.id) }), { class: 'ghost' }),
      )),
  );
  if (!todos.length) els.todoList.append(h('li', { class: 'empty muted' }, 'Nothing yet. Add one thing that matters today.'));
}

function paintTimer() {
  const left = timer.remaining();
  els.timerText.textContent = timer.format(left);
  const pct = 1 - left / timer.length();
  els.timerRing.style.setProperty('--p', String(Math.max(0, Math.min(1, pct))));
  els.timerToggle.replaceChildren(icon(timer.running() ? 'pause' : 'play'), timer.running() ? 'Pause' : 'Start');
  for (const b of els.presets) b.classList.toggle('on', Number(b.dataset.min) * 60 === timer.length());
}

export const today = {
  id: 'today',
  label: 'Today',
  icon: 'today',
  mount(view) {
    els = {
      time: h('div', { class: 'big-time' }),
      date: h('div', { class: 'big-date' }),
      weather: h('div', { class: 'weather-line' }),
      week: h('div', { class: 'week' }),
      todoList: h('ul', { class: 'todos' }),
      timerText: h('div', { class: 'timer-text' }),
      timerRing: h('div', { class: 'timer-ring' }),
      timerToggle: h('button', { class: 'btn primary', type: 'button', onClick: () => (timer.running() ? timer.pause() : timer.start()) }),
      presets: [5, 25, 50].map((m) => h('button', { class: 'chip-btn', type: 'button', dataset: { min: m }, onClick: () => timer.reset(m * 60) }, `${m}m`)),
    };
    els.timerRing.append(els.timerText);
    const input = h('input', { type: 'text', placeholder: 'Add a to-do and press Enter', maxLength: 140, 'aria-label': 'New to-do' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        set({ todos: [...get().todos, { id: uid(), text: input.value.trim(), done: false }] });
        input.value = '';
      }
    });
    view.append(
      h('div', { class: 'today-grid' },
        h('div', { class: 'card hero' }, els.time, els.date, els.weather, els.week),
        h('div', { class: 'card' }, h('h3', {}, 'To-do'), input, els.todoList,
          h('button', { class: 'link-btn', type: 'button', onClick: () => set({ todos: get().todos.filter((t) => !t.done) }) }, 'Clear finished')),
        h('div', { class: 'card focus' }, h('h3', {}, 'Focus'), els.timerRing,
          h('div', { class: 'row center' }, els.timerToggle, iconButton('reset', 'Reset', () => timer.reset())),
          h('div', { class: 'row center' }, ...els.presets)),
      ),
    );
    paintClock();
    paintWeather();
    paintTodos();
    paintTimer();
    setInterval(() => {
      if (!view.hidden) {
        paintClock();
        paintTimer();
      }
    }, 1000);
    onWeather(paintWeather);
    onChange(() => {
      paintTodos();
      paintClock();
    });
    timer.onTimer(paintTimer);
  },
};
