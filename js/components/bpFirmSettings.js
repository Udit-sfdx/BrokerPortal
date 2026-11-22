// P12 Firm settings: SLAs and calling hours, routing rules (order and on/off, with a suggestion from past results),
// pipelines and stage gates, commission defaults, message templates, integrations, plan and seats.
// LWC equivalent: c-bp-firm-settings with one child per tab (c-bp-routing-rules, c-bp-gate-editor, c-bp-template-editor…).
// Acceptance: every rule changes behaviour without code (each save is read by the services straight away).

import { card, uIcon, badge, field, select, textarea, checkbox, toggle, readForm, toast, alertBox } from '../core/ui.js';
import { esc, fmtDate } from '../core/util.js';
import { getState } from '../core/store.js';
import { PIPELINES, GATE_CHOICES, LOCKED_GATES, COMMISSION_RULES, MESSAGE_TEMPLATES, INTEGRATIONS, PLANS, DEAL_TYPES } from '../core/config.js';
import { stagesFor } from '../core/rules.js';
import {
  firmOf, seatsUsed, saveRules, saveCallWindow, moveRoutingRule, saveGates, resetGates, saveCommissionDefaults, saveTemplate,
  setIntegration, requestPlanChange, routingSuggestion,
} from '../services/firmService.js';

const TABS = [['general', 'SLAs and hours'], ['routing', 'Routing'], ['pipelines', 'Pipelines and gates'], ['commission', 'Commission'], ['templates', 'Templates'], ['integrations', 'Integrations'], ['plan', 'Plan and seats']];
const help = (text) => `<p class="bp-small bp-muted slds-m-bottom_small">${uIcon('info', 'slds-icon_xx-small')} ${text}</p>`;

function general(firm) {
  const sla = firm.settings.sla;
  const cw = firm.settings.callWindow;
  const hours = Array.from({ length: 15 }, (_, i) => [7 + i, `${String(7 + i).padStart(2, '0')}:00`]);
  return `<div class="bp-grid bp-cols-2">
    ${card('Lead SLAs', `${help('The first-reply timer on every new lead, and when a late lead goes to the re-assign queue.')}
      <form data-submit="saveSla">${field('setSla', 'First reply within (minutes)', { type: 'number', value: sla.firstResponseMin, name: 'firstResponseMin', attrs: 'min="1" max="240"' })}
      ${field('setRe', 'Re-assign after (minutes late)', { type: 'number', value: sla.reassignAfterMin, name: 'reassignAfterMin', attrs: 'min="1" max="480"' })}
      <button type="submit" class="slds-button slds-button_brand">Save</button></form>`, { icon: 'service_appointment' })}
    ${card('Calling hours (GST)', `${help('Calls outside these hours are blocked for everyone (UAE telemarketing rules allow 09:00–18:00 by default).')}
      <form data-submit="saveHours"><div class="slds-grid slds-gutters_small"><div class="slds-col">${select('setStart', 'From', hours, { value: cw.start, name: 'start' })}</div><div class="slds-col">${select('setEnd', 'To', hours, { value: cw.end, name: 'end' })}</div></div>
      <button type="submit" class="slds-button slds-button_brand">Save</button></form>`, { icon: 'call' })}
    ${card('Firm details', `<dl class="bp-kv bp-kv-narrow"><dt>Legal name</dt><dd>${esc(firm.legalName)}</dd><dt>Trade licence</dt><dd>${esc(firm.tradeLicence)} · expires ${firm.licenceExpiry ? fmtDate(firm.licenceExpiry) : '—'}</dd>
      <dt>ORN</dt><dd>${esc(firm.orn)} · expires ${firm.ornExpiry ? fmtDate(firm.ornExpiry) : '—'}</dd><dt>Teams</dt><dd>${esc(firm.teams.map((t) => t.name).join(', ') || '—')}</dd></dl>
      <p class="bp-small bp-muted slds-m-top_small">Licence changes go through ThinkVibes verification. Users and roles are managed on <a href="portal/#/people">People</a>.</p>`, { icon: 'account' })}
  </div>`;
}

