import { h, icon, iconButton, toast } from '../h.js';
import { call } from '../api.js';
import { get, onChange } from '../prefs.js';
import * as routines from '../routines.js';

let els;
let ctx;

// ---------- Dictation: hold the shortcut, talk, let go. Recorded as 16 kHz WAV, which every webview can make.
let rec = null;
let busy = false;
export const dictating = () => Boolean(rec) || busy;

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  const node = audio.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(audio.destination);
  return { stream, audio, node, chunks, startedAt: Date.now() };
}

function toWav(chunks, rate) {
  const target = 16000;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    merged.set(c, o);
    o += c.length;
  }
  const ratio = rate / target;
  const n = Math.floor(total / ratio);
  const buf = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off, s) => [...s].forEach((ch, i) => buf.setUint8(off + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, target, true); buf.setUint32(28, target * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, 'data'); buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, merged[Math.floor(i * ratio)]));
    buf.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf.buffer);
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function stopRecording() {
  const r = rec;
  rec = null;
  if (!r) return null;
  r.node.disconnect();
  r.stream.getTracks().forEach((t) => t.stop());
  const rate = r.audio.sampleRate;
  await r.audio.close();
  if (Date.now() - r.startedAt < 400) return null;
  busy = true;
  try {
    return await call('ai_transcribe', { audioBase64: base64(toWav(r.chunks, rate)), mime: 'audio/wav' });
  } finally {
    busy = false;
  }
}

/** Global shortcut pressed. */
export async function dictateDown() {
  if (rec || busy) return;
  try {
    rec = await startRecording();
  } catch (e) {
    toast(`Microphone unavailable: ${e.message || e}`);
  }
}

/** Global shortcut released: write the text into whatever app you were typing in. */
export async function dictateUp() {
  try {
    const text = await stopRecording();
    if (text) await call('paste_text', { text });
  } catch (e) {
    toast(String(e));
  }
}

// ---------- Routines: questions asked on their own every day at a set time.
function paintRoutines() {
  const list = get().routines;
  els.routineList.replaceChildren(
    ...list.map((r) => h('li', {},
      h('span', { class: 'time' }, r.time),
      h('span', { class: 'grow' }, r.prompt),
      iconButton('play', 'Run now', () => routines.run(r), { class: 'ghost' }),
      iconButton('x', 'Remove', () => routines.remove(r.id), { class: 'ghost' }))),
  );
  if (!list.length) els.routineList.append(h('li', { class: 'empty muted' }, 'No routines yet. Try 08:00 and "summarize today\'s weather and my to-dos".'));
}

function showRoutineAnswer() {
  const a = get().routineAnswer;
  if (!a) return;
  els.answer.textContent = `${a.prompt} · ${new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\n${a.text}`;
  els.answer.classList.toggle('muted', Boolean(a.error));
}

function routineCard() {
  const time = h('input', { type: 'time', value: '08:00', 'aria-label': 'Time' });
  const prompt = h('input', { type: 'text', placeholder: 'Summarize today\'s weather and my to-dos', 'aria-label': 'Routine question', maxlength: 300 });
  const add = () => {
    const text = prompt.value.trim() || prompt.placeholder;
    if (!time.value) return;
    routines.add(time.value, text);
    prompt.value = '';
    toast(`Atoll will ask this every day at ${time.value}`);
  };
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add();
  });
  els.routineList = h('ul', { class: 'routine-list' });
  paintRoutines();
  return h('div', { class: 'card' },
    h('h3', {}, 'Routines'),
    h('p', { class: 'muted small' }, 'Asked by itself every day, with your weather and to-dos. Answers show up on the left.'),
    h('div', { class: 'routine-add' }, time, prompt, iconButton('plus', 'Add routine', add)),
    els.routineList);
}

// ---------- Ask
async function status() {
  const c = await call('config_get');
  const off = !c || c.ai_provider === 'none';
  els.status.replaceChildren(
    h('span', { class: `dot ${off ? '' : 'on'}` }),
    off ? 'AI is off. Turn it on in Settings with a free Gemini key or a local Ollama model.'
      : c.ai_provider === 'gemini' ? `Gemini · ${c.gemini_model} · your own key${c.has_gemini_key ? '' : ' (not added yet)'}`
        : `Ollama · ${c.ollama_model} · runs on this computer`,
  );
  return c;
}

