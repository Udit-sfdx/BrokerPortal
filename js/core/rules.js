// Pure business rules shared by the seed data and the services. No storage, no DOM.
// Apex equivalents: BP_RoutingRules, BP_LeadScoring, BP_StageGates, BP_CommissionCalc, BP_Screening.

import { DAY, HOUR, MIN, fmtCompact } from './util.js';
import {
  LEAD_SOURCES, PIPELINES, DEAL_DOCUMENTS, PAYMENT_PLANS, HANDOVER_CHECKLISTS, COMMISSION_RULES, VAT_RATE,
  WATCHLIST, CASH_REPORT_THRESHOLD, QUALIFICATION_FIELDS,
} from './config.js';

/* ---------- routing ---------- */

const hasValidBrn = (u, t) => !!u.brn && !!u.brnExpiry && u.brnExpiry > t;

/**
 * Picks an owner for a lead using the firm's routing rules, in order.
 * agents: the firm's Active agents. openCount: { userId: open leads }. lastAssignedAt: { userId: time }.
 * Soft rules that would leave nobody are skipped (and say so); the licence rule is never skipped.
 * Returns { ownerId (or null), trace: [text] } so the inbox can show why the lead went where it did.
 */
export function routeLead(lead, agents, routing, { openCount = {}, lastAssignedAt = {}, t }) {
  const trace = [];
  let pool = agents.filter((u) => u.status === 'Active' && u.role === 'Agent');
  const rules = (routing || []).filter((r) => r.on || r.hard);
  for (const rule of rules) {
    if (!pool.length) break;
    if (rule.id === 'licence') {
      const next = pool.filter((u) => hasValidBrn(u, t));
      const dropped = pool.filter((u) => !next.includes(u));
      trace.push(`Valid BRN: ${next.length} of ${pool.length} agents${dropped.length ? ` (skipped ${dropped.map((u) => u.name).join(', ')}: BRN expired)` : ''}`);
      pool = next;
    } else if (rule.id === 'lob' && lead.lob) {
      const next = pool.filter((u) => (u.lob || []).includes(lead.lob));
      if (next.length) { trace.push(`${lead.lob} specialists: ${next.length}`); pool = next; } else trace.push(`No ${lead.lob} specialist free; rule relaxed`);
    } else if (rule.id === 'lang' && lead.lang) {
      const next = pool.filter((u) => (u.langs || []).includes(lead.lang));
      if (next.length) { trace.push(`Speaks ${lead.lang}: ${next.length}`); pool = next; } else trace.push(`Nobody speaks ${lead.lang}; rule relaxed`);
    } else if (rule.id === 'workload') {
      const min = Math.min(...pool.map((u) => openCount[u.id] || 0));
      pool = pool.filter((u) => (openCount[u.id] || 0) === min);
      trace.push(`Lowest open workload (${min} open): ${pool.length}`);
    } else if (rule.id === 'rr') {
      pool = [...pool].sort((a, b) => (lastAssignedAt[a.id] || 0) - (lastAssignedAt[b.id] || 0) || a.id.localeCompare(b.id)).slice(0, 1);
      trace.push(`Round-robin: ${pool[0].name} waited longest`);
    }
  }
  if (!pool.length) {
    trace.push('No eligible agent: left unassigned for the team leader');
    return { ownerId: null, trace };
  }
  const owner = pool[0];
  trace.push(`Assigned to ${owner.name}`);
  return { ownerId: owner.id, trace };
}

/* ---------- Lead Qualifier: score with reasons ---------- */

const TIMELINE_POINTS = { Now: 15, '1–3 months': 10, '3–6 months': 4, '6+ months': -5 };

