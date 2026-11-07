import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/engine.js';
import { EpicenterLookup } from '../src/sim/epicenter.js';
import { CLASSES, classOf, predictIntensity } from '../src/sim/intensity.js';
import { DepthGrid } from '../src/sim/tsunami.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url)));
const data = {
  stations: load('stations.json').stations,
  subregions: load('subregions.json'),
  tsunami: load('tsunami.json'),
  epicenters: new EpicenterLookup(load('epicenters.json')),
  depth: new DepthGrid(load('depth.json')),
};
const sim = new Simulation(data);
const run = (q) => sim.start({ ...q, seed: 42 });

test('epicenter names', () => {
  assert.equal(data.epicenters.find(37.50, 137.27).name.includes('Noto'), true);
  assert.equal(data.epicenters.find(38.10, 142.86).name, 'Off Sanriku');
  assert.equal(data.epicenters.find(35.69, 139.69).name, 'Tokyo, 23 Wards');
});

test('intensity attenuates with distance', () => {
  const near = predictIntensity(7.0, 10, 10);
  const far = predictIntensity(7.0, 10, 300);
  assert.ok(near > 5.5 && near <= 7, `near ${near}`);
  assert.ok(far < 3.5, `far ${far}`);
  assert.equal(classOf(4.6), '5-');
  assert.equal(classOf(6.6), '7');
});

test('2024 Noto: strong shaking, EEW warning, tsunami warning', () => {
  const q = run({ lat: 37.50, lon: 137.27, depth: 16, mag: 7.6 });
  assert.ok(CLASSES.indexOf(q.maxClass) >= CLASSES.indexOf('6-'), `max ${q.maxClass}`);
  const final = sim.eewReports.at(-1);
  assert.ok(sim.eewReports.length > 5);
  assert.ok(final.isWarning && final.isFinal);
  assert.ok(final.warnAreas.size > 3);
  assert.ok(['warning', 'major'].includes(sim.tsunami.level), sim.tsunami.level);
  assert.ok(sim.tsunami.areas.has('360'), 'Ishikawa Noto coast');
  const types = sim.reports.map((r) => r.type);
  assert.equal(types[0], 'flash');
  assert.ok(types.includes('detail') && types.includes('tsunami'));
  // the bulletin comes out together with (and just before) the hypocenter report
  const at = (type) => sim.reports.find((r) => r.type === type).at;
  assert.equal(at('tsunami'), at('hypocenter'));
  assert.ok(types.indexOf('tsunami') < types.indexOf('hypocenter'));
});

test('2011 Tohoku: major tsunami warning and saturated EEW magnitude', () => {
  run({ lat: 38.10, lon: 142.86, depth: 24, mag: 9.0 });
  assert.equal(sim.tsunami.level, 'major');
  assert.equal(sim.tsunami.areas.get('220').level, 'major');
  assert.ok(sim.eewReports.at(-1).mag < 8.5);
});

test('small inland quake: no EEW, no tsunami, weak shaking', () => {
  const q = run({ lat: 36.0, lon: 138.0, depth: 10, mag: 3.2 });
  assert.equal(sim.eewReports.length, 0);
  assert.equal(sim.tsunami.level, 'none');
  assert.ok(CLASSES.indexOf(q.maxClass ?? '0') <= CLASSES.indexOf('3'), q.maxClass);
});

test('state is consistent over time', () => {
  run({ lat: 35.7, lon: 139.8, depth: 50, mag: 7.3 });
  assert.equal(sim.regionsAt(0).size, 0);
  const early = sim.regionsAt(20).size;
  const late = sim.regionsAt(300).size;
  assert.ok(late >= early && late > 30, `${early} -> ${late}`);
  const i = 0;
  assert.ok(sim.realtime(i, -1) < -2);
  const evs = sim.eventsBetween(-1, sim.duration());
  assert.equal(evs.length, sim.events.length);
});

