// P6 Deal room: stage path with the next gate's checklist, Deal Coach, and tabs for documents (Document Reader),
// KYC and screening (Compliance Checker), payments, handover, commission and co-broking.
// LWC equivalent: c-bp-deal-room composed of c-bp-stage-path, c-bp-gate-checklist, c-bp-document-reader,
// c-bp-kyc-panel, c-bp-payment-plan, c-bp-handover-list, c-bp-commission-panel.
// Acceptance: a deal cannot pass a gate with missing documents or KYC.

import { card, uIcon, badge, avatar, emptyState, openModal, field, select, textarea, readForm, toast, alertBox } from '../core/ui.js';
import { esc, fmtAED, fmtDate, fmtDateTime, fmtAgo, toDateInput, parseDateInput, DAY } from '../core/util.js';
import { now, getState } from '../core/store.js';
import { DEAL_DOCUMENTS, KYC_FIELD_LABELS, CASH_REPORT_THRESHOLD, VAT_RATE } from '../core/config.js';
import { stagesFor, stageIndex, stageLabel, nextGate, commissionFor, cashNeedsReport } from '../core/rules.js';
import {
  getDeal, canWorkDeal, canWorkCompliance, canApproveKyc, canManageCommission, uploadDocument, confirmDocument, removeDocument,
  submitKyc, runScreening, clearScreening, verifyKyc, rejectKyc, recordPayment, draftRear, toggleHandover, setCoBroke,
  updateCommission, advanceCommission, PAYMENT_METHODS, kycProblems,
} from '../services/dealService.js';
import { dealCoach } from '../services/aiService.js';
import { firmOf } from '../services/firmService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';
import { tryMove } from './bpPipelineBoard.js';

const TABS = [['overview', 'Overview'], ['documents', 'Documents'], ['kyc', 'KYC and screening'], ['payments', 'Payments'], ['handover', 'Handover'], ['commission', 'Commission']];
const DATE_FIELDS = ['dob', 'passportExpiry', 'eidExpiry'];
const aiTag = (label) => `<span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} ${esc(label)}</span>`;
const ok = (b) => (b ? `<span class="bp-ok">${uIcon('check', 'slds-icon_xx-small')}</span>` : `<span class="bp-no">${uIcon('close', 'slds-icon_xx-small')}</span>`);

/** Documents this deal type needs, in the order its gates ask for them. */
function requiredDocs(type, firmId) {
  const out = [];
  for (const st of stagesFor(type, firmId)) for (const req of st.gate || []) if (req.startsWith('doc:') && !out.some((x) => x.key === req.slice(4))) out.push({ key: req.slice(4), stage: st.label });
  return out;
}

function stagePath(user, deal) {
  const stages = stagesFor(deal.type, deal.firmId);
  const cur = stageIndex(deal.type, deal.stage);
  const canMove = canWorkDeal(user, deal) && !['Won', 'Lost'].includes(deal.stage);
  return `<div class="slds-path bp-path"><div class="slds-grid slds-path__track"><div class="slds-grid slds-path__scroller-container"><div class="slds-path__scroller"><div class="slds-path__scroller_inner">
    <ul class="slds-path__nav" role="listbox" aria-orientation="horizontal" aria-label="Deal stages">
    ${stages.map((st, i) => {
      const cls = deal.stage === 'Lost' ? (i === 0 ? 'slds-is-lost slds-is-current' : 'slds-is-incomplete')
        : deal.stage === 'Won' && i === cur ? 'slds-is-won slds-is-current'
          : i < cur ? 'slds-is-complete' : i === cur ? 'slds-is-current slds-is-active' : 'slds-is-incomplete';
      return `<li class="slds-path__item ${cls}" role="presentation"><a class="slds-path__link" role="option" aria-selected="${i === cur}" ${canMove && i !== cur ? `data-act="moveDealTo" data-id="${esc(deal.id)}" data-to="${esc(st.id)}" title="Move to ${esc(st.label)}"` : ''} tabindex="${canMove && i !== cur ? 0 : -1}">
        <span class="slds-path__stage">${i < cur ? uIcon('check', 'slds-icon_x-small') : ''}</span><span class="slds-path__title">${esc(st.label)}${(st.gate || []).length ? ' 🔒' : ''}</span></a></li>`;
    }).join('')}
    ${deal.stage === 'Lost' ? '<li class="slds-path__item slds-is-lost slds-is-current" role="presentation"><a class="slds-path__link" role="option" aria-selected="true"><span class="slds-path__title">Lost</span></a></li>' : ''}
    </ul></div></div></div></div></div>`;
}

