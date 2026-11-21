// P5 Pipeline board: one board per deal type, drag and drop (plus a keyboard "Move" menu), value per stage,
// stuck and at-risk flags from the Deal Coach, and a blocked drop that explains exactly what is missing.
// LWC equivalent: c-bp-pipeline-board composed of c-bp-stage-column and c-bp-deal-card; gates checked by
// BP_DealService.moveCheck before the drop is accepted.
// Acceptance: a blocked drag explains exactly what is missing.

import { uIcon, avatar, emptyState, openModal, select, field, readForm, toast, badge } from '../core/ui.js';
import { esc, fmtCompact, fmtAED, DAY } from '../core/util.js';
import { now, tabSession, getState } from '../core/store.js';
import { DEAL_TYPES } from '../core/config.js';
import { stagesFor, stageIndex, stageLabel, dealRisks, nextGate } from '../core/rules.js';
import { visibleDeals, getDeal, moveCheck, moveStage, canWorkDeal } from '../services/dealService.js';
import { firmOf } from '../services/firmService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';

const MANAGERS = ['Owner', 'Director', 'Team Leader'];
const DEFAULT = { type: '', owner: '', risk: false };
const state = () => ({ ...DEFAULT, ...tabSession.get('board', {}) });
const setState = (patch) => tabSession.set('board', { ...state(), ...patch });

function dealCard(user, d, t, brand) {
  const risks = dealRisks(d, t);
  const ng = nextGate(d);
  const done = ng.items.filter((i) => i.ok).length;
  const days = Math.floor((t - d.stageChangedAt) / DAY);
  const owner = getState().users.find((u) => u.id === d.ownerId);
  const movable = canWorkDeal(user, d) && !['Won', 'Lost'].includes(d.stage);
  return `<article class="bp-kcard bp-deal ${risks.length ? 'is-risk' : ''}" ${movable ? `draggable="true" data-drag-deal="${esc(d.id)}"` : ''} aria-label="${esc(d.clientName)}, ${esc(stageLabel(d.type, d.stage))}">
    <div class="bp-kcard-top"><a class="bp-link" href="portal/#/deal/${esc(d.id)}"><b>${esc(d.clientName)}</b></a><span class="bp-deal-val">${fmtCompact(d.value)}</span></div>
    <div class="bp-small bp-muted">${esc(d.unit.ref)}</div>
    ${ng.stage && d.stage !== 'Lost' ? `<div class="bp-gate-mini" title="${esc(ng.items.map((i) => `${i.ok ? '✓' : '✗'} ${i.text}`).join('\n'))}"><span class="bp-gate-bar"><span style="width:${ng.items.length ? Math.round((done / ng.items.length) * 100) : 100}%"></span></span><span class="bp-small">${done}/${ng.items.length} for ${esc(ng.stage.label)}</span></div>` : ''}
    ${risks.length ? `<div class="bp-small bp-risk" title="${esc(risks.join('\n'))}">${uIcon('warning', 'slds-icon_xx-small')} ${esc(risks[0])}</div>` : ''}
    <div class="bp-kcard-foot">${owner ? `${avatar(owner.name, brand, 20)} <span class="bp-small">${esc(owner.name.split(' ')[0])}</span>` : ''}<span class="bp-small bp-muted">${days}d in stage</span>
      ${d.coBroke ? '<span class="bp-flag nc" title="Co-broking">Co-broke</span>' : ''}
      ${movable ? `<button type="button" class="slds-button slds-button_icon bp-move-btn" title="Move" aria-label="Move ${esc(d.clientName)} to another stage" data-act="openMoveDeal" data-id="${esc(d.id)}">${uIcon('move', 'slds-icon_xx-small')}</button>` : ''}</div>
  </article>`;
}

