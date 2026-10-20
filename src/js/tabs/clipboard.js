import { h, icon, iconButton, toast } from '../h.js';
import { call } from '../api.js';

let items = [];
let filter = 'all';
let query = '';
let selected = null;
let els;
const thumbs = new Map();

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function visible() {
  const q = query.toLowerCase();
  const list = items.filter((c) => (filter === 'all' || c.kind === filter || (filter === 'pinned' && c.pinned)) && (!q || c.text.toLowerCase().includes(q)));
  return [...list.filter((c) => c.pinned), ...list.filter((c) => !c.pinned)];
}

async function thumb(id) {
  if (!thumbs.has(id)) thumbs.set(id, call('clip_thumb', { id }));
  return thumbs.get(id);
}

function row(c) {
  const img = c.kind === 'image' ? h('img', { alt: '' }) : null;
  if (img) thumb(c.id).then((src) => src && (img.src = src));
  const el = h('li', { class: `clip ${c.id === selected ? 'sel' : ''}`, tabIndex: -1, onClick: () => select(c.id), onDblclick: () => paste(c.id) },
    img || h('span', { class: 'clip-text' }, c.text.replace(/\s+/g, ' ').slice(0, 160)),
    img ? h('span', { class: 'clip-text muted' }, `Image ${c.width}×${c.height}`) : null,
    c.pinned ? h('span', { class: 'pinned', title: 'Pinned' }, icon('pin')) : null,
  );
  return el;
}

function paint() {
  const list = visible();
  if (!list.some((c) => c.id === selected)) selected = list[0]?.id ?? null;
  els.search.placeholder = `Search ${items.length} item${items.length === 1 ? '' : 's'}`;
  els.list.replaceChildren(...list.map(row));
  if (!list.length) els.list.append(h('li', { class: 'empty muted' }, items.length ? 'No matches.' : 'Copy something and it shows up here. History stays on this computer.'));
  for (const b of els.filters) b.classList.toggle('on', b.dataset.f === filter);
  paintPreview();
}

function paintPreview() {
  const c = items.find((x) => x.id === selected);
  if (!c) return els.preview.replaceChildren(h('div', { class: 'muted center-fill' }, 'Nothing selected'));
  let body;
  if (c.kind === 'image') {
    body = h('img', { class: 'preview-img', alt: 'Copied image' });
    thumb(c.id).then((src) => src && (body.src = src));
  } else {
    body = h('pre', { class: 'preview-text' }, c.text);
  }
  els.preview.replaceChildren(
    body,
    h('div', { class: 'meta' },
      h('span', {}, c.kind === 'image' ? `Image · ${c.width}×${c.height}` : `Text · ${c.text.length} characters`),
      h('span', {}, `Copied ${ago(c.created)}`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onClick: () => paste(c.id) }, 'Paste'),
      iconButton('copy', 'Copy (Ctrl D)', () => copy(c.id)),
      iconButton('pin', c.pinned ? 'Unpin (Ctrl P)' : 'Pin (Ctrl P)', () => pin(c.id), { class: c.pinned ? 'on' : '' }),
      iconButton('trash', 'Remove (Del)', () => remove(c.id))),
  );
}

function select(id) {
  selected = id;
  for (const li of els.list.children) li.classList.remove('sel');
  const idx = visible().findIndex((c) => c.id === id);
  els.list.children[idx]?.classList.add('sel');
  els.list.children[idx]?.scrollIntoView({ block: 'nearest' });
  paintPreview();
}

async function paste(id) {
  try {
    await call('clip_paste', { id });
  } catch (e) {
    toast(String(e));
  }
}
async function copy(id) {
  await call('clip_copy', { id }).catch((e) => toast(String(e)));
  toast('Copied');
}
async function pin(id) {
  const c = items.find((x) => x.id === id);
  await call('clip_pin', { id, pinned: !c.pinned });
  c.pinned = !c.pinned;
  paint();
}
async function remove(id) {
  await call('clip_delete', { id });
  items = items.filter((x) => x.id !== id);
  thumbs.delete(id);
  paint();
}

async function load() {
  items = (await call('clips_list')) || [];
  items.sort((a, b) => b.created - a.created);
  paint();
}

export const clipboard = {
  id: 'clipboard',
  label: 'Clipboard',
  icon: 'clipboard',
  mount(view) {
    els = {
      search: h('input', { type: 'search', 'aria-label': 'Search clipboard history' }),
      list: h('ul', { class: 'clips' }),
      preview: h('div', { class: 'card preview' }),
      filters: [['all', 'All'], ['text', 'Text'], ['image', 'Images'], ['pinned', 'Pinned']].map(([f, label]) =>
        h('button', { class: 'chip-btn', type: 'button', dataset: { f }, onClick: () => { filter = f; paint(); } }, label)),
    };
    els.search.addEventListener('input', () => {
      query = els.search.value;
      paint();
    });
    view.addEventListener('keydown', (e) => {
      const list = visible();
      const i = list.findIndex((c) => c.id === selected);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) select(next.id);
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        paste(selected);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selected) {
        e.preventDefault();
        copy(selected);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && selected) {
        e.preventDefault();
        pin(selected);
      } else if (e.key === 'Delete' && selected && document.activeElement !== els.search) {
        remove(selected);
      }
    });
    const clearBtn = h('button', { class: 'link-btn', type: 'button', onClick: async () => { await call('clip_clear'); load(); } }, 'Clear unpinned');
    view.append(
      h('div', { class: 'clip-grid' },
        h('div', { class: 'card list-card' },
          h('div', { class: 'search' }, icon('search'), els.search),
          h('div', { class: 'row' }, ...els.filters, h('span', { class: 'grow' }), clearBtn),
          els.list,
          h('div', { class: 'hints' }, h('span', {}, h('kbd', {}, 'Enter'), ' paste'), h('span', {}, h('kbd', {}, 'Ctrl D'), ' copy'), h('span', {}, h('kbd', {}, 'Ctrl P'), ' pin'), h('span', {}, h('kbd', {}, 'Del'), ' remove'))),
        els.preview,
      ),
    );
    load();
  },
  show() {
    load();
  },
  focus() {
    els.search.focus();
  },
  add(clip) {
    items = [clip, ...items.filter((c) => c.id !== clip.id)];
    if (els && !els.list.closest('.view').hidden) paint();
  },
};
