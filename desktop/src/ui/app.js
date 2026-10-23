// App controller: loads data, runs the playback clock and renders map + sidebar from the simulation state.
import { Simulation, VP, VS, surfaceRadius } from '../sim/engine.js';
import { EpicenterLookup } from '../sim/epicenter.js';
import { CLASSES, CLASS_LABEL, classIndex } from '../sim/intensity.js';
import { QuakeMap } from './map.js';
import {
  eewCard, shakingCard, infoCard, regionListCard, tsunamiCard, noTsunamiCard, idleCard, historyItem, legendHtml,
  fmtTime, fmtDate,
} from './cards.js';
import {
  play, preload, say, stopSpeech, setVolume, setSpeech, SOUND_SLOTS, loadCustomSounds, setCustomSound,
  clearCustomSound, customSoundName,
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

const prefs = load(STORE + '.prefs', {});
const P = { volume: 0.7, speech: false, autoswitch: true, follow: true, lowpower: false, ...prefs };
let history = load(STORE + '.history', []);

const state = {
  sim: null, quake: null, data: null, map: null,
  t: -5, playing: false, speed: 1, lastFrame: 0, lastMapUpdate: 0, lastSide: 0,
  pending: null, activeId: null, view: 'realtime', markers: true,
  rt: null, // Float32Array of real-time intensity per station
  warned: false, lastEewKey: '', shakeK: 0, loop: 0, tsunamiShownAt: -Infinity,
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
  state.rt = new Float32Array(data.stations.length).fill(-3);
  state.sim = new Simulation(data);
  state.map = new QuakeMap($('map'), data);
  await state.map.ready;
  state.map.fitJapan();

  wireUi();
  applyPrefs();
  renderHistory();
  setView('realtime');
  render(true);
  openSetup();
  idleClock();
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
  $('new-quake').addEventListener('click', () => { resetSim(); openSetup(); });
  $('reset').addEventListener('click', resetSim);

  state.map.map.on('click', (e) => {
    if (!$('setup').hidden) {
      $('preset').value = '';
      setPending(e.lngLat.lat, e.lngLat.lng);
    }
  });
  // redraw markers etc. once after the user moves the map while paused
  state.map.map.on('moveend', () => { if (!state.playing) render(true); });

  $('play').addEventListener('click', togglePlay);
  $('replay').addEventListener('click', () => { if (state.quake) { seek(-5); setPlaying(true); } });
  $('timeline').addEventListener('input', (e) => seek(parseFloat(e.target.value)));
  for (const b of document.querySelectorAll('#speeds button')) {
    b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed)));
  }
  for (const b of document.querySelectorAll('#tabs [data-view]')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  $('btn-settings').addEventListener('click', () => {
    $('settings').hidden = !$('settings').hidden;
    if (!$('settings').hidden) closeSetup();
  });
  $('settings-close').addEventListener('click', () => { $('settings').hidden = true; });
  $('btn-zin').addEventListener('click', () => state.map.map.zoomIn());
  $('btn-zout').addEventListener('click', () => state.map.map.zoomOut());
  $('btn-fit').addEventListener('click', () => state.map.fitJapan());
  $('btn-labels').addEventListener('click', () => {
    state.markers = !state.markers;
    $('btn-labels').classList.toggle('off', !state.markers);
    for (const id of ['obs', 'stations-rt']) {
      state.map.map.setLayoutProperty(id, 'visibility', state.markers && visibleIn(id) ? 'visible' : 'none');
    }
  });

  $('volume').addEventListener('input', (e) => { P.volume = e.target.value / 100; savePrefs(); applyPrefs(); });
  $('speech').addEventListener('change', (e) => { P.speech = e.target.checked; savePrefs(); applyPrefs(); });
  $('autoswitch').addEventListener('change', (e) => { P.autoswitch = e.target.checked; savePrefs(); });
  $('follow').addEventListener('change', (e) => { P.follow = e.target.checked; savePrefs(); });
  $('lowpower').addEventListener('change', (e) => { P.lowpower = e.target.checked; savePrefs(); });

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
    if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'n' || e.key === 'N') { resetSim(); openSetup(); }
    if (e.key === 'r' || e.key === 'R') resetSim();
    if (e.key === '1') setView('info');
    if (e.key === '2') setView('realtime');
    if (e.key === '3') setView('tsunami');
    if (e.key === 'Escape') { closeSetup(); $('settings').hidden = true; }
    if (e.key === 'ArrowRight' && state.quake) seek(state.t + 5);
    if (e.key === 'ArrowLeft' && state.quake) seek(state.t - 5);
  });

  // Don't draw anything while the window is hidden or minimised.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { state.lastFrame = performance.now(); render(true); }
  });
}