export function bpPipelineBoard(user) {
  const t = now();
  const firm = firmOf(user);
  const f = state();
  const all = visibleDeals(user);
  const typesInUse = DEAL_TYPES.filter((ty) => all.some((d) => d.type === ty));
  const type = DEAL_TYPES.includes(f.type) ? f.type : typesInUse[0] || DEAL_TYPES[0];
  const deals = all.filter((d) => d.type === type && (!f.owner || d.ownerId === f.owner) && (!f.risk || dealRisks(d, t).length));
  const stages = [...stagesFor(type), { id: 'Lost', label: 'Lost' }];
  const owners = MANAGERS.includes(user.role) || user.role === 'Compliance' ? getState().users.filter((u) => all.some((d) => d.ownerId === u.id)) : [];
  const open = deals.filter((d) => !['Won', 'Lost'].includes(d.stage));
  const atRisk = open.filter((d) => dealRisks(d, t).length).length;

  const tabsHtml = `<div class="bp-viewbar" role="tablist" aria-label="Deal type">${DEAL_TYPES.map((ty) => {
    const n = all.filter((d) => d.type === ty && !['Won', 'Lost'].includes(d.stage)).length;
    return `<button type="button" role="tab" aria-selected="${ty === type}" class="bp-pill ${ty === type ? 'is-active' : ''}" data-act="boardType" data-type="${esc(ty)}">${esc(ty)} <span class="bp-pill-n">${n}</span></button>`;
  }).join('')}</div>`;

  const toolbar = `<div class="bp-toolbar">
    ${owners.length ? `<div class="bp-tool">${select('board-owner', 'Owner', [['', 'Everyone'], ...owners.map((u) => [u.id, u.name])], { value: f.owner, attrs: 'data-act="boardOwner"' })}</div>` : ''}
    <div class="bp-tool bp-tool-check"><div class="slds-checkbox"><input type="checkbox" id="board-risk" ${f.risk ? 'checked' : ''} data-act="boardRisk"><label class="slds-checkbox__label" for="board-risk"><span class="slds-checkbox_faux"></span><span class="slds-form-element__label">At risk only</span></label></div></div>
    <div class="bp-board-sum"><span><b>${open.length}</b> open</span><span><b>${fmtAED(open.reduce((n, d) => n + d.value, 0))}</b> in pipeline</span><span class="${atRisk ? 'bp-risk' : ''}"><b>${atRisk}</b> at risk</span></div>
  </div>`;

  const cols = stages.map((st) => {
    const items = deals.filter((d) => d.stage === st.id).sort((a, b) => dealRisks(b, t).length - dealRisks(a, t).length || b.value - a.value);
    const total = items.reduce((n, d) => n + d.value, 0);
    const gate = (st.gate || []).length ? `<div class="bp-col-gate" title="To enter: ${esc((st.gate || []).join(', '))}">${uIcon('lock', 'slds-icon_xx-small')} gated</div>` : '';
    return `<section class="bp-col ${st.id === 'Lost' ? 'bp-col-lost' : st.id === 'Won' ? 'bp-col-won' : ''}" data-drop-stage="${esc(st.id)}" aria-label="${esc(st.label)}: ${items.length} deals">
      <header class="bp-col-head"><b>${esc(st.label)}</b><span class="bp-col-n">${items.length}</span>${gate}<div class="bp-col-val">${fmtAED(total)}</div></header>
      <div class="bp-col-body">${items.map((d) => dealCard(user, d, t, firm.brand)).join('') || '<div class="bp-col-empty">Drop a deal here</div>'}</div></section>`;
  }).join('');

  return `<div class="bp-page-title"><div><h1>Pipeline</h1><p class="bp-muted bp-small">Drag a deal to move it. Gated stages check documents, KYC and payments first.</p></div></div>
    ${tabsHtml}<div class="slds-card bp-card">${toolbar}${deals.length || all.length ? `<div class="bp-board bp-deal-board" style="--cols:${stages.length}">${cols}</div>` : emptyState('No deals yet', 'Convert a qualified lead to start a deal.')}</div>
    <p class="bp-small bp-muted slds-m-top_small">${uIcon('sparkles', 'slds-icon_xx-small')} Deal Coach flags deals that are stuck, overdue or missing a step. Keyboard: use the ${uIcon('move', 'slds-icon_xx-small')} button on a card to move it.</p>`;
}

/* ---------- moving ---------- */

/** Shows exactly what blocks the move, grouped by stage, with a link to the deal room tab that fixes each item. */
export function showBlocked(deal, toStage, problems) {
  const groups = {};
  problems.forEach((p) => { (groups[p.stage || 'Rules'] = groups[p.stage || 'Rules'] || []).push(p); });
  openModal(`Can't move to ${esc(stageLabel(deal.type, toStage))} yet`, `<p class="slds-m-bottom_small"><b>${esc(deal.clientName)}</b> (${esc(deal.id)}) is in ${esc(stageLabel(deal.type, deal.stage))}. Before it can move:</p>
    ${Object.entries(groups).map(([stage, items]) => `<div class="bp-blocked-group"><div class="bp-small bp-muted">${esc(stage === 'Rules' ? 'Rules' : `To enter ${stage}`)}</div>
      <ul class="bp-blocked">${items.map((p) => `<li>${uIcon('close', 'slds-icon_xx-small')}<span>${esc(p.text)}</span>${p.tab ? `<a class="bp-link bp-small" href="portal/#/deal/${esc(deal.id)}/${esc(p.tab)}">Fix in ${esc(p.tab)} →</a>` : ''}</li>`).join('')}</ul></div>`).join('')}`,
  `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Close</button><a class="slds-button slds-button_brand" href="portal/#/deal/${esc(deal.id)}/${esc(problems.find((p) => p.tab)?.tab || 'overview')}">Open deal room</a>`);
}

