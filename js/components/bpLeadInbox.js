// P3 Leads inbox: list and board views, preset and saved views, filters, live arrivals,
// bulk assign (managers), score with reasons, DNC and duplicate badges, routing trace on hover.
// LWC equivalent: c-bp-lead-inbox composed of c-bp-view-bar, c-bp-lead-table, c-bp-lead-board, c-bp-bulk-bar.
// Acceptance: new portal leads appear without refresh and are routed in seconds.

import { card, uIcon, avatar, emptyState, openModal, field, readForm, toast, select, alertBox } from '../core/ui.js';
import { esc, fmtAgo, fmtCompact } from '../core/util.js';
import { now, tabSession, getState } from '../core/store.js';
import { LEAD_SOURCES, OPEN_LEAD_STATUSES } from '../core/config.js';
import { slaState } from '../core/rules.js';
import {
  visibleLeads, isOpenLead, assignableUsers, assignLeads, savedViews, saveView, deleteView, simulateArrival, leadOwnerName,
} from '../services/leadService.js';
import { firmOf } from '../services/firmService.js';
import { go } from '../core/app.js';
import { slaTimer, scoreChip, leadFlags, leadStatusBadge, followUpLabel } from './bpLeadBits.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';

const MANAGERS = ['Owner', 'Director', 'Team Leader'];

export const PRESETS = {
  mine: { label: 'My open leads', test: (l, u) => l.ownerId === u.id && isOpenLead(l) },
  new: { label: 'Waiting for first reply', test: (l) => isOpenLead(l) && !l.firstResponseAt },
  hot: { label: 'Hot (70+)', test: (l) => isOpenLead(l) && l.score >= 70 },
  overdue: { label: 'Overdue follow-ups', test: (l, u, t) => isOpenLead(l) && l.nextFollowUpAt && l.nextFollowUpAt < t },
  unassigned: { label: 'Unassigned', managers: true, test: (l) => isOpenLead(l) && !l.ownerId },
  all: { label: 'All open', test: (l) => isOpenLead(l) },
  closed: { label: 'Converted and lost', test: (l) => !isOpenLead(l) },
};

const SORTS = { newest: 'Newest first', sla: 'SLA due first', score: 'Highest score', followup: 'Next follow-up' };
const selection = new Set();
const DEFAULT = { source: '', owner: '', lob: '', q: '', layout: 'list', sort: 'newest', limit: 60 };
const state = () => ({ ...DEFAULT, ...tabSession.get('inbox', {}) });
const setState = (patch) => tabSession.set('inbox', { ...state(), ...patch });

/** Resolves the route into a filter: leads/<preset> or leads/view/<savedViewId>. */
function resolveView(user, params) {
  if (params[0] === 'view') {
    const v = savedViews(user).find((x) => x.id === params[1]);
    if (v) return { preset: v.filter.preset || 'all', saved: v, extra: v.filter };
  }
  const preset = PRESETS[params[0]] && (!PRESETS[params[0]].managers || MANAGERS.includes(user.role)) ? params[0] : user.role === 'Agent' ? 'mine' : 'all';
  return { preset, saved: null, extra: {} };
}

export function filterLeads(user, preset, f, t) {
  const q = String(f.q || '').trim().toLowerCase();
  const list = visibleLeads(user).filter((l) => PRESETS[preset].test(l, user, t)
    && (!f.source || l.source === f.source) && (!f.lob || l.lob === f.lob)
    && (!f.owner || (f.owner === 'none' ? !l.ownerId : l.ownerId === f.owner))
    && (!q || [l.name, l.phone, l.email, l.interest, l.id].some((v) => String(v || '').toLowerCase().includes(q))));
  const sorters = {
    newest: (a, b) => b.createdAt - a.createdAt,
    sla: (a, b) => (a.firstResponseAt ? 1 : 0) - (b.firstResponseAt ? 1 : 0) || a.slaDueAt - b.slaDueAt,
    score: (a, b) => b.score - a.score,
    followup: (a, b) => (a.nextFollowUpAt || Infinity) - (b.nextFollowUpAt || Infinity),
  };
  return list.sort(sorters[f.sort] || sorters.newest);
}

