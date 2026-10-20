// Demo data for the browser preview (no Rust side). Never used inside the app.
const now = Date.now();
const GB = 1024 ** 3;
let config = {
  ai_provider: 'gemini', gemini_key: '', gemini_model: 'gemini-2.5-flash', ollama_url: 'http://localhost:11434', ollama_model: 'gemma3',
  clip_limit: 500, clip_paused: false, toggle_shortcut: 'CommandOrControl+Shift+Space', ask_shortcut: 'CommandOrControl+Shift+A',
  dictate_shortcut: 'CommandOrControl+Shift+D', has_gemini_key: true,
};
let clips = [
  { id: 'a1', kind: 'text', text: 'git commit -m "island: smoother expand animation"', created: now - 40e3, pinned: false },
  { id: 'a2', kind: 'text', text: 'https://github.com/llamaboi55/atoll', created: now - 5 * 60e3, pinned: true },
  { id: 'a3', kind: 'image', text: '', width: 1280, height: 720, created: now - 12 * 60e3, pinned: false },
  { id: 'a4', kind: 'text', text: 'Meeting moved to Thursday 3:30. Bring the Q4 numbers and the new mockups.', created: now - 50 * 60e3, pinned: false },
  { id: 'a5', kind: 'text', text: 'const island = await call("set_mode", { expanded: true });', created: now - 3 * 3600e3, pinned: false },
  { id: 'a6', kind: 'text', text: 'tidepool, atoll, lagoon, reef, shoal, cay', created: now - 26 * 3600e3, pinned: false },
  { id: 'a7', kind: 'text', text: '1600 Amphitheatre Parkway', created: now - 30 * 3600e3, pinned: false },
];
const apps = ['Blender', 'Calculator', 'Discord', 'Files', 'Firefox', 'GIMP', 'Inkscape', 'Kdenlive', 'LibreOffice Writer', 'Obsidian', 'OBS Studio', 'Signal', 'Spotify', 'Steam', 'Terminal', 'Thunderbird', 'VLC', 'VS Code']
  .map((name) => ({ name, path: `/demo/${name}.desktop` }));
let cpuPhase = 0;

function thumb() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#1f2b28"/><rect x="10" y="10" width="140" height="12" rx="3" fill="#8fbf9a"/><rect x="10" y="30" width="90" height="8" rx="3" fill="#56746a"/><rect x="10" y="44" width="120" height="8" rx="3" fill="#56746a"/><rect x="10" y="58" width="70" height="8" rx="3" fill="#56746a"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function demo(cmd, args) {
  switch (cmd) {
    case 'config_get': return { ...config };
    case 'config_set': config = { ...config, ...args.next, has_gemini_key: config.has_gemini_key || Boolean(args.next.gemini_key) }; return { ...config };
    case 'stats':
      cpuPhase += 0.4;
      return {
        cpu: 18 + 9 * Math.sin(cpuPhase), cores: 8, memory_used: 9.4 * GB, memory_total: 16 * GB, uptime: 3 * 3600 + 42 * 60,
        top: [
          { name: 'firefox', memory: 2.1 * GB, cpu: 6.2, count: 14 }, { name: 'code', memory: 1.4 * GB, cpu: 3.1, count: 9 },
          { name: 'Discord', memory: 0.62 * GB, cpu: 0.8, count: 5 }, { name: 'Spotify', memory: 0.41 * GB, cpu: 1.2, count: 4 },
          { name: 'obsidian', memory: 0.33 * GB, cpu: 0.2, count: 3 }, { name: 'atoll', memory: 0.05 * GB, cpu: 0.1, count: 1 },
        ],
        disks: [{ name: 'nvme0n1p2', mount: '/', total: 512 * GB, available: 201 * GB }],
        rx_per_sec: 1.8e6 + Math.random() * 3e5, tx_per_sec: 2.1e5, os: 'Linux 24.04 Ubuntu', host: 'workstation',
      };
    case 'speed_test': await new Promise((r) => setTimeout(r, 1200)); return { down_mbps: 312.4, latency_ms: 14 };
    case 'clips_list': return clips.map((c) => ({ ...c }));
    case 'clip_thumb': return thumb();
    case 'clip_pin': clips = clips.map((c) => (c.id === args.id ? { ...c, pinned: args.pinned } : c)); return null;
    case 'clip_delete': clips = clips.filter((c) => c.id !== args.id); return null;
    case 'clip_clear': clips = clips.filter((c) => c.pinned); return null;
    case 'apps_list': return apps;
    case 'keep_awake': return args.on;
    case 'current_wallpaper': return null;
    case 'ai_ask':
      await new Promise((r) => setTimeout(r, 900));
      return 'That error means the port is already taken. Another dev server is still running on 5173. Stop it with Ctrl+C in its terminal, or start this one on a different port with `--port 5174`.';
    case 'ai_transcribe': return 'Pick up the train tickets on Thursday.';
    default: return null;
  }
}
