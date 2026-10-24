// MapLibre map: base layers, area fills, stations, wave fronts, tsunami coasts, markers.
// Three views like the original app: 'info' (observed intensities), 'realtime' (EEW + live
// shaking) and 'tsunami' (coast bulletins). Updates only touch what changed, to keep the GPU idle.
import { circleRing } from '../sim/geo.js';
import { CLASSES, CLASS_COLOR, CLASS_TEXT, classIndex } from '../sim/intensity.js';

const maplibregl = globalThis.maplibregl;

const SEA = '#1e232a';
const LAND = '#30353c';
const JAPAN = '#3b4048';
export const TSUNAMI_COLOR = { major: '#c03ee0', warning: '#ef2f2f', advisory: '#f5d327', forecast: '#45a8f5' };

const classFill = (prop) => {
  const m = ['match', ['coalesce', ['feature-state', prop], 0]];
  CLASSES.forEach((c, i) => { if (i > 0) m.push(i, CLASS_COLOR[c]); });
  m.push(JAPAN);
  return m;
};

// Real-time (Kyoshin monitor) colour ramp as a MapLibre expression on the 'i' property.
const RT_RAMP = ['interpolate', ['linear'], ['get', 'i'],
  -3, 'rgb(0,0,205)', -2, 'rgb(0,70,255)', -1, 'rgb(0,170,255)', 0, 'rgb(0,220,140)',
  1, 'rgb(120,235,0)', 2, 'rgb(235,240,0)', 3, 'rgb(255,180,0)', 4, 'rgb(255,100,0)',
  5, 'rgb(245,20,0)', 6, 'rgb(190,0,40)', 7, 'rgb(150,0,120)'];

