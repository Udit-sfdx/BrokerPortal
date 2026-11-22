// P7 Inventory: projects with availability, units and listings with filters, unit matching for a lead,
// hold / release, and price and status edits for the owner and directors.
// LWC equivalent: c-bp-inventory-browser composed of c-bp-project-card, c-bp-unit-table, c-bp-unit-match.
// Acceptance: an agent can send a matching unit to a client in two clicks (Send → Send WhatsApp).

import { card, uIcon, badge, emptyState, openModal, select, field, readForm, toast } from '../core/ui.js';
import { esc, fmtAED, fmtCompact } from '../core/util.js';
import { tabSession, now } from '../core/store.js';
import { BEDROOMS, UNIT_STATUSES } from '../core/config.js';
import { visibleProjects, visibleUnits, getUnit, matchesForLead, unitLabel, unitPriceText, holdUnit, releaseUnit, updateUnit, canEditInventory } from '../services/inventoryService.js';
import { visibleLeads, isOpenLead, getLead, canWorkLead } from '../services/leadService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';
import { openComposer } from './bpMessageComposer.js';
import { barChart } from './bpChart.js';

const DEFAULT = { project: '', kind: '', beds: '', status: 'Available', maxPrice: '', lead: '', limit: 30 };
const state = () => ({ ...DEFAULT, ...tabSession.get('inv', {}) });
const setState = (p) => tabSession.set('inv', { ...state(), ...p });
const STATUS_THEME = { Available: 'success', Reserved: 'warning', Sold: 'light' };

/** Matching units for a lead, with a two-click Send. Reused on the lead workspace. */
export function matchList(user, lead, { compact = false } = {}) {
  const matches = matchesForLead(user, lead.id, compact ? 3 : 6);
  const projects = visibleProjects(user);
  if (!matches.length) return `<div class="bp-empty">No available unit fits ${esc(lead.name.split(' ')[0])}'s needs yet${lead.budgetMax ? ` (budget ${fmtAED(lead.budgetMax)})` : ''}.</div>`;
  const canSend = canWorkLead(user, lead) && isOpenLead(lead);
  return `<ul class="bp-matches">${matches.map((m) => `<li>
    <div class="bp-match-main"><b>${esc(unitLabel(m.unit, projects))}</b><div class="bp-small bp-muted">${unitPriceText(m.unit)} · ${m.unit.sizeSqft} sqft · ${esc(m.unit.view)} view</div>
      <div class="bp-small bp-match-why">${m.reasons.map((r) => `<span>${uIcon('check', 'slds-icon_xx-small')} ${esc(r)}</span>`).join('')}</div></div>
    <span class="bp-match-score" title="Match score">${Math.min(100, m.score)}</span>
    ${canSend ? `<div class="bp-match-act"><button type="button" class="slds-button slds-button_brand" data-act="sendUnit" data-lead="${esc(lead.id)}" data-unit="${esc(m.unit.id)}">Send</button>
      <button type="button" class="slds-button slds-button_neutral" data-act="holdUnitFor" data-lead="${esc(lead.id)}" data-unit="${esc(m.unit.id)}">Hold</button></div>` : ''}
  </li>`).join('')}</ul>`;
}