function viewBar(user, active, counts, savedId) {
  const presets = Object.entries(PRESETS).filter(([, p]) => !p.managers || MANAGERS.includes(user.role)).filter(([id]) => !(user.role === 'Agent' && id === 'all'));
  const saved = savedViews(user);
  return `<div class="bp-viewbar" role="tablist" aria-label="Lead views">
    ${presets.map(([id, p]) => `<a role="tab" aria-selected="${id === active && !savedId}" class="bp-pill ${id === active && !savedId ? 'is-active' : ''}" href="portal/#/leads/${id}">${esc(p.label)} <span class="bp-pill-n">${counts[id]}</span></a>`).join('')}
    ${saved.map((v) => `<span class="bp-pill bp-pill-saved ${v.id === savedId ? 'is-active' : ''}"><a href="portal/#/leads/view/${esc(v.id)}">${uIcon('pin', 'slds-icon_xx-small')} ${esc(v.name)}</a><button type="button" class="bp-pill-x" title="Delete view" aria-label="Delete view ${esc(v.name)}" data-act="deleteLeadView" data-id="${esc(v.id)}">×</button></span>`).join('')}
  </div>`;
}

function toolbar(user, f, firm) {
  const owners = MANAGERS.includes(user.role) ? getState().users.filter((u) => u.firmId === user.firmId && ['Agent', 'Team Leader'].includes(u.role) && visibleLeads(user).some((l) => l.ownerId === u.id)) : [];
  const sel = (id, label, opts, value) => `<div class="bp-tool">${select(id, label, opts, { value, attrs: `data-act="inboxFilter" data-key="${id.replace('inbox-', '')}"` })}</div>`;
  return `<div class="bp-toolbar">
    <div class="bp-tool bp-tool-search"><div class="slds-form-element"><label class="slds-form-element__label" for="inbox-q">Search</label>
      <div class="slds-form-element__control slds-input-has-icon slds-input-has-icon_left">${uIcon('search', 'slds-icon slds-input__icon slds-input__icon_left slds-icon-text-default')}
      <input class="slds-input" id="inbox-q" type="search" placeholder="Name, phone, email, unit…" value="${esc(f.q)}" data-act="inboxFilter" data-key="q"></div></div></div>
    ${sel('inbox-source', 'Source', [['', 'All sources'], ...Object.keys(LEAD_SOURCES)], f.source)}
    ${sel('inbox-lob', 'Deal type', [['', 'All types'], 'Off-plan', 'Secondary', 'Rental'], f.lob)}
    ${owners.length ? sel('inbox-owner', 'Owner', [['', 'Everyone'], ['none', 'Unassigned'], ...owners.map((u) => [u.id, u.name])], f.owner) : ''}
    ${sel('inbox-sort', 'Sort', Object.entries(SORTS), f.sort)}
    <div class="bp-tool bp-tool-actions">
      <div class="slds-button-group" role="group" aria-label="Layout">
        <button type="button" class="slds-button ${f.layout === 'list' ? 'slds-button_brand' : 'slds-button_neutral'}" data-act="inboxLayout" data-layout="list" aria-pressed="${f.layout === 'list'}">${uIcon('table', 'slds-icon_x-small')}&nbsp;List</button>
        <button type="button" class="slds-button ${f.layout === 'board' ? 'slds-button_brand' : 'slds-button_neutral'}" data-act="inboxLayout" data-layout="board" aria-pressed="${f.layout === 'board'}">${uIcon('kanban', 'slds-icon_x-small')}&nbsp;Board</button>
      </div>
      <button type="button" class="slds-button slds-button_neutral" data-act="saveLeadView">${uIcon('pin', 'slds-icon_x-small')}&nbsp;Save view</button>
    </div>
  </div>`;
}

function bulkBar(user) {
  if (!MANAGERS.includes(user.role) || !selection.size) return '';
  const people = assignableUsers(user);
  return `<div class="bp-bulk" role="region" aria-label="Bulk actions"><b>${selection.size} selected</b>
    <div class="bp-tool">${select('bulk-owner', 'Assign to', [['', 'Choose…'], ...people.map((u) => [u.id, `${u.name}${u.role === 'Team Leader' ? ' (TL)' : ''}`])], { attrs: 'aria-label="Assign to"' })}</div>
    <button type="button" class="slds-button slds-button_brand" data-act="bulkAssign">Assign</button>
    <button type="button" class="slds-button slds-button_neutral" data-act="clearSelection">Clear</button>
    <span class="bp-small bp-muted">Agents with an expired BRN are not offered.</span></div>`;
}

const arriving = (l, t) => t - l.createdAt < 20000;

