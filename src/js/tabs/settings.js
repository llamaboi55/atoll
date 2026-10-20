import { h, icon, toast } from '../h.js';
import { call, plugins } from '../api.js';
import { get, set } from '../prefs.js';
import { searchCity, setCity } from '../weather.js';

const REPO = 'https://github.com/llamaboi55/atoll';
let els;
let cfg;

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
}

async function load() {
  cfg = await call('config_get');
  els.provider.value = cfg.ai_provider;
  els.key.value = '';
  els.key.placeholder = cfg.has_gemini_key ? 'Saved. Type a new key to replace it.' : 'Paste your key';
  els.geminiModel.value = cfg.gemini_model;
  els.ollamaUrl.value = cfg.ollama_url;
  els.ollamaModel.value = cfg.ollama_model;
  els.toggle.value = cfg.toggle_shortcut;
  els.ask.value = cfg.ask_shortcut;
  els.dictate.value = cfg.dictate_shortcut;
  els.limit.value = cfg.clip_limit;
  paintProvider();
}

function paintProvider() {
  const p = els.provider.value;
  els.gemini.hidden = p !== 'gemini';
  els.ollama.hidden = p !== 'ollama';
}

async function save(clearKey = false) {
  const next = {
    ...cfg,
    ai_provider: els.provider.value,
    gemini_key: els.key.value,
    gemini_model: els.geminiModel.value.trim() || 'gemini-2.5-flash',
    ollama_url: els.ollamaUrl.value.trim() || 'http://localhost:11434',
    ollama_model: els.ollamaModel.value.trim() || 'gemma3',
    toggle_shortcut: els.toggle.value.trim(),
    ask_shortcut: els.ask.value.trim(),
    dictate_shortcut: els.dictate.value.trim(),
    clip_limit: Number(els.limit.value) || 500,
  };
  delete next.has_gemini_key;
  try {
    await call('config_set', { next, clearKey });
    toast('Saved');
  } catch (e) {
    toast(String(e));
  }
  load();
}

export const settings = {
  id: 'settings',
  label: 'Settings',
  icon: 'gear',
  mount(view) {
    const select = (options) => h('select', {}, ...options.map(([v, l]) => h('option', { value: v }, l)));
    els = {
      provider: select([['none', 'Off'], ['gemini', 'Google Gemini (your free key)'], ['ollama', 'Ollama (local, offline)']]),
      key: h('input', { type: 'password', autocomplete: 'off', spellcheck: false }),
      geminiModel: h('input', { type: 'text' }),
      ollamaUrl: h('input', { type: 'text' }),
      ollamaModel: h('input', { type: 'text' }),
      toggle: h('input', { type: 'text' }),
      ask: h('input', { type: 'text' }),
      dictate: h('input', { type: 'text' }),
      limit: h('input', { type: 'number', min: 20, max: 5000, step: 10 }),
      city: h('input', { type: 'search', placeholder: get().city?.name || 'Search for your city' }),
      cityResults: h('ul', { class: 'city-results' }),
      units: select([['c', 'Celsius'], ['f', 'Fahrenheit']]),
      clock: select([['12', '12-hour'], ['24', '24-hour']]),
    };
    els.provider.addEventListener('change', paintProvider);
    els.units.value = get().units;
    els.clock.value = get().clock24 ? '24' : '12';
    els.units.addEventListener('change', () => {
      set({ units: els.units.value });
      setCity(get().city);
    });
    els.clock.addEventListener('change', () => set({ clock24: els.clock.value === '24' }));

    let t;
    els.city.addEventListener('input', () => {
      clearTimeout(t);
      const q = els.city.value.trim();
      if (q.length < 2) return els.cityResults.replaceChildren();
      t = setTimeout(async () => {
        try {
          const found = await searchCity(q);
          els.cityResults.replaceChildren(...found.map((c) =>
            h('li', {}, h('button', { type: 'button', onClick: async () => {
              await setCity({ name: c.name, lat: c.lat, lon: c.lon });
              els.city.value = '';
              els.city.placeholder = c.name;
              els.cityResults.replaceChildren();
              toast(`Weather for ${c.name}`);
            } }, h('b', {}, c.name), ` ${c.detail}`))));
        } catch {
          els.cityResults.replaceChildren(h('li', { class: 'muted' }, 'Offline?'));
        }
      }, 300);
    });

    els.gemini = h('div', { class: 'sub' },
      field('Gemini API key', els.key, 'Free at aistudio.google.com. Stored only on this computer.'),
      h('div', { class: 'row' }, field('Model', els.geminiModel), h('button', { class: 'link-btn', type: 'button', onClick: () => save(true) }, 'Remove saved key')));
    els.ollama = h('div', { class: 'sub' },
      h('div', { class: 'row' }, field('Ollama address', els.ollamaUrl), field('Model', els.ollamaModel, 'Use a vision model (gemma3, llava) to ask about your screen.')));

    view.append(
      h('div', { class: 'settings-grid' },
        h('div', { class: 'card' }, h('h3', {}, 'AI (optional)'), field('Provider', els.provider), els.gemini, els.ollama,
          h('p', { class: 'muted small' }, 'Nothing is sent anywhere unless you ask a question or dictate.')),
        h('div', { class: 'card' }, h('h3', {}, 'Shortcuts'),
          field('Open / close', els.toggle), field('Ask about my screen', els.ask), field('Hold to dictate', els.dictate),
          field('Clipboard items to keep', els.limit),
          h('button', { class: 'btn primary', type: 'button', onClick: () => save() }, icon('check'), 'Save')),
        h('div', { class: 'card' }, h('h3', {}, 'Weather and clock'), field('City', els.city), els.cityResults,
          h('div', { class: 'row' }, field('Units', els.units), field('Clock', els.clock)),
          h('h3', {}, 'About'),
          h('p', { class: 'muted small' }, 'Atoll is free and open source (MIT). No account, no ads, no tracking.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onClick: () => plugins.openUrl(REPO) }, icon('github'), 'GitHub'),
            h('button', { class: 'btn', type: 'button', onClick: () => call('quit') }, icon('power'), 'Quit'))),
      ),
    );
    view.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target !== els.city) save();
    });
    load();
  },
  show() {
    load();
  },
};