function visibleIn(layer) {
  return layer === 'obs' ? state.view === 'info' : state.view === 'realtime';
}

function applyPrefs() {
  $('volume').value = Math.round(P.volume * 100);
  $('vol-val').textContent = `${Math.round(P.volume * 100)}%`;
  $('speech').checked = P.speech;
  $('autoswitch').checked = P.autoswitch;
  $('follow').checked = P.follow;
  $('lowpower').checked = P.lowpower;
  setVolume(P.volume);
  setSpeech(P.speech);
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

function setView(view) {
  state.view = view;
  for (const b of document.querySelectorAll('#tabs [data-view]')) b.classList.toggle('on', b.dataset.view === view);
  state.map.setView(view);
  if (!state.markers) for (const id of ['obs', 'stations-rt']) state.map.map.setLayoutProperty(id, 'visibility', 'none');
  $('legend').innerHTML = legendHtml(view);
  lastCardsKey = '';
  render(true);
}

function autoView(view) {
  if (!P.autoswitch || state.view === view) return;
  // a new tsunami bulletin keeps the tsunami view up for a while, even if reports arrive
  if (view !== 'tsunami' && state.t - state.tsunamiShownAt < 20) return;
  setView(view);
}

function startPending() {
  if (!state.pending) return;
  const q = {
    lat: state.pending.lat, lon: state.pending.lon,
    depth: parseInt($('depth').value, 10), mag: parseFloat($('mag').value),
    origin: Date.now() + 5000,
  };
  closeSetup();
  preload();
  startQuake(q, { autoplay: true });
}

function startQuake(q, { autoplay = true, seekTo = -5 } = {}) {
  stopSpeech();
  state.quake = state.sim.start(q);
  state.pending = null;
  state.map.setEpicenter(state.quake);
  $('timeline').max = state.sim.duration().toFixed(1);
  $('timeline').disabled = false;
  if (P.follow && autoplay) state.map.flyTo(q.lat, q.lon, q.mag);
  if (q.id) state.activeId = q.id;
  else { state.activeId = `q${state.quake.origin}`; addHistory(); }
  renderHistory();
  if (autoplay) setView('realtime');
  seek(seekTo);
  setPlaying(autoplay);
}

// Stop playback and clear the current quake from the map and sidebar (history is kept).
function resetSim() {
  setPlaying(false);
  stopSpeech();
  state.quake = null;
  state.activeId = null;
  state.pending = null;
  state.t = -5;
  state.warned = false;
  state.lastEewKey = '';
  state.shakeK = 0;
  state.tsunamiShownAt = -Infinity;
  state.map.setEpicenter(null);
  $('start').disabled = true;
  $('setup-place').textContent = '—';
  $('setup-coords').textContent = '—';
  $('timeline').value = -5;
  $('timeline').disabled = true;
  lastCardsKey = '';
  renderHistory();
  render(true);
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
  seek(state.sim.duration());
  setView('info');
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
  if (p) {
    state.lastFrame = performance.now();
    if (!state.loop) state.loop = requestAnimationFrame(frame);
  } else {
    stopSpeech();
  }
}

function setSpeed(s) {
  state.speed = s;
  for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', parseFloat(b.dataset.speed) === s);
}

function seek(t) {
  if (!state.quake) return;
  state.t = Math.max(-5, Math.min(state.sim.duration(), t));
  const eew = state.sim.eewAt(state.t);
  state.warned = !!eew?.isWarning;
  state.lastEewKey = eew ? eewKey(eew) : '';
  state.shakeK = state.sim.maxObservedAt(state.t) ? CLASSES.indexOf(state.sim.maxObservedAt(state.t)) : 0;
  state.tsunamiShownAt = -Infinity;
  stopSpeech();
  render(true);
}

// The animation loop only runs while a simulation is playing.
function frame(now) {
  state.loop = 0;
  if (!state.playing || !state.quake) return;
  const dt = Math.min(0.25, (now - state.lastFrame) / 1000) * state.speed;
  state.lastFrame = now;
  const t0 = state.t;
  const t1 = Math.min(state.sim.duration(), t0 + dt);
  state.t = t1;
  for (const ev of state.sim.eventsBetween(t0, t1)) announce(ev);
  if (t1 >= state.sim.duration()) setPlaying(false);
  if (!document.hidden) render(false);
  if (state.playing) state.loop = requestAnimationFrame(frame);
}

function idleClock() {
  if (!state.quake) renderClock();
  setTimeout(idleClock, 1000 - (Date.now() % 1000) + 5);
}

// ---------------------------------------------------------------- rendering
function clock(t) {
  return new Date(state.quake ? state.quake.origin + t * 1000 : Date.now());
}

function render(force) {
  const now = performance.now();
  const mapEvery = P.lowpower ? 250 : 100;
  if (force || now - state.lastMapUpdate >= mapEvery) {
    state.lastMapUpdate = now;
    renderMap();
  }
  if (force || now - state.lastSide >= 250) {
    state.lastSide = now;
    renderClock();
    renderCards();
    renderTimeline();
  }
}

function renderTimeline() {
  const tl = $('timeline');
  if (document.activeElement !== tl) tl.value = state.t.toFixed(1);
  const a = Math.abs(state.t);
  $('elapsed').textContent = state.quake
    ? `${state.t < 0 ? '−' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}`
    : '--:--';
}

function renderClock() {
  const d = clock(state.t);
  $('clock-date').textContent = fmtDate(d);
  $('clock-time').textContent = fmtTime(d);
  $('clock-tag').textContent = !state.quake ? 'Idle' : state.playing ? 'Simulated' : state.t >= state.sim.duration() ? 'Finished' : 'Paused';
}

function currentReports(t) {
  const sim = state.sim;
  const eew = sim.eewAt(t);
  const infos = sim.reports.filter((r) => r.at <= t && r.type !== 'tsunami');
  const info = infos.at(-1) || null;
  const tsunami = sim.reports.find((r) => r.type === 'tsunami' && r.at <= t) ? sim.tsunami : null;
  const eewActive = eew && !(eew.isFinal && t - eew.at > 60);
  return { eew: eewActive ? eew : null, info, tsunami };
}

let lastCardsKey = '';
function renderCards() {
  const ctx = { q: state.quake, sim: state.sim, clock, subByCode: state.data.subByCode, tsuByCode: state.data.tsuByCode };
  if (!state.quake) {
    const html = state.view === 'tsunami' ? noTsunamiCard(ctx) : idleCard();
    if (lastCardsKey !== html) { $('cards').innerHTML = html; lastCardsKey = html; }
    return;
  }
  const t = state.t;
  const { eew, info, tsunami } = currentReports(t);
  let html = '';
  if (state.view === 'realtime') {
    if (eew) html += eewCard(eew, ctx);
    html += shakingCard(state.sim.realtimeRegions(t), ctx);
  } else if (state.view === 'info') {
    if (info) {
      html += infoCard(info, ctx);
      const regions = info.type === 'flash' ? state.sim.reportRegions(info.at, 3)
        : info.type === 'hypocenter' ? new Map() : state.sim.reportRegions(Infinity, 1);
      if (regions.size) html += regionListCard(regions, ctx);
    } else {
      html += idleCard().replace('No earthquake', t < 0 ? 'Waiting for the earthquake' : 'No report yet');
    }
  } else {
    html += tsunami ? tsunamiCard(tsunami, ctx, t) : noTsunamiCard(ctx);
  }
  if (html !== lastCardsKey) {
    const scroll = $('cards').scrollTop;
    $('cards').innerHTML = html;
    $('cards').scrollTop = scroll;
    lastCardsKey = html;
  }
}

function renderMap() {
  const m = state.map;
  const sim = state.sim;
  const rt = state.rt;
  const n = rt.length;
  if (!state.quake) {
    rt.fill(-2.6);
    m.setStations(rt);
    m.setWaves(null, 0, 0);
    m.setAreas(new Map(), new Map(), new Set());
    m.setTsunami(new Map());
    m.setObserved([]);
    m.setBlink(false);
    return;
  }
  const t = state.t;
  const q = state.quake;
  const { eew, info, tsunami } = currentReports(t);
  m.setBlink(state.view === 'tsunami' && !!tsunami && (tsunami.level === 'major' || tsunami.level === 'warning'));

  if (state.view === 'realtime') {
    for (let i = 0; i < n; i++) rt[i] = sim.realtime(i, t);
    m.setStations(rt);
    checkShaking();
    const pR = t > 0 ? surfaceRadius(t, q.depth, VP) : 0;
    const sR = t > 0 ? surfaceRadius(t, q.depth, VS) : 0;
    m.setWaves(q, pR < 2500 ? pR : 0, sR < 2500 ? sR : 0);
    m.setAreas(new Map(), eew ? eew.forecast : new Map(), eew && eew.isWarning ? eew.warnAreas : new Set());
  } else {
    // Info view, and the tsunami view underneath its coastlines (dimmed by the map), show
    // the intensities reported so far.
    let observed = new Map();
    let cutoff = -Infinity;
    if (info && (info.type === 'detail' || info.type === 'lpgm')) { observed = sim.reportRegions(Infinity, 1); cutoff = Infinity; }
    else if (info) { observed = sim.reportRegions(info.at, 3); cutoff = info.at; }
    m.setAreas(observed, new Map(), new Set());
    if (state.view === 'info') {
      m.setObserved(cutoff === -Infinity ? [] : observedPoints(cutoff, info.type === 'flash' || info.type === 'hypocenter' ? 3 : 1));
    } else {
      m.setTsunami(tsunami ? tsunami.areas : new Map());
    }
  }
}

// Station squares for the info view.
function observedPoints(at, minK) {
  const out = [];
  const st = state.data.stations;
  for (let i = 0; i < st.length; i++) {
    if (st[i][4]) continue;
    const k = classIndex(at === Infinity ? state.sim.st.peak[i] : state.sim.observed(i, at));
    if (k >= minK) out.push({ lat: st[i][0], lon: st[i][1], k });
  }
  return out;
}

// "Shaking detected" sound each time live shaking reaches a new intensity level.
function checkShaking() {
  if (!state.playing) return;
  let maxI = -3;
  const st = state.data.stations;
  for (let i = 0; i < st.length; i++) if (!st[i][4] && state.rt[i] > maxI) maxI = state.rt[i];
  const k = classIndex(maxI);
  if (k >= 1 && k > state.shakeK) {
    state.shakeK = k;
    play(`shake${Math.min(7, k)}`, { exclusive: false });
  }
}

// ---------------------------------------------------------------- announcements
function eewKey(r) {
  return `${r.maxClass}|${r.isWarning}|${r.warnAreas.size}`;
}

function announce(ev) {
  const r = ev.report;
  const q = state.quake;
  const sub = state.data.subByCode;
  if (ev.kind === 'eew') {
    autoView('realtime');
    const key = eewKey(r);
    const k = CLASSES.indexOf(r.maxClass ?? '0');
    if (r.serial === 1) {
      play(r.isWarning ? 'eewWarning' : k >= 3 ? 'eewInt3' : 'eew');
      say(`Earthquake Early Warning. Earthquake in ${r.name}. Estimated maximum intensity ${label(r.maxClass)}.`, { interrupt: true });
    } else if (r.isWarning && !state.warned) {
      play('eewWarning');
      const areas = prefecturesOf(r.warnAreas, sub).slice(0, 6).join(', ');
      say(`Earthquake Early Warning. Strong shaking expected in ${areas}.`, { interrupt: true });
      toast('EEW (warning) issued');
    } else if (r.isFinal) {
      play('final');
    } else if (key !== state.lastEewKey) {
      play('update');
    }
    if (r.isWarning) state.warned = true;
    state.lastEewKey = key;
    return;
  }
  if (ev.kind === 'flash') {
    autoView('info');
    play('flash');
    const regions = state.sim.reportRegions(r.at, 3);
    let maxK = 0; for (const k of regions.values()) maxK = Math.max(maxK, k);
    const top = [...regions].filter(([, k]) => k === maxK).map(([c]) => sub.get(c)?.properties.en).filter(Boolean);
    say(`Seismic intensity flash. Intensity ${label(CLASSES[maxK])} in ${top.slice(0, 4).join(', ')}.`);
  } else if (ev.kind === 'hypocenter') {
    autoView('info');
    play('hypocenter');
    say(`Hypocenter information. ${q.place.name}, depth ${depthWords(q.depth)}, magnitude ${q.mag.toFixed(1)}. ${r.tsunamiComment}`);
  } else if (ev.kind === 'detail') {
    autoView('info');
    play('detail');
    say(`Earthquake information. Maximum intensity ${label(q.maxClass)}. ${q.place.name}, depth ${depthWords(q.depth)}, magnitude ${q.mag.toFixed(1)}. ${r.tsunamiComment}`);
  } else if (ev.kind === 'tsunami') {
    autoView('tsunami');
    state.tsunamiShownAt = state.t;
    const ts = state.sim.tsunami;
    const lvl = ts.level;
    play({ major: 'tsunamiMajor', warning: 'tsunamiWarning', advisory: 'tsunamiAdvisory', forecast: 'tsunamiForecast' }[lvl]);
    const names = [...ts.areas].filter(([, a]) => a.level === lvl).map(([c]) => state.data.tsuByCode.get(c)?.properties.en).filter(Boolean);
    const title = { major: 'Major tsunami warning', warning: 'Tsunami warning', advisory: 'Tsunami advisory', forecast: 'Tsunami forecast' }[lvl];
    say(`${title} for ${names.slice(0, 5).join(', ')}.${lvl === 'major' || lvl === 'warning' ? ' Evacuate immediately.' : ''}`, { interrupt: true });
    toast(title);
  } else if (ev.kind === 'lpgm') {
    play('other');
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
function savePrefs() { save(STORE + '.prefs', P); }

init().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#f88;padding:8px">${String(err && err.stack || err)}</pre>`);
});
