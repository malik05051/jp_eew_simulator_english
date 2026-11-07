// Ground-motion and JMA seismic-intensity helpers.
//
// Peak ground velocity on Vs=600 m/s bedrock: Si & Midorikawa (1999).
// Instrumental intensity from PGV: Fujimoto & Midorikawa (2005).
// Finite-fault geometry: ground.js.

export const CLASSES = ['0', '1', '2', '3', '4', '5-', '5+', '6-', '6+', '7'];
const LOWER_BOUNDS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.0, 5.5, 6.0, 6.5];

export const CLASS_LABEL = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5-': '5 lower', '5+': '5 upper', '6-': '6 lower', '6+': '6 upper', '7': '7',
};

export const CLASS_COLOR = {
  '0': '#5b6770', '1': '#2f88d0', '2': '#23a98c', '3': '#e8c547', '4': '#f08a24',
  '5-': '#e5532b', '5+': '#c81e2a', '6-': '#a51d58', '6+': '#86197a', '7': '#55107a',
};
export const CLASS_TEXT = {
  '0': '#fff', '1': '#fff', '2': '#fff', '3': '#1b1b1b', '4': '#1b1b1b',
  '5-': '#fff', '5+': '#fff', '6-': '#fff', '6+': '#fff', '7': '#fff',
};

// Index into CLASSES for an instrumental intensity, or -1 when below 0.5 ("no felt shaking").
export function classIndex(i) {
  if (!(i >= LOWER_BOUNDS[0] - 0.5)) return -1;
  let k = 0;
  while (k < LOWER_BOUNDS.length && i >= LOWER_BOUNDS[k]) k++;
  return k;
}

export function classOf(i) {
  const k = classIndex(i);
  return k < 0 ? null : CLASSES[k];
}

// Rough rupture length for a magnitude (km), as used by the EEW's point-source estimate.
export function faultLengthKm(m) {
  return 10 ** (0.5 * Math.min(m, 9.6) - 1.85);
}

// Source type from depth and whether the epicenter is offshore.
export function sourceType(depthKm, offshore) {
  if (depthKm >= 60) return 'intraslab';
  if (offshore) return 'interplate';
  return 'crustal';
}

const TYPE_TERM = { crustal: 0, interplate: -0.02, intraslab: 0.12 };

// PGV (cm/s) on engineering bedrock (Vs ≈ 600 m/s), Si & Midorikawa (1999):
//   log PGV = 0.58 Mw + 0.0038 D + d − 1.29 − log(X + 0.0028·10^(0.5 Mw)) − 0.002 X
// X = shortest distance to the fault (km), D = fault depth (km), d = source-type term.
// Mw saturates at 8.3 as in the J-SHIS hazard maps; D is held within the data range.
// Above Mw 9.6 (larger than any recorded quake) shaking keeps growing so that fictional
// magnitudes up to 50 behave as expected.
// `q` scales the anelastic term: below 1 for paths running up a cold, high-Q slab and above 1
// for paths crossing the hot mantle wedge (see slabPathFactor).
export function pgvSM99(mw, faultDepthKm, xKm, type = 'crustal', q = 1) {
  const m = Math.min(mw, 8.3);
  const d = Math.min(Math.max(faultDepthKm, 0), 120);
  const x = Math.max(0.5, xKm);
  const logv = 0.58 * m + 0.0038 * d + TYPE_TERM[type] - 1.29 -
    Math.log10(x + 0.0028 * 10 ** (0.5 * m)) - 0.002 * q * x + 0.3 * Math.max(0, mw - 9.6);
  return 10 ** logv;
}

// The station site factors (ARV) are relative to Vs = 400 m/s bedrock; SM99 gives PGV on
// Vs = 600 m/s, which is 1.31 times weaker (Midorikawa et al. 1994: log ARV = 1.83 − 0.66 log Vs).
export const VS600_TO_VS400 = 1.31;

// Volcanic front (lat, lon), north to south: stations on its ocean side sit above the
// subducting slab. Kyushu has its own front for the Philippine Sea slab.
const FRONT_PACIFIC = [
  [45.5, 147.5], [43.4, 144.4], [42.7, 141.3], [41.3, 140.9], [40.0, 140.9], [38.7, 140.7], [37.6, 140.1],
  [36.6, 139.5], [35.4, 138.7], [34.7, 139.4], [33.1, 139.8], [30.5, 140.3], [27.0, 140.9], [24.0, 141.3],
];
const FRONT_KYUSHU = [[33.6, 131.6], [33.1, 131.2], [31.6, 130.7], [29.6, 129.7], [28.0, 129.2]];

