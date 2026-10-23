// Earthquake simulation: wave arrivals, station shaking, EEW reports, JMA-style
// information reports and tsunami bulletins. Everything is precomputed in start(),
// so state(t) can be evaluated for any time (pause, speed changes and seeking are free).
import { distanceKm, insideGeometry, distanceToLineKm } from './geo.js';
import {
  CLASSES, classIndex, classOf, predictIntensity, sourceType, longPeriodClass, faultLengthKm,
  pgvBedrock, intensityFromPgv,
} from './intensity.js';

export const VP = 6.2; // km/s
export const VS = 3.6;
const BACKGROUND = -2.6;

// Deterministic PRNG so a given quake always plays out the same way.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function surfaceRadius(t, depthKm, v) {
  const r = v * t;
  return r <= depthKm ? 0 : Math.sqrt(r * r - depthKm * depthKm);
}

export class Simulation {
  /**
   * @param {object} data
   *   stations: [[lat, lon, regionCode, amp, seafloor], ...]
   *   subregions: GeoJSON FeatureCollection (properties code, en, c=[lon, lat])
   *   tsunami: GeoJSON FeatureCollection of coast lines (properties code, en)
   *   epicenters: EpicenterLookup
   */
  constructor(data) {
    this.stations = data.stations;
    this.subregions = data.subregions.features;
    this.tsunamiAreas = data.tsunami.features;
    this.lookup = data.epicenters;
    this.regionByCode = new Map(this.subregions.map((f) => [f.properties.code, f]));
    this.quake = null;
  }

  isOffshore(lat, lon) {
    for (const f of this.subregions) {
      if (insideGeometry(lon, lat, f.geometry)) return false;
    }
    return true;
  }

  start(q) {
    const quake = {
      lat: q.lat, lon: q.lon, depth: q.depth, mag: q.mag,
      origin: q.origin ?? Date.now(),
      seed: q.seed ?? Math.floor(Math.random() * 2 ** 31),
    };
    const rand = mulberry32(quake.seed);
    quake.offshore = this.isOffshore(quake.lat, quake.lon);
    quake.type = sourceType(quake.depth, quake.offshore);
    quake.place = this.lookup.find(quake.lat, quake.lon);
    this.quake = quake;

    // ---- stations
    const dur = Math.min(180, Math.max(4, 10 ** (0.5 * quake.mag - 2.0)));
    const n = this.stations.length;
    const st = {
      tP: new Float64Array(n), tS: new Float64Array(n), peak: new Float32Array(n),
      dur: new Float32Array(n), flicker: new Float32Array(n),
    };
    for (let i = 0; i < n; i++) {
      const [lat, lon, , amp] = this.stations[i];
      const epi = distanceKm(quake.lat, quake.lon, lat, lon);
      const hyp = Math.hypot(epi, quake.depth);
      st.tP[i] = hyp / VP;
      st.tS[i] = hyp / VS;
      const pgv = pgvBedrock(quake.mag, quake.depth, epi, quake.type) * amp * 10 ** (0.16 * gauss(rand));
      st.peak[i] = intensityFromPgv(pgv);
      st.dur[i] = dur + 0.04 * hyp;
      st.flicker[i] = rand() * 6.283;
    }
    this.st = st;

    // ---- final observed intensities per subregion (land stations only)
    const regionFinal = new Map();
    this.firstThreeAt = Infinity;
    for (let i = 0; i < n; i++) {
      if (this.stations[i][4]) continue;
      const code = this.stations[i][2];
      const k = classIndex(st.peak[i]);
      if (k < 1) continue;
      const t = this.timeToReach(i, CLASSES_LOWER[k]);
      if (k >= 3) this.firstThreeAt = Math.min(this.firstThreeAt, this.timeToReach(i, 2.5));
      const prev = regionFinal.get(code);
      if (!prev || k > prev.k) regionFinal.set(code, { k, t });
      else if (k === prev.k && t < prev.t) prev.t = t;
    }
    this.regionFinal = regionFinal;
    let maxK = 0;
    for (const v of regionFinal.values()) maxK = Math.max(maxK, v.k);
    quake.maxClass = maxK > 0 ? CLASSES[maxK] : null;

    this.tsunami = this.computeTsunami(quake, rand);
    this.eewReports = this.scheduleEew(quake, rand, dur);
    this.reports = this.scheduleReports(quake);
    this.events = this.buildEventList();
    return quake;
  }

  // Time (s after origin) at which station i first reaches intensity `level`.
  timeToReach(i, level) {
    const { tP, tS, peak } = this.st;
    const ip = peak[i] - 1.6;
    if (level <= ip) return tP[i] + 1.5 * Math.max(0, (level - BACKGROUND) / (ip - BACKGROUND));
    const rise = Math.min(4, this.st.dur[i] * 0.2);
    return tS[i] + rise * Math.max(0, (level - ip) / Math.max(0.01, peak[i] - ip));
  }

