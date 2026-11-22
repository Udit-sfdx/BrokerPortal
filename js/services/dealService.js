// Deals: stage moves with gates, documents and KYC, screening, payments, handover, co-broking, commission.
// Mirrors BP_DealService (Apex). Gates come from config PIPELINES and are checked here, never only in the UI:
// in Salesforce the same checks run in the service and a validation rule backs them up.

import { getState, mutate, now, nextId, audit } from '../core/store.js';
import { assertValid, isBlank, DAY } from '../core/util.js';
import { FIRM_WIDE_ROLES, DEAL_DOCUMENTS, KYC_FIELD_LABELS, CASH_REPORT_THRESHOLD, COMMISSION_RULES } from '../core/config.js';
import { gateProblems, stagesFor, stageIndex, stageLabel, scheduleNextPayments, cashNeedsReport } from '../core/rules.js';
import { firmOf } from './firmService.js';
import { readClientDocument, screeningResult, rearDraft } from './aiService.js';

const MANAGERS = ['Owner', 'Director', 'Team Leader'];
const KYC_APPROVERS = ['Compliance', 'Owner'];
const FINANCE = ['Owner', 'Director', 'Compliance'];

/* ---------- visibility ---------- */

export function canSeeDeal(actor, deal) {
  if (!actor || !deal || deal.firmId !== actor.firmId) return false;
  if (FIRM_WIDE_ROLES.includes(actor.role)) return true;
  if (actor.role === 'Team Leader') {
    const owner = getState().users.find((u) => u.id === deal.ownerId);
    return deal.ownerId === actor.id || (owner && owner.teamId === actor.teamId);
  }
  return deal.ownerId === actor.id;
}

export const visibleDeals = (actor) => getState().deals.filter((d) => canSeeDeal(actor, d));
export const getDeal = (actor, id) => getState().deals.find((d) => d.id === id && canSeeDeal(actor, d)) || null;

/** Deal owner and managers move the deal; Compliance works documents and KYC on any deal in the firm. */
export const canWorkDeal = (actor, deal) => canSeeDeal(actor, deal) && (deal.ownerId === actor.id || MANAGERS.includes(actor.role));
export const canWorkCompliance = (actor, deal) => canWorkDeal(actor, deal) || (canSeeDeal(actor, deal) && actor.role === 'Compliance');
export const canApproveKyc = (actor) => KYC_APPROVERS.includes(actor.role);
export const canManageCommission = (actor) => FINANCE.includes(actor.role);

function requireWritable(actor) {
  const firm = firmOf(actor);
  assertValid(firm && ['Active', 'Trial'].includes(firm.status) ? [] : ['Your firm is read-only right now: no changes can be saved.']);
  return firm;
}

function requireDeal(actor, id, { compliance = false } = {}) {
  requireWritable(actor);
  const deal = getDeal(actor, id);
  assertValid(deal ? [] : ['Deal not found, or you do not have access to it.']);
  const ok = compliance ? canWorkCompliance(actor, deal) : canWorkDeal(actor, deal);
  assertValid(ok ? [] : ['Only the deal owner or a manager can change this deal.']);
  assertValid(['Won', 'Lost'].includes(deal.stage) && !compliance ? ['This deal is closed.'] : []);
  return deal;
}

const findIn = (s, id) => s.deals.find((d) => d.id === id);
const notify = (s, userId, text, link) => userId && s.notifications.unshift({ id: nextId('N'), userId, text, link, at: now(), read: false });
const history = (d, at, text, by) => { d.activity = d.activity || []; d.activity.unshift({ at, text, by }); };

/* ---------- stages ---------- */

/** What stops a move, as plain sentences grouped by stage (empty = allowed). Used by the board before dropping. */
export function moveCheck(actor, deal, toStage) {
  const problems = [];
  if (!canWorkDeal(actor, deal)) problems.push({ stage: '', text: 'Only the deal owner or a manager can move this deal.', tab: null });
  if (['Won', 'Lost'].includes(deal.stage)) problems.push({ stage: '', text: 'This deal is closed.', tab: null });
  const back = stageIndex(deal.type, toStage) < stageIndex(deal.type, deal.stage);
  if (back && !MANAGERS.includes(actor.role)) problems.push({ stage: '', text: 'Only a team leader or above can move a deal back a stage.', tab: null });
  return [...problems, ...gateProblems(deal, toStage)];
}