test('tsunami heights in metres match real events (rough calibration)', () => {
  run({ lat: 38.10, lon: 142.86, depth: 24, mag: 9.0 }); // 2011 Tohoku
  const miyagi = sim.tsunami.areas.get('220');
  assert.ok(miyagi.est > 8 && miyagi.est < 25, `Miyagi ${miyagi.est}`); // gauges 8-15 m+, runup far more
  assert.ok(sim.tsunami.areas.get('312').est < 3, 'Tokyo inner bay ~1.5 m');
  assert.ok(miyagi.arrivalMin >= 5 && miyagi.arrivalMin <= 40, `arrival ${miyagi.arrivalMin} min`);
  const okinawa = sim.tsunami.areas.get('800');
  assert.ok(okinawa.arrivalMin > 90, 'Okinawa is hours away');

  run({ lat: 37.50, lon: 137.27, depth: 16, mag: 7.5 }); // 2024 Noto
  const noto = sim.tsunami.areas.get('360');
  assert.ok(noto.est > 1 && noto.est < 6, `Noto ${noto.est}`);
  assert.ok(!sim.tsunami.areas.has('250'), 'no tsunami bulletin on the Pacific side');

  run({ lat: 41.78, lon: 144.08, depth: 27, mag: 8.0 }); // 2003 Tokachi
  const tokachi = sim.tsunami.areas.get('101');
  assert.ok(tokachi.est > 2 && tokachi.est < 6, `Tokachi ${tokachi.est}`);
});

test('tsunami observations come after the bulletin and the wave arrival', () => {
  run({ lat: 38.10, lon: 142.86, depth: 24, mag: 9.0 });
  const obsReports = sim.reports.filter((r) => r.type === 'tsunamiObs');
  assert.ok(obsReports.length > 0);
  assert.ok(obsReports.every((r) => r.at >= sim.tsunami.at));
  for (const o of sim.tsunami.obs) {
    assert.ok(o.peakAt > o.firstAt && o.height > 0);
    assert.equal(sim.tsunamiObservedAt(o.code, o.firstAt - 1), null);
    assert.equal(sim.tsunamiObservedAt(o.code, o.peakAt + 1).peak, o.height);
  }
});

test('deep and inland quakes make no tsunami', () => {
  run({ lat: 30.5, lon: 140.4, depth: 400, mag: 6.8 });
  assert.equal(sim.tsunami.level, 'none');
  run({ lat: 36.2, lon: 138.2, depth: 10, mag: 7.0 }); // Nagano
  assert.equal(sim.tsunami.level, 'none');
});

// Iburi 2018 (observed 7 on very soft volcanic soil) comes out at 6- to 6+: a known low case.
test('finite fault: historical maximum intensities within one class', () => {
  const cases = [
    [{ lat: 32.75, lon: 130.76, depth: 12, mag: 7.3, mw: 7.0, strike: 226, dip: 70 }, '7'], // Kumamoto 2016
    [{ lat: 34.60, lon: 135.04, depth: 16, mag: 7.3, mw: 6.9, strike: 53, dip: 85 }, '7'], // Hanshin 1995
    [{ lat: 37.50, lon: 137.27, depth: 16, mag: 7.6, mw: 7.5, strike: 55, dip: 45 }, '7'], // Noto 2024
    [{ lat: 38.10, lon: 142.86, depth: 24, mag: 9.0, strike: 193, dip: 14, length: 450 }, '7'], // Tohoku 2011
  ];
  for (const [q, obs] of cases) {
    const got = CLASSES.indexOf(run(q).maxClass);
    assert.ok(Math.abs(got - CLASSES.indexOf(obs)) <= 1, `${JSON.stringify(q)}: ${CLASSES[got]} vs ${obs}`);
  }
});

test('deep quake: abnormal intensity on the Pacific side', () => {
  // 2015 Bonin deep quake (682 km): 4 widely in Kanto, little on the Sea of Japan side
  run({ lat: 27.86, lon: 140.68, depth: 682, mag: 8.1, mw: 7.9 });
  const kanto = Math.max(0, ...[...sim.regionFinal].filter(([c]) => /^3[0-6]/.test(c)).map(([, v]) => v.k));
  assert.ok(kanto >= CLASSES.indexOf('3') && kanto <= CLASSES.indexOf('5+'), `Kanto ${CLASSES[kanto]}`);
  const backArc = [...sim.regionFinal].filter(([c]) => /^(37|38|39)/.test(c)).map(([, v]) => v.k);
  assert.ok(Math.max(0, ...backArc) < kanto, 'Sea of Japan side weaker');
});

test('limits: M50 and 1000 km depth run without errors', () => {
  const huge = run({ lat: 36.0, lon: 138.0, depth: 10, mag: 50 });
  assert.equal(huge.maxClass, '7');
  assert.ok(sim.duration() < 4 * 3600);
  const deep = run({ lat: 36.0, lon: 138.0, depth: 1000, mag: 7 });
  assert.ok(CLASSES.indexOf(deep.maxClass) <= CLASSES.indexOf('3'), deep.maxClass);
  assert.equal(sim.tsunami.level, 'none');
});
