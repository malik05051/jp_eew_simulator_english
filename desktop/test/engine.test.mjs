import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/engine.js';
import { EpicenterLookup } from '../src/sim/epicenter.js';
import { CLASSES, classOf, predictIntensity } from '../src/sim/intensity.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url)));
const data = {
  stations: load('stations.json').stations,
  subregions: load('subregions.json'),
  tsunami: load('tsunami.json'),
  epicenters: new EpicenterLookup(load('epicenters.json')),
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