export function moveStage(actor, id, toStage, { lostReason } = {}) {
  const deal = requireDeal(actor, id);
  const valid = toStage === 'Lost' || stageIndex(deal.type, toStage) >= 0;
  assertValid(valid ? [] : ['Unknown stage.']);
  assertValid(toStage === deal.stage ? [`The deal is already in ${stageLabel(deal.type, toStage)}.`] : []);
  if (toStage === 'Lost') assertValid(isBlank(lostReason) ? ['Give a reason for losing the deal.'] : []);
  const blocked = moveCheck(actor, deal, toStage);
  assertValid(blocked.map((b) => (b.stage ? `${b.stage}: ${b.text}` : b.text)));
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    const from = d.stage;
    d.stage = toStage;
    d.stageChangedAt = t;
    d.history.push({ at: t, from, to: toStage, by: actor.name });
    if (toStage === 'Lost') { d.lostReason = lostReason.trim(); d.closedAt = t; }
    if (toStage === 'Won') {
      d.closedAt = t;
      d.commission.status = 'Invoiced';
      d.commission.invoicedAt = t;
      d.commission.invoiceDueAt = t + 30 * DAY;
    }
    scheduleNextPayments(d);
    history(d, t, `Moved ${stageLabel(d.type, from)} → ${stageLabel(d.type, toStage)}${toStage === 'Lost' ? `: ${d.lostReason}` : ''}.`, actor.name);
    if (d.ownerId !== actor.id) notify(s, d.ownerId, `${actor.name} moved ${d.clientName}'s deal to ${stageLabel(d.type, toStage)}.`, `#/deal/${d.id}`);
    audit(actor.name, 'Deal stage changed', `${d.id} ${d.clientName}: ${stageLabel(d.type, from)} → ${stageLabel(d.type, toStage)}.`, d.firmId);
    return d;
  });
}

/* ---------- documents (Document Reader) ---------- */

export function uploadDocument(actor, id, key, fileName) {
  const deal = requireDeal(actor, id, { compliance: true });
  const problems = [];
  if (!DEAL_DOCUMENTS[key]) problems.push('Unknown document type.');
  if (isBlank(fileName)) problems.push('Choose a file.');
  else if (!/\.(pdf|jpe?g|png)$/i.test(fileName)) problems.push('Upload a PDF, JPG or PNG.');
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    const reader = DEAL_DOCUMENTS[key].reader;
    d.documents[key] = { file: fileName, uploadedAt: t, by: actor.name, confirmed: false, fields: reader ? readClientDocument(d, key, fileName, t) : {}, read: !!reader };
    // A new passport or Emirates ID re-opens a verified KYC: Compliance has to look again.
    if (reader && d.kyc.status === 'Verified') { d.kyc.status = 'Submitted'; d.kyc.verifiedAt = null; d.kyc.verifiedBy = null; }
    history(d, t, `Uploaded ${DEAL_DOCUMENTS[key].label} (${fileName})${reader ? '; Document Reader read the fields' : ''}.`, actor.name);
    return d.documents[key];
  });
}

/** Problems with extracted/edited fields before a person confirms them. */
export function documentFieldProblems(deal, key, fields) {
  const out = [];
  const reader = DEAL_DOCUMENTS[key]?.reader || [];
  for (const f of reader) if (isBlank(fields[f])) out.push(`${KYC_FIELD_LABELS[f]} is required.`);
  const t = now();
  if (fields.passportExpiry && fields.passportExpiry < t) out.push('The passport has expired: ask the client for a valid one.');
  if (fields.eidExpiry && fields.eidExpiry < t) out.push('The Emirates ID has expired: ask the client for a valid one.');
  if (key === 'eid' && fields.eidNo && !/^784-\d{4}-\d{7}-\d$/.test(fields.eidNo)) out.push('Emirates ID number must look like 784-YYYY-NNNNNNN-N.');
  if (fields.fullName && deal.clientName && !sameName(fields.fullName, deal.clientName)) out.push(`Name on the document (${fields.fullName}) does not match the client (${deal.clientName}).`);
  return out;
}

