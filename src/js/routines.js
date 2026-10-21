// Routines: questions Atoll asks your AI on its own at a set time each day, like
// "summarize today's weather and my to-dos" at 8:00. Kept in prefs, checked every 30 seconds
// while Atoll is running. The newest answer lands in the Ask tab.
import { get, set } from './prefs.js';
import { call } from './api.js';
import { weather, describe } from './weather.js';

const listeners = new Set();
let running = false;

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const minutes = (hhmm) => {
  const [hh, mm] = String(hhmm).split(':').map(Number);
  return hh * 60 + mm;
};

/** What Atoll already knows, so a routine can talk about your day without a screenshot. */
function context() {
  const bits = [`It is ${new Date().toLocaleString()}.`];
  const w = weather();
  if (w && w.temp != null) {
    bits.push(`Weather in ${w.city || 'my city'}: ${w.temp}°${(w.units || 'c').toUpperCase()}, ${describe(w.code).label}.`);
  }
  const open = get().todos.filter((t) => !t.done).map((t) => `- ${t.text}`);
  bits.push(open.length ? `My open to-dos:\n${open.join('\n')}` : 'I have no open to-dos.');
  return bits.join('\n');
}

export async function run(routine) {
  const answer = { id: routine.id, prompt: routine.prompt, at: Date.now() };
  try {
    answer.text = await call('ai_ask', { prompt: `${context()}\n\n${routine.prompt}`, withScreen: false });
  } catch (e) {
    answer.text = String(e);
    answer.error = true;
  }
  set({ routineAnswer: answer });
  for (const fn of listeners) fn(answer);
  return answer;
}

/** Runs every routine whose time has passed today and that hasn't run yet today. */
export async function tick(now = new Date()) {
  if (running) return;
  const today = dayKey(now);
  const due = get().routines.filter((r) => r.on !== false && r.lastRun !== today && minutes(r.time) <= now.getHours() * 60 + now.getMinutes());
  if (!due.length) return;
  running = true;
  set({ routines: get().routines.map((r) => (due.some((d) => d.id === r.id) ? { ...r, lastRun: today } : r)) });
  try {
    for (const r of due) await run(r);
  } finally {
    running = false;
  }
}

/** A new routine starts counting from tomorrow if its time already passed today. */
export function add(time, prompt) {
  const now = new Date();
  const passed = minutes(time) <= now.getHours() * 60 + now.getMinutes();
  const routine = { id: Math.random().toString(36).slice(2, 10), time, prompt, on: true, lastRun: passed ? dayKey(now) : '' };
  set({ routines: [...get().routines, routine] });
  return routine;
}

export const remove = (id) => set({ routines: get().routines.filter((r) => r.id !== id) });

export function onAnswer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function start() {
  tick();
  setInterval(tick, 30 * 1000);
}
