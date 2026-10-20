// Bridge to the Rust side. Outside the app (plain browser preview, `npm run preview`)
// it falls back to demo data so the interface can be worked on and screenshotted anywhere.
import { demo } from './demo.js';

const T = window.__TAURI__;
export const native = Boolean(T?.core);

export function call(cmd, args = {}) {
  if (native) return T.core.invoke(cmd, args);
  return demo(cmd, args);
}

export async function listen(event, fn) {
  if (native) return T.event.listen(event, (e) => fn(e.payload));
  window.addEventListener(event, (e) => fn(e.detail));
  return () => {};
}

/** Official plugins are reached through their IPC names, so no bundler is needed. */
export const plugins = {
  openUrl: (url) => (native ? T.core.invoke('plugin:opener|open_url', { url }) : window.open(url, '_blank')),
  pickImage: () =>
    native
      ? T.core.invoke('plugin:dialog|open', { options: { multiple: false, directory: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }] } })
      : Promise.resolve(null),
  autostart: {
    get: () => (native ? T.core.invoke('plugin:autostart|is_enabled') : Promise.resolve(false)),
    set: (on) => (native ? T.core.invoke(on ? 'plugin:autostart|enable' : 'plugin:autostart|disable') : Promise.resolve()),
  },
};
