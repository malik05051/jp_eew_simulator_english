// App controller: loads data, runs the playback clock and renders map + sidebar from the simulation state.
import { Simulation, VP, VS, surfaceRadius } from '../sim/engine.js';
import { EpicenterLookup } from '../sim/epicenter.js';
import { CLASSES, CLASS_LABEL, realtimeColor } from '../sim/intensity.js';
import { QuakeMap } from './map.js';
import { eewCard, infoCard, tsunamiCard, idleCard, shakingCard, historyItem, legendHtml, fmtTime, fmtDate } from './cards.js';
import {
  play, say, setVolume, setSpeech, SOUND_SLOTS, loadCustomSounds, setCustomSound, clearCustomSound, customSoundName,
} from './audio.js';

const PRESETS = [
  { id: 'tohoku', name: '2011 Tohoku (M9.0, off Sanriku)', lat: 38.10, lon: 142.86, depth: 24, mag: 9.0 },
  { id: 'noto', name: '2024 Noto Peninsula (M7.6)', lat: 37.50, lon: 137.27, depth: 16, mag: 7.6 },
  { id: 'kumamoto', name: '2016 Kumamoto mainshock (M7.3)', lat: 32.75, lon: 130.76, depth: 12, mag: 7.3 },
  { id: 'hanshin', name: '1995 Great Hanshin (M7.3)', lat: 34.60, lon: 135.04, depth: 16, mag: 7.3 },
  { id: 'iburi', name: '2018 Hokkaido Iburi-East (M6.7)', lat: 42.69, lon: 142.01, depth: 37, mag: 6.7 },
  { id: 'nankai', name: 'Nankai Trough scenario (M8.7)', lat: 33.00, lon: 135.60, depth: 20, mag: 8.7 },
  { id: 'tokyo', name: 'Tokyo inland scenario (M7.3)', lat: 35.70, lon: 139.80, depth: 50, mag: 7.3 },
  { id: 'deep', name: 'Deep quake off Torishima (M6.8, 400 km)', lat: 30.50, lon: 140.40, depth: 400, mag: 6.8 },
];

const $ = (id) => document.getElementById(id);
const STORE = 'quakesim.v1';

const prefs = load(STORE + '.prefs', { volume: 0.7, speech: true, fast: false, follow: true });
let history = load(STORE + '.history', []);

const state = {
  sim: null, quake: null, data: null, map: null,
  t: -5, playing: false, speed: 1, lastFrame: 0, lastMapUpdate: 0,
  pending: null, // epicenter chosen in the setup panel
  activeId: null,
  seenEew: 0, warned: false,
};
globalThis.quakeSim = state; // handy from the devtools console (F12)

async function loadJson(name) {
  const res = await fetch(`data/${name}`);
  return res.json();
}

