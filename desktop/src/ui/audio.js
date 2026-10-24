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

// Let the audio device sleep once nothing has been playing for a while (saves power). The
// deadline only ever moves later, so a short alert can't cut off a longer announcement.
let idleTimer = null;
let busyUntil = 0;
function scheduleSuspend(ms) {
  busyUntil = Math.max(busyUntil, performance.now() + ms);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (ctx && ctx.state === 'running' && performance.now() >= busyUntil) ctx.suspend();
  }, busyUntil - performance.now() + 1500);
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
// Announcements are spoken through Scratch's online speech service, the same voices the
// original web project used. Without internet access the system's Web Speech voices are used
// if any are installed (Electron on Linux usually has none).
const SYNTH_URL = 'https://synthesis-service.scratch.mit.edu/synth';
let speechQueue = Promise.resolve();
let speechGen = 0;
let speechSrc = null;

// The service accepts at most 128 characters: split at sentence or clause boundaries.
function chunks(text) {
  const out = [];
  let cur = '';
  for (const part of text.split(/(?<=[.!?,;:])\s+/)) {
    if ((cur + ' ' + part).trim().length > 120 && cur) { out.push(cur.trim()); cur = ''; }
    cur += ' ' + part;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap((c) => (c.length <= 128 ? [c] : c.match(/.{1,120}(\s|$)/g)));
}

async function fetchSpeech(text, locale) {
  try {
    const url = `${SYNTH_URL}?locale=${locale}&gender=female&text=${encodeURIComponent(text)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return await ac().decodeAudioData(await r.arrayBuffer());
  } catch { return null; }
}

function playSpeech(buffer) {
  return new Promise((res) => {
    const src = ac().createBufferSource();
    src.buffer = buffer;
    src.connect(master);
    src.onended = () => { if (speechSrc === src) speechSrc = null; res(); };
    speechSrc = src;
    src.start();
    scheduleSuspend(buffer.duration * 1000);
  });
}

function systemSay(text, locale) {
  return new Promise((res) => {
    if (!('speechSynthesis' in globalThis)) return res();
    const voices = speechSynthesis.getVoices();
    const lang = locale.slice(0, 2);
    const v = voices.find((x) => x.lang.replace('_', '-') === locale) || voices.find((x) => x.lang.startsWith(lang));
    if (!v) return res();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.voice = v;
    u.volume = Math.min(1, volume * 1.2);
    u.onend = res;
    u.onerror = res;
    speechSynthesis.speak(u);
  });
}

export function say(text, { interrupt = false } = {}) {
  if (!speechOn) return;
  if (interrupt) stopSpeech();
  const gen = speechGen;
  const locale = speechLocale();
  for (const part of chunks(text)) {
    const audio = fetchSpeech(part, locale); // download while earlier parts are playing
    speechQueue = speechQueue.then(async () => {
      if (gen !== speechGen) return;
      const buffer = await audio;
      if (gen !== speechGen) return;
      if (buffer) await playSpeech(buffer);
      else await systemSay(part, locale);
    }).catch(() => {});
  }
}

export function stopSpeech() {
  speechGen++;
  try { speechSrc?.stop(); } catch { /* already stopped */ }
  speechSrc = null;
  speechQueue = Promise.resolve();
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}

function speechLocale() {
  return 'en-US';
}