function projectCards(user, projects, units) {
  if (!projects.length) return '';
  return `<div class="bp-grid bp-cols-3">${projects.map((p) => {
    const mine = units.filter((u) => u.projectId === p.id);
    const avail = mine.filter((u) => u.status === 'Available');
    const pct = mine.length ? Math.round((mine.filter((u) => u.status === 'Sold').length / mine.length) * 100) : 0;
    return `<div class="slds-card bp-card bp-project"><div class="bp-project-head"><b>${esc(p.name)}</b><span class="bp-small bp-muted">${esc(p.developer)} · ${esc(p.area)}</span></div>
      <div class="bp-project-stats"><span><b>${avail.length}</b> available</span><span><b>${pct}%</b> sold</span><span>from <b>${fmtCompact(Math.min(...avail.map((u) => u.price), Infinity) === Infinity ? 0 : Math.min(...avail.map((u) => u.price)))}</b></span></div>
      <div class="bp-avail-bar" aria-label="${pct}% sold"><span style="width:${pct}%"></span><span class="res" style="width:${mine.length ? Math.round((mine.filter((u) => u.status === 'Reserved').length / mine.length) * 100) : 0}%"></span></div>
      <div class="bp-small slds-m-top_x-small">Handover ${esc(p.handover)} · plan ${esc(p.plan)}${p.offer ? ` · <span class="bp-offer">${esc(p.offer)}</span>` : ''}</div>
      <button type="button" class="slds-button slds-button_neutral slds-m-top_x-small" data-act="invFilter" data-key="project" data-value="${esc(p.id)}">Show units</button></div>`;
  }).join('')}</div>`;
}