/** 0–100 score with the reasons that make it up, so the agent can see why a lead is hot. */
export function scoreLead(lead, t) {
  const reasons = [];
  const add = (pts, text) => { if (pts) reasons.push({ pts, text }); };
  add(LEAD_SOURCES[lead.source]?.quality || 5, `${lead.source} enquiry`);
  if (lead.budgetMax >= 3e6) add(15, `Budget ${fmtCompact(lead.budgetMax)} AED`);
  else if (lead.budgetMax >= 1e6) add(10, `Budget ${fmtCompact(lead.budgetMax)} AED`);
  else if (lead.budgetMax > 0) add(4, `Budget ${fmtCompact(lead.budgetMax)} AED`);
  else add(-6, 'No budget stated');
  if (lead.timeline) add(TIMELINE_POINTS[lead.timeline] || 0, `Timeline: ${lead.timeline.toLowerCase()}`);
  if (lead.financing === 'Cash') add(8, 'Cash buyer');
  if (lead.email && lead.phone) add(4, 'Phone and email given');
  const inbound = (lead.activities || []).filter((a) => a.type === 'inbound').length;
  if (inbound) add(Math.min(12, inbound * 6), `Replied ${inbound} time${inbound === 1 ? '' : 's'}`);
  if (t - lead.createdAt < HOUR) add(10, 'Arrived in the last hour');
  else if (!lead.firstResponseAt && t - lead.createdAt > 3 * DAY) add(-10, 'Not contacted for 3+ days');
  if (lead.dnc) add(-8, 'On the do-not-call list');
  if (lead.duplicateOf) add(-5, 'Possible duplicate');
  const score = Math.max(0, Math.min(100, 30 + reasons.reduce((n, r) => n + r.pts, 0)));
  reasons.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  return { score, reasons };
}

export const scoreBand = (score) => (score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold');

/** Missing qualification fields (labels). Empty list = ready to qualify. */
export const missingQualification = (lead) => QUALIFICATION_FIELDS.filter(([k]) => !lead[k]).map(([, label]) => label);

/* ---------- SLA ---------- */

/** First-response SLA: running (time left), breached (no reply, overdue), met / missed (replied in or after time). */
export function slaState(lead, t) {
  if (!lead.slaDueAt) return { state: 'none' };
  if (lead.firstResponseAt) {
    const took = lead.firstResponseAt - lead.createdAt;
    return { state: lead.firstResponseAt <= lead.slaDueAt ? 'met' : 'missed', took };
  }
  if (['Converted', 'Lost'].includes(lead.status)) return { state: 'none' };
  const left = lead.slaDueAt - t;
  return { state: left >= 0 ? 'running' : 'breached', left };
}

/* ---------- deals: stage gates ---------- */

/** Firm-specific gates (from Firm settings) are resolved through this hook; the default is the product pipeline. */
let pipelineResolver = null;
export const setPipelineResolver = (fn) => { pipelineResolver = fn; };
export const stagesFor = (type, firmId) => (firmId && pipelineResolver && pipelineResolver(firmId, type)) || PIPELINES[type] || [];
export const stageIndex = (type, stageId) => stagesFor(type).findIndex((s) => s.id === stageId);
export const stageLabel = (type, stageId) => (stageId === 'Lost' ? 'Lost' : stagesFor(type).find((s) => s.id === stageId)?.label || stageId);

/** One gate requirement → { ok, text, tab } where tab is the deal room tab that fixes it. */
export function requirement(deal, req) {
  const [kind, key] = req.split(':');
  if (kind === 'kyc') return { ok: deal.kyc.status === 'Verified', text: 'KYC verified by Compliance', tab: 'kyc' };
  if (kind === 'screening') {
    const sc = deal.kyc.screening;
    return { ok: sc.status === 'Clear', text: sc.status === 'Possible match' ? 'Watchlist screening has a possible match: Compliance must clear it' : 'Watchlist screening run and clear', tab: 'kyc' };
  }
  if (kind === 'doc') {
    const doc = deal.documents[key];
    const label = DEAL_DOCUMENTS[key]?.label || key;
    return { ok: !!(doc && doc.confirmed), text: doc && !doc.confirmed ? `${label} uploaded but not confirmed` : `${label} uploaded and confirmed`, tab: 'documents' };
  }
  if (kind === 'pay') {
    const p = deal.payments.find((x) => x.key === key);
    return { ok: !!(p && p.paidAt), text: `${p ? p.label : key} received`, tab: 'payments' };
  }
  if (kind === 'handover') {
    const left = deal.handover.filter((h) => !h.done).length;
    return { ok: left === 0, text: left ? `Handover checklist complete (${left} item${left === 1 ? '' : 's'} left)` : 'Handover checklist complete', tab: 'handover' };
  }
  return { ok: false, text: req, tab: 'overview' };
}

/**
 * What blocks moving a deal to toStage. Moving forward checks the gates of every stage passed through
 * (no skipping a gate by jumping two columns). Moving back or to Lost has no gate here.
 * Returns [{ stage, text, tab }].
 */
export function gateProblems(deal, toStage) {
  if (toStage === 'Lost') return [];
  const stages = stagesFor(deal.type, deal.firmId);
  const from = stageIndex(deal.type, deal.stage);
  const to = stageIndex(deal.type, toStage);
  if (to < 0) return [{ stage: toStage, text: 'Unknown stage', tab: 'overview' }];
  if (to <= from) return [];
  const out = [];
  for (let i = from + 1; i <= to; i++) {
    for (const req of stages[i].gate || []) {
      const r = requirement(deal, req);
      if (!r.ok) out.push({ stage: stages[i].label, text: r.text, tab: r.tab });
    }
  }
  return out;
}

/** Next stage's checklist for the stage path: [{ text, ok, tab }]. */
export function nextGate(deal) {
  const stages = stagesFor(deal.type, deal.firmId);
  const i = stageIndex(deal.type, deal.stage);
  const next = stages[i + 1];
  if (!next) return { stage: null, items: [] };
  return { stage: next, items: (next.gate || []).map((req) => requirement(deal, req)) };
}

/* ---------- commission ---------- */

export function commissionFor(deal) {
  const c = deal.commission;
  const gross = Math.round((deal.value * c.rate) / 100);
  const coBrokeShare = deal.coBroke ? Math.round((gross * deal.coBroke.splitPct) / 100) : 0;
  const firmNet = gross - coBrokeShare;
  const vat = Math.round((gross * VAT_RATE) / 100);
  const agentPayout = Math.round((firmNet * c.agentShare) / 100);
  return { gross, coBrokeShare, firmNet, vat, invoiceTotal: gross + vat, agentPayout };
}

/* ---------- Compliance Checker: watchlist screening ---------- */

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);

