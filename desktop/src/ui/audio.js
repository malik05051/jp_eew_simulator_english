// Synthesised alert sounds (WebAudio) and spoken announcements (Web Speech API).

let ctx = null;
let master = null;
let volume = 0.7;
let speechOn = true;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

export function setSpeech(on) {
  speechOn = on;
  if (!on) speechSynthesis.cancel();
}

function tone(freq, start, len, { type = 'sine', gain = 0.35, glide = 0 } = {}) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (glide) o.frequency.linearRampToValueAtTime(freq + glide, c.currentTime + start + len);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + len);
  o.connect(g).connect(master);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + len + 0.05);
}

const SOUNDS = {
  // first EEW (forecast): two bright chimes
  eewForecast() { tone(988, 0, 0.5); tone(1319, 0.18, 0.7); },
  // EEW warning: urgent alternating tones
  eewWarning() {
    for (let i = 0; i < 4; i++) {
      tone(1046, i * 0.42, 0.2, { type: 'square', gain: 0.18 });
      tone(784, i * 0.42 + 0.21, 0.2, { type: 'square', gain: 0.18 });
    }
  },
  // EEW update
  update() { tone(1175, 0, 0.18, { gain: 0.2 }); },
  // information report
  info() { tone(659, 0, 0.6, { gain: 0.25 }); tone(988, 0.22, 0.9, { gain: 0.25 }); },
  // tsunami bulletin
  tsunami() { for (let i = 0; i < 3; i++) tone(440, i * 0.55, 0.45, { type: 'triangle', gain: 0.35, glide: -60 }); },
  // strong shaking reached a land station
  shaking() { tone(220, 0, 0.35, { type: 'sawtooth', gain: 0.12 }); },
};

// User-chosen sound files override the synthesised ones (stored in IndexedDB as Blobs).
export const SOUND_SLOTS = [
  ['eewForecast', 'EEW (first report)'],
  ['eewWarning', 'EEW (warning)'],
  ['update', 'EEW (update)'],
  ['info', 'Earthquake information'],
  ['tsunami', 'Tsunami bulletin'],
];
const custom = new Map(); // slot -> AudioBuffer

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('quakesim-sounds', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sounds');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function dbOp(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('sounds', mode);
    const req = fn(tx.objectStore('sounds'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

async function decode(blob) {
  return ac().decodeAudioData(await blob.arrayBuffer());
}

export async function loadCustomSounds() {
  try {
    for (const [slot] of SOUND_SLOTS) {
      const rec = await dbOp('readonly', (s) => s.get(slot));
      if (rec) custom.set(slot, { name: rec.name, buffer: await decode(rec.blob) });
    }
  } catch { /* no stored sounds */ }
}

export async function setCustomSound(slot, file) {
  const buffer = await decode(file);
  await dbOp('readwrite', (s) => s.put({ name: file.name, blob: file }, slot));
  custom.set(slot, { name: file.name, buffer });
}

export async function clearCustomSound(slot) {
  await dbOp('readwrite', (s) => s.delete(slot));
  custom.delete(slot);
}

export function customSoundName(slot) {
  return custom.get(slot)?.name ?? null;
}

let current = null;
export function play(name) {
  try {
    const c = custom.get(name);
    if (c) {
      current?.stop();
      const src = ac().createBufferSource();
      src.buffer = c.buffer;
      src.connect(master);
      src.start();
      current = src;
      return;
    }
    SOUNDS[name]?.();
  } catch { /* audio not available */ }
}

let englishVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  englishVoice = voices.find((v) => /en[-_](US|GB)/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
}
if ('speechSynthesis' in globalThis) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function say(text, { interrupt = false } = {}) {
  if (!speechOn || !('speechSynthesis' in globalThis)) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (englishVoice) u.voice = englishVoice;
  u.rate = 1.02;
  u.volume = Math.min(1, volume * 1.2);
  speechSynthesis.speak(u);
}