function gatePanel(user, deal, t) {
  if (['Won', 'Lost'].includes(deal.stage)) {
    return `<div class="bp-gatebox closed">${deal.stage === 'Won' ? `${uIcon('success', 'slds-icon_x-small')} Won on ${fmtDate(deal.closedAt)}. Commission: ${esc(deal.commission.status)}.` : `${uIcon('close', 'slds-icon_x-small')} Lost on ${fmtDate(deal.closedAt)}: ${esc(deal.lostReason)}.`}</div>`;
  }
  const ng = nextGate(deal);
  const coach = dealCoach(deal, t);
  const missing = ng.items.filter((i) => !i.ok);
  return `<div class="bp-gatebox">
    <div class="bp-gate-col"><div class="bp-small bp-muted">To move to <b>${esc(ng.stage.label)}</b></div>
      ${ng.items.length ? `<ul class="bp-gate-list">${ng.items.map((i) => `<li>${ok(i.ok)}<span>${esc(i.text)}</span>${!i.ok ? `<a class="bp-link bp-small" href="portal/#/deal/${esc(deal.id)}/${esc(i.tab)}">Go</a>` : ''}</li>`).join('')}</ul>` : '<p class="bp-small">No gate: move when ready.</p>'}
      ${canWorkDeal(user, deal) ? `<button type="button" class="slds-button ${missing.length ? 'slds-button_neutral' : 'slds-button_brand'}" data-act="moveDealTo" data-id="${esc(deal.id)}" data-to="${esc(ng.stage.id)}">Move to ${esc(ng.stage.label)}</button>` : ''}</div>
    <div class="bp-gate-col bp-coach">${aiTag('Deal Coach')}
      ${coach.risks.length ? `<ul class="bp-coach-risks">${coach.risks.map((r) => `<li>${uIcon('warning', 'slds-icon_xx-small')} ${esc(r)}</li>`).join('')}</ul>` : '<p class="bp-small">On track.</p>'}
      ${coach.next ? `<p class="bp-small"><b>Next:</b> ${esc(coach.next.text)} ${coach.next.tab ? `<a class="bp-link" href="portal/#/deal/${esc(deal.id)}/${esc(coach.next.tab)}">Open</a>` : ''}</p>` : ''}
      <p class="bp-small bp-muted">Suggestions only: the gates decide.</p></div>
  </div>`;
}

/* ---------- tabs ---------- */

function overviewTab(user, deal, t) {
  const owner = getState().users.find((u) => u.id === deal.ownerId);
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const hist = [...(deal.activity || []).map((a) => ({ at: a.at, text: a.text, by: a.by })), ...deal.history.map((h) => ({ at: h.at, text: h.from ? `Moved ${stageLabel(deal.type, h.from)} → ${stageLabel(deal.type, h.to)}` : `Deal created in ${stageLabel(deal.type, h.to)}`, by: h.by }))]
    .sort((a, b) => b.at - a.at).filter((h, i, arr) => i === 0 || !(h.text === arr[i - 1].text && Math.abs(h.at - arr[i - 1].at) < 2000));
  return `<div class="bp-grid bp-cols-2e">
    ${card('Client', `<dl class="bp-kv bp-kv-narrow">${row('Name', esc(deal.clientName))}${row('Mobile', esc(deal.clientPhone || '—'))}${row('Email', esc(deal.clientEmail || '—'))}${row('Nationality', esc(deal.nationality || '—'))}
      ${row('From lead', deal.leadId ? `<a class="bp-link" href="portal/#/lead/${esc(deal.leadId)}">${esc(deal.leadId)}</a>` : '—')}</dl>`, { icon: 'person_account' })}
    ${card('Property', `<dl class="bp-kv bp-kv-narrow">${row('Unit', esc(deal.unit.ref))}${deal.unit.project ? row('Project', `${esc(deal.unit.project)}${deal.unit.developer ? ` · ${esc(deal.unit.developer)}` : ''}`) : ''}${row('Area', esc(deal.unit.area || '—'))}
      ${row('Bedrooms', esc(deal.unit.beds || '—'))}${row(deal.type === 'Rental' ? 'Annual rent' : 'Value', fmtAED(deal.value))}${row('Owner', owner ? esc(owner.name) : '—')}${row('Co-broking', deal.coBroke ? `${esc(deal.coBroke.firm)} (${deal.coBroke.splitPct}%)` : 'No')}</dl>`, { icon: 'home' })}
  </div>
  <div class="slds-m-top_medium">${card('History', `<ul class="bp-timeline">${hist.slice(0, 30).map((h) => `<li><span class="bp-tl-icon">${uIcon('record', 'slds-icon_xx-small')}</span><div><div class="bp-tl-text">${esc(h.text)}</div><div class="bp-small bp-muted">${esc(h.by)} · ${fmtAgo(h.at, t)}</div></div></li>`).join('')}</ul>`, { icon: 'feed' })}</div>`;
}

