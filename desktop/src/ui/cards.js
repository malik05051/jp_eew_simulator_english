// Sidebar cards (EEW, shaking, information, tsunami) and the history list, as HTML strings.
import { CLASSES, CLASS_LABEL, CLASS_COLOR, CLASS_TEXT, classOf } from '../sim/intensity.js';
import { tsunamiText } from '../sim/engine.js';
import { badgeHtml, TSUNAMI_COLOR } from './map.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const p2 = (n) => String(n).padStart(2, '0');

export function fmtTime(date, withSeconds = true) {
  return `${p2(date.getHours())}:${p2(date.getMinutes())}${withSeconds ? ':' + p2(date.getSeconds()) : ''}`;
}

export function fmtDate(date) {
  return `${date.getFullYear()}/${p2(date.getMonth() + 1)}/${p2(date.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtShort(date) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${fmtTime(date, false)}`;
}

function clsValue(cls) {
  if (!cls) return '?';
  const mod = cls[1] === '-' ? '−' : cls[1] === '+' ? '+' : '';
  return `${cls[0]}${mod ? `<sup>${mod}</sup>` : ''}`;
}

// Wide coloured box: "<label>  <value>"
function bigBox(cls, label) {
  const bg = cls ? CLASS_COLOR[cls] : '#3a4552';
  const fg = cls ? CLASS_TEXT[cls] : '#cfd8e3';
  return `<div class="bigbox" style="background:${bg};color:${fg}"><span class="bb-label">${label}</span><span class="bb-value">${clsValue(cls)}</span></div>`;
}

// Magnitude / depth rows with the small colour bar of the original app.
function magColor(m) {
  return m >= 7 ? '#c43ad6' : m >= 6 ? '#ef2f2f' : m >= 5 ? '#f08a24' : m >= 4 ? '#f5d327' : '#45a8f5';
}
function depthColor(d) {
  return d < 30 ? '#ef2f2f' : d < 100 ? '#f08a24' : d < 300 ? '#f5d327' : '#45a8f5';
}
function depthText(d) {
  return d <= 0 ? 'Very shallow' : `${Math.round(d)} km`;
}
function magDepth(mag, depth) {
  return `
    <div class="mrow"><span>Magnitude</span><b>${mag.toFixed(1)}</b><i style="background:${magColor(mag)}"></i></div>
    <div class="mrow"><span>Depth</span><b>${depthText(depth)}</b><i style="background:${depthColor(depth)}"></i></div>`;
}

function areaName(code, ctx) {
  return ctx.subByCode.get(code)?.properties.en ?? code;
}

// --------------------------------------------------------------- realtime view
export function eewCard(r, ctx) {
  const tag = r.isWarning ? `Warning ${r.isFinal ? 'final' : '#' + r.serial}` : `Forecast ${r.isFinal ? 'final' : '#' + r.serial}`;
  const lp = r.lpgm > 0
    ? `<div class="lprow"><span>Est. max long-period<br>ground motion class</span><b>${r.lpgm}</b></div>` : '';
  const note = r.emergency
    ? '<div class="alertnote">This is an emergency Earthquake Early Warning. Protect yourself immediately.</div>'
    : r.isWarning ? '<div class="alertnote">Strong shaking expected. Protect yourself.</div>' : '';
  return `
  <div class="card">
    <div class="card-head ${r.isWarning ? 'warning' : 'forecast'}">Early Warning (EEW)<span class="tag">${tag}</span></div>
    <div class="card-body">
      <div class="place">${esc(r.name)} <small>earthquake</small></div>
      <div class="sub">${fmtDate(ctx.clock(0))} ${fmtTime(ctx.clock(0))} occurred</div>
      ${bigBox(r.maxClass, 'Est. max<br>intensity')}
      ${lp}
      ${magDepth(r.mag, r.depth)}
      ${note}
    </div>
  </div>`;
}