function routing(firm, user) {
  const rules = firm.settings.routing;
  const tips = routingSuggestion(user);
  return `<div class="bp-grid bp-cols-2">${card('Routing rules', `${help('New leads go through these rules in order. The licence rule always runs first and cannot be switched off.')}
    <form data-submit="saveRouting"><ol class="bp-rules">${rules.map((r, i) => `<li>
      <span class="bp-rule-n">${i + 1}</span><span style="flex:1"><b>${esc(r.label)}</b>${r.hard ? ' <span class="bp-small bp-muted">(required)</span>' : ''}</span>
      ${r.hard ? badge('Always on', 'success') : `<div class="slds-checkbox"><input type="checkbox" id="rr-${r.id}" name="${r.id}" ${r.on ? 'checked' : ''}><label class="slds-checkbox__label" for="rr-${r.id}"><span class="slds-checkbox_faux"></span><span class="slds-form-element__label">On</span></label></div>
        <button type="button" class="slds-button slds-button_icon slds-button_icon-border" title="Move up" aria-label="Move ${esc(r.label)} up" data-act="routingMove" data-id="${r.id}" data-dir="up" ${i <= 1 ? 'disabled' : ''}>${uIcon('arrowup', 'slds-icon_xx-small')}</button>
        <button type="button" class="slds-button slds-button_icon slds-button_icon-border" title="Move down" aria-label="Move ${esc(r.label)} down" data-act="routingMove" data-id="${r.id}" data-dir="down" ${i === rules.length - 1 ? 'disabled' : ''}>${uIcon('arrowdown', 'slds-icon_xx-small')}</button>`}</li>`).join('')}</ol>
    <input type="hidden" name="firstResponseMin" value="${firm.settings.sla.firstResponseMin}"><input type="hidden" name="reassignAfterMin" value="${firm.settings.sla.reassignAfterMin}">
    <button type="submit" class="slds-button slds-button_brand">Save rules</button></form>`, { icon: 'omni_supervisor' })}
    ${card(`${uIcon('sparkles', 'slds-icon_x-small')} Suggestion from past results`, `<ul class="bp-coach-risks">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="bp-small bp-muted">Based on your firm's own leads only. Suggestions never change rules by themselves.</p>`, { cls: 'bp-ai-card' })}</div>`;
}

function pipelines(firm, type) {
  const stages = stagesFor(type, firm.id);
  const overridden = !!(firm.settings.gates && firm.settings.gates[type]);
  const choices = Object.entries(GATE_CHOICES).filter(([k]) => PIPELINES[type].some((s) => (s.gate || []).includes(k)) || ['handover', 'kyc', 'screening'].includes(k) || k.startsWith('doc:'));
  return `<div class="bp-viewbar">${DEAL_TYPES.map((t) => `<button type="button" class="bp-pill ${t === type ? 'is-active' : ''}" data-act="settingsPipeline" data-type="${esc(t)}">${esc(t)}</button>`).join('')}
    ${overridden ? `<button type="button" class="slds-button slds-button_text-destructive" data-act="resetGates" data-type="${esc(type)}">Reset ${esc(type)} to default</button>` : ''}</div>
    ${help('Choose what must be true before a deal can enter each stage, and after how many days a deal counts as stuck. KYC and screening are locked on by regulation.')}
    <div class="bp-grid">${stages.map((st, i) => i === 0 ? '' : `<form class="slds-card bp-card slds-p-around_medium bp-gate-editor" data-submit="saveGate"><input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="stage" value="${esc(st.id)}">
      <div class="bp-gate-editor-head"><b>To enter ${esc(st.label)}</b><div class="bp-tool">${field(`sd-${st.id}`, 'Stuck after (days)', { type: 'number', value: st.stuckDays || '', name: 'stuckDays', attrs: 'min="1" max="120"' })}</div></div>
      <div class="bp-gate-choices">${choices.map(([k, label]) => {
        const locked = LOCKED_GATES.includes(k) && (PIPELINES[type].find((s) => s.id === st.id)?.gate || []).includes(k);
        return `<div class="slds-checkbox"><input type="checkbox" id="g-${st.id}-${k}" name="g:${k}" ${(st.gate || []).includes(k) ? 'checked' : ''} ${locked ? 'disabled' : ''}><label class="slds-checkbox__label" for="g-${st.id}-${k}"><span class="slds-checkbox_faux"></span><span class="slds-form-element__label">${esc(label)}${locked ? ' 🔒' : ''}</span></label></div>`;
      }).join('')}</div>
      <button type="submit" class="slds-button slds-button_neutral slds-m-top_small">Save gate</button></form>`).join('')}</div>`;
}