export function bpInventoryBrowser(user, params = []) {
  const f = state();
  const projects = visibleProjects(user);
  const all = visibleUnits(user);
  const unitFocus = params[0] === 'unit' ? getUnit(user, params[1]) : null;
  const units = all.filter((u) => (!f.project || u.projectId === f.project) && (!f.kind || u.kind === f.kind) && (!f.beds || u.beds === f.beds)
    && (!f.status || u.status === f.status) && (!f.maxPrice || u.price <= Number(f.maxPrice))).sort((a, b) => a.price - b.price);
  const kinds = [...new Set(all.map((u) => u.kind))];
  const myLeads = visibleLeads(user).filter((l) => isOpenLead(l) && (user.role !== 'Agent' || l.ownerId === user.id)).sort((a, b) => b.score - a.score).slice(0, 60);
  const focusLead = f.lead ? getLead(user, f.lead) : null;
  const editor = canEditInventory(user);
  const sel = (id, label, opts, value, key) => `<div class="bp-tool">${select(id, label, opts, { value, attrs: `data-act="invFilter" data-key="${key}"` })}</div>`;
  const byStatus = UNIT_STATUSES.map((st) => ({ label: st, value: all.filter((u) => u.status === st).length, tone: st === 'Available' ? 'good' : st === 'Reserved' ? 'warn' : '' }));

  const matchCard = card('Match a lead', `${select('inv-lead', 'Lead', [['', 'Choose one of your leads…'], ...myLeads.map((l) => [l.id, `${l.name} · ${l.interest}`])], { value: f.lead, attrs: 'data-act="invFilter" data-key="lead"' })}
    ${focusLead ? matchList(user, focusLead) : '<p class="bp-small bp-muted">Pick a lead to see the units that fit their bedrooms, budget and area. Send opens a WhatsApp with the unit filled in.</p>'}`, { icon: 'goals' });

  const table = units.length ? `<div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer bp-unit-table"><thead><tr>
      <th>Unit</th><th>Type</th><th>Size</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>
      ${units.slice(0, f.limit).map((u) => `<tr class="${unitFocus && unitFocus.id === u.id ? 'bp-row-focus' : ''}"><td><b>${esc(u.ref)}</b><div class="bp-small bp-muted">${esc(projects.find((p) => p.id === u.projectId)?.name || u.area)}${u.listingNo ? ` · ${esc(u.listingNo)}` : ''}</div></td>
        <td class="bp-small">${esc(u.kind)} · ${u.beds === 'Studio' ? 'Studio' : `${esc(u.beds)}BR`}</td><td class="bp-small">${u.sizeSqft} sqft</td><td>${unitPriceText(u)}</td>
        <td>${badge(u.status, STATUS_THEME[u.status])}${u.reservedBy ? `<div class="bp-small bp-muted">by ${esc(u.reservedBy)}</div>` : ''}</td>
        <td class="bp-row-actions">${u.status === 'Reserved' ? `<button type="button" class="slds-button slds-button_neutral" data-act="releaseUnit" data-id="${esc(u.id)}">Release</button>` : ''}
          ${editor ? `<button type="button" class="slds-button slds-button_neutral" data-act="editUnitOpen" data-id="${esc(u.id)}">Edit</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${units.length > f.limit ? `<div class="slds-p-around_small" style="text-align:center"><button type="button" class="slds-button slds-button_neutral" data-act="invMore">Show more (${units.length - f.limit} left)</button></div>` : ''}`
    : emptyState('No units match', 'Clear a filter to see more.');

  return `<div class="bp-page-title"><div><h1>Inventory</h1><p class="bp-muted bp-small">${all.length} units and listings · shared with your firm only</p></div></div>
    ${projectCards(user, projects, all)}
    <div class="bp-grid bp-cols-2 slds-m-top_medium" style="grid-template-columns:2fr 1fr">
      <div class="slds-card bp-card"><div class="bp-toolbar">
        ${projects.length ? sel('inv-project', 'Project', [['', 'All projects'], ...projects.map((p) => [p.id, p.name])], f.project, 'project') : ''}
        ${kinds.length > 1 ? sel('inv-kind', 'Type', [['', 'All'], ...kinds], f.kind, 'kind') : ''}
        ${sel('inv-beds', 'Bedrooms', [['', 'Any'], ...BEDROOMS], f.beds, 'beds')}
        ${sel('inv-status', 'Status', [['', 'Any'], ...UNIT_STATUSES], f.status, 'status')}
        <div class="bp-tool">${field('inv-max', 'Max price (AED)', { type: 'number', value: f.maxPrice, attrs: 'data-act="invFilter" data-key="maxPrice" min="0" step="50000"' })}</div>
      </div>${table}</div>
      <div class="bp-grid">${matchCard}${card('Availability', barChart(byStatus, { label: 'Units by status' }), { icon: 'chart' })}</div>
    </div>`;
}

export const inventoryActions = (getActor, refresh) => ({
  invFilter(el) { setState({ [el.dataset.key]: el.dataset.value ?? el.value, limit: 30 }); refresh(); },
  invMore() { setState({ limit: state().limit + 30 }); refresh(); },
  /** Click 1: Send opens the composer pre-filled with the unit. Click 2 is "Send WhatsApp". */
  sendUnit(el) {
    const actor = getActor();
    const lead = getLead(actor, el.dataset.lead);
    const unit = getUnit(actor, el.dataset.unit);
    if (!lead || !unit) return;
    const projects = visibleProjects(actor);
    openComposer(actor, lead, { templateId: 'unit', lang: lead.lang === 'Arabic' ? 'Arabic' : 'English', extra: { unit: unitLabel(unit, projects), price: unitPriceText(unit) } });
  },
  holdUnitFor(el) {
    const u = holdUnit(getActor(), el.dataset.unit, el.dataset.lead);
    toast('success', 'Unit held', `${esc(u.ref)} is reserved for this client.`);
  },
  releaseUnit(el) { releaseUnit(getActor(), el.dataset.id); toast('success', 'Unit released'); },
  editUnitOpen(el) {
    const u = getUnit(getActor(), el.dataset.id);
    openModal(`Edit ${esc(u.ref)}`, modalForm('unit-form', 'submitUnit', `<input type="hidden" name="id" value="${esc(u.id)}">
      ${field('unitPrice', u.kind === 'Rental' ? 'Annual rent (AED)' : 'Price (AED)', { type: 'number', value: u.price, name: 'price', attrs: 'min="1"' })}
      ${select('unitStatus', 'Status', UNIT_STATUSES, { value: u.status, name: 'status' })}<p class="bp-small bp-muted">Changes are logged in the audit trail.</p>`), modalFooter('unit-form', 'Save'));
  },
  submitUnit(form) { const f = readForm(form); submitModal(() => updateUnit(getActor(), f.id, f), { title: 'Unit updated' }); },
});

export const _now = now;
