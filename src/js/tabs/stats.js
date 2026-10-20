import { h, icon, toast } from '../h.js';
import { call } from '../api.js';

const GB = 1024 ** 3;
const gb = (b) => `${(b / GB).toFixed(1)} GB`;
function rate(bps) {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${Math.round(bps / 1e3)} KB/s`;
  return `${Math.round(bps)} B/s`;
}
function since(secs) {
  const d = Math.floor(secs / 86400);
  const hrs = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d ? `${d}d ${hrs}h` : `${hrs}h ${m}m`;
}

function ring(label) {
  const value = h('b', {});
  const sub = h('small', {});
  const el = h('div', { class: 'ring' }, h('div', { class: 'ring-inner' }, value, h('span', {}, label), sub));
  return {
    el,
    set(pct, subText) {
      el.style.setProperty('--p', String(Math.max(0, Math.min(1, pct / 100))));
      el.classList.toggle('hot', pct > 85);
      value.textContent = `${Math.round(pct)}%`;
      sub.textContent = subText;
    },
  };
}

let timerId = null;
let els;

async function tick() {
  const s = await call('stats');
  if (!s) return;
  els.mem.set((s.memory_used / s.memory_total) * 100, `${gb(s.memory_used)} of ${gb(s.memory_total)}`);
  els.cpu.set(s.cpu, `${s.cores} cores`);
  els.down.textContent = rate(s.rx_per_sec);
  els.up.textContent = rate(s.tx_per_sec);
  els.uptime.textContent = since(s.uptime);
  els.host.textContent = [s.host, s.os].filter(Boolean).join(' · ');
  const max = Math.max(...s.top.map((p) => p.memory), 1);
  els.top.replaceChildren(
    ...s.top.map((p) =>
      h('li', {},
        h('span', { class: 'name' }, p.name, p.count > 1 ? h('em', {}, ` ×${p.count}`) : null),
        h('span', { class: 'bar' }, h('i', { style: { width: `${(p.memory / max) * 100}%` } })),
        h('span', { class: 'num' }, p.memory >= GB ? gb(p.memory) : `${Math.round(p.memory / 1024 ** 2)} MB`))),
  );
  els.disks.replaceChildren(
    ...s.disks.map((d) => {
      const used = d.total - d.available;
      return h('li', {},
        h('span', { class: 'name' }, d.mount),
        h('span', { class: 'bar' }, h('i', { style: { width: `${(used / d.total) * 100}%` } })),
        h('span', { class: 'num' }, `${gb(d.available)} free`));
    }),
  );
}

export const stats = {
  id: 'stats',
  label: 'Stats',
  icon: 'stats',
  mount(view) {
    els = {
      mem: ring('Memory'), cpu: ring('CPU'),
      down: h('b', {}), up: h('b', {}), uptime: h('b', {}), host: h('small', { class: 'muted host' }),
      top: h('ul', { class: 'bars' }), disks: h('ul', { class: 'bars' }),
      speed: h('b', {}, '—'),
    };
    const speedBtn = h('button', { class: 'btn', type: 'button' }, icon('wifi'), 'Test speed');
    speedBtn.addEventListener('click', async () => {
      speedBtn.disabled = true;
      els.speed.textContent = 'Testing…';
      try {
        const r = await call('speed_test');
        els.speed.textContent = `${r.down_mbps.toFixed(0)} Mbps · ${Math.round(r.latency_ms)} ms`;
      } catch (e) {
        els.speed.textContent = '—';
        toast(String(e));
      }
      speedBtn.disabled = false;
    });
    view.append(
      h('div', { class: 'stats-grid' },
        h('div', { class: 'card rings' }, els.mem.el, els.cpu.el),
        h('div', { class: 'card' }, h('h3', {}, 'Using the most memory'), els.top),
        h('div', { class: 'card side' },
          h('div', { class: 'kv' }, h('span', {}, 'Download'), els.down),
          h('div', { class: 'kv' }, h('span', {}, 'Upload'), els.up),
          h('div', { class: 'kv' }, h('span', {}, 'Up for'), els.uptime),
          h('div', { class: 'kv' }, h('span', {}, 'Internet speed'), els.speed),
          speedBtn,
          h('h3', {}, 'Disks'), els.disks, els.host),
      ),
    );
  },
  show() {
    tick();
    timerId = setInterval(tick, 2000);
  },
  hide() {
    clearInterval(timerId);
  },
};