function commission(firm) {
  return card('Commission defaults for new deals', `${help('Used when a lead is converted. Finance can still change the terms on a single deal.')}
    <div class="bp-grid bp-cols-3">${DEAL_TYPES.map((t) => {
      const r = { ...COMMISSION_RULES[t], ...(firm.settings.commission[t] || {}) };
      return `<form class="slds-card bp-card slds-p-around_medium" data-submit="saveCommissionDefaults"><input type="hidden" name="type" value="${esc(t)}"><b>${esc(t)}</b> <span class="bp-small bp-muted">paid by the ${esc(r.payer.toLowerCase())}</span>
        ${field(`cm-r-${t}`, 'Rate (%)', { type: 'number', value: r.rate, name: 'rate', attrs: 'step="0.25" min="0.25" max="10"' })}
        ${field(`cm-a-${t}`, "Agent's share (%)", { type: 'number', value: r.agentShare, name: 'agentShare', attrs: 'min="0" max="100"' })}
        <button type="submit" class="slds-button slds-button_neutral">Save</button></form>`;
    }).join('')}</div>`, { icon: 'currency' });
}

function templates(firm) {
  const own = firm.settings.templates || {};
  return `${help('Approved templates for WhatsApp and email. Placeholders: {first} {agent} {firm} {interest} {when} {unit} {price}.')}
    <div class="bp-grid">${MESSAGE_TEMPLATES.map((t) => {
      const v = { ...t, ...(own[t.id] || {}) };
      return `<form class="slds-card bp-card slds-p-around_medium" data-submit="saveTemplate"><input type="hidden" name="id" value="${esc(t.id)}">
        <div class="bp-gate-editor-head"><b>${esc(t.name)}</b>${checkbox(`tp-on-${t.id}`, 'In use', { checked: v.enabled !== false, name: 'enabled' })}</div>
        <div class="bp-grid bp-cols-2">${textarea(`tp-en-${t.id}`, 'English', { value: v.en, name: 'en', attrs: 'rows="3"' })}${textarea(`tp-ar-${t.id}`, 'Arabic', { value: v.ar, name: 'ar', attrs: 'rows="3" dir="rtl" lang="ar"' })}</div>
        <button type="submit" class="slds-button slds-button_neutral">Save template</button></form>`;
    }).join('')}</div>`;
}

function integrations(firm) {
  const on = firm.settings.integrations || {};
  const marketing = PLANS[firm.plan].marketing;
  return card('Integrations', `${help('Demo: switching an integration on simulates the connection. In Salesforce these are Named Credentials and platform events.')}
    <ul class="bp-list">${INTEGRATIONS.map((i) => `<li><span style="flex:1"><b>${esc(i.label)}</b> <span class="bp-small bp-muted">${esc(i.kind)}</span><div class="bp-small bp-muted">${esc(i.detail)}</div></span>
      ${i.plan === 'marketing' && !marketing ? badge('Option B', 'light') : toggle(on[i.key] ? 'Connected' : 'Off', !!on[i.key], 'toggleIntegration', { attrs: `data-key="${esc(i.key)}"` })}</li>`).join('')}</ul>`, { icon: 'connected_apps' });
}

function plan(firm) {
  const p = PLANS[firm.plan];
  const req = firm.planRequest;
  return `<div class="bp-grid bp-cols-2">${card('Current plan', `<p><b>${esc(p.label)}</b></p><p class="bp-small bp-muted">${esc(p.detail)}</p>
      <dl class="bp-kv bp-kv-narrow slds-m-top_small"><dt>Seats</dt><dd>${seatsUsed(firm.id)} used of ${firm.seats}</dd><dt>Status</dt><dd>${esc(firm.status)}${firm.trialEndsAt ? ` · trial ends ${fmtDate(firm.trialEndsAt)}` : ''}</dd></dl>`, { icon: 'product_consumed' })}
    ${card('Change plan or seats', `${req ? `<div class="slds-m-bottom_small">${alertBox('info', `Requested ${esc(PLANS[req.plan].label)}, ${req.seats} seats on ${fmtDate(req.at)}. ThinkVibes will confirm.`)}</div>` : ''}
      <form data-submit="requestPlan">${select('plPlan', 'Plan', [['A', PLANS.A.label], ['B', PLANS.B.label]], { value: firm.plan === 'Trial' ? 'B' : firm.plan, name: 'plan' })}
      ${field('plSeats', 'Seats', { type: 'number', value: firm.seats, name: 'seats', attrs: `min="${seatsUsed(firm.id)}" max="500"` })}${textarea('plNote', 'Note (optional)', { name: 'note', attrs: 'rows="2"' })}
      <button type="submit" class="slds-button slds-button_brand">Send request</button></form>`, { icon: 'orders' })}</div>`;
}