export function shakingCard(list, ctx) {
  const top = list.length ? classOf(list[0].i) : null;
  const rows = list.slice(0, 8).map((x) => `
    <div class="area-row">${badgeHtml(classOf(x.i))}<span class="names">${esc(areaName(x.code, ctx))}</span></div>`).join('');
  return `
  <div class="card">
    <div class="card-head">Shaking detected</div>
    <div class="card-body">
      ${bigBox(top, 'Real-time<br>max intensity')}
      <div class="areas">${rows || '<span class="sub">Waiting for the waves to arrive</span>'}</div>
    </div>
  </div>`;
}

// --------------------------------------------------------------- info view
const REPORT_TITLE = {
  flash: 'Seismic Intensity Flash',
  hypocenter: 'Hypocenter Information',
  detail: 'Intensity Information',
  lpgm: 'Intensity Information',
};

export function infoCard(rep, ctx) {
  const { q, sim } = ctx;
  const origin = ctx.clock(0);
  const ts = sim.tsunami.level;
  const tsBtn = ts === 'none'
    ? '<div class="tsunote none">No tsunami concern</div>'
    : ts === 'slight' ? '<div class="tsunote slight">Slight sea-level change possible</div>'
      : `<div class="tsunote alert">${ts === 'major' || ts === 'warning' ? 'Tsunami warnings in effect' : 'Tsunami bulletins in effect'}</div>`;
  if (rep.type === 'flash') {
    const regions = sim.reportRegions(rep.at, 3);
    let maxK = 0; for (const k of regions.values()) maxK = Math.max(maxK, k);
    return `
    <div class="card">
      <div class="card-head"><span class="ico">i</span>${REPORT_TITLE.flash}</div>
      <div class="card-body">
        ${bigBox(CLASSES[maxK], 'Max<br>intensity')}
        <div class="sub">${fmtShort(origin)} or so</div>
        <div class="kvline"><span>Epicenter and size</span><b>Under investigation</b></div>
        <div class="tsunote">Tsunami: under investigation</div>
      </div>
    </div>`;
  }
  const known = rep.type !== 'hypocenter';
  return `
  <div class="card">
    <div class="card-head"><span class="ico">i</span>${REPORT_TITLE[rep.type]}</div>
    <div class="card-body">
      ${known ? bigBox(q.maxClass, 'Max<br>intensity') : ''}
      <div class="sub">${fmtShort(origin)} or so</div>
      <div class="place">${esc(q.place.name)}</div>
      <div class="sub">an earthquake occurred</div>
      ${magDepth(q.mag, q.depth)}
      ${tsBtn}
      ${rep.type === 'lpgm' ? `<div class="lprow"><span>Long-period ground<br>motion class observed</span><b>${Math.max(1, Math.min(4, Math.round((q.mag - 5.8) * 1.5)))}</b></div>` : ''}
    </div>
  </div>`;
}

export function regionListCard(regions, ctx) {
  const groups = new Map();
  for (const [code, k] of regions) {
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(code);
  }
  const rows = [...groups.keys()].sort((a, b) => b - a).map((k) => `
    <div class="area-row">${badgeHtml(CLASSES[k])}<span class="names">${esc(groups.get(k).map((c) => areaName(c, ctx)).join(', '))}</span></div>`).join('');
  return `
  <div class="card">
    <div class="card-head">Intensity by area</div>
    <div class="card-body"><div class="areas tall">${rows}</div></div>
  </div>`;
}

// --------------------------------------------------------------- tsunami view
const TSU_TITLE = { major: 'Major Tsunami Warning', warning: 'Tsunami Warning', advisory: 'Tsunami Advisory', forecast: 'Tsunami Forecast' };
const TSU_SHORT = { major: 'Major tsunami warning', warning: 'Tsunami warning', advisory: 'Tsunami advisory', forecast: 'Tsunami forecast' };

