import { h, icon, toast } from '../h.js';
import { call, native, plugins } from '../api.js';
import { SCENES, sceneSvg, sceneDataUrl, sceneOfTheDay } from '../scenes.js';
import { get, set } from '../prefs.js';

/** Draw a scene at the screen's full resolution and hand the PNG to the OS. */
async function renderPng(scene) {
  const w = Math.round(screen.width * (window.devicePixelRatio || 1));
  const hgt = Math.round(screen.height * (window.devicePixelRatio || 1));
  const svg = sceneSvg(scene).replace('<svg ', `<svg width="${w}" height="${hgt}" `);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    canvas.getContext('2d').drawImage(img, 0, 0, w, hgt);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function apply(scene, quiet = false) {
  try {
    const pngBase64 = await renderPng(scene);
    await call('set_wallpaper_png', { name: scene.id, pngBase64 });
    if (!native && document.documentElement.classList.contains('stage')) window.parent.postMessage({ wallpaper: scene.id }, '*');
    else if (!native) document.body.style.backgroundImage = `url("${sceneDataUrl(scene)}")`;
    set({ wallpaperCurrent: scene.id });
    if (!quiet) toast(`Wallpaper set to ${scene.name}`);
  } catch (e) {
    toast(`Couldn't set the wallpaper: ${e}`);
  }
}

export async function applyDailyWallpaper() {
  if (!native || !get().wallpaperDaily) return;
  const day = new Date().toDateString();
  if (get().wallpaperDay === day) return;
  set({ wallpaperDay: day });
  await apply(sceneOfTheDay(), true);
}
setInterval(applyDailyWallpaper, 15 * 60 * 1000);

let grid;
function paint() {
  const currentId = get().wallpaperCurrent;
  grid.replaceChildren(
    ...SCENES.map((s) =>
      h('button', { class: `scene ${s.id === currentId ? 'on' : ''}`, type: 'button', title: `Use ${s.name}`, onClick: async () => { await apply(s); paint(); } },
        h('img', { src: sceneDataUrl(s), alt: '' }),
        h('span', {}, s.name))),
  );
}

export const wallpaper = {
  id: 'wallpaper',
  label: 'Wallpaper',
  icon: 'image',
  mount(view) {
    grid = h('div', { class: 'scenes' });
    const daily = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(get().wallpaperDaily), 'aria-label': 'New wallpaper every day' });
    daily.addEventListener('click', () => {
      const on = !get().wallpaperDaily;
      set({ wallpaperDaily: on, wallpaperDay: '' });
      daily.setAttribute('aria-checked', String(on));
      applyDailyWallpaper();
    });
    const own = h('button', { class: 'btn', type: 'button' }, icon('image'), 'Use my own image');
    own.addEventListener('click', async () => {
      const path = await plugins.pickImage();
      if (!path) return;
      await call('set_wallpaper_file', { path }).then(() => toast('Wallpaper set'), (e) => toast(String(e)));
    });
    view.append(
      h('div', { class: 'card full' },
        h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Landscapes drawn by Atoll'),
          h('label', { class: 'inline-toggle' }, 'New one every day', daily), own),
        grid),
    );
    paint();
  },
};