export class QuakeMap {
  constructor(el, data) {
    this.data = data;
    this.view = 'realtime';
    this.map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': SEA } }],
      },
      center: [137.5, 37.2],
      zoom: 4.6,
      minZoom: 3,
      maxZoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      fadeDuration: 0,
      pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
    this.map.touchZoomRotate.disableRotation();
    this.subState = new Map(); // code -> "k|f|w" last pushed to the GPU
    this.tsuState = new Map();
    this.ready = new Promise((res) => this.map.on('load', () => { this.setup(); res(); }));
  }

  setup() {
    const m = this.map;
    const d = this.data;
    this.addIcons();
    m.addSource('land', { type: 'geojson', data: d.land });
    m.addSource('sub', { type: 'geojson', data: d.subregions, promoteId: 'code' });
    m.addSource('pref', { type: 'geojson', data: d.prefectures });
    m.addSource('tsu', { type: 'geojson', data: d.tsunami, promoteId: 'code' });
    this.stationsGeo = {
      type: 'FeatureCollection',
      features: d.stations.map((s, idx) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s[1], s[0]] },
        properties: { i: -3, ic: '', k: 0, sea: !!s[4], idx },
      })),
    };
    m.addSource('stations', { type: 'geojson', data: this.stationsGeo });
    m.addSource('obs', { type: 'geojson', data: empty() });
    m.addSource('waves', { type: 'geojson', data: empty() });

    m.addLayer({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND } });
    m.addLayer({
      id: 'sub-fill', type: 'fill', source: 'sub',
      paint: {
        'fill-color': ['case',
          ['>', ['coalesce', ['feature-state', 'k'], 0], 0], classFill('k'),
          ['>', ['coalesce', ['feature-state', 'f'], 0], 0], classFill('f'),
          JAPAN],
      },
    });
    m.addLayer({ id: 'sub-line', type: 'line', source: 'sub', paint: { 'line-color': '#59606a', 'line-width': 0.5 } });
    m.addLayer({
      id: 'warn-line', type: 'line', source: 'sub',
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 8, 2.2],
        'line-opacity': ['case', ['boolean', ['feature-state', 'w'], false], 0.9, 0],
      },
    });
    m.addLayer({ id: 'pref-line', type: 'line', source: 'pref', paint: { 'line-color': '#a3abb5', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.4] } });
    m.addLayer({
      id: 'tsu-line', type: 'line', source: 'tsu',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['coalesce', ['feature-state', 'lvl'], ''],
          'major', TSUNAMI_COLOR.major, 'warning', TSUNAMI_COLOR.warning,
          'advisory', TSUNAMI_COLOR.advisory, 'forecast', TSUNAMI_COLOR.forecast, 'rgba(0,0,0,0)'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 4, 8, 10],
      },
    });
    m.addLayer({
      id: 'stations', type: 'circle', source: 'stations',
      paint: {
        'circle-color': RT_RAMP,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['get', 'sea'], 1.5, 1.9], 9, 5],
        'circle-opacity': 0.95,
      },
    });
    m.addLayer({
      id: 'wave-s-fill', type: 'fill', source: 'waves', filter: ['==', ['get', 'kind'], 'S'],
      paint: { 'fill-color': '#ff3b30', 'fill-opacity': 0.16 },
    });
    m.addLayer({
      id: 'wave-line', type: 'line', source: 'waves',
      paint: {
        'line-color': ['match', ['get', 'kind'], 'P', '#e8eef5', '#ff3b30'],
        'line-width': ['match', ['get', 'kind'], 'S', 2.4, 1.3],
        'line-opacity': ['match', ['get', 'kind'], 'P', 0.85, 1],
      },
    });
    // live numbered circles for stations that are shaking (realtime view)
    m.addLayer({
      id: 'stations-rt', type: 'symbol', source: 'stations', filter: ['!=', ['get', 'ic'], ''],
      layout: {
        'icon-image': ['get', 'ic'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.42, 9, 0.75],
        'symbol-sort-key': ['-', 0, ['get', 'k']], 'icon-allow-overlap': false, 'icon-padding': 0,
      },
    });
    // observed intensity squares per station (info view)
    m.addLayer({
      id: 'obs', type: 'symbol', source: 'obs',
      layout: {
        'icon-image': ['get', 'ic'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 9, 0.8],
        'symbol-sort-key': ['-', 0, ['get', 'k']], 'icon-allow-overlap': false, 'icon-padding': 1,
      },
    });
    this.setView(this.view);
  }

  // Square (observed) and round (real-time) intensity icons drawn once on a canvas.
  addIcons() {
    const size = 44;
    CLASSES.forEach((cls, k) => {
      if (k === 0) return;
      for (const shape of ['sq', 'ci']) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(0,0,0,.55)';
        if (shape === 'sq') roundRect(g, 1, 1, size - 2, size - 2, 7); else { g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); }
        g.fill();
        g.fillStyle = CLASS_COLOR[cls];
        if (shape === 'sq') roundRect(g, 3, 3, size - 6, size - 6, 6); else { g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); }
        g.fill();
        g.fillStyle = CLASS_TEXT[cls];
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `800 ${cls.length > 1 ? 24 : 28}px "Noto Sans", Arial, sans-serif`;
        const mod = cls[1] === '-' ? '−' : cls[1] === '+' ? '+' : '';
        if (mod) {
          g.fillText(cls[0], size / 2 - 5, size / 2 + 2);
          g.font = '800 17px "Noto Sans", Arial, sans-serif';
          g.fillText(mod, size / 2 + 10, size / 2 - 7);
        } else {
          g.fillText(cls, size / 2, size / 2 + 2);
        }
        this.map.addImage(`${shape}${k}`, g.getImageData(0, 0, size, size), { pixelRatio: 2 });
      }
    });
  }

  setView(view) {
    this.view = view;
    const m = this.map;
    if (!m.getLayer('stations')) return;
    const vis = (id, on) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('stations', view === 'realtime');
    vis('stations-rt', view === 'realtime');
    vis('wave-line', view === 'realtime');
    vis('wave-s-fill', view === 'realtime');
    vis('warn-line', view === 'realtime');
    vis('obs', view === 'info');
    vis('tsu-line', view === 'tsunami');
    m.setPaintProperty('sub-fill', 'fill-opacity', view === 'tsunami' ? 0.35 : 1);
  }

  // intensities: Float32Array of real-time intensity per station (quantised before upload)
  setStations(intensities) {
    const f = this.stationsGeo.features;
    let changed = false;
    for (let i = 0; i < f.length; i++) {
      const v = Math.round(intensities[i] * 10) / 10;
      const p = f[i].properties;
      if (p.i === v) continue;
      p.i = v;
      const k = p.sea ? -1 : classIndex(v);
      p.k = k;
      p.ic = k >= 1 ? `ci${k}` : '';
      changed = true;
    }
    if (changed) this.map.getSource('stations')?.setData(this.stationsGeo);
  }

  // Station squares for the info view: [{lon, lat, k}]
  setObserved(points) {
    const key = points.length + ':' + points.reduce((a, p) => a + p.k, 0);
    if (key === this._obsKey) return;
    this._obsKey = key;
    this.map.getSource('obs')?.setData({
      type: 'FeatureCollection',
      features: points.map((p) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { ic: `sq${p.k}`, k: p.k },
      })),
    });
  }

  setWaves(q, pR, sR) {
    const key = `${pR.toFixed(1)}|${sR.toFixed(1)}`; // sub-km steps keep the rings moving smoothly
    if (key === this._waveKey) return;
    this._waveKey = key;
    const feats = [];
    if (q && pR > 0) feats.push(ringFeature(q.lat, q.lon, pR, 'P'));
    if (q && sR > 0) feats.push(polyFeature(q.lat, q.lon, sR, 'S'));
    this.map.getSource('waves')?.setData({ type: 'FeatureCollection', features: feats });
  }

  // observed / forecast: Map code -> class index; warn: Set of codes
  setAreas(observed, forecast, warn) {
    const m = this.map;
    if (!m.getSource('sub')) return;
    for (const f of this.data.subregions.features) {
      const code = f.properties.code;
      const k = observed.get(code) || 0;
      const fk = forecast.get(code) || 0;
      const w = warn.has(code);
      const key = `${k}|${fk}|${w}`;
      if (this.subState.get(code) === key) continue;
      this.subState.set(code, key);
      m.setFeatureState({ source: 'sub', id: code }, { k, f: fk, w });
    }
  }

  // Warning and major-warning coasts blink (about once a second) while they are shown.
  // The timer only runs while such a coast is on screen and the window is visible.
  setBlink(on) {
    if (on === !!this.blinkTimer) return;
    const m = this.map;
    if (!on) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
      m.setPaintProperty('tsu-line', 'line-opacity', 1);
      return;
    }
    let lit = true;
    this.blinkTimer = setInterval(() => {
      if (document.hidden) return;
      lit = !lit;
      m.setPaintProperty('tsu-line', 'line-opacity', lit ? 1
        : ['match', ['coalesce', ['feature-state', 'lvl'], ''], ['major', 'warning'], 0.12, 1]);
    }, 550);
  }

  setTsunami(areas) {
    const m = this.map;
    if (!m.getSource('tsu')) return;
    for (const f of this.data.tsunami.features) {
      const code = f.properties.code;
      const lvl = areas.get(code)?.level || '';
      if (this.tsuState.get(code) === lvl) continue;
      this.tsuState.set(code, lvl);
      m.setFeatureState({ source: 'tsu', id: code }, { lvl });
    }
  }

  setEpicenter(q, { pending = false } = {}) {
    if (!q) { this.epi?.remove(); this.epi = null; return; }
    if (!this.epi) {
      const el = document.createElement('div');
      el.className = 'epi-marker';
      el.innerHTML = '<svg viewBox="0 0 30 30"><path d="M6 6L24 24M24 6L6 24" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M6 6L24 24M24 6L6 24" stroke="#e8262b" stroke-width="5" stroke-linecap="round"/></svg>';
      this.epi = new maplibregl.Marker({ element: el }).setLngLat([q.lon, q.lat]).addTo(this.map);
    }
    this.epi.setLngLat([q.lon, q.lat]);
    this.epi.getElement().classList.toggle('pending', pending);
  }

  flyTo(lat, lon, mag) {
    const zoom = mag >= 8.5 ? 5.0 : mag >= 7.5 ? 5.8 : mag >= 6.5 ? 6.4 : 7.0;
    this.map.flyTo({ center: [lon, lat], zoom, speed: 1.4 });
  }

  fitJapan() {
    this.map.fitBounds([[127.5, 26.0], [146.5, 45.6]], { padding: 40 });
  }
}

export function badgeHtml(cls, extra = '') {
  if (!cls) return `<span class="badge ${extra}" style="background:#3a4552;color:#cfd8e3">-</span>`;
  const mod = cls[1] === '-' ? '−' : cls[1] === '+' ? '+' : '';
  return `<span class="badge ${extra}" style="background:${CLASS_COLOR[cls]};color:${CLASS_TEXT[cls]}">${cls[0]}${mod ? `<sup>${mod}</sup>` : ''}</span>`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function empty() { return { type: 'FeatureCollection', features: [] }; }

function ringFeature(lat, lon, r, kind) {
  return { type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: circleRing(lat, lon, r, 72) } };
}

function polyFeature(lat, lon, r, kind) {
  return { type: 'Feature', properties: { kind }, geometry: { type: 'Polygon', coordinates: [circleRing(lat, lon, r, 72)] } };
}