const sameName = (a, b) => {
  const n = (x) => String(x).toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).sort().join(' ');
  return n(a) === n(b);
};

export function confirmDocument(actor, id, key, fields = {}) {
  const deal = requireDeal(actor, id, { compliance: true });
  const doc = deal.documents[key];
  assertValid(doc ? [] : ['Upload the document first.']);
  const merged = { ...doc.fields, ...fields };
  assertValid(documentFieldProblems(deal, key, merged));
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    const reader = DEAL_DOCUMENTS[key].reader;
    d.documents[key] = { ...d.documents[key], fields: merged, confirmed: true, confirmedBy: actor.name, confirmedAt: t };
    if (reader) for (const f of reader) d.kyc.fields[f] = merged[f];
    history(d, t, `Confirmed ${DEAL_DOCUMENTS[key].label}.`, actor.name);
    return d.documents[key];
  });
}

export function removeDocument(actor, id, key) {
  const deal = requireDeal(actor, id, { compliance: true });
  assertValid(deal.documents[key] ? [] : ['No document to remove.']);
  const neededByCurrent = stagesFor(deal.type, deal.firmId).slice(1, stageIndex(deal.type, deal.stage) + 1).some((st) => (st.gate || []).includes(`doc:${key}`));
  assertValid(neededByCurrent ? [`This document is needed for the deal's current stage (${stageLabel(deal.type, deal.stage)}). Upload a replacement instead.`] : []);
  return mutate((s) => {
    const d = findIn(s, id);
    delete d.documents[key];
    history(d, now(), `Removed ${DEAL_DOCUMENTS[key].label}.`, actor.name);
  });
}

/* ---------- KYC and screening (Compliance Checker) ---------- */

export function kycProblems(deal) {
  const out = [];
  for (const k of ['passport', 'eid']) {
    const doc = deal.documents[k];
    if (!doc) out.push(`Upload the ${DEAL_DOCUMENTS[k].label.toLowerCase()}.`);
    else if (!doc.confirmed) out.push(`Confirm the fields of the ${DEAL_DOCUMENTS[k].label.toLowerCase()}.`);
  }
  if (deal.documents.passport?.confirmed && deal.documents.eid?.confirmed && !sameName(deal.documents.passport.fields.fullName, deal.documents.eid.fields.fullName)) {
    out.push('Passport and Emirates ID names do not match.');
  }
  return out;
}

export function submitKyc(actor, id) {
  const deal = requireDeal(actor, id, { compliance: true });
  assertValid(['Not started', 'Rejected'].includes(deal.kyc.status) ? [] : [`KYC is already ${deal.kyc.status.toLowerCase()}.`]);
  assertValid(kycProblems(deal));
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    d.kyc.status = 'Submitted';
    d.kyc.submittedAt = t;
    d.kyc.rejectReason = null;
    history(d, t, 'KYC submitted to Compliance.', actor.name);
    s.users.filter((u) => u.firmId === d.firmId && u.status === 'Active' && u.role === 'Compliance').forEach((u) => notify(s, u.id, `KYC to review: ${d.clientName} (${d.id}).`, `#/deal/${d.id}/kyc`));
    return d.kyc;
  });
}

export function runScreening(actor, id) {
  const deal = requireDeal(actor, id, { compliance: true });
  const name = deal.kyc.fields.fullName || deal.clientName;
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    const res = screeningResult(name);
    d.kyc.screening = { status: res.status, at: t, hits: res.hits, clearedBy: null, name };
    history(d, t, `Watchlist screening: ${res.status.toLowerCase()}${res.hits.length ? ` (${res.hits.map((h) => `${h.name}, ${h.pct}%`).join('; ')})` : ''}.`, actor.name);
    if (res.hits.length) {
      s.users.filter((u) => u.firmId === d.firmId && u.status === 'Active' && u.role === 'Compliance').forEach((u) => notify(s, u.id, `Screening match to review: ${d.clientName}.`, `#/deal/${d.id}/kyc`));
      audit('Compliance Checker', 'Screening match', `${d.clientName} (${d.id}) possible match: ${res.hits[0].name}.`, d.firmId);
    }
    return d.kyc.screening;
  });
}