/** Fuzzy name match against the demo watchlist: tokens that share their first 5 letters count as a hit. */
export function screenName(name) {
  const mine = norm(name);
  return WATCHLIST.map((w) => {
    const theirs = norm(w.name);
    const shared = theirs.filter((tk) => mine.some((m) => m.slice(0, 5) === tk.slice(0, 5))).length;
    const pct = Math.round((shared / Math.max(theirs.length, mine.length)) * 100);
    return { ...w, pct };
  }).filter((h) => h.pct >= 60);
}

export const cashNeedsReport = (deal) => (deal.cashAmount || 0) >= CASH_REPORT_THRESHOLD;

/* ---------- Deal Coach: risk ---------- */

/** Reasons a deal is at risk, most serious first. Empty list = on track. */
export function dealRisks(deal, t) {
  if (['Won', 'Lost'].includes(deal.stage)) return [];
  const out = [];
  const stage = stagesFor(deal.type, deal.firmId).find((s) => s.id === deal.stage);
  const days = Math.floor((t - deal.stageChangedAt) / DAY);
  if (stage && stage.stuckDays && days > stage.stuckDays) {
    const missing = nextGate(deal).items.filter((i) => !i.ok);
    out.push(`Stuck in ${stage.label} for ${days} days (limit ${stage.stuckDays})${missing.length ? `; still missing: ${missing[0].text}` : ''}`);
  }
  if (deal.kyc.screening.status === 'Possible match') out.push('Screening has a possible watchlist match');
  const overdue = deal.payments.filter((p) => !p.paidAt && p.dueAt && p.dueAt < t);
  if (overdue.length) out.push(`${overdue[0].label} overdue by ${Math.floor((t - overdue[0].dueAt) / DAY) || 1} days`);
  if (cashNeedsReport(deal) && !deal.rearDrafted) out.push('Cash at or above AED 55,000: REAR report needed');
  const exp = deal.kyc.fields.passportExpiry;
  if (exp && exp - t < 30 * DAY) out.push(exp < t ? 'Client passport has expired' : 'Client passport expires within 30 days');
  return out;
}

/** Builds the payment plan rows for a new deal. */
export function buildPayments(type, value, start) {
  return (PAYMENT_PLANS[type] || []).map(([key, label, pct], i) => ({
    key, label, pct, amount: Math.round((value * pct) / 100), dueAt: null, paidAt: null, method: null,
  }));
}

