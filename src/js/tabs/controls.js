import { h, icon, toast } from '../h.js';
import { call, plugins } from '../api.js';

function tile(name, label, onClick, cls = '') {
  return h('button', { class: `tile ${cls}`, type: 'button', onClick }, icon(name), h('span', {}, label));
}

function toggleRow(label, hint, initial, onToggle) {
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(initial), 'aria-label': label });
  sw.addEventListener('click', async () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    try {
      const actual = await onToggle(next);
      sw.setAttribute('aria-checked', String(actual ?? next));
    } catch (e) {
      toast(String(e));
    }
  });
  return { row: h('div', { class: 'toggle-row' }, h('div', {}, h('b', {}, label), h('small', {}, hint)), sw), sw };
}

const media = (action) => () => call('media', { action }).catch((e) => toast(String(e)));

export const controls = {
  id: 'controls',
  label: 'Controls',
  icon: 'sliders',
  mount(view) {
    // Restart and shut down ask for a second click instead of a dialog.
    let armed = null;
    const confirmPower = (action, label) => (e) => {
      const btn = e.currentTarget;
      if (armed !== action) {
        armed = action;
        btn.classList.add('armed');
        btn.querySelector('span').textContent = 'Click again';
        setTimeout(() => {
          if (armed === action) armed = null;
          btn.classList.remove('armed');
          btn.querySelector('span').textContent = label;
        }, 3000);
        return;
      }
      call('power', { action }).catch((err) => toast(String(err)));
    };

    const awake = toggleRow('Keep awake', 'Stops the screen from sleeping', false, (on) => call('keep_awake', { on }));
    const login = toggleRow('Start at login', 'Atoll opens when you sign in', false, async (on) => {
      await plugins.autostart.set(on);
      return plugins.autostart.get();
    });
    plugins.autostart.get().then((on) => login.sw.setAttribute('aria-checked', String(on))).catch(() => {});
    const paused = toggleRow('Pause clipboard history', 'Copies are not saved while on', false, async (on) => {
      const cfg = await call('config_get');
      const next = await call('config_set', { next: { ...cfg, clip_paused: on }, clearKey: false });
      return next.clip_paused;
    });
    call('config_get').then((c) => paused.sw.setAttribute('aria-checked', String(Boolean(c?.clip_paused))));

    view.append(
      h('div', { class: 'controls-grid' },
        h('div', { class: 'card' }, h('h3', {}, 'Media'),
          h('div', { class: 'tiles' }, tile('prev', 'Previous', media('prev')), tile('play', 'Play / pause', media('play'), 'wide'), tile('next', 'Next', media('next')))),
        h('div', { class: 'card' }, h('h3', {}, 'Volume'),
          h('div', { class: 'tiles' }, tile('volDown', 'Down', media('vol-down')), tile('mute', 'Mute', media('mute')), tile('volUp', 'Up', media('vol-up')))),
        h('div', { class: 'card' }, h('h3', {}, 'Quick toggles'), awake.row, login.row, paused.row),
        h('div', { class: 'card' }, h('h3', {}, 'Power'),
          h('div', { class: 'tiles four' },
            tile('lock', 'Lock', () => call('power', { action: 'lock' }).catch((e) => toast(String(e)))),
            tile('moon', 'Sleep', () => call('power', { action: 'sleep' }).catch((e) => toast(String(e)))),
            tile('restart', 'Restart', confirmPower('restart', 'Restart'), 'warn'),
            tile('power', 'Shut down', confirmPower('shutdown', 'Shut down'), 'warn'))),
      ),
    );
  },
};
