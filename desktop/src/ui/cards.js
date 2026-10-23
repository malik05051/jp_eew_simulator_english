// Sidebar cards (EEW, information reports, tsunami) and the history list, as HTML strings.
import { CLASSES, CLASS_LABEL, CLASS_COLOR, CLASS_TEXT } from '../sim/intensity.js';
import { tsunamiText } from '../sim/engine.js';
import { badgeHtml } from './map.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fmtTime(date, withSeconds = true) {
  const p = (n) => String(n).padStart(2, '0');
  const t = `${p(date.getHours())}:${p(date.getMinutes())}${withSeconds ? ':' + p(date.getSeconds()) : ''}`;
  return t;
}

export function fmtDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${p(date.getMonth() + 1)}/${p(date.getDate())}`;
}

function bigBadge(cls, label) {
  const bg = cls ? CLASS_COLOR[cls] : '#3a4552';
  const fg = cls ? CLASS_TEXT[cls] : '#cfd8e3';
  let value = '?';
  if (cls) {
    const mod = cls[1] === '-' ? '−' : cls[1] === '+' ? '+' : '';
    value = `${cls[0]}${mod ? `<sup>${mod}</sup>` : ''}`;
  }
  return `<span class="badge xl" style="background:${bg};color:${fg}"><span class="stack"><span class="lbl">${label}</span><span>${value}</span></span></span>`;
}

function depthText(d) {
  return d <= 0 ? 'Very shallow' : `${Math.round(d)} km`;
}

function areaNames(codes, subByCode, limit = 99) {
  const names = [...codes].map((c) => subByCode.get(c)?.properties.en).filter(Boolean);
  const shown = names.slice(0, limit).join(', ');
  return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
}

// Group a Map(code -> class index) into rows of "badge  names", strongest first.
function areaRows(regions, subByCode, minK = 1) {
  const groups = new Map();
  for (const [code, k] of regions) {
    if (k < minK) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(code);
  }
  return [...groups.keys()].sort((a, b) => b - a).map((k) => `
    <div class="area-row">${badgeHtml(CLASSES[k])}<span class="names">${esc(areaNames(groups.get(k), subByCode))}</span></div>`).join('');
}

export function eewCard(r, ctx) {
  const kind = r.isWarning ? 'warning' : 'forecast';
  const title = r.isWarning ? 'Earthquake Early Warning (Warning)' : 'Earthquake Early Warning (Forecast)';
  const tag = r.isFinal ? 'Final' : `#${r.serial}`;
  const warn = r.isWarning && r.warnAreas.size
    ? `<div class="note alert"><b>Strong shaking expected:</b> ${esc(areaNames(r.warnAreas, ctx.subByCode, 12))}</div>` : '';
  return `
  <div class="card">
    <div class="card-head ${kind} ${r.isFinal ? 'final' : ''}">${title}<span class="tag">${tag}</span></div>
    <div class="card-body">
      <div class="maxrow">${bigBadge(r.maxClass, 'Est. max')}
        <div class="meta">
          <div class="place">${esc(r.name)}</div>
          <div class="sub">M${r.mag.toFixed(1)} · Depth ${depthText(r.depth)}</div>
          <div class="sub">Issued ${fmtTime(ctx.clock(r.at))}${r.lpgm ? ` · Est. LPGM class ${r.lpgm}` : ''}</div>
        </div>
      </div>
      ${warn}
    </div>
  </div>`;
}

const REPORT_TITLE = {
  flash: 'Seismic Intensity Flash',
  hypocenter: 'Hypocenter Information',
  detail: 'Earthquake Information',
  lpgm: 'Long-Period Ground Motion Observation',
};