async function init() {
  const [stations, subregions, prefectures, tsunami, land, epicenters] = await Promise.all(
    ['stations.json', 'subregions.json', 'prefectures.json', 'tsunami.json', 'land.json', 'epicenters.json'].map(loadJson));
  const data = { stations: stations.stations, subregions, prefectures, tsunami, land };
  data.epicenters = new EpicenterLookup(epicenters);
  data.subByCode = new Map(subregions.features.map((f) => [f.properties.code, f]));
  data.tsuByCode = new Map(tsunami.features.map((f) => [f.properties.code, f]));
  state.data = data;
  state.sim = new Simulation(data);
  state.map = new QuakeMap($('map'), data);
  await state.map.ready;
  state.map.fitJapan();

  $('legend').innerHTML = legendHtml();
  wireUi();
  applyPrefs();
  renderHistory();
  renderCards();
  renderClock();
  renderMap(true);
  openSetup();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- UI wiring
function wireUi() {
  const sel = $('preset');
  for (const p of PRESETS) sel.insertAdjacentHTML('beforeend', `<option value="${p.id}">${p.name}</option>`);
  sel.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === sel.value);
    if (!p) return;
    $('mag').value = p.mag; $('depth').value = p.depth;
    setPending(p.lat, p.lon);
    syncSetupLabels();
    state.map.flyTo(p.lat, p.lon, p.mag);
  });
  $('mag').addEventListener('input', () => { sel.value = ''; syncSetupLabels(); });
  $('depth').addEventListener('input', () => { sel.value = ''; syncSetupLabels(); });
  $('start').addEventListener('click', startPending);
  $('setup-close').addEventListener('click', closeSetup);
  $('new-quake').addEventListener('click', openSetup);

  state.map.map.on('click', (e) => {
    if (!$('setup').hidden) {
      $('preset').value = '';
      setPending(e.lngLat.lat, e.lngLat.lng);
    }
  });

  $('play').addEventListener('click', togglePlay);
  $('replay').addEventListener('click', () => { if (state.quake) { seek(-5); setPlaying(true); } });
  $('timeline').addEventListener('input', (e) => seek(parseFloat(e.target.value)));
  for (const b of document.querySelectorAll('#speeds button')) {
    b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed)));
  }

  for (const b of document.querySelectorAll('#layer-bar [data-layer]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.layer;
      state.map.layers[k] = !state.map.layers[k];
      b.classList.toggle('on', state.map.layers[k]);
      if (k === 'stations') state.map.map.setLayoutProperty('stations', 'visibility', state.map.layers[k] ? 'visible' : 'none');
      if (k === 'waves') {
        for (const id of ['wave-line', 'wave-s-fill']) state.map.map.setLayoutProperty(id, 'visibility', state.map.layers[k] ? 'visible' : 'none');
      }
      renderMap(true);
    });
  }
  $('btn-fit').addEventListener('click', () => state.map.fitJapan());
  $('btn-settings').addEventListener('click', () => { $('settings').hidden = !$('settings').hidden; if (!$('settings').hidden) closeSetup(); });
  $('settings-close').addEventListener('click', () => { $('settings').hidden = true; });

  $('volume').addEventListener('input', (e) => { prefs.volume = e.target.value / 100; savePrefs(); applyPrefs(); });
  $('speech').addEventListener('change', (e) => { prefs.speech = e.target.checked; savePrefs(); applyPrefs(); });
  $('autoplay-speed').addEventListener('change', (e) => { prefs.fast = e.target.checked; savePrefs(); });
  $('follow').addEventListener('change', (e) => { prefs.follow = e.target.checked; savePrefs(); });

  let pickingSlot = null;
  $('sound-slots').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const slot = b.dataset.slot;
    if (b.dataset.act === 'test') play(slot);
    if (b.dataset.act === 'pick') { pickingSlot = slot; $('sound-file').click(); }
    if (b.dataset.act === 'reset') { await clearCustomSound(slot); renderSoundSlots(); }
  });
  $('sound-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !pickingSlot) return;
    try { await setCustomSound(pickingSlot, file); toast(`Sound set: ${file.name}`); } catch { toast('Could not read that audio file'); }
    renderSoundSlots();
  });
  loadCustomSounds().then(renderSoundSlots);

  $('history').addEventListener('click', (e) => {
    const el = e.target.closest('.hist');
    if (el) openHistory(el.dataset.id);
  });
  $('clear-history').addEventListener('click', () => { history = []; save(STORE + '.history', history); renderHistory(); });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'n' || e.key === 'N') openSetup();
    if (e.key === 'Escape') { closeSetup(); $('settings').hidden = true; }
    if (e.key === 'ArrowRight' && state.quake) seek(state.t + 5);
    if (e.key === 'ArrowLeft' && state.quake) seek(state.t - 5);
  });
  $('settings').hidden = true;
}

function applyPrefs() {
  $('volume').value = Math.round(prefs.volume * 100);
  $('vol-val').textContent = `${Math.round(prefs.volume * 100)}%`;
  $('speech').checked = prefs.speech;
  $('autoplay-speed').checked = prefs.fast;
  $('follow').checked = prefs.follow;
  setVolume(prefs.volume);
  setSpeech(prefs.speech);
}

function renderSoundSlots() {
  $('sound-slots').innerHTML = SOUND_SLOTS.map(([slot, label]) => {
    const name = customSoundName(slot);
    return `<div class="slot"><span>${label}</span>
      <button data-slot="${slot}" data-act="test" title="Play">▶</button>
      <button data-slot="${slot}" data-act="pick">Choose…</button>
      <button data-slot="${slot}" data-act="reset" title="Use the built-in sound" ${name ? '' : 'disabled'}>Reset</button>
      <span class="file">${name ? name.replace(/[<>&]/g, '') : 'Built-in sound'}</span></div>`;
  }).join('');
}

