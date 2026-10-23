// MapLibre map: base layers, area fills, stations, wave fronts, tsunami coasts, markers.
import { circleRing } from '../sim/geo.js';
import { CLASSES, CLASS_COLOR, CLASS_TEXT } from '../sim/intensity.js';

const maplibregl = globalThis.maplibregl;

const LAND = '#2a313a';
const JAPAN = '#3a414b';
const TSUNAMI_COLOR = { major: '#b31cc9', warning: '#ee2b2b', advisory: '#f2d22e', forecast: '#2a9bf2' };

const classFill = (prop) => {
  const m = ['match', ['coalesce', ['feature-state', prop], 0]];
  CLASSES.forEach((c, i) => { if (i > 0) m.push(i, CLASS_COLOR[c]); });
  m.push(JAPAN);
  return m;
};

export class QuakeMap {
  constructor(el, data) {
    this.data = data;
    this.map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b1622' } }],
      },
      center: [137.5, 37.2],
      zoom: 4.6,
      minZoom: 3,
      maxZoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.badges = new Map();
    this.layers = { stations: true, waves: true, areas: true, tsunami: true };
    this.ready = new Promise((res) => this.map.on('load', () => { this.setup(); res(); }));
    this.map.on('zoomend', () => this.refreshBadges());
  }

  setup() {
    const m = this.map;
    const d = this.data;
    m.addSource('land', { type: 'geojson', data: d.land });
    m.addSource('sub', { type: 'geojson', data: d.subregions, promoteId: 'code' });
    m.addSource('pref', { type: 'geojson', data: d.prefectures });
    m.addSource('tsu', { type: 'geojson', data: d.tsunami, promoteId: 'code' });
    m.addSource('stations', { type: 'geojson', data: this.stationFeatures() });
    m.addSource('waves', { type: 'geojson', data: empty() });

    m.addLayer({ id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND } });
    m.addLayer({
      id: 'sub-fill', type: 'fill', source: 'sub',
      paint: {
        'fill-color': ['case',
          ['>', ['coalesce', ['feature-state', 'k'], 0], 0], classFill('k'),
          ['>', ['coalesce', ['feature-state', 'f'], 0], 0], classFill('f'),
          JAPAN],
        'fill-opacity': ['case', ['>', ['coalesce', ['feature-state', 'k'], 0], 0], 0.92,
          ['>', ['coalesce', ['feature-state', 'f'], 0], 0], 0.55, 1],
      },
    });
    m.addLayer({ id: 'sub-line', type: 'line', source: 'sub', paint: { 'line-color': '#5f6874', 'line-width': 0.5 } });
    m.addLayer({
      id: 'warn-line', type: 'line', source: 'sub',
      paint: {
        'line-color': '#ff3b3b',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.5],
        'line-opacity': ['case', ['boolean', ['feature-state', 'w'], false], 1, 0],
      },
    });
    m.addLayer({ id: 'pref-line', type: 'line', source: 'pref', paint: { 'line-color': '#aab3be', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.4] } });
    m.addLayer({
      id: 'tsu-line', type: 'line', source: 'tsu',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['coalesce', ['feature-state', 'lvl'], ''],
          'major', TSUNAMI_COLOR.major, 'warning', TSUNAMI_COLOR.warning,
          'advisory', TSUNAMI_COLOR.advisory, 'forecast', TSUNAMI_COLOR.forecast, 'rgba(0,0,0,0)'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 8, 7],
      },
    });
    m.addLayer({
      id: 'stations', type: 'circle', source: 'stations',
      paint: {
        'circle-color': ['coalesce', ['get', 'c'], '#0000cd'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['get', 'sea'], 1.6, 2], 9, 5.5],
        'circle-stroke-color': 'rgba(0,0,0,.45)',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0, 8, 0.6],
      },
    });
    m.addLayer({
      id: 'wave-s-fill', type: 'fill', source: 'waves', filter: ['==', ['get', 'kind'], 'S'],
      paint: { 'fill-color': '#ff4a3a', 'fill-opacity': 0.07 },
    });
    m.addLayer({
      id: 'wave-line', type: 'line', source: 'waves',
      paint: {
        'line-color': ['match', ['get', 'kind'], 'P', '#4aa8ff', 'S', '#ff4a3a', '#ffffff'],
        'line-width': ['match', ['get', 'kind'], 'S', 2.2, 1.6],
      },
    });
  }

  stationFeatures(colors) {
    return {
      type: 'FeatureCollection',
      features: this.data.stations.map((s, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s[1], s[0]] },
        properties: { c: colors ? colors[i] : '#0000cd', sea: !!s[4] },
      })),
    };
  }

  setStationColors(colors) {
    const src = this.map.getSource('stations');
    if (!src) return;
    if (!this._st) this._st = this.stationFeatures();
    const f = this._st.features;
    for (let i = 0; i < f.length; i++) f[i].properties.c = colors[i];
    src.setData(this._st);
  }

  setWaves(q, pR, sR, eew) {
    const feats = [];
    if (q && pR > 0) feats.push(ringFeature(q.lat, q.lon, pR, 'P'));
    if (q && sR > 0) feats.push(polyFeature(q.lat, q.lon, sR, 'S'));
    this.map.getSource('waves')?.setData({ type: 'FeatureCollection', features: feats });
  }

  // areas: Map code -> class index (observed); forecast: Map code -> class index; warn: Set of codes
  setAreas(observed, forecast, warn) {
    const m = this.map;
    if (!m.getSource('sub')) return;
    for (const f of this.data.subregions.features) {
      const code = f.properties.code;
      m.setFeatureState({ source: 'sub', id: code }, {
        k: this.layers.areas ? (observed.get(code) || 0) : 0,
        f: this.layers.areas ? (forecast.get(code) || 0) : 0,
        w: this.layers.areas && warn.has(code),
      });
    }
    this._observed = observed;
    this.refreshBadges();
  }

  setTsunami(areas) {
    const m = this.map;
    if (!m.getSource('tsu')) return;
    for (const f of this.data.tsunami.features) {
      const a = this.layers.tsunami ? areas.get(f.properties.code) : null;
      m.setFeatureState({ source: 'tsu', id: f.properties.code }, { lvl: a ? a.level : '' });
    }
  }

  refreshBadges() {
    const obs = this._observed || new Map();
    const z = this.map.getZoom();
    const minK = z >= 7 ? 1 : z >= 5.8 ? 2 : 3;
    const want = new Map();
    if (this.layers.areas) {
      for (const [code, k] of obs) if (k >= minK) want.set(code, k);
    }
    for (const [code, mk] of this.badges) {
      if (want.get(code) !== mk.k) { mk.marker.remove(); this.badges.delete(code); }
    }
    for (const [code, k] of want) {
      if (this.badges.has(code)) continue;
      const f = this.data.subregions.features.find((x) => x.properties.code === code);
      if (!f) continue;
      const el = document.createElement('div');
      el.innerHTML = badgeHtml(CLASSES[k], 'area-badge');
      const marker = new maplibregl.Marker({ element: el.firstChild }).setLngLat(f.properties.c).addTo(this.map);
      this.badges.set(code, { k, marker });
    }
  }

  setEpicenter(q, { pending = false } = {}) {
    if (!q) { this.epi?.remove(); this.epi = null; return; }
    if (!this.epi) {
      const el = document.createElement('div');
      el.className = 'epi-marker';
      el.innerHTML = '<svg viewBox="0 0 30 30"><path d="M6 6L24 24M24 6L6 24" stroke="#000" stroke-width="7" stroke-linecap="round"/><path d="M6 6L24 24M24 6L6 24" stroke="#ff2a2a" stroke-width="4" stroke-linecap="round"/><path d="M6 6L24 24M24 6L6 24" stroke="#ffd23a" stroke-width="1.5" stroke-linecap="round"/></svg>';
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
  const base = cls[0];
  const mod = cls[1] === '-' ? '−' : cls[1] === '+' ? '+' : '';
  return `<span class="badge ${extra}" style="background:${CLASS_COLOR[cls]};color:${CLASS_TEXT[cls]}">${base}${mod ? `<sup>${mod}</sup>` : ''}</span>`;
}

function empty() { return { type: 'FeatureCollection', features: [] }; }

function ringFeature(lat, lon, r, kind) {
  return { type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: circleRing(lat, lon, r) } };
}

function polyFeature(lat, lon, r, kind) {
  return { type: 'Feature', properties: { kind }, geometry: { type: 'Polygon', coordinates: [circleRing(lat, lon, r)] } };
}
