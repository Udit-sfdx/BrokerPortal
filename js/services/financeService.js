// Commission and finance: expected → invoiced → collected → paid out, developer ageing, VAT, agent payouts, splits.
// Mirrors BP_CommissionService (Apex). Every amount links to its deal, lead, source and campaign.

import { getState, mutate, now, audit } from '../core/store.js';
import { assertValid, DAY } from '../core/util.js';
import { commissionFor } from '../core/rules.js';
import { visibleDeals, canManageCommission, getDeal } from './dealService.js';

/** One ledger row per deal with its commission trail. */
export function ledger(actor) {
  if (!canManageCommission(actor)) return [];
  const s = getState();
  const t = now();
  return visibleDeals(actor).filter((d) => d.stage !== 'Lost').map((d) => {
    const c = commissionFor(d);
    const lead = s.leads.find((l) => l.id === d.leadId);
    const campaign = lead && lead.campaignId ? s.campaigns.find((x) => x.id === lead.campaignId) : null;
    const owner = s.users.find((u) => u.id === d.ownerId);
    const status = d.stage === 'Won' ? d.commission.status : 'Expected';
    const payer = d.unit.developer || d.commission.payer;
    const overdueDays = status === 'Invoiced' && d.commission.invoiceDueAt < t ? Math.floor((t - d.commission.invoiceDueAt) / DAY) : 0;
    return { deal: d, ...c, status, payer, owner, lead, source: lead ? lead.source : '—', campaign, overdueDays, invoiceAgeDays: d.commission.invoicedAt ? Math.floor((t - d.commission.invoicedAt) / DAY) : null };
  });
}

/** Totals per status, plus overdue and owed to agents. */
export function summary(rows) {
  const sum = (f) => rows.filter(f).reduce((n, r) => n + r.firmNet, 0);
  return {
    expected: sum((r) => r.status === 'Expected'), invoiced: sum((r) => r.status === 'Invoiced'), collected: sum((r) => r.status === 'Collected'), paidOut: sum((r) => r.status === 'Paid out'),
    overdue: sum((r) => r.overdueDays > 0), vatDue: rows.filter((r) => ['Invoiced', 'Collected', 'Paid out'].includes(r.status)).reduce((n, r) => n + r.vat, 0),
    owedToAgents: rows.filter((r) => r.status === 'Collected').reduce((n, r) => n + r.agentPayout, 0),
    coBroke: rows.reduce((n, r) => n + r.coBrokeShare, 0),
  };
}

/** Invoiced, not yet collected, grouped by who pays, in age buckets. */
export function payerAgeing(rows) {
  const out = {};
  for (const r of rows.filter((x) => x.status === 'Invoiced')) {
    const k = r.payer;
    out[k] = out[k] || { payer: k, b0: 0, b30: 0, b60: 0, total: 0, overdue: 0 };
    const age = r.invoiceAgeDays || 0;
    out[k][age <= 30 ? 'b0' : age <= 60 ? 'b30' : 'b60'] += r.invoiceTotal;
    out[k].total += r.invoiceTotal;
    if (r.overdueDays) out[k].overdue += 1;
  }
  return Object.values(out).sort((a, b) => b.total - a.total);
}

/** Per agent: collected but not paid out (owed), and paid out. */
export function agentPayouts(rows) {
  const out = {};
  for (const r of rows.filter((x) => ['Collected', 'Paid out'].includes(x.status))) {
    const k = r.owner ? r.owner.id : 'none';
    out[k] = out[k] || { agent: r.owner, owed: 0, paid: 0, deals: 0 };
    out[k][r.status === 'Collected' ? 'owed' : 'paid'] += r.agentPayout;
    out[k].deals += 1;
  }
  return Object.values(out).sort((a, b) => b.owed - a.owed || b.paid - a.paid);
}

/** Records a payment reminder to the payer (demo: logged; the real build emails the developer's finance team). */
export function sendReminder(actor, dealId) {
  const deal = getDeal(actor, dealId);
  const problems = [];
  if (!canManageCommission(actor)) problems.push('Only finance, a director or the owner can chase invoices.');
  if (!deal) problems.push('Deal not found.');
  else if (deal.commission.status !== 'Invoiced') problems.push('Only invoiced commission can be chased.');
  assertValid(problems);
  return mutate((s) => {
    const d = s.deals.find((x) => x.id === dealId);
    d.commission.remindedAt = now();
    d.activity = d.activity || [];
    d.activity.unshift({ at: now(), text: `Payment reminder sent to ${d.unit.developer || d.commission.payer}.`, by: actor.name });
    audit(actor.name, 'Commission reminder', `${d.id} ${d.clientName}.`, d.firmId);
  });
}