function readerFields(deal, key, doc, editable) {
  const keys = DEAL_DOCUMENTS[key].reader;
  return `<form data-submit="confirmDealDoc" class="bp-reader-form"><input type="hidden" name="dealId" value="${esc(deal.id)}"><input type="hidden" name="key" value="${esc(key)}">
    <div class="slds-grid slds-gutters_x-small slds-wrap">${keys.map((k) => {
      const v = doc.fields[k];
      const isDate = DATE_FIELDS.includes(k);
      const mismatch = k === 'fullName' && v && v !== deal.clientName;
      return `<div class="slds-col slds-size_1-of-2">${field(`rd-${key}-${k}`, KYC_FIELD_LABELS[k], { type: isDate ? 'date' : 'text', value: isDate ? toDateInput(v) : v || '', name: k, attrs: editable ? '' : 'disabled', error: mismatch ? `Client on the deal: ${deal.clientName}` : isDate && v && v < now() && k !== 'dob' ? 'Expired' : '' })}</div>`;
    }).join('')}</div>
    ${editable ? '<div class="bp-form-actions"><button type="submit" class="slds-button slds-button_brand">Confirm fields</button></div>' : ''}</form>`;
}

function documentsTab(user, deal) {
  const editable = canWorkCompliance(user, deal);
  const docs = requiredDocs(deal.type, deal.firmId);
  return card('Documents', `<p class="bp-small bp-muted slds-m-bottom_small">${aiTag('Document Reader')} reads passports and Emirates IDs into the KYC fields; a person confirms every value. Demo: include "mismatch" or "expired" in a file name to see the checks.</p>
    ${docs.map(({ key, stage }) => {
      const doc = deal.documents[key];
      const meta = DEAL_DOCUMENTS[key];
      const status = !doc ? badge('Missing', 'light') : doc.confirmed ? badge('Confirmed', 'success') : badge('Check fields', 'warning');
      const upload = editable ? `<label class="slds-button slds-button_neutral bp-file">${uIcon('upload', 'slds-icon_x-small')}&nbsp;${doc ? 'Replace' : 'Upload'}<input type="file" accept=".pdf,.jpg,.jpeg,.png" data-act="dealUpload" data-id="${esc(deal.id)}" data-key="${esc(key)}" aria-label="Upload ${esc(meta.label)}"></label>` : '';
      return `<div class="bp-doc" id="doc-${esc(key)}"><div class="bp-doc-head">${uIcon('file', 'slds-icon_small')}<div><b>${esc(meta.label)}</b><div class="bp-small bp-muted">Needed for ${esc(stage)}${doc ? ` · ${esc(doc.file)} · ${esc(doc.by)} · ${fmtDate(doc.uploadedAt)}` : ''}</div></div>${status}<span style="margin-left:auto;display:flex;gap:6px">${upload}
        ${doc && editable ? `<button type="button" class="slds-button slds-button_text-destructive" data-act="removeDealDoc" data-id="${esc(deal.id)}" data-key="${esc(key)}">Remove</button>` : ''}</span></div>
        ${doc && meta.reader ? `<div class="bp-doc-body"><div class="bp-doc-thumb">${esc(doc.file)}<br>source image</div>${readerFields(deal, key, doc, editable && !doc.confirmed)}</div>` : ''}
        ${doc && !meta.reader && !doc.confirmed && editable ? `<div class="slds-m-top_small"><form data-submit="confirmDealDoc"><input type="hidden" name="dealId" value="${esc(deal.id)}"><input type="hidden" name="key" value="${esc(key)}"><button type="submit" class="slds-button slds-button_brand">Confirm document</button></form></div>` : ''}
      </div>`;
    }).join('')}`, { icon: 'document' });
}