function openLostDeal(deal) {
  openModal(`Mark ${esc(deal.clientName)}'s deal lost`, modalForm('dl-form', 'submitDealLost', `<input type="hidden" name="dealId" value="${esc(deal.id)}">
    ${select('dlReason', 'Reason', [['', 'Choose…'], 'Client bought elsewhere', 'Finance not approved', 'Seller withdrew', 'Price disagreement', 'Client stopped responding'], { required: true, name: 'reason' })}`),
  modalFooter('dl-form', 'Mark lost', { variant: 'destructive' }));
}

/** Validates then moves; blocked → explanation modal; Lost → reason modal. Shared by drag, menu and deal room. */
export function tryMove(actor, dealId, toStage) {
  const deal = getDeal(actor, dealId);
  if (!deal || deal.stage === toStage) return;
  if (toStage === 'Lost') {
    const rules = moveCheck(actor, deal, 'Lost');
    if (rules.length) { showBlocked(deal, toStage, rules); return; }
    openLostDeal(deal);
    return;
  }
  const problems = moveCheck(actor, deal, toStage);
  if (problems.length) { showBlocked(deal, toStage, problems); return; }
  const moved = moveStage(actor, dealId, toStage);
  toast('success', `Moved to ${stageLabel(moved.type, toStage)}`, `${esc(moved.clientName)} · ${fmtAED(moved.value)}${toStage === 'Won' ? ' · commission invoiced' : ''}`);
}

function openMoveMenu(actor, deal) {
  const options = [...stagesFor(deal.type), { id: 'Lost', label: 'Lost' }].filter((s) => s.id !== deal.stage);
  openModal(`Move ${esc(deal.clientName)}`, modalForm('mv-form', 'submitMoveDeal', `<input type="hidden" name="dealId" value="${esc(deal.id)}">
    ${select('mvTo', 'Move to', options.map((s) => [s.id, `${s.label}${stageIndex(deal.type, s.id) < stageIndex(deal.type, deal.stage) && s.id !== 'Lost' ? ' (back)' : ''}`]), { name: 'to' })}
    <p class="bp-small bp-muted">Gates are checked before the move.</p>`), modalFooter('mv-form', 'Move'));
}

export const boardActions = (getActor, refresh) => ({
  boardType(el) { setState({ type: el.dataset.type }); refresh(); },
  boardOwner(el) { setState({ owner: el.value }); refresh(); },
  boardRisk(el) { setState({ risk: el.checked }); refresh(); },
  openMoveDeal(el) { const d = getDeal(getActor(), el.dataset.id); if (d) openMoveMenu(getActor(), d); },
  submitMoveDeal(form) {
    const f = readForm(form);
    document.getElementById('modal-root').innerHTML = '';
    tryMove(getActor(), f.dealId, f.to);
  },
  submitDealLost(form) {
    const f = readForm(form);
    submitModal(() => moveStage(getActor(), f.dealId, 'Lost', { lostReason: f.reason }), { title: 'Deal marked lost' });
  },
  moveDealTo(el) { tryMove(getActor(), el.dataset.id, el.dataset.to); },
});

/** Native drag and drop for the board; wired once by the portal app. */
export function wireBoardDragAndDrop(getActor) {
  let dragging = null;
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest && e.target.closest('[data-drag-deal]');
    if (!card) return;
    dragging = card.dataset.dragDeal;
    e.dataTransfer.setData('text/plain', dragging);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  document.addEventListener('dragend', (e) => {
    document.querySelectorAll('.is-dragging, .is-over').forEach((el) => el.classList.remove('is-dragging', 'is-over'));
    dragging = null;
  });
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest && e.target.closest('[data-drop-stage]');
    if (!col || !dragging) return;
    e.preventDefault();
    document.querySelectorAll('.is-over').forEach((el) => el !== col && el.classList.remove('is-over'));
    col.classList.add('is-over');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest && e.target.closest('[data-drop-stage]');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragging;
    col.classList.remove('is-over');
    if (!id) return;
    try {
      tryMove(getActor(), id, col.dataset.dropStage);
    } catch (err) {
      toast('error', 'Could not move the deal', esc(err.messages ? err.messages.join(' ') : err.message));
    }
  });
}