export function tsunamiCard(ts, ctx, t) {
  const { q } = ctx;
  const origin = ctx.clock(0);
  const levels = ['major', 'warning', 'advisory', 'forecast'];
  const groups = levels.map((lvl) => {
    const list = [...ts.areas.entries()].filter(([, a]) => a.level === lvl);
    if (!list.length) return '';
    const height = lvl === 'forecast' ? '' : list.reduce((best, [, a]) => (rankH(a.height) > rankH(best) ? a.height : best), '');
    const items = list.sort((a, b) => a[1].arrivalMin - b[1].arrivalMin).map(([code, a]) => {
      const f = ctx.tsuByCode.get(code);
      const arrive = t >= a.arrivalMin * 60
        ? '<span class="pill-y">Arriving now (estimated)</span>'
        : `<span class="pill-d">Expected ${fmtTime(ctx.clock(a.arrivalMin * 60), false)}</span>`;
      return `<div class="tsu-item"><div>${esc(f ? f.properties.en : code)}</div>${lvl === 'forecast' ? '' : arrive}</div>`;
    }).join('');
    return `
      <div class="tsu-group" style="--c:${TSUNAMI_COLOR[lvl]}">
        <div class="tsu-title">${height ? `<span class="hbadge">${esc(height.replace('over ', '>').replace(' m', 'm'))}</span>` : ''}${TSU_SHORT[lvl]}</div>
        <div class="tsu-list">${items}</div>
      </div>`;
  }).join('');
  return `
  <div class="card">
    <div class="card-head" style="background:${ts.level === 'advisory' ? '#c9a90f' : ts.level === 'forecast' ? '#2179c2' : '#d32631'}">${TSU_TITLE[ts.level]}</div>
    <div class="card-body">
      <div class="sub">${fmtShort(origin)} or so</div>
      <div class="place">${esc(q.place.name)}</div>
      ${magDepth(q.mag, q.depth)}
      ${groups}
    </div>
  </div>`;
}

export function noTsunamiCard(ctx) {
  const lvl = ctx.sim ? ctx.sim.tsunami.level : 'none';
  return `
  <div class="card">
    <div class="card-head">Tsunami information</div>
    <div class="card-body"><div class="sub">${esc(ctx.q ? tsunamiText(lvl) : 'No tsunami bulletins in effect.')}</div></div>
  </div>`;
}

function rankH(h) {
  return { '': 0, '1 m': 1, '3 m': 2, '5 m': 3, '10 m': 4, 'over 10 m': 5 }[h ?? ''] ?? 0;
}

// --------------------------------------------------------------- idle + history
export function idleCard() {
  return `
  <div class="card">
    <div class="card-head"><span class="ico">i</span>Intensity Information</div>
    <div class="card-body">
      ${bigBox(null, 'Max<br>intensity')}
      <div class="place">No earthquake</div>
      <div class="sub">Press “New quake” and click the map to place an epicenter.</div>
    </div>
  </div>`;
}

export function historyItem(h, active) {
  const d = new Date(h.origin);
  const cls = h.maxClass;
  return `
  <div class="hist ${active ? 'active' : ''}" data-id="${h.id}">
    <div class="hbox" style="background:${cls ? CLASS_COLOR[cls] : '#3a4552'};color:${cls ? CLASS_TEXT[cls] : '#cfd8e3'}"><span>Max int.</span><b>${clsValue(cls)}</b></div>
    <div class="info">
      <div class="name">${esc(h.name)}</div>
      <div class="line2">${fmtShort(d)} or so</div>
      <div class="line3"><span>Depth ${depthText(h.depth)}</span><i style="background:${depthColor(h.depth)}"></i><span class="mag">M ${h.mag.toFixed(1)}</span><i style="background:${magColor(h.mag)}"></i></div>
    </div>
  </div>`;
}

export function legendHtml(view) {
  if (view === 'tsunami') {
    return `<div class="lg-title">Coastline colours</div>` + ['major', 'warning', 'advisory', 'forecast'].map((l) =>
      `<div class="lg-row"><i style="background:${TSUNAMI_COLOR[l]}"></i>${TSU_SHORT[l]}</div>`).join('');
  }
  const title = view === 'realtime' ? 'Map colours (forecast)' : 'Map colours';
  return `<div class="lg-title">${title}</div>` + CLASSES.slice(1).reverse().map((c) =>
    `<div class="lg-row"><i style="background:${CLASS_COLOR[c]}"></i>Intensity ${CLASS_LABEL[c]}</div>`).join('');
}