function kycTab(user, deal) {
  const k = deal.kyc;
  const sc = k.screening;
  const approver = canApproveKyc(user);
  const editable = canWorkCompliance(user, deal);
  const problems = kycProblems(deal);
  const theme = { Verified: 'success', Submitted: 'warning', Rejected: 'error', 'Not started': 'light' }[k.status];
  const fields = Object.entries(KYC_FIELD_LABELS).map(([key, label]) => `<dt>${esc(label)}</dt><dd>${k.fields[key] ? esc(DATE_FIELDS.includes(key) ? fmtDate(k.fields[key]) : k.fields[key]) : '<span class="bp-muted">—</span>'}</dd>`).join('');
  const kycCard = card(`KYC ${badge(k.status, theme)}`, `<dl class="bp-kv bp-kv-narrow">${fields}</dl>
    ${k.status === 'Rejected' ? `<div class="slds-m-top_small">${alertBox('error', `Rejected: ${esc(k.rejectReason)}`)}</div>` : ''}
    ${k.status === 'Verified' ? `<p class="bp-small slds-m-top_small">${uIcon('check', 'slds-icon_xx-small')} Verified by ${esc(k.verifiedBy)} on ${fmtDateTime(k.verifiedAt)}.</p>` : ''}
    ${problems.length && ['Not started', 'Rejected'].includes(k.status) ? `<ul class="bp-gate-list slds-m-top_small">${problems.map((p) => `<li>${ok(false)}<span>${esc(p)}</span></li>`).join('')}</ul>` : ''}
    <div class="bp-form-actions slds-m-top_small">
      ${editable && ['Not started', 'Rejected'].includes(k.status) ? `<button type="button" class="slds-button slds-button_brand" data-act="submitKyc" data-id="${esc(deal.id)}" ${problems.length ? 'disabled' : ''}>Submit to Compliance</button>` : ''}
      ${approver && k.status === 'Submitted' ? `<button type="button" class="slds-button slds-button_success" data-act="verifyKyc" data-id="${esc(deal.id)}">Verify KYC</button><button type="button" class="slds-button slds-button_destructive" data-act="rejectKycOpen" data-id="${esc(deal.id)}">Reject</button>` : ''}
      ${!approver && k.status === 'Submitted' ? '<span class="bp-small bp-muted">Waiting for Compliance to verify.</span>' : ''}
    </div>`, { icon: 'approval' });
  const scTheme = { Clear: 'success', 'Possible match': 'error', 'Not run': 'light' }[sc.status];
  const scCard = card(`Watchlist screening ${badge(sc.status, scTheme)}`, `<p class="bp-small bp-muted">${aiTag('Compliance Checker')} screens the client's name against the demo sanctions and PEP lists.</p>
    ${sc.at ? `<p class="bp-small">Screened "${esc(sc.name || deal.clientName)}" on ${fmtDateTime(sc.at)}.</p>` : ''}
    ${sc.hits && sc.hits.length ? `<table class="slds-table slds-table_bordered slds-m-top_x-small"><thead><tr><th>Listed name</th><th>List</th><th>Match</th></tr></thead><tbody>${sc.hits.map((h) => `<tr><td>${esc(h.name)}</td><td>${esc(h.list)}<div class="bp-small bp-muted">${esc(h.reason)}</div></td><td>${h.pct}%</td></tr>`).join('')}</tbody></table>` : ''}
    ${sc.clearedBy ? `<p class="bp-small slds-m-top_x-small">Cleared as a false positive by ${esc(sc.clearedBy)}: ${esc(sc.clearNote)}</p>` : ''}
    <div class="bp-form-actions slds-m-top_small">
      ${editable ? `<button type="button" class="slds-button slds-button_neutral" data-act="runScreening" data-id="${esc(deal.id)}">${uIcon('search', 'slds-icon_x-small')}&nbsp;${sc.at ? 'Screen again' : 'Run screening'}</button>` : ''}
      ${approver && sc.status === 'Possible match' ? `<button type="button" class="slds-button slds-button_neutral" data-act="clearScreeningOpen" data-id="${esc(deal.id)}">Clear as false positive</button>` : ''}
      ${!approver && sc.status === 'Possible match' ? '<span class="bp-small bp-risk">Compliance must review this match before the deal can continue.</span>' : ''}
    </div>`, { icon: 'disclosure_and_compliance' });
  const cashCard = card('Cash and REAR', `<p class="bp-small">Cash received on this deal: <b>${fmtAED(deal.cashAmount || 0)}</b> (report threshold ${fmtAED(CASH_REPORT_THRESHOLD)}).</p>
    ${cashNeedsReport(deal) ? (deal.rearDrafted ? `<pre class="bp-rear">${esc(deal.rearText || 'REAR draft prepared.')}</pre><p class="bp-small bp-muted">Draft only: the AML officer files it through goAML.</p>`
      : `<div class="slds-m-vertical_small">${alertBox('warning', 'Cash at or above the threshold: a REAR report is needed.')}</div>${editable ? `<button type="button" class="slds-button slds-button_neutral" data-act="draftRear" data-id="${esc(deal.id)}">${uIcon('sparkles', 'slds-icon_x-small')}&nbsp;Draft REAR</button>` : ''}`)
      : '<p class="bp-small bp-muted">No report needed.</p>'}`, { icon: 'report' });
  return `<div class="bp-grid bp-cols-2e">${kycCard}<div class="bp-grid">${scCard}${cashCard}</div></div>`;
}