function syncSetupLabels() {
  $('mag-val').textContent = parseFloat($('mag').value).toFixed(1);
  const d = parseInt($('depth').value, 10);
  $('depth-val').textContent = d === 0 ? 'Very shallow' : `${d} km`;
}

function setPending(lat, lon) {
  state.pending = { lat, lon };
  const place = state.data.epicenters.find(lat, lon);
  $('setup-place').textContent = place.name;
  $('setup-coords').textContent = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  $('start').disabled = false;
  state.map.setEpicenter(state.pending, { pending: true });
}

function openSetup() {
  $('setup').hidden = false;
  $('settings').hidden = true;
  document.body.classList.add('picking');
  syncSetupLabels();
}

function closeSetup() {
  $('setup').hidden = true;
  document.body.classList.remove('picking');
  if (state.quake) state.map.setEpicenter(state.quake);
  else if (!state.pending) state.map.setEpicenter(null);
}

function startPending() {
  if (!state.pending) return;
  const q = {
    lat: state.pending.lat, lon: state.pending.lon,
    depth: parseInt($('depth').value, 10), mag: parseFloat($('mag').value),
    origin: Date.now() + 5000,
  };
  closeSetup();
  startQuake(q, { autoplay: true });
}

function startQuake(q, { autoplay = true, seekTo = -5 } = {}) {
  speechSynthesis.cancel();
  state.quake = state.sim.start(q);
  state.pending = null;
  state.map.setEpicenter(state.quake);
  const dur = state.sim.duration();
  $('timeline').max = dur.toFixed(1);
  $('timeline').disabled = false;
  if (prefs.follow && autoplay) state.map.flyTo(q.lat, q.lon, q.mag);
  state.activeId = q.id ?? null;
  if (!q.id) {
    state.activeId = `q${state.quake.origin}`;
    addHistory();
  }
  renderHistory();
  setSpeed(autoplay && prefs.fast ? 2 : state.speed);
  state.seenEew = 0;
  state.warned = false;
  seek(seekTo);
  setPlaying(autoplay);
}

// ---------------------------------------------------------------- history
function addHistory() {
  const q = state.quake;
  history.unshift({
    id: state.activeId, origin: q.origin, lat: q.lat, lon: q.lon, depth: q.depth, mag: q.mag,
    seed: q.seed, name: q.place.name, maxClass: q.maxClass,
  });
  history = history.slice(0, 50);
  save(STORE + '.history', history);
}

function openHistory(id) {
  const h = history.find((x) => x.id === id);
  if (!h) return;
  closeSetup();
  startQuake({ ...h }, { autoplay: false, seekTo: 0 });
  state.activeId = id;
  renderHistory();
  seek(state.sim.duration());
  state.map.flyTo(h.lat, h.lon, h.mag);
}

function renderHistory() {
  $('history').innerHTML = history.length
    ? history.map((h) => historyItem(h, h.id === state.activeId)).join('')
    : '<div class="empty">Simulated earthquakes will appear here.</div>';
}

// ---------------------------------------------------------------- playback
function togglePlay() {
  if (!state.quake) { openSetup(); return; }
  if (!state.playing && state.t >= state.sim.duration()) seek(-5);
  setPlaying(!state.playing);
}

function setPlaying(p) {
  state.playing = p;
  $('icon-play').hidden = p;
  $('icon-pause').hidden = !p;
  state.lastFrame = performance.now();
  if (!p) speechSynthesis.pause(); else speechSynthesis.resume();
  renderStatus();
}

function setSpeed(s) {
  state.speed = s;
  for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', parseFloat(b.dataset.speed) === s);
}

function seek(t) {
  if (!state.quake) return;
  state.t = Math.max(-5, Math.min(state.sim.duration(), t));
  state.seenEew = state.sim.eewAt(state.t)?.serial ?? 0;
  speechSynthesis.cancel();
  render(true);
}

