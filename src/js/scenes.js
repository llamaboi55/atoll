// Built-in wallpapers: landscapes generated as SVG at runtime. No image files to ship,
// crisp at any resolution, and every scene is original artwork.

export const SCENES = [
  { id: 'dawn-fjord', name: 'Dawn Fjord', sky: ['#9fb7c9', '#f6d5b8'], sun: '#fff1dc', sunAt: [0.68, 0.46], ridges: ['#a7b5c2', '#7f95a8', '#5a7389', '#36506a'], water: true, mode: 'light', seed: 7 },
  { id: 'moss-valley', name: 'Moss Valley', sky: ['#b9cfb0', '#eef3e1'], sun: '#fffbea', sunAt: [0.3, 0.38], ridges: ['#a8bf9f', '#83a083', '#5f7f62', '#3a5a43'], water: false, mode: 'light', seed: 21 },
  { id: 'sea-glass', name: 'Sea Glass', sky: ['#a9d6d1', '#e4f3ef'], sun: '#ffffff', sunAt: [0.5, 0.5], ridges: ['#9cc9c3', '#78b0ab', '#56928f', '#357371'], water: true, mode: 'light', seed: 5, low: true },
  { id: 'autumn-ridge', name: 'Autumn Ridge', sky: ['#e9b78e', '#f8e7cf'], sun: '#fff4e0', sunAt: [0.22, 0.42], ridges: ['#d39a70', '#ad6f4b', '#7f4c33', '#4f2f22'], water: false, mode: 'light', seed: 33 },
  { id: 'pine-mist', name: 'Pine Mist', sky: ['#c3d0cd', '#e9eeec'], sun: '#f8fbf9', sunAt: [0.8, 0.3], ridges: ['#aebdba', '#869a96', '#5b726e', '#304744'], water: false, mode: 'light', seed: 48, sharp: true },
  { id: 'desert-dusk', name: 'Desert Dusk', sky: ['#4b3f72', '#f6b17a'], sun: '#ffd8a8', sunAt: [0.55, 0.6], ridges: ['#b9746a', '#8f5a62', '#643f55', '#3b2840'], water: false, mode: 'dark', seed: 12 },
  { id: 'night-lake', name: 'Night Lake', sky: ['#0b1426', '#2a4064'], sun: '#eef2f8', sunAt: [0.72, 0.24], moon: true, stars: true, ridges: ['#24344f', '#1b2940', '#131f31', '#0c1422'], water: true, mode: 'dark', seed: 64 },
  { id: 'aurora', name: 'Aurora', sky: ['#05141a', '#0f3a3d'], aurora: true, stars: true, ridges: ['#123138', '#0d252b', '#091b20', '#051115'], water: false, mode: 'dark', seed: 90, sharp: true },
];

export const sceneById = (id) => SCENES.find((s) => s.id === id) || SCENES[0];

/** Scene of the day, so "rotate daily" changes once per calendar day. */
export function sceneOfTheDay(date = new Date()) {
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
  return SCENES[day % SCENES.length];
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1920;
const H = 1080;

// Midpoint displacement gives natural-looking ridgelines.
function ridge(rand, baseY, amplitude, roughness, sharp) {
  const n = 64;
  const pts = new Array(n + 1).fill(0);
  pts[0] = (rand() - 0.5) * amplitude;
  pts[n] = (rand() - 0.5) * amplitude;
  let step = n;
  let amp = amplitude;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) {
      pts[i] = (pts[i - half] + pts[i + half]) / 2 + (rand() - 0.5) * amp;
    }
    amp *= roughness;
    step = half;
  }
  const coords = pts.map((y, i) => [Math.round((i / n) * W), Math.round(baseY + y)]);
  let d = `M0 ${H} L${coords[0][0]} ${coords[0][1]}`;
  if (sharp) {
    for (const [x, y] of coords.slice(1)) d += ` L${x} ${y}`;
  } else {
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1];
      const [x1, y1] = coords[i];
      d += ` Q${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`;
    }
    d += ` L${W} ${coords[n][1]}`;
  }
  return `${d} L${W} ${H} Z`;
}