  // Real-time intensity of station i at time t (s after origin).
  realtime(i, t) {
    const { tP, tS, peak, dur, flicker } = this.st;
    const bg = BACKGROUND + 0.25 * Math.sin(t * 1.3 + flicker[i]);
    if (t < tP[i]) return bg;
    const ip = peak[i] - 1.6;
    if (t < tS[i]) return Math.max(bg, bg + (ip - bg) * Math.min(1, (t - tP[i]) / 1.5));
    const rise = Math.min(4, dur[i] * 0.2);
    const end = tS[i] + dur[i];
    if (t < end) return Math.max(bg, ip + (peak[i] - ip) * Math.min(1, (t - tS[i]) / rise));
    return Math.max(bg, peak[i] - 1.6 * Math.log2(1 + (t - end) / 4));
  }

  // Highest intensity station i has recorded up to time t.
  observed(i, t) {
    const { tP, tS, peak } = this.st;
    if (t < tP[i]) return -Infinity;
    if (t >= tS[i] + Math.min(4, this.st.dur[i] * 0.2)) return peak[i];
    return this.realtime(i, t);
  }

  // ---------------------------------------------------------------- EEW
  scheduleEew(q, rand, dur) {
    const n = this.stations.length;
    const order = [...Array(n).keys()].sort((a, b) => this.st.tP[a] - this.st.tP[b]);
    // A station "detects" when the P wave is strong enough to stand out of the noise.
    const detectors = order.filter((i) => this.st.peak[i] - 1.6 > -0.5);
    if (detectors.length < 1 || q.mag < 3.5) return [];
    const t1 = this.st.tP[detectors[0]] + 1.5;
    const t2 = detectors.length > 1 ? this.st.tP[detectors[1]] + 1.0 : Infinity;

    const lastS = Math.min(90, 15 + dur * 0.6);
    const offsets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 30, 40, 50, 60, 75, 90]
      .filter((o) => o <= lastS);
    const mStart = Math.min(q.mag, 4.6 + rand() * 0.6) - 0.2;
    const mCap = q.mag >= 8.1 ? 8.1 + rand() * 0.2 : q.mag; // EEW magnitude saturates
    const tau = 2 + 0.3 * Math.sqrt(dur);
    const err = { d: 15 + rand() * 25, b: rand() * 360, z: 10 + rand() * 20 };