async function send() {
  const prompt = els.input.value.trim();
  if (!prompt) return;
  els.answer.textContent = 'Thinking…';
  els.answer.classList.add('muted');
  els.send.disabled = true;
  try {
    const text = await call('ai_ask', { prompt, withScreen: els.screen.checked });
    els.answer.textContent = text || 'No answer came back.';
    els.answer.classList.remove('muted');
  } catch (e) {
    els.answer.textContent = String(e);
  }
  els.send.disabled = false;
  els.screen.checked = false;
}

export const ask = {
  id: 'ask',
  label: 'Ask',
  icon: 'spark',
  mount(view, context) {
    ctx = context;
    els = {
      status: h('div', { class: 'ai-status' }),
      input: h('textarea', { rows: 3, placeholder: 'Ask anything. Tick "Include my screen" to ask about what you are looking at.', 'aria-label': 'Question' }),
      screen: h('input', { type: 'checkbox' }),
      send: h('button', { class: 'btn primary', type: 'button' }, icon('send'), 'Ask'),
      answer: h('div', { class: 'answer muted' }, 'Answers show up here.'),
      dictated: h('div', { class: 'answer small muted' }, 'Hold the button and talk. Clean text appears here.'),
    };
    els.send.addEventListener('click', send);
    // Ask by voice: hold, ask out loud, let go. The question is written into the box and sent.
    const voice = iconButton('mic', 'Hold to ask out loud', () => {}, { class: 'ghost' });
    voice.addEventListener('pointerdown', async () => {
      voice.classList.add('live');
      await dictateDown();
    });
    const askAloud = async () => {
      if (!voice.classList.contains('live')) return;
      voice.classList.remove('live');
      els.answer.textContent = 'Listening back…';
      els.answer.classList.add('muted');
      try {
        const text = await stopRecording();
        if (!text) {
          els.answer.textContent = 'Didn\'t catch that. Hold a little longer.';
          return;
        }
        els.input.value = text;
        send();
      } catch (e) {
        els.answer.textContent = String(e);
      }
    };
    voice.addEventListener('pointerup', askAloud);
    voice.addEventListener('pointerleave', askAloud);
    els.voice = voice;
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
    });
    const hold = h('button', { class: 'btn hold', type: 'button' }, icon('mic'), 'Hold to talk');
    hold.addEventListener('pointerdown', async () => {
      hold.classList.add('live');
      await dictateDown();
    });
    const release = async () => {
      if (!hold.classList.contains('live')) return;
      hold.classList.remove('live');
      els.dictated.textContent = 'Writing…';
      try {
        const text = await stopRecording();
        els.dictated.textContent = text || 'Didn\'t catch that. Hold a little longer.';
        els.dictated.classList.toggle('muted', !text);
      } catch (e) {
        els.dictated.textContent = String(e);
      }
    };
    hold.addEventListener('pointerup', release);
    hold.addEventListener('pointerleave', release);

    view.append(
      h('div', { class: 'ask-grid' },
        h('div', { class: 'card' },
          els.status, els.input,
          h('div', { class: 'row' }, h('label', { class: 'check-label' }, els.screen, icon('screen'), 'Include my screen'), h('span', { class: 'grow' }), h('small', { class: 'muted' }, 'Ctrl Enter'), els.voice, els.send),
          h('div', { class: 'answer-wrap' }, els.answer, iconButton('copy', 'Copy answer', () => navigator.clipboard.writeText(els.answer.textContent).then(() => toast('Copied')), { class: 'ghost corner' }))),
        h('div', { class: 'ask-side' },
          h('div', { class: 'card' },
            h('h3', {}, 'Dictation'),
            h('p', { class: 'muted small' }, 'Hold ', h('kbd', {}, 'Ctrl Shift D'), ' anywhere, talk, and let go. Atoll removes the ums, applies your corrections and types it where your cursor is.'),
            hold, els.dictated),
          routineCard()),
      ),
    );
    onChange(paintRoutines);
    routines.onAnswer(showRoutineAnswer);
    showRoutineAnswer();
    status();
  },
  show() {
    status();
  },
  focus() {
    els.input.focus();
  },
  prepare({ withScreen }) {
    els.screen.checked = withScreen;
    els.input.select();
    els.input.focus();
  },
};
