// Alert sounds and spoken announcements.
// Built-in sounds are the files that ship with the original Scratch project (src/sounds/),
// played for the same events. Each alert can be overridden with a user-chosen file.

let ctx = null;
let master = null;
let volume = 0.7;
let speechOn = false;

function ac() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'playback' });
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Let the audio device sleep when nothing is playing (saves power).
let idleTimer = null;
function scheduleSuspend(ms) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend(); }, ms + 1500);
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

export function setSpeech(on) {
  speechOn = on;
  if (!on && 'speechSynthesis' in globalThis) speechSynthesis.cancel();
}

// slot -> built-in file
const BUILTIN = {
  eew: 'eew.wav', eewInt3: 'eew-int3.mp3', eewWarning: 'eew-warning.mp3', update: 'eew-update.mp3',
  final: 'eew-final.mp3', cancel: 'eew-cancel.wav',
  flash: 'info-flash.mp3', hypocenter: 'info-hypocenter.mp3', detail: 'info-detail.mp3', other: 'info-other.mp3',
  tsunamiForecast: 'tsa01.mp3', tsunamiAdvisory: 'tsa02.mp3', tsunamiWarning: 'tsa03.mp3', tsunamiMajor: 'tsa04.mp3',
  shake1: 'newshi0.wav', shake2: 'newshi1.wav', shake3: 'newshi2.wav', shake4: 'newshi3.wav',
  shake5: 'newshi4.wav', shake6: 'newshi5.wav', shake7: 'newshi6.wav',
};

export const SOUND_SLOTS = [
  ['eew', 'EEW (first report)'],
  ['eewInt3', 'EEW (intensity 3 or more)'],
  ['eewWarning', 'EEW (warning)'],
  ['update', 'EEW (update)'],
  ['final', 'EEW (final report)'],
  ['flash', 'Seismic intensity flash'],
  ['hypocenter', 'Hypocenter information'],
  ['detail', 'Earthquake information'],
  ['tsunamiMajor', 'Major tsunami warning'],
  ['tsunamiWarning', 'Tsunami warning'],
  ['tsunamiAdvisory', 'Tsunami advisory'],
  ['tsunamiForecast', 'Tsunami forecast'],
];

const builtin = new Map(); // slot -> AudioBuffer (decoded lazily)
const custom = new Map(); // slot -> {name, buffer}

async function builtinBuffer(slot) {
  if (builtin.has(slot)) return builtin.get(slot);
  const file = BUILTIN[slot];
  if (!file) return null;
  const p = fetch(`sounds/${file}`).then((r) => r.arrayBuffer()).then((b) => ac().decodeAudioData(b)).catch(() => null);
  builtin.set(slot, p);
  return p;
}

// ------------------------------------------------------------------ custom files (IndexedDB)
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

export async function loadCustomSounds() {
  try {
    for (const [slot] of SOUND_SLOTS) {
      const rec = await dbOp('readonly', (s) => s.get(slot));
      if (rec) custom.set(slot, { name: rec.name, buffer: await ac().decodeAudioData(await rec.blob.arrayBuffer()) });
    }
    scheduleSuspend(0);
  } catch { /* nothing stored */ }
}

export async function setCustomSound(slot, file) {
  const buffer = await ac().decodeAudioData(await file.arrayBuffer());
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

// ------------------------------------------------------------------ playback
let current = null;
export async function play(slot, { exclusive = true } = {}) {
  try {
    const buffer = custom.get(slot)?.buffer ?? await builtinBuffer(slot);
    if (!buffer) return;
    const c = ac();
    if (exclusive) { try { current?.stop(); } catch { /* already stopped */ } }
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(master);
    src.start();
    if (exclusive) current = src;
    scheduleSuspend(buffer.duration * 1000);
  } catch { /* audio not available */ }
}

export function preload() {
  for (const slot of Object.keys(BUILTIN)) builtinBuffer(slot);
}

// ------------------------------------------------------------------ speech
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
  u.volume = Math.min(1, volume * 1.2);
  speechSynthesis.speak(u);
}

export function stopSpeech() {
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}