export function sceneSvg(scene) {
  const s = typeof scene === 'string' ? sceneById(scene) : scene;
  const rand = rng(s.seed);
  const horizon = s.low ? 0.7 : 0.62;
  const parts = [];

  parts.push(`<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="${s.sun || '#fff'}" stop-opacity=".85"/><stop offset=".25" stop-color="${s.sun || '#fff'}" stop-opacity=".35"/><stop offset="1" stop-color="${s.sun || '#fff'}" stop-opacity="0"/></radialGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[1]}" stop-opacity="0"/><stop offset="1" stop-color="${s.sky[1]}" stop-opacity=".55"/></linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[0]}"/></linearGradient>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);

  if (s.stars) {
    let stars = '';
    for (let i = 0; i < 140; i++) {
      const x = Math.round(rand() * W);
      const y = Math.round(rand() * H * 0.55);
      const r = (rand() * 1.3 + 0.3).toFixed(2);
      const o = (rand() * 0.6 + 0.25).toFixed(2);
      stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
    }
    parts.push(stars);
  }

  if (s.aurora) {
    for (let i = 0; i < 3; i++) {
      const y = 180 + i * 70;
      const c = ['#5ef2b8', '#3fd4c9', '#9a8cff'][i];
      let d = `M-100 ${y}`;
      for (let x = 0; x <= W + 200; x += 240) d += ` Q${x + 120} ${y - 90 + rand() * 180} ${x + 240} ${y + (rand() - 0.5) * 60}`;
      parts.push(`<path d="${d}" stroke="${c}" stroke-width="${70 - i * 15}" fill="none" opacity=".22" stroke-linecap="round" filter="url(#blur)"/>`);
    }
    parts[0] = parts[0].replace('</defs>', '<filter id="blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="28"/></filter></defs>');
  }

  if (s.sun) {
    const [sx, sy] = s.sunAt;
    const cx = Math.round(sx * W);
    const cy = Math.round(sy * H);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${s.moon ? 220 : 360}" fill="url(#glow)" opacity="${s.moon ? 0.5 : 1}"/>`);
    if (s.moon) {
      // Crescent: the full disc with an offset circle masked out, so the sky shows through.
      parts.push(`<mask id="crescent"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${cx + 22}" cy="${cy - 14}" r="40" fill="#000"/></mask>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="44" fill="${s.sun}" opacity=".95" mask="url(#crescent)"/>`);
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="64" fill="${s.sun}" opacity=".9"/>`);
    }
  }

  const layers = s.ridges.length;
  s.ridges.forEach((color, i) => {
    const t = i / (layers - 1);
    const base = H * (horizon - 0.2 + t * 0.2) + (s.water ? -40 : 40 * t);
    const amp = (s.low ? 140 : 300) * (1 - t * 0.45);
    parts.push(`<path d="${ridge(rand, base, amp, s.sharp ? 0.58 : 0.5, s.sharp)}" fill="${color}"/>`);
    if (i < layers - 1) parts.push(`<rect y="${Math.round(base - amp / 2)}" width="${W}" height="${Math.round(H - base + amp / 2)}" fill="url(#mist)" opacity=".5"/>`);
  });

  if (s.water) {
    const wy = Math.round(H * (s.low ? 0.8 : 0.78));
    parts.push(`<rect y="${wy}" width="${W}" height="${H - wy}" fill="url(#water)" opacity=".92"/>`);
    let ripples = '';
    for (let i = 0; i < 26; i++) {
      const y = wy + 14 + rand() * (H - wy - 20);
      const x = rand() * W;
      const w = 60 + rand() * 260;
      ripples += `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="2" rx="1" fill="#fff" opacity="${(0.08 + rand() * 0.14).toFixed(2)}"/>`;
    }
    parts.push(ripples);
    if (s.sun) {
      const cx = Math.round(s.sunAt[0] * W);
      let glints = '';
      for (let y = wy + 8, i = 0; y < H; y += 14, i++) {
        const w = Math.max(16, 150 - i * 6 + (rand() - 0.5) * 50);
        glints += `<rect x="${Math.round(cx - w / 2 + (rand() - 0.5) * 20)}" y="${y}" width="${Math.round(w)}" height="3" rx="1.5" fill="${s.sun}" opacity="${(0.32 - i * 0.012).toFixed(2)}"/>`;
      }
      parts.push(glints);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${parts.join('')}</svg>`;
}

export function sceneDataUrl(scene) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneSvg(scene))}`;
}