/** Compliance or the owner records that a possible match is a different person. */
export function clearScreening(actor, id, note) {
  const deal = requireDeal(actor, id, { compliance: true });
  const problems = [];
  if (!canApproveKyc(actor)) problems.push('Only Compliance or the firm owner can clear a screening match.');
  if (deal.kyc.screening.status !== 'Possible match') problems.push('There is no match to clear.');
  if (isBlank(note) || note.trim().length < 10) problems.push('Explain why this is not the listed person (at least 10 characters).');
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    d.kyc.screening = { ...d.kyc.screening, status: 'Clear', clearedBy: actor.name, clearedAt: t, clearNote: note.trim() };
    history(d, t, `Screening match cleared as a false positive: ${note.trim()}`, actor.name);
    audit(actor.name, 'Screening cleared', `${d.clientName} (${d.id}): ${note.trim()}`, d.firmId);
  });
}

export function verifyKyc(actor, id) {
  const deal = requireDeal(actor, id, { compliance: true });
  const problems = [];
  if (!canApproveKyc(actor)) problems.push('Only Compliance or the firm owner can verify KYC.');
  if (deal.kyc.status !== 'Submitted') problems.push('KYC must be submitted before it can be verified.');
  if (deal.kyc.screening.status === 'Not run') problems.push('Run the watchlist screening first.');
  if (deal.kyc.screening.status === 'Possible match') problems.push('Clear or escalate the screening match first.');
  problems.push(...kycProblems(deal));
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    Object.assign(d.kyc, { status: 'Verified', verifiedAt: t, verifiedBy: actor.name });
    history(d, t, 'KYC verified.', actor.name);
    notify(s, d.ownerId, `KYC verified for ${d.clientName}.`, `#/deal/${d.id}`);
    audit(actor.name, 'KYC verified', `${d.clientName} (${d.id}).`, d.firmId);
  });
}

export function rejectKyc(actor, id, reason) {
  const deal = requireDeal(actor, id, { compliance: true });
  const problems = [];
  if (!canApproveKyc(actor)) problems.push('Only Compliance or the firm owner can reject KYC.');
  if (deal.kyc.status !== 'Submitted') problems.push('Only submitted KYC can be rejected.');
  if (isBlank(reason)) problems.push('Give a reason for the agent.');
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    Object.assign(d.kyc, { status: 'Rejected', rejectReason: reason.trim() });
    history(d, t, `KYC rejected: ${reason.trim()}`, actor.name);
    notify(s, d.ownerId, `KYC rejected for ${d.clientName}: ${reason.trim()}`, `#/deal/${d.id}/kyc`);
  });
}

/* ---------- payments ---------- */

export const PAYMENT_METHODS = ['Bank transfer', 'Cheque', 'Card', 'Cash'];

export function recordPayment(actor, id, key, method) {
  const deal = requireDeal(actor, id);
  const p = deal.payments.find((x) => x.key === key);
  const problems = [];
  if (!p) problems.push('Unknown payment.');
  else if (p.paidAt) problems.push(`${p.label} is already recorded.`);
  if (!PAYMENT_METHODS.includes(method)) problems.push('Choose how it was paid.');
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    const row = d.payments.find((x) => x.key === key);
    row.paidAt = t;
    row.method = method;
    if (method === 'Cash') d.cashAmount = (d.cashAmount || 0) + row.amount;
    history(d, t, `Payment received: ${row.label} by ${method.toLowerCase()}.`, actor.name);
    if (cashNeedsReport(d) && !d.rearDrafted) {
      s.users.filter((u) => u.firmId === d.firmId && u.status === 'Active' && u.role === 'Compliance').forEach((u) => notify(s, u.id, `Cash of AED ${d.cashAmount.toLocaleString('en-US')} on ${d.id}: REAR report needed.`, `#/deal/${d.id}/kyc`));
    }
    return row;
  });
}