function frame(now) {
  if (state.playing && state.quake) {
    const dt = Math.min(0.25, (now - state.lastFrame) / 1000) * state.speed;
    const t0 = state.t;
    const t1 = Math.min(state.sim.duration(), t0 + dt);
    state.t = t1;
    for (const ev of state.sim.eventsBetween(t0, t1)) announce(ev);
    if (t1 >= state.sim.duration()) setPlaying(false);
    render(false);
  } else if (!state.quake) {
    renderClock();
  }
  state.lastFrame = now;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- rendering
function clock(t) {
  return new Date(state.quake ? state.quake.origin + t * 1000 : Date.now());
}

function render(force) {
  renderClock();
  renderCards();
  renderMap(force);
  renderStatus();
  const tl = $('timeline');
  if (document.activeElement !== tl) tl.value = state.t.toFixed(1);
  const s = Math.max(0, state.t);
  $('elapsed').textContent = state.quake
    ? `${state.t < 0 ? '−' : '+'}${String(Math.floor(Math.abs(state.t) / 60)).padStart(2, '0')}:${String(Math.floor(Math.abs(state.t) % 60)).padStart(2, '0')}`
    : '--:--';
  void s;
}

function renderClock() {
  const d = clock(state.t);
  $('clock-date').textContent = fmtDate(d);
  $('clock-time').textContent = fmtTime(d);
}

function renderStatus() {
  const pill = $('status-pill');
  if (!state.quake) { pill.textContent = 'Idle'; pill.className = 'pill'; return; }
  if (state.t >= state.sim.duration()) { pill.textContent = 'Finished'; pill.className = 'pill done'; return; }
  pill.textContent = state.playing ? 'Live' : 'Paused';
  pill.className = state.playing ? 'pill live' : 'pill';
}

function currentReports(t) {
  const sim = state.sim;
  const eew = sim.eewAt(t);
  const infos = sim.reports.filter((r) => r.at <= t && r.type !== 'tsunami');
  const info = infos.at(-1) || null;
  const tsunami = sim.reports.find((r) => r.type === 'tsunami' && r.at <= t) ? sim.tsunami : null;
  const lastEew = sim.eewReports.at(-1);
  const eewActive = eew && !(eew.isFinal && t - eew.at > 30) && !(info && info.type === 'detail');
  return { eew: eewActive ? eew : null, info, tsunami, everEew: !!eew, lastEew };
}

let lastCardsKey = '';
function renderCards() {
  if (!state.quake) { $('cards').innerHTML = idleCard(); lastCardsKey = 'idle'; return; }
  const t = state.t;
  const { eew, info, tsunami } = currentReports(t);
  const key = [eew?.serial, info?.type, !!tsunami, t < 0, state.activeId].join('|');
  if (key === lastCardsKey) return;
  lastCardsKey = key;
  const ctx = { q: state.quake, sim: state.sim, clock, subByCode: state.data.subByCode, tsuByCode: state.data.tsuByCode };
  let html = '';
  if (eew) html += eewCard(eew, ctx);
  if (info) html += infoCard(info, ctx);
  if (!eew && !info) html += shakingCard(ctx, t);
  if (tsunami) html += tsunamiCard(tsunami, ctx);
  $('cards').innerHTML = html;
}

function renderMap(force) {
  const now = performance.now();
  if (!force && now - state.lastMapUpdate < 66) return;
  state.lastMapUpdate = now;
  const m = state.map;
  const sim = state.sim;
  const n = state.data.stations.length;
  const colors = new Array(n);
  if (!state.quake) {
    for (let i = 0; i < n; i++) colors[i] = realtimeColor(-2.6);
    m.setStationColors(colors);
    m.setWaves(null, 0, 0);
    m.setAreas(new Map(), new Map(), new Set());
    m.setTsunami(new Map());
    return;
  }
  const t = state.t;
  for (let i = 0; i < n; i++) colors[i] = realtimeColor(sim.realtime(i, t));
  m.setStationColors(colors);

  const q = state.quake;
  const maxR = 2500;
  const pR = t > 0 ? surfaceRadius(t, q.depth, VP) : 0;
  const sR = t > 0 ? surfaceRadius(t, q.depth, VS) : 0;
  m.setWaves(q, pR < maxR ? pR : 0, sR < maxR ? sR : 0);

  const { eew, info, tsunami } = currentReports(t);
  let observed = new Map();
  if (info && (info.type === 'detail' || info.type === 'lpgm')) observed = sim.reportRegions(Infinity, 1);
  else if (info) observed = sim.reportRegions(info.at, 3);
  if (!info || info.type === 'flash' || info.type === 'hypocenter') {
    // live observed intensities on top of whatever has been reported so far
    for (const [code, k] of sim.regionsAt(t)) if (!(observed.get(code) >= k)) observed.set(code, k);
  }
  const forecast = eew ? eew.forecast : new Map();
  const warn = eew && eew.isWarning ? eew.warnAreas : new Set();
  m.setAreas(observed, forecast, warn);
  m.setTsunami(tsunami ? tsunami.areas : new Map());
}

// ---------------------------------------------------------------- announcements
function announce(ev) {
  const r = ev.report;
  const q = state.quake;
  const sub = state.data.subByCode;
  if (ev.kind === 'eew') {
    if (r.serial === 1) {
      play(r.isWarning ? 'eewWarning' : 'eewForecast');
      say(`Earthquake Early Warning. Earthquake detected in ${r.name}. Estimated maximum intensity ${label(r.maxClass)}.`, { interrupt: true });
      toast(`EEW #1 · ${r.name}`);
    } else if (r.isWarning && !state.warned) {
      play('eewWarning');
      const areas = prefecturesOf(r.warnAreas, sub).slice(0, 6).join(', ');
      say(`Earthquake Early Warning. Strong shaking expected in ${areas}. Take cover.`, { interrupt: true });
      toast('EEW (Warning) issued');
    } else if (r.newAreas.length) {
      play('update');
    } else if (r.isFinal) {
      play('update');
    }
    if (r.isWarning) state.warned = true;
    state.seenEew = r.serial;
    return;
  }
  if (ev.kind === 'flash') {
    play('info');
    const regions = state.sim.reportRegions(r.at, 3);
    let maxK = 0; for (const k of regions.values()) maxK = Math.max(maxK, k);
    const top = [...regions].filter(([, k]) => k === maxK).map(([c]) => sub.get(c)?.properties.en).filter(Boolean);
    say(`Seismic intensity flash. Intensity ${label(CLASSES[maxK])} observed in ${top.slice(0, 4).join(', ')}.`);
    toast('Seismic Intensity Flash');
  } else if (ev.kind === 'hypocenter') {
    play('info');
    say(`Hypocenter information. The epicenter is ${q.place.name}, at a depth of ${depthWords(q.depth)}, magnitude ${q.mag.toFixed(1)}. ${r.tsunamiComment}`);
  } else if (ev.kind === 'detail') {
    play('info');
    say(`Earthquake information. Maximum intensity ${label(q.maxClass)}. The epicenter is ${q.place.name}, depth ${depthWords(q.depth)}, magnitude ${q.mag.toFixed(1)}. ${r.tsunamiComment}`);
    toast('Earthquake Information issued');
  } else if (ev.kind === 'tsunami') {
    play('tsunami');
    const ts = state.sim.tsunami;
    const lvl = ts.level;
    const names = [...ts.areas].filter(([, a]) => a.level === lvl).map(([c]) => state.data.tsuByCode.get(c)?.properties.en).filter(Boolean);
    const title = { major: 'Major tsunami warning', warning: 'Tsunami warning', advisory: 'Tsunami advisory', forecast: 'Tsunami forecast' }[lvl];
    say(`${title} issued for ${names.slice(0, 5).join(', ')}.${lvl === 'major' || lvl === 'warning' ? ' Evacuate immediately.' : ''}`, { interrupt: true });
    toast(title);
  } else if (ev.kind === 'lpgm') {
    play('info');
  }
}

function prefecturesOf(codes, sub) {
  const out = [];
  for (const c of codes) {
    const name = sub.get(c)?.properties.en;
    if (!name) continue;
    const pref = name.split(',')[0];
    if (!out.includes(pref)) out.push(pref);
  }
  return out;
}

function label(cls) { return cls ? CLASS_LABEL[cls] : 'unknown'; }
function depthWords(d) { return d <= 0 ? 'very shallow' : `${Math.round(d)} kilometers`; }

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- storage
function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function savePrefs() { save(STORE + '.prefs', prefs); }

init().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#f88;padding:8px">${String(err && err.stack || err)}</pre>`);
});
