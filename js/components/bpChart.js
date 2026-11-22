// Charts built from HTML and SVG (no images): bar, funnel, trend and gauge. Text values are always shown,
// so the numbers are readable without the visual and by screen readers.
// LWC equivalent: c-bp-chart with a `type` property.

import { esc, fmtCompact } from '../core/util.js';

const fmt = (v, money) => (money ? `${fmtCompact(v)}` : String(v));

/** Horizontal bars: [{label, value, sub?, tone?}] */
export function barChart(rows, { money = false, max, label = 'Bar chart' } = {}) {
  const top = max || Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bp-chart bp-bars" role="img" aria-label="${esc(label)}: ${rows.map((r) => `${r.label} ${fmt(r.value, money)}`).join(', ')}">
    ${rows.map((r) => `<div class="bp-bar-row"><span class="bp-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="bp-bar-track"><span class="bp-bar-fill ${r.tone || ''}" style="width:${Math.max(2, Math.round((r.value / top) * 100))}%"></span></span>
      <span class="bp-bar-val">${fmt(r.value, money)}${r.sub ? `<small> ${esc(r.sub)}</small>` : ''}</span></div>`).join('')}</div>`;
}

/** Funnel: [{label, value}] each step narrower; shows conversion from the previous step. */
export function funnelChart(steps, { label = 'Funnel' } = {}) {
  const top = Math.max(1, steps[0]?.value || 1);
  return `<div class="bp-chart bp-funnel" role="img" aria-label="${esc(label)}: ${steps.map((s) => `${s.label} ${s.value}`).join(', ')}">
    ${steps.map((s, i) => `<div class="bp-funnel-step"><div class="bp-funnel-bar" style="width:${Math.max(6, Math.round((s.value / top) * 100))}%"><b>${esc(s.display ?? String(s.value))}</b></div>
      <span class="bp-funnel-label">${esc(s.label)}${i && steps[i - 1].value && s.pct !== false ? ` <small>${Math.round((s.value / steps[i - 1].value) * 100)}%</small>` : ''}</span></div>`).join('')}</div>`;
}

/** Trend: column chart over time [{label, value}]. */
export function trendChart(points, { money = false, label = 'Trend', height = 120 } = {}) {
  const top = Math.max(1, ...points.map((p) => p.value));
  return `<div class="bp-chart bp-trend" style="height:${height}px" role="img" aria-label="${esc(label)}: ${points.map((p) => `${p.label} ${fmt(p.value, money)}`).join(', ')}">
    ${points.map((p) => `<div class="bp-trend-col" title="${esc(p.label)}: ${fmt(p.value, money)}"><span class="bp-trend-val">${fmt(p.value, money)}</span><span class="bp-trend-bar" style="height:${Math.max(3, Math.round((p.value / top) * 100))}%"></span><span class="bp-trend-label">${esc(p.label)}</span></div>`).join('')}</div>`;
}

/** Gauge 0–100 (semi-circle). */
export function gauge(pct, { label = '', tone = '' } = {}) {
  const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const a = Math.PI * (1 - v / 100);
  const x = 50 + 40 * Math.cos(a);
  const y = 50 - 40 * Math.sin(a);
  return `<div class="bp-gauge ${tone}" role="img" aria-label="${esc(label)} ${v}%"><svg viewBox="0 0 100 56" aria-hidden="true">
    <path d="M10 50 A40 40 0 0 1 90 50" class="bp-gauge-track"/><path d="M10 50 A40 40 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" class="bp-gauge-fill"/></svg>
    <div class="bp-gauge-val">${v}%</div><div class="bp-gauge-label">${esc(label)}</div></div>`;
}
