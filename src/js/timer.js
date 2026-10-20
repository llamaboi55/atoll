// Focus timer shared by the Today tab and the pill, so a running countdown stays visible.
const KEY = 'atoll:timer';
let t = load();
const listeners = new Set();

function load() {
  try {
    return { length: 25 * 60, endsAt: 0, left: 25 * 60, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { length: 25 * 60, endsAt: 0, left: 25 * 60 };
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {}
  listeners.forEach((fn) => fn());
}

export const running = () => t.endsAt > 0;
export const remaining = () => (running() ? Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) : t.left);
export const length = () => t.length;

export function start() {
  if (running()) return;
  t.endsAt = Date.now() + remaining() * 1000;
  save();
}
export function pause() {
  if (!running()) return;
  t.left = remaining();
  t.endsAt = 0;
  save();
}
export function reset(seconds = t.length) {
  t = { length: seconds, endsAt: 0, left: seconds };
  save();
}
export function onTimer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function format(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

let done = null;
/** Called when a countdown reaches zero. */
export function onDone(fn) {
  done = fn;
}
setInterval(() => {
  if (running() && remaining() === 0) {
    reset();
    done?.();
  }
}, 500);