function paymentsTab(user, deal, t) {
  const editable = canWorkDeal(user, deal) && !['Won', 'Lost'].includes(deal.stage);
  const gated = new Set(stagesFor(deal.type, deal.firmId).flatMap((s) => (s.gate || []).filter((g) => g.startsWith('pay:')).map((g) => g.slice(4))));
  return card('Payment plan', `<div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer"><thead><tr><th>Payment</th><th>%</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${deal.payments.map((p) => {
      const status = p.paidAt ? badge(`Received ${fmtDate(p.paidAt)}`, 'success') : p.dueAt && p.dueAt < t ? badge('Overdue', 'error') : p.dueAt ? badge('Due', 'warning') : badge('Later', 'light');
      return `<tr><td>${esc(p.label)}${gated.has(p.key) ? ' <span class="bp-small bp-muted">(gate)</span>' : ''}${p.method ? `<div class="bp-small bp-muted">${esc(p.method)}</div>` : ''}</td><td>${p.pct}%</td><td>${fmtAED(p.amount)}</td><td>${p.dueAt ? fmtDate(p.dueAt) : '—'}</td><td>${status}</td>
        <td>${!p.paidAt && editable ? `<form class="bp-inline-form" data-submit="recordPayment"><input type="hidden" name="dealId" value="${esc(deal.id)}"><input type="hidden" name="key" value="${esc(p.key)}">
          <select class="slds-select" name="method" aria-label="How ${esc(p.label)} was paid"><option value="">Method…</option>${PAYMENT_METHODS.map((m) => `<option>${m}</option>`).join('')}</select>
          <button type="submit" class="slds-button slds-button_neutral">Record</button></form>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="bp-small bp-muted slds-m-top_small">Cash payments count towards the AED 55,000 report threshold.</p>`, { icon: 'product_consumed' });
}

function handoverTab(user, deal) {
  const editable = canWorkDeal(user, deal) && !['Won', 'Lost'].includes(deal.stage);
  return card('Handover checklist', `<p class="bp-small bp-muted slds-m-bottom_small">All items must be done before the deal can be marked Won.</p>
    <ul class="bp-checklist">${deal.handover.map((h, i) => `<li><div class="slds-checkbox"><input type="checkbox" id="ho-${i}" ${h.done ? 'checked' : ''} ${editable ? '' : 'disabled'} data-act="toggleHandover" data-id="${esc(deal.id)}" data-i="${i}">
      <label class="slds-checkbox__label" for="ho-${i}"><span class="slds-checkbox_faux"></span><span class="slds-form-element__label">${esc(h.label)}</span></label></div>${h.done && h.by ? `<span class="bp-small bp-muted">${esc(h.by)}</span>` : ''}</li>`).join('')}</ul>`, { icon: 'task' });
}

function commissionTab(user, deal) {
  const c = commissionFor(deal);
  const finance = canManageCommission(user);
  const steps = ['Expected', 'Invoiced', 'Collected', 'Paid out'];
  const at = steps.indexOf(deal.commission.status);
  const overdue = deal.commission.status === 'Invoiced' && deal.commission.invoiceDueAt < now();
  const row = (k, v, cls = '') => `<tr class="${cls}"><td>${esc(k)}</td><td style="text-align:right">${v}</td></tr>`;
  const calc = card('Commission', `<ol class="bp-steps">${steps.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${esc(s)}</li>`).join('')}</ol>
    ${overdue ? `<div class="slds-m-vertical_small">${alertBox('warning', `Invoice overdue since ${fmtDate(deal.commission.invoiceDueAt)}: chase the ${esc(deal.commission.payer.toLowerCase())}.`)}</div>` : ''}
    <table class="slds-table slds-table_bordered bp-calc"><tbody>
      ${row(deal.type === 'Rental' ? 'Annual rent' : 'Deal value', fmtAED(deal.value))}
      ${row(`Commission (${deal.commission.rate}%, paid by the ${deal.commission.payer.toLowerCase()})`, fmtAED(c.gross))}
      ${deal.coBroke ? row(`Co-broker share (${deal.coBroke.firm}, ${deal.coBroke.splitPct}%)`, `− ${fmtAED(c.coBrokeShare)}`) : ''}
      ${row('Firm net', fmtAED(c.firmNet), 'bp-strong')}
      ${row(`VAT ${VAT_RATE}% on the invoice`, fmtAED(c.vat))}
      ${row('Invoice total', fmtAED(c.invoiceTotal))}
      ${row(`Agent payout (${deal.commission.agentShare}% of firm net)`, fmtAED(c.agentPayout), 'bp-strong')}
    </tbody></table>
    <div class="bp-form-actions slds-m-top_small">
      ${finance && deal.stage === 'Won' && at < 3 ? `<button type="button" class="slds-button slds-button_brand" data-act="advanceCommission" data-id="${esc(deal.id)}">Mark ${esc(steps[at + 1].toLowerCase())}</button>` : ''}
      ${finance ? `<button type="button" class="slds-button slds-button_neutral" data-act="editCommissionOpen" data-id="${esc(deal.id)}">Edit terms</button>` : '<span class="bp-small bp-muted">Commission terms are set by finance.</span>'}
    </div>`, { icon: 'currency' });
  const co = card('Co-broking', deal.coBroke ? `<dl class="bp-kv bp-kv-narrow"><dt>Firm</dt><dd>${esc(deal.coBroke.firm)}</dd><dt>ORN</dt><dd>${esc(deal.coBroke.orn)}</dd><dt>Agent</dt><dd>${esc(deal.coBroke.agent || '—')}</dd><dt>Their share</dt><dd>${deal.coBroke.splitPct}%</dd></dl>`
    : '<p class="bp-small bp-muted">Not co-broked.</p>', { icon: 'partners', actions: canWorkDeal(user, deal) && !['Won', 'Lost'].includes(deal.stage) ? `<button type="button" class="slds-button slds-button_neutral" data-act="editCoBrokeOpen" data-id="${esc(deal.id)}">${deal.coBroke ? 'Edit' : 'Add'}</button>` : '' });
  return `<div class="bp-grid bp-cols-2">${calc}${co}</div>`;
}

export function bpDealRoom(user, id, tab = 'overview') {
  const deal = getDeal(user, id);
  if (!deal) return card('Deal not found', emptyState('This deal does not exist or is not visible to you', 'Deals are visible to their owner, their team leader and firm managers only.', '<a class="slds-button slds-button_neutral" href="portal/#/pipeline">Back to pipeline</a>'));
  const t = now();
  const active = TABS.some(([k]) => k === tab) ? tab : 'overview';
  const owner = getState().users.find((u) => u.id === deal.ownerId);
  const canWork = canWorkDeal(user, deal) && !['Won', 'Lost'].includes(deal.stage);
  const tabNav = `<div class="slds-tabs_default bp-tabs"><ul class="slds-tabs_default__nav" role="tablist">${TABS.map(([k, label]) => {
    const flag = k === 'documents' ? requiredDocs(deal.type, deal.firmId).filter((d) => !deal.documents[d.key]?.confirmed).length : k === 'kyc' ? (deal.kyc.status !== 'Verified' || deal.kyc.screening.status === 'Possible match' ? 1 : 0) : 0;
    return `<li class="slds-tabs_default__item ${k === active ? 'slds-is-active' : ''}" role="presentation"><a class="slds-tabs_default__link" role="tab" aria-selected="${k === active}" href="portal/#/deal/${esc(deal.id)}/${k}">${esc(label)}${flag && !['Won', 'Lost'].includes(deal.stage) ? '<span class="bp-tab-dot" aria-label="needs attention"></span>' : ''}</a></li>`;
  }).join('')}</ul></div>`;
  const body = { overview: () => overviewTab(user, deal, t), documents: () => documentsTab(user, deal), kyc: () => kycTab(user, deal), payments: () => paymentsTab(user, deal, t), handover: () => handoverTab(user, deal), commission: () => commissionTab(user, deal) }[active]();
  return `<div class="bp-record-head">
      <a class="bp-back" href="portal/#/pipeline">${uIcon('back', 'slds-icon_xx-small')} Pipeline</a>
      <div class="bp-record-title">${avatar(deal.clientName, firmOf(user).brand, 44)}
        <div style="min-width:0"><h1>${esc(deal.clientName)} ${badge(deal.type, 'info')} ${badge(stageLabel(deal.type, deal.stage), deal.stage === 'Won' ? 'success' : deal.stage === 'Lost' ? 'light' : '')}</h1>
          <div class="bp-small bp-muted">${esc(deal.unit.ref)} · ${fmtAED(deal.value)}${deal.type === 'Rental' ? ' a year' : ''} · owner ${esc(owner ? owner.name : '—')} · ${esc(deal.id)}</div></div>
        <div class="bp-record-actions">${canWork ? `<button type="button" class="slds-button slds-button_text-destructive" data-act="moveDealTo" data-id="${esc(deal.id)}" data-to="Lost">Mark lost</button>` : ''}</div>
      </div></div>
    <div class="slds-card bp-card slds-p-around_small">${stagePath(user, deal)}${gatePanel(user, deal, t)}</div>
    ${tabNav}<div class="bp-tab-body">${body}</div>`;
}

/* ---------- actions ---------- */

function dateFieldsFrom(f) {
  const out = { ...f };
  delete out.dealId; delete out.key;
  for (const k of DATE_FIELDS) if (k in out) out[k] = parseDateInput(out[k]);
  return out;
}

export const dealRoomActions = (getActor) => ({
  dealUpload(el) {
    const file = el.files && el.files[0];
    if (!file) return;
    const doc = uploadDocument(getActor(), el.dataset.id, el.dataset.key, file.name);
    toast('success', 'Uploaded', doc.read ? 'The Document Reader filled the fields: check and confirm them.' : 'Confirm the document to count it.');
  },
  confirmDealDoc(form) {
    const f = readForm(form);
    confirmDocument(getActor(), f.dealId, f.key, dateFieldsFrom(f));
    toast('success', 'Document confirmed', DEAL_DOCUMENTS[f.key].reader ? 'Fields copied to KYC.' : '');
  },
  removeDealDoc(el) { removeDocument(getActor(), el.dataset.id, el.dataset.key); toast('success', 'Document removed'); },
  submitKyc(el) { submitKyc(getActor(), el.dataset.id); toast('success', 'KYC submitted', 'Compliance has been notified.'); },
  runScreening(el) {
    const res = runScreening(getActor(), el.dataset.id);
    toast(res.status === 'Clear' ? 'success' : 'warning', `Screening: ${res.status}`, res.hits.length ? `Possible match with ${esc(res.hits[0].name)} (${res.hits[0].pct}%). Compliance must review.` : 'No watchlist matches.');
  },
  verifyKyc(el) { verifyKyc(getActor(), el.dataset.id); toast('success', 'KYC verified'); },
  rejectKycOpen(el) {
    openModal('Reject KYC', modalForm('rk-form', 'submitRejectKyc', `<input type="hidden" name="dealId" value="${esc(el.dataset.id)}">${textarea('rkReason', 'Reason for the agent', { required: true, name: 'reason', attrs: 'rows="3"' })}`), modalFooter('rk-form', 'Reject', { variant: 'destructive' }));
  },
  submitRejectKyc(form) { const f = readForm(form); submitModal(() => rejectKyc(getActor(), f.dealId, f.reason), { title: 'KYC rejected', message: 'The agent has been notified.' }); },
  clearScreeningOpen(el) {
    openModal('Clear screening match', modalForm('cs-form', 'submitClearScreening', `<input type="hidden" name="dealId" value="${esc(el.dataset.id)}">
      ${textarea('csNote', 'Why is this a different person?', { required: true, name: 'note', attrs: 'rows="3" placeholder="e.g. Date of birth and nationality differ from the listed person."' })}
      <p class="bp-small bp-muted">Recorded in the audit log with your name.</p>`), modalFooter('cs-form', 'Clear match'));
  },
  submitClearScreening(form) { const f = readForm(form); submitModal(() => clearScreening(getActor(), f.dealId, f.note), { title: 'Match cleared' }); },
  draftRear(el) { draftRear(getActor(), el.dataset.id); toast('success', 'REAR drafted', 'Review it, then the AML officer files it.'); },
  recordPayment(form) {
    const f = readForm(form);
    const row = recordPayment(getActor(), f.dealId, f.key, f.method);
    toast('success', 'Payment recorded', `${esc(row.label)}: ${fmtAED(row.amount)} by ${esc(f.method.toLowerCase())}.`);
  },
  toggleHandover(el) { toggleHandover(getActor(), el.dataset.id, Number(el.dataset.i)); },
  advanceCommission(el) { advanceCommission(getActor(), el.dataset.id); toast('success', 'Commission updated'); },
  editCommissionOpen(el) {
    const d = getDeal(getActor(), el.dataset.id);
    openModal('Commission terms', modalForm('cm-form', 'submitCommission', `<input type="hidden" name="dealId" value="${esc(d.id)}">
      ${field('cmRate', 'Commission rate (%)', { type: 'number', value: d.commission.rate, name: 'rate', attrs: 'step="0.25" min="0.25" max="10"' })}
      ${field('cmShare', "Agent's share of firm net (%)", { type: 'number', value: d.commission.agentShare, name: 'agentShare', attrs: 'min="0" max="100"' })}`), modalFooter('cm-form', 'Save'));
  },
  submitCommission(form) { const f = readForm(form); submitModal(() => updateCommission(getActor(), f.dealId, f), { title: 'Commission terms saved' }); },
  editCoBrokeOpen(el) {
    const d = getDeal(getActor(), el.dataset.id);
    const c = d.coBroke || { firm: '', orn: '', agent: '', splitPct: 50 };
    openModal('Co-broking', modalForm('cb-form', 'submitCoBroke', `<input type="hidden" name="dealId" value="${esc(d.id)}">
      ${field('cbFirm', 'Other firm', { value: c.firm, required: true, name: 'firm' })}${field('cbOrn', 'Their ORN', { value: c.orn, required: true, name: 'orn', attrs: 'inputmode="numeric" maxlength="6"' })}
      ${field('cbAgent', 'Their agent', { value: c.agent, name: 'agent' })}${field('cbSplit', 'Their share (%)', { type: 'number', value: c.splitPct, name: 'splitPct', attrs: 'min="1" max="90"' })}`),
    modalFooter('cb-form', 'Save', { extra: d.coBroke ? `<button type="button" class="slds-button slds-button_text-destructive" style="margin-right:auto" data-act="removeCoBroke" data-id="${esc(d.id)}">Remove co-broking</button>` : '' }));
  },
  submitCoBroke(form) { const f = readForm(form); submitModal(() => setCoBroke(getActor(), f.dealId, f), { title: 'Co-broking saved' }); },
  removeCoBroke(el) { submitModal(() => setCoBroke(getActor(), el.dataset.id, null), { title: 'Co-broking removed' }); },
});

export { tryMove };