    const reports = [];
    let warned = false;
    const warnAreas = new Set();
    offsets.forEach((o, idx) => {
      const t = t1 + o;
      const f = Math.exp(-idx / 1.6);
      const est = shift(q.lat, q.lon, err.d * f, err.b);
      const depth = Math.max(10, Math.round((q.depth + (err.z - q.depth) * f * 0.8) / 10) * 10);
      const mag = Math.round((mCap - (mCap - mStart) * Math.exp(-o / tau)) * 10) / 10;
      const place = this.lookup.find(est.lat, est.lon);
      const offshore = this.isOffshoreCached(place.code, est);
      const type = sourceType(depth, offshore);
      const forecast = new Map();
      let maxK = 0;
      for (const fr of this.subregions) {
        const [clon, clat] = fr.properties.c;
        const epi = distanceKm(est.lat, est.lon, clat, clon);
        const k = classIndex(predictIntensity(mag, depth, epi, 1.4, type));
        if (k >= 1) {
          forecast.set(fr.properties.code, k);
          if (k > maxK) maxK = k;
        }
      }
      const canWarn = t >= t2;
      if (!warned && canWarn && maxK >= 5) warned = true;
      const newAreas = [];
      if (warned) {
        for (const [code, k] of forecast) {
          if (k >= 4 && !warnAreas.has(code)) { warnAreas.add(code); newAreas.push(code); }
        }
      }
      const lpgm = longPeriodClass(mag, 0);
      reports.push({
        serial: idx + 1, at: t, isWarning: warned, isFinal: idx === offsets.length - 1,
        lat: est.lat, lon: est.lon, depth, mag, name: place.name,
        maxClass: maxK > 0 ? CLASSES[maxK] : null, lpgm,
        forecast, warnAreas: new Set(warnAreas), newAreas,
      });
    });
    return reports;
  }

  isOffshoreCached(code, est) {
    if (this.regionByCode.has(code)) return false;
    return this.isOffshore(est.lat, est.lon);
  }

  // ---------------------------------------------------------------- tsunami
  computeTsunami(q, rand) {
    const res = { level: 'none', areas: new Map(), at: 180 };
    if (q.depth > 80) return res;
    // A shallow quake right on the coast can still rupture into the sea (e.g. 2024 Noto),
    // so coastal land epicenters get a reduced tsunami instead of none.
    let landFactor = 1;
    if (!q.offshore) {
      const coast = Math.min(...this.tsunamiAreas.map((f) => distanceToLineKm(q.lat, q.lon, f.geometry)));
      if (q.depth > 25 || coast > 15) return res;
      landFactor = Math.exp(-coast / 8);
    }
    if (q.mag < 6.0) return res;
    if (q.mag < 6.5) { res.level = 'slight'; return res; }
    for (const f of this.tsunamiAreas) {
      const d = Math.max(30, distanceToLineKm(q.lat, q.lon, f.geometry));
      const h = 10 ** (q.mag - 5.55 - Math.log10(d) - 0.0015 * d) * landFactor * (0.8 + 0.4 * rand());
      let lvl = null;
      if (h > 3) lvl = 'major';
      else if (h > 1) lvl = 'warning';
      else if (h > 0.2) lvl = 'advisory';
      else if (h > 0.05) lvl = 'forecast';
      if (lvl) res.areas.set(f.properties.code, { level: lvl, height: heightLabel(h), arrivalMin: Math.round(d / 2.6) });
    }
    const rank = { forecast: 1, advisory: 2, warning: 3, major: 4 };
    let top = 0;
    for (const a of res.areas.values()) top = Math.max(top, rank[a.level]);
    res.level = ['slight', 'forecast', 'advisory', 'warning', 'major'][top];
    return res;
  }

  // ---------------------------------------------------------------- information reports
  scheduleReports(q) {
    const out = [];
    const finals = [...this.regionFinal.entries()];
    if (!finals.length) return out;
    const tsunamiComment = tsunamiText(this.tsunami.level);
    let tFlash = null;
    if (Number.isFinite(this.firstThreeAt)) {
      tFlash = this.firstThreeAt + 70;
      out.push({ type: 'flash', at: tFlash });
      out.push({ type: 'hypocenter', at: tFlash + 60, tsunamiComment });
    }
    const lastArrival = Math.max(...finals.map(([, v]) => v.t));
    const tDetail = Math.max(150, (tFlash ?? 0) + 120, lastArrival + 30);
    out.push({ type: 'detail', at: tDetail, tsunamiComment });
    if (this.tsunami.level !== 'none' && this.tsunami.level !== 'slight') {
      out.push({ type: 'tsunami', at: this.tsunami.at });
    }
    if (this.quake.mag >= 6.0) out.push({ type: 'lpgm', at: tDetail + 60 });
    return out.sort((a, b) => a.at - b.at);
  }

  // Region intensities observed by time t: Map code -> class index.
  regionsAt(t) {
    const m = new Map();
    for (let i = 0; i < this.stations.length; i++) {
      if (this.stations[i][4]) continue;
      const k = classIndex(this.observed(i, t));
      if (k < 1) continue;
      const code = this.stations[i][2];
      if (!(m.get(code) >= k)) m.set(code, k);
    }
    return m;
  }

  // Region intensities a report would contain (observations up to report time).
  reportRegions(at, minK) {
    const out = new Map();
    for (const [code, v] of this.regionFinal) {
      if (v.k >= minK && v.t <= at) out.set(code, v.k);
    }
    return out;
  }

  buildEventList() {
    const ev = [];
    for (const r of this.eewReports) ev.push({ kind: 'eew', at: r.at, report: r });
    for (const r of this.reports) ev.push({ kind: r.type, at: r.at, report: r });
    return ev.sort((a, b) => a.at - b.at);
  }

  // Events whose time is in (t0, t1].
  eventsBetween(t0, t1) {
    return this.events.filter((e) => e.at > t0 && e.at <= t1);
  }

  // The latest EEW report issued at or before t.
  eewAt(t) {
    let cur = null;
    for (const r of this.eewReports) if (r.at <= t) cur = r;
    return cur;
  }

  maxObservedAt(t) {
    let k = 0;
    for (const v of this.regionsAt(t).values()) k = Math.max(k, v);
    return k > 0 ? CLASSES[k] : null;
  }

  duration() {
    const last = this.events.length ? this.events[this.events.length - 1].at : 60;
    return Math.max(last + 20, 120);
  }
}

const CLASSES_LOWER = [0, 0.5, 1.5, 2.5, 3.5, 4.5, 5.0, 5.5, 6.0, 6.5];

function shift(lat, lon, distKm, bearingDeg) {
  const b = (bearingDeg * Math.PI) / 180;
  const dLat = (distKm * Math.cos(b)) / 111;
  const dLon = (distKm * Math.sin(b)) / (111 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

function heightLabel(h) {
  if (h > 10) return 'over 10 m';
  if (h > 5) return '10 m';
  if (h > 3) return '5 m';
  if (h > 1) return '3 m';
  if (h > 0.2) return '1 m';
  return '';
}

export function tsunamiText(level) {
  switch (level) {
    case 'none': return 'There is no tsunami concern from this earthquake.';
    case 'slight': return 'Slight sea-level changes may occur along the coast, but no damage is expected.';
    default: return 'Tsunami bulletins are currently in effect.';
  }
}

export { classOf, faultLengthKm };