function frontLon(front, lat) {
  if (lat >= front[0][0]) return front[0][1];
  for (let k = 1; k < front.length; k++) {
    const [la1, lo1] = front[k];
    if (lat >= la1) {
      const [la0, lo0] = front[k - 1];
      return lo1 + ((lat - la1) / (la0 - la1)) * (lo0 - lo1);
    }
  }
  return front[front.length - 1][1];
}

// Which slab a site sits above (forearc side of the volcanic front): 'pac' (Pacific plate),
// 'phs' (Philippine Sea plate) or '' for the back-arc.
export function forearcOf(lat, lon) {
  if (lon < 132.2 && lat < 34) return lon > frontLon(FRONT_KYUSHU, lat) ? 'phs' : '';
  if (lon < 137.6 && lat < 35) return lat < 34.3 ? 'phs' : ''; // Shikoku and Kii
  if (lon < 137.6) return '';
  return lon > frontLon(FRONT_PACIFIC, lat) ? 'pac' : '';
}

// The slab a quake belongs to: the Philippine Sea plate under south-west Japan, else the Pacific.
export function slabOf(lat, lon) {
  return lon < 136.5 && lat < 35.5 ? 'phs' : 'pac';
}

// Path attenuation relative to SM99's average, from where the station sits:
// - deep quakes (異常震域, abnormal intensity distribution): waves travelling up the cold
//   slab lose little energy, so the Pacific side shakes far from the epicentre while the
//   land right above the quake barely feels it;
// - interplate quakes: paths to the back-arc cross the hot mantle wedge and fade faster.
// Returns the scale for pgvSM99's anelastic term.
export function slabPathFactor(type, depthKm, forearc) {
  if (type === 'interplate') return forearc ? 1 : 1.6;
  if (type !== 'intraslab') return 1;
  const g = Math.max(0, Math.min(1, (depthKm - 80) / 200));
  return forearc ? 1 - 0.7 * g : 1 + 1.0 * g;
}

// Point-source version (EEW forecasts): distance to the fault approximated from the
// hypocentral distance minus half the rupture length.
export function pgvBedrock(m, depthKm, epiKm, type = 'crustal') {
  const half = faultLengthKm(m) * 0.5;
  const x = Math.max(Math.min(depthKm, 300), Math.hypot(epiKm, depthKm) - half);
  return pgvSM99(m, depthKm, x, type);
}

export function intensityFromPgv(pgv) {
  if (pgv <= 0) return -3;
  const l = Math.min(Math.log10(pgv), 4); // the quadratic turns over beyond ~10^6 cm/s
  const i = 2.002 + 2.603 * l - 0.213 * l * l;
  return Math.max(-3, Math.min(7, i));
}

export function predictIntensity(m, depthKm, epiKm, amp = 1.3, type = 'crustal') {
  return intensityFromPgv(pgvBedrock(m, depthKm, epiKm, type) * amp);
}

// Colour for real-time (Kyoshin monitor style) intensity, -3 .. 7.
const RT_STOPS = [
  [-3, [0, 0, 205]], [-2, [0, 70, 255]], [-1, [0, 170, 255]], [0, [0, 220, 140]],
  [1, [120, 235, 0]], [2, [235, 240, 0]], [3, [255, 180, 0]], [4, [255, 100, 0]],
  [5, [245, 20, 0]], [6, [190, 0, 40]], [7, [150, 0, 120]],
];

export function realtimeColor(i) {
  if (i <= RT_STOPS[0][0]) return rgb(RT_STOPS[0][1]);
  for (let k = 1; k < RT_STOPS.length; k++) {
    const [v1, c1] = RT_STOPS[k];
    if (i <= v1) {
      const [v0, c0] = RT_STOPS[k - 1];
      const f = (i - v0) / (v1 - v0);
      return rgb(c0.map((c, j) => c + (c1[j] - c) * f));
    }
  }
  return rgb(RT_STOPS[RT_STOPS.length - 1][1]);
}

function rgb(c) {
  return `rgb(${c.map((v) => Math.round(v)).join(',')})`;
}

// JMA long-period ground motion class (0-4) from a magnitude and distance; a coarse heuristic.
export function longPeriodClass(m, epiKm) {
  if (m < 6.0) return 0;
  const s = (m - 6.0) * 1.6 - epiKm / 150;
  return Math.max(0, Math.min(4, Math.floor(s)));
}
