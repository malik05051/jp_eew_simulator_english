// Ground-motion and JMA seismic-intensity helpers.
//
// Peak ground velocity on Vs=600 m/s bedrock: Si & Midorikawa (1999).
// Instrumental intensity from PGV: Fujimoto & Midorikawa (2005).

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

// Rough rupture length for a magnitude (km).
export function faultLengthKm(m) {
  return 10 ** (0.5 * m - 1.85);
}

// Source type from depth and whether the epicenter is offshore.
export function sourceType(depthKm, offshore) {
  if (depthKm >= 60) return 'intraslab';
  if (offshore) return 'interplate';
  return 'crustal';
}

const TYPE_TERM = { crustal: 0, interplate: -0.02, intraslab: 0.12 };

// PGV (cm/s) on engineering bedrock.
export function pgvBedrock(m, depthKm, epiKm, type = 'crustal') {
  const mw = Math.min(m, 8.3);
  const half = faultLengthKm(m) * 0.35;
  const near = Math.max(0, epiKm - half);
  const x = Math.max(3, Math.hypot(near, Math.min(depthKm, 200)));
  const d = Math.min(depthKm, 150);
  const logv = 0.58 * mw + 0.0038 * d + TYPE_TERM[type] - 1.29 -
    Math.log10(x + 0.0028 * 10 ** (0.5 * mw)) - 0.002 * x;
  return 10 ** logv;
}

export function intensityFromPgv(pgv) {
  if (pgv <= 0) return -3;
  const l = Math.log10(pgv);
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