/** Compliance Checker drafts the REAR for the AML officer; it is never filed automatically. */
export function draftRear(actor, id) {
  const deal = requireDeal(actor, id, { compliance: true });
  assertValid(cashNeedsReport(deal) ? [] : [`A REAR is only needed when cash reaches AED ${CASH_REPORT_THRESHOLD.toLocaleString('en-US')}.`]);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    d.rearDrafted = true;
    d.rearText = rearDraft(d, s.firms.find((f) => f.id === d.firmId));
    history(d, t, 'REAR draft prepared for the AML officer (not filed).', actor.name);
    audit('Compliance Checker', 'REAR drafted', `${d.clientName} (${d.id}), cash AED ${d.cashAmount}. Approved by ${actor.name}.`, d.firmId);
    return d.rearText;
  });
}

/* ---------- handover, co-broking, commission ---------- */

export function toggleHandover(actor, id, index) {
  const deal = requireDeal(actor, id);
  assertValid(deal.handover[index] ? [] : ['Unknown checklist item.']);
  return mutate((s) => {
    const d = findIn(s, id);
    const item = d.handover[index];
    item.done = !item.done;
    item.doneAt = item.done ? now() : null;
    item.by = item.done ? actor.name : null;
    history(d, now(), `${item.done ? 'Done' : 'Re-opened'}: ${item.label}.`, actor.name);
  });
}

export function setCoBroke(actor, id, form) {
  const deal = requireDeal(actor, id);
  if (!form) return mutate((s) => { const d = findIn(s, id); d.coBroke = null; history(d, now(), 'Co-broking removed.', actor.name); });
  const problems = [];
  const split = Number(form.splitPct);
  if (isBlank(form.firm)) problems.push('Enter the other firm.');
  if (!/^\d{4,6}$/.test(String(form.orn || '').trim())) problems.push("The other firm's ORN must be 4 to 6 digits.");
  if (!Number.isFinite(split) || split < 1 || split > 90) problems.push('Their share must be 1 to 90%.');
  if (String(form.orn || '').trim() === firmOf(actor).orn) problems.push('That is your own ORN.');
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    d.coBroke = { firm: form.firm.trim(), orn: String(form.orn).trim(), agent: (form.agent || '').trim(), splitPct: split };
    history(d, now(), `Co-broking with ${d.coBroke.firm} (ORN ${d.coBroke.orn}), their share ${split}%.`, actor.name);
    return d.coBroke;
  });
}

export function updateCommission(actor, id, { rate, agentShare }) {
  requireWritable(actor);
  const deal = getDeal(actor, id);
  const problems = [];
  if (!deal) problems.push('Deal not found.');
  if (!canManageCommission(actor)) problems.push('Only the owner, a director or finance can change commission terms.');
  const r = Number(rate);
  const a = Number(agentShare);
  if (!Number.isFinite(r) || r <= 0 || r > 10) problems.push('Commission rate must be above 0% and at most 10%.');
  if (!Number.isFinite(a) || a < 0 || a > 100) problems.push("Agent's share must be 0 to 100%.");
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    d.commission.rate = r;
    d.commission.agentShare = a;
    history(d, now(), `Commission terms set to ${r}% (agent ${a}%).`, actor.name);
  });
}

const COMMISSION_FLOW = { Expected: 'Invoiced', Invoiced: 'Collected', Collected: 'Paid out' };

export function advanceCommission(actor, id) {
  requireWritable(actor);
  const deal = getDeal(actor, id);
  const problems = [];
  if (!deal) problems.push('Deal not found.');
  else {
    if (!canManageCommission(actor)) problems.push('Only the owner, a director or finance can update commission.');
    if (deal.stage !== 'Won') problems.push('Commission is invoiced once the deal is won.');
    if (!COMMISSION_FLOW[deal.commission.status]) problems.push('Commission is already paid out.');
  }
  assertValid(problems);
  return mutate((s) => {
    const d = findIn(s, id);
    const t = now();
    const next = COMMISSION_FLOW[d.commission.status];
    d.commission.status = next;
    if (next === 'Invoiced') { d.commission.invoicedAt = t; d.commission.invoiceDueAt = t + 30 * DAY; }
    if (next === 'Collected') d.commission.collectedAt = t;
    if (next === 'Paid out') d.commission.paidOutAt = t;
    history(d, t, `Commission ${next.toLowerCase()}.`, actor.name);
    audit(actor.name, 'Commission updated', `${d.id}: ${next}.`, d.firmId);
  });
}

export const commissionRule = (type) => COMMISSION_RULES[type];