export function bpFirmSettings(user, params = []) {
  const firm = firmOf(user);
  const tab = TABS.some(([k]) => k === params[0]) ? params[0] : 'general';
  const type = DEAL_TYPES.includes(params[1]) ? params[1] : 'Off-plan';
  const body = { general: () => general(firm), routing: () => routing(firm, user), pipelines: () => pipelines(firm, type), commission: () => commission(firm), templates: () => templates(firm), integrations: () => integrations(firm), plan: () => plan(firm) }[tab]();
  return `<div class="bp-page-title"><div><h1>Firm settings</h1><p class="bp-muted bp-small">Rules take effect straight away, for everyone in ${esc(firm.name)}. Every change is in the audit log.</p></div></div>
    <div class="slds-tabs_default bp-tabs"><ul class="slds-tabs_default__nav" role="tablist">${TABS.map(([k, label]) => `<li class="slds-tabs_default__item ${k === tab ? 'slds-is-active' : ''}" role="presentation"><a class="slds-tabs_default__link" role="tab" aria-selected="${k === tab}" href="portal/#/settings/${k}">${esc(label)}</a></li>`).join('')}</ul></div>
    <div class="bp-tab-body">${body}</div>`;
}

export const settingsActions = (getActor, refresh) => ({
  saveSla(form) { const f = readForm(form); saveRules(getActor(), { firstResponseMin: Number(f.firstResponseMin), reassignAfterMin: Number(f.reassignAfterMin) }); toast('success', 'SLAs saved', 'New leads use the new timer.'); },
  saveHours(form) { const f = readForm(form); saveCallWindow(getActor(), f); toast('success', 'Calling hours saved'); },
  saveRouting(form) {
    const f = readForm(form);
    const routing = Object.fromEntries(firmOf(getActor()).settings.routing.filter((r) => !r.hard).map((r) => [r.id, !!f[r.id]]));
    saveRules(getActor(), { firstResponseMin: Number(f.firstResponseMin), reassignAfterMin: Number(f.reassignAfterMin), routing });
    toast('success', 'Routing saved', 'The next lead uses these rules.');
  },
  routingMove(el) { moveRoutingRule(getActor(), el.dataset.id, el.dataset.dir); },
  settingsPipeline(el) { location.hash = `#/settings/pipelines/${el.dataset.type}`; },
  saveGate(form) {
    const f = readForm(form);
    const locked = (PIPELINES[f.type].find((s) => s.id === f.stage)?.gate || []).filter((g) => LOCKED_GATES.includes(g));
    const gate = [...new Set([...locked, ...Object.keys(f).filter((k) => k.startsWith('g:') && f[k]).map((k) => k.slice(2))])];
    saveGates(getActor(), f.type, f.stage, { gate, stuckDays: f.stuckDays });
    toast('success', 'Gate saved', 'Deals are checked against it from now on.');
  },
  resetGates(el) { resetGates(getActor(), el.dataset.type); toast('success', 'Pipeline reset to default'); },
  saveCommissionDefaults(form) { const f = readForm(form); saveCommissionDefaults(getActor(), f.type, f); toast('success', `${f.type} defaults saved`); },
  saveTemplate(form) { const f = readForm(form); saveTemplate(getActor(), f.id, { en: f.en, ar: f.ar, enabled: !!f.enabled }); toast('success', 'Template saved'); },
  toggleIntegration(el) { setIntegration(getActor(), el.dataset.key, el.checked); toast('success', el.checked ? 'Connected' : 'Disconnected'); },
  requestPlan(form) { const f = readForm(form); requestPlanChange(getActor(), f); toast('success', 'Request sent', 'ThinkVibes will confirm the change.'); },
});

export const _getState = getState;