function listView(user, leads, t, limit) {
  const manager = MANAGERS.includes(user.role);
  const shown = leads.slice(0, limit);
  const allSel = shown.length && shown.every((l) => selection.has(l.id));
  return `<div class="bp-table-wrap"><table class="slds-table slds-table_cell-buffer slds-table_bordered bp-lead-table" aria-label="Leads">
    <thead><tr class="slds-line-height_reset">
      ${manager ? `<th scope="col" style="width:32px"><div class="slds-checkbox"><input type="checkbox" id="sel-all" ${allSel ? 'checked' : ''} data-act="selectAllLeads" aria-label="Select all shown"><label class="slds-checkbox__label" for="sel-all"><span class="slds-checkbox_faux"></span></label></div></th>` : ''}
      <th scope="col">Lead</th><th scope="col">Score</th><th scope="col">Status</th><th scope="col">Source</th>${manager ? '<th scope="col">Owner</th>' : ''}<th scope="col">First reply / follow-up</th><th scope="col">Arrived</th>
    </tr></thead><tbody>
    ${shown.map((l) => `<tr class="${arriving(l, t) ? 'bp-arrive' : ''}" data-lead-row="${esc(l.id)}">
      ${manager ? `<td><div class="slds-checkbox"><input type="checkbox" id="sel-${esc(l.id)}" ${selection.has(l.id) ? 'checked' : ''} ${isOpenLead(l) ? '' : 'disabled'} data-act="selectLead" data-id="${esc(l.id)}" aria-label="Select ${esc(l.name)}"><label class="slds-checkbox__label" for="sel-${esc(l.id)}"><span class="slds-checkbox_faux"></span></label></div></td>` : ''}
      <td><a class="bp-lead-name" href="portal/#/lead/${esc(l.id)}">${esc(l.name)}</a>${arriving(l, t) ? ' <span class="bp-new-dot">new</span>' : ''}<div class="bp-small bp-muted">${esc(l.interest)}</div><div>${leadFlags(l)}</div></td>
      <td>${scoreChip(l)}</td>
      <td>${leadStatusBadge(l.status)}</td>
      <td class="bp-small">${esc(l.source)}</td>
      ${manager ? `<td class="bp-small"><span class="bp-owner" title="${esc((l.routingTrace || []).join(' → '))}">${l.ownerId ? `${avatar(leadOwnerName(l), firmOf(user).brand, 22)} ${esc(leadOwnerName(l))}` : '<span class="bp-flag dup">Unassigned</span>'}</span></td>` : ''}
      <td>${['running', 'breached'].includes(slaState(l, t).state) ? slaTimer(l, t) : isOpenLead(l) ? followUpLabel(l, t) : `<span class="bp-small bp-muted">${l.status === 'Lost' ? esc(l.lostReason) : esc(l.dealId || '')}</span>`}</td>
      <td class="bp-small bp-muted">${fmtAgo(l.createdAt, t)}</td>
    </tr>`).join('')}</tbody></table></div>
    ${leads.length > limit ? `<div class="slds-m-top_small" style="text-align:center"><button type="button" class="slds-button slds-button_neutral" data-act="inboxMore">Show more (${leads.length - limit} left)</button></div>` : ''}`;
}

function boardView(user, leads, t) {
  const cols = OPEN_LEAD_STATUSES.map((st) => ({ st, items: leads.filter((l) => l.status === st) }));
  return `<div class="bp-board bp-lead-board">${cols.map(({ st, items }) => `<section class="bp-col" aria-label="${esc(st)}">
    <header class="bp-col-head"><b>${esc(st)}</b><span class="bp-col-n">${items.length}</span></header>
    <div class="bp-col-body">${items.slice(0, 40).map((l) => `<a class="bp-kcard ${arriving(l, t) ? 'bp-arrive' : ''}" href="portal/#/lead/${esc(l.id)}">
      <div class="bp-kcard-top"><b>${esc(l.name)}</b>${scoreChip(l)}</div>
      <div class="bp-small bp-muted">${esc(l.interest)}</div>
      <div class="bp-kcard-foot">${['running', 'breached'].includes(slaState(l, t).state) ? slaTimer(l, t, { compact: true }) : followUpLabel(l, t)}${leadFlags(l)}</div>
      ${MANAGERS.includes(user.role) ? `<div class="bp-small bp-muted">${esc(leadOwnerName(l))}</div>` : ''}
    </a>`).join('')}${items.length > 40 ? `<div class="bp-small bp-muted" style="text-align:center">+${items.length - 40} more: use filters</div>` : ''}
    ${items.length ? '' : '<div class="bp-col-empty">None</div>'}</div></section>`).join('')}</div>`;
}