export function infoCard(rep, ctx) {
  const { q, sim } = ctx;
  const origin = ctx.clock(0);
  if (rep.type === 'flash') {
    const regions = sim.reportRegions(rep.at, 3);
    let maxK = 0; for (const k of regions.values()) maxK = Math.max(maxK, k);
    return `
    <div class="card">
      <div class="card-head">${REPORT_TITLE.flash}<span class="tag">${fmtTime(ctx.clock(rep.at), false)}</span></div>
      <div class="card-body">
        <div class="maxrow">${bigBadge(CLASSES[maxK], 'Max int.')}
          <div class="meta"><div class="place">Strong shaking observed</div>
          <div class="sub">Around ${fmtTime(origin, false)} · Hypocenter under investigation</div></div>
        </div>
        <div class="areas">${areaRows(regions, ctx.subByCode, 3)}</div>
      </div>
    </div>`;
  }
  const isDetail = rep.type === 'detail' || rep.type === 'lpgm';
  const regions = isDetail ? sim.reportRegions(Infinity, 1) : new Map();
  const maxCls = q.maxClass;
  const lp = rep.type === 'lpgm' ? `<div class="note">Long-period ground motion class up to ${Math.max(1, Math.min(4, Math.round((q.mag - 5.8) * 1.5)))} observed.</div>` : '';
  return `
  <div class="card">
    <div class="card-head">${REPORT_TITLE[rep.type]}<span class="tag">${fmtTime(ctx.clock(rep.at), false)}</span></div>
    <div class="card-body">
      <div class="maxrow">${bigBadge(isDetail || rep.type === 'hypocenter' ? maxCls : null, 'Max int.')}
        <div class="meta">
          <div class="place">${esc(q.place.name)}</div>
          <div class="sub">M${q.mag.toFixed(1)} · Depth ${depthText(q.depth)}</div>
          <div class="sub">${fmtDate(origin)} ${fmtTime(origin, false)}</div>
        </div>
      </div>
      <div class="note ${sim.tsunami.level !== 'none' && sim.tsunami.level !== 'slight' ? 'alert' : ''}">${esc(rep.tsunamiComment || tsunamiText(sim.tsunami.level))}</div>
      ${lp}
      ${isDetail ? `<div class="areas">${areaRows(regions, ctx.subByCode, 1)}</div>` : ''}
    </div>
  </div>`;
}

const TSU_TITLE = { major: 'Major Tsunami Warning', warning: 'Tsunami Warning', advisory: 'Tsunami Advisory', forecast: 'Tsunami Forecast' };
const TSU_BG = { major: '#8d17a0', warning: '#c81e2a', advisory: '#d9b51c', forecast: '#2179c2' };

export function tsunamiCard(ts, ctx) {
  const levels = ['major', 'warning', 'advisory', 'forecast'];
  const rows = levels.map((lvl) => {
    const list = [...ts.areas.entries()].filter(([, a]) => a.level === lvl);
    if (!list.length) return '';
    const items = list.map(([code, a]) => {
      const f = ctx.tsuByCode.get(code);
      return `${esc(f ? f.properties.en : code)}${a.height ? ` <span style="opacity:.7">(${a.height})</span>` : ''}`;
    }).join(', ');
    return `<div class="area-row"><span class="badge" style="background:${TSU_BG[lvl]};color:${lvl === 'advisory' ? '#1b1b1b' : '#fff'};font-size:11px;min-width:64px">${lvl === 'forecast' ? 'Forecast' : lvl === 'advisory' ? 'Advisory' : lvl === 'major' ? 'Major' : 'Warning'}</span><span class="names">${items}</span></div>`;
  }).join('');
  const top = ts.level;
  return `
  <div class="card">
    <div class="card-head" style="background:${TSU_BG[top]};${top === 'advisory' ? 'color:#1b1b1b' : ''}">${TSU_TITLE[top]}<span class="tag">${fmtTime(ctx.clock(ts.at), false)}</span></div>
    <div class="card-body">
      ${top === 'major' || top === 'warning' ? '<div class="note alert">Evacuate immediately from coastal and riverside areas.</div>' : ''}
      <div class="areas">${rows}</div>
    </div>
  </div>`;
}

export function idleCard() {
  return `
  <div class="card">
    <div class="card-head">Earthquake Information</div>
    <div class="card-body">
      <div class="maxrow">${bigBadge(null, 'Max int.')}
        <div class="meta"><div class="place">No earthquake</div><div class="sub">Place an epicenter on the map to start a simulation.</div></div>
      </div>
    </div>
  </div>`;
}

export function shakingCard(ctx, t) {
  return `
  <div class="card">
    <div class="card-head">Shaking detected</div>
    <div class="card-body">
      <div class="maxrow">${bigBadge(null, 'Max int.')}
        <div class="meta"><div class="place">Analysing…</div><div class="sub">${t > 0 ? 'Seismic waves are spreading' : 'Waiting for the first waves'}</div></div>
      </div>
    </div>
  </div>`;
}

export function historyItem(h, active) {
  const d = new Date(h.origin);
  return `
  <div class="hist ${active ? 'active' : ''}" data-id="${h.id}">
    ${badgeHtml(h.maxClass)}
    <div class="info">
      <div class="name">${esc(h.name)}</div>
      <div class="line2"><span>${fmtDate(d).slice(5)} ${fmtTime(d, false)}</span><span>Depth ${depthText(h.depth)}</span><span class="mag">M${h.mag.toFixed(1)}</span></div>
    </div>
  </div>`;
}

export function legendHtml() {
  return CLASSES.slice(1).map((c) => badgeHtml(c)).join('') + `<span style="margin-left:6px;color:#8ea3b8;font-size:11px">JMA intensity</span>`;
}

export { CLASS_LABEL };