/** Payments the next stage's gate needs fall due 7 days after the deal entered its current stage. */
export function scheduleNextPayments(deal) {
  const { stage } = nextGate(deal);
  if (!stage) return;
  for (const req of stage.gate || []) {
    const [kind, key] = req.split(':');
    const p = kind === 'pay' && deal.payments.find((x) => x.key === key);
    if (p && !p.paidAt && !p.dueAt) p.dueAt = deal.stageChangedAt + 7 * DAY;
  }
}

export const buildHandover = (type) => (HANDOVER_CHECKLISTS[type] || []).map((label) => ({ label, done: false }));

export function newCommission(type, firmDefaults = {}) {
  const r = { ...(COMMISSION_RULES[type] || COMMISSION_RULES.Secondary), ...(firmDefaults[type] || {}) };
  return { rate: r.rate, payer: r.payer, agentShare: r.agentShare, status: 'Expected', invoicedAt: null, invoiceDueAt: null, collectedAt: null };
}

export const minutes = (n) => n * MIN;

/* ---------- inventory: unit matching ---------- */

const KIND_FOR_LOB = { 'Off-plan': 'Off-plan', Secondary: 'Resale', Rental: 'Rental' };
const BED_ORDER = ['Studio', '1', '2', '3', '4', '5+'];

/** Scores available units of the right kind for a lead, best first, with the reasons. */
export function matchUnits(lead, units, projects = [], limit = 5) {
  const kind = KIND_FOR_LOB[lead.lob];
  const out = [];
  for (const u of units) {
    if (u.status !== 'Available' || (kind && u.kind !== kind)) continue;
    const reasons = [];
    let score = 0;
    const db = Math.abs(BED_ORDER.indexOf(u.beds) - BED_ORDER.indexOf(lead.beds));
    if (lead.beds && db === 0) { score += 40; reasons.push(`${u.beds === 'Studio' ? 'Studio' : `${u.beds}BR`} as asked`); } else if (lead.beds && db === 1) { score += 15; reasons.push('One bedroom off'); }
    if (lead.budgetMax) {
      if (u.price <= lead.budgetMax) { score += 30; reasons.push('Within budget'); } else if (u.price <= lead.budgetMax * 1.1) { score += 10; reasons.push('Up to 10% over budget'); } else continue;
    }
    const project = projects.find((p) => p.id === u.projectId);
    if (lead.project && project && project.name === lead.project) { score += 25; reasons.push(`In ${project.name}`); }
    if (lead.area && (u.area === lead.area || (project && project.area === lead.area))) { score += 20; reasons.push(`In ${lead.area}`); }
    if (score >= 40) out.push({ unit: u, project, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.unit.price - b.unit.price).slice(0, limit);
}

/* ---------- campaigns ---------- */

/** Ad permit state: valid, expiring (within 30 days), expired or missing. */
export function permitState(permit, t) {
  if (!permit || !permit.number) return { state: 'missing', text: 'No ad permit' };
  if (permit.expiresAt < t) return { state: 'expired', text: 'Permit expired' };
  if (permit.expiresAt - t < 30 * DAY) return { state: 'expiring', text: `Permit expires in ${Math.ceil((permit.expiresAt - t) / DAY)} days` };
  return { state: 'valid', text: 'Permit valid' };
}

/** Funnel from spend to commission for one campaign, from the leads it brought in. */
export function campaignFunnel(campaign, leads, deals) {
  const own = leads.filter((l) => l.campaignId === campaign.id);
  const dealOf = (l) => deals.find((d) => d.id === l.dealId);
  const won = own.map(dealOf).filter((d) => d && d.stage === 'Won');
  const commission = won.reduce((n, d) => n + commissionFor(d).firmNet, 0);
  const spend = campaign.spend.reduce((n, x) => n + x.amount, 0);
  return {
    spend, leads: own.length,
    contacted: own.filter((l) => l.firstResponseAt).length,
    qualified: own.filter((l) => ['Qualified', 'Viewing', 'Converted'].includes(l.status)).length,
    deals: own.filter((l) => l.dealId).length, won: won.length, commission,
    cpl: own.length ? Math.round(spend / own.length) : null,
    roi: spend ? commission / spend : null,
  };
}