export function bpLeadInbox(user, params) {
  const t = now();
  const firm = firmOf(user);
  const { preset, saved, extra } = resolveView(user, params);
  const f = saved ? { ...state(), ...extra } : state();
  const all = visibleLeads(user);
  const counts = Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, all.filter((l) => p.test(l, user, t)).length]));
  const leads = filterLeads(user, preset, f, t);
  for (const id of [...selection]) if (!leads.some((l) => l.id === id)) selection.delete(id);
  const title = saved ? saved.name : PRESETS[preset].label;
  const header = `<div class="bp-page-title"><div><h1>Leads</h1><p class="bp-muted bp-small">${esc(title)} · ${leads.length} lead${leads.length === 1 ? '' : 's'} · first-reply SLA ${firm.settings.sla.firstResponseMin} min</p></div>
    <div class="bp-page-actions">
      <button type="button" class="slds-button slds-button_neutral" data-act="simulateLead" title="Demo: a new enquiry arrives from a portal or ad">${uIcon('download', 'slds-icon_x-small')}&nbsp;Simulate portal lead</button>
      <button type="button" class="slds-button slds-button_brand" data-act="quickCapture">${uIcon('add', 'slds-icon_x-small')}&nbsp;Quick capture</button>
    </div></div>`;
  const body = leads.length ? (f.layout === 'board' ? boardView(user, leads, t) : listView(user, leads, t, f.limit)) : emptyState('No leads in this view', preset === 'new' ? 'Every lead has had a first reply. Nice.' : 'Try another view or clear the filters.', '<button type="button" class="slds-button slds-button_neutral" data-act="clearInboxFilters">Clear filters</button>');
  const noAgents = MANAGERS.includes(user.role) && !assignableUsers(user).length
    ? `<div class="slds-m-bottom_small">${alertBox('warning', `No agent can receive leads yet, so new leads wait unassigned. ${user.role === 'Owner' ? '<a href="portal/#/people">Invite agents with a valid BRN</a> to start routing.' : 'Ask the owner to invite agents with a valid BRN.'}`)}</div>` : '';
  return `${header}${noAgents}${viewBar(user, preset, counts, saved?.id)}<div class="slds-card bp-card bp-inbox">${toolbar(user, f, firm)}${bulkBar(user)}<div class="bp-inbox-body">${body}</div></div>
    <p class="bp-small bp-muted slds-m-top_small">${uIcon('info', 'slds-icon_xx-small')} Hover a score for the Lead Qualifier's reasons, and an owner for the routing trace. New leads arrive from the portals while this page is open.</p>`;
}

export const inboxActions = (getActor, refresh) => ({
  inboxFilter(el) {
    const key = el.dataset.key;
    setState({ [key]: el.value, limit: DEFAULT.limit });
    refresh();
  },
  inboxLayout(el) { setState({ layout: el.dataset.layout }); refresh(); },
  inboxMore() { setState({ limit: state().limit + 60 }); refresh(); },
  clearInboxFilters() { tabSession.set('inbox', { layout: state().layout }); selection.clear(); refresh(); },
  selectLead(el) { if (el.checked) selection.add(el.dataset.id); else selection.delete(el.dataset.id); refresh(); },
  selectAllLeads(el) {
    document.querySelectorAll('[data-act="selectLead"]:not([disabled])').forEach((cb) => { if (el.checked) selection.add(cb.dataset.id); else selection.delete(cb.dataset.id); });
    refresh();
  },
  clearSelection() { selection.clear(); refresh(); },
  bulkAssign() {
    const to = document.getElementById('bulk-owner')?.value;
    const n = assignLeads(getActor(), [...selection], to);
    const name = getState().users.find((u) => u.id === to)?.name;
    selection.clear();
    toast('success', `${n} lead${n === 1 ? '' : 's'} assigned`, `${esc(name)} has been notified.`);
  },
  saveLeadView() {
    openModal('Save this view', modalForm('view-form', 'submitLeadView', `${field('viewName', 'View name', { required: true, name: 'name', attrs: 'maxlength="40" placeholder="e.g. Hot off-plan from Meta"' })}
      <p class="bp-small bp-muted">Saves the current view, filters and sort. Only you see your saved views.</p>`), modalFooter('view-form', 'Save view'));
  },
  submitLeadView(form) {
    const preset = (location.hash.split('/')[2] && PRESETS[location.hash.split('/')[2]]) ? location.hash.split('/')[2] : 'all';
    const { source, owner, lob, q, sort } = state();
    const view = submitModal(() => saveView(getActor(), readForm(form).name, { preset, source, owner, lob, q, sort }), { title: 'View saved' });
    if (view) go(`leads/view/${view.id}`);
  },
  deleteLeadView(el) {
    deleteView(getActor(), el.dataset.id);
    toast('success', 'View deleted');
    if (location.hash.includes(el.dataset.id)) go('leads');
  },
  simulateLead() {
    const lead = simulateArrival(getActor());
    toast('info', `New lead from ${lead.source}`, `${esc(lead.name)} → ${esc(leadOwnerName(lead))} (${esc(lead.routingTrace[lead.routingTrace.length - 1])}).`);
  },
});
