// P10 Commission and finance: expected → invoiced → collected → paid out, payer ageing with overdue flags,
// invoices with VAT, agent payouts and co-broke splits. Every amount links to its deal, lead, source and campaign.
// LWC equivalent: c-bp-commission-ledger composed of c-bp-chart, c-bp-ageing-table, c-bp-ledger-table, c-bp-payouts.
// Acceptance: every AED of commission is traceable to its deal and campaign.

import { card, uIcon, badge, emptyState, select, toast } from '../core/ui.js';
import { esc, fmtAED, fmtCompact, fmtDate } from '../core/util.js';
import { tabSession } from '../core/store.js';
import { ledger, summary, payerAgeing, agentPayouts, sendReminder } from '../services/financeService.js';
import { advanceCommission } from '../services/dealService.js';
import { funnelChart } from './bpChart.js';

const STATUS_THEME = { Expected: 'light', Invoiced: 'warning', Collected: 'info', 'Paid out': 'success' };

export function bpCommissionLedger(user) {
  const rows = ledger(user);
  if (!rows.length) return card('Commission', emptyState('No commission yet', 'Commission appears here as deals are created and won.'));
  const sum = summary(rows);
  const ageing = payerAgeing(rows);
  const payouts = agentPayouts(rows);
  const filter = tabSession.get('ledgerStatus', '');
  const shown = rows.filter((r) => !filter || (filter === 'Overdue' ? r.overdueDays > 0 : r.status === filter)).sort((a, b) => b.overdueDays - a.overdueDays || b.firmNet - a.firmNet);

  const flow = card('From expected to paid out', funnelChart([
    { label: 'Expected (open deals)', value: sum.expected, display: fmtAED(sum.expected), pct: false },
    { label: 'Invoiced', value: sum.invoiced, display: fmtAED(sum.invoiced), pct: false },
    { label: 'Collected', value: sum.collected, display: fmtAED(sum.collected), pct: false },
    { label: 'Paid out to agents', value: sum.paidOut, display: fmtAED(sum.paidOut), pct: false },
  ], { label: 'Commission by status' }) + `<p class="bp-small bp-muted">Firm net after co-broke shares (${fmtAED(sum.coBroke)} to other firms). VAT on invoices: ${fmtAED(sum.vatDue)}.</p>`, { icon: 'currency' });

  const ageCard = card('Who owes us', ageing.length ? `<div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer"><thead><tr><th>Payer</th><th>0–30 days</th><th>31–60</th><th>60+</th><th>Total (incl. VAT)</th></tr></thead><tbody>
    ${ageing.map((a) => `<tr><td><b>${esc(a.payer)}</b>${a.overdue ? ` <span class="bp-flag dnc">${a.overdue} overdue</span>` : ''}</td><td>${a.b0 ? fmtAED(a.b0) : '—'}</td><td>${a.b30 ? fmtAED(a.b30) : '—'}</td><td class="${a.b60 ? 'bp-risk' : ''}">${a.b60 ? fmtAED(a.b60) : '—'}</td><td><b>${fmtAED(a.total)}</b></td></tr>`).join('')}
    </tbody></table></div><p class="bp-small bp-muted slds-m-top_x-small"><span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} Finance check</span> flags invoices past their 30-day due date.</p>` : '<div class="bp-empty">Nothing outstanding.</div>', { icon: 'service_appointment' });

  const payCard = card('Agent payouts', payouts.length ? `<ul class="bp-list">${payouts.map((p) => `<li><span style="flex:1">${esc(p.agent ? p.agent.name : 'Unassigned')}<div class="bp-small bp-muted">${p.deals} deal${p.deals === 1 ? '' : 's'}</div></span>
    <span style="text-align:right"><b class="${p.owed ? 'bp-risk' : ''}">${fmtAED(p.owed)}</b><div class="bp-small bp-muted">owed · ${fmtAED(p.paid)} paid</div></span></li>`).join('')}</ul>` : '<div class="bp-empty">No collected commission yet.</div>', { icon: 'people' });

  const filters = ['', 'Overdue', 'Expected', 'Invoiced', 'Collected', 'Paid out'];
  const table = `<div class="bp-toolbar"><div class="bp-tool">${select('ledger-status', 'Show', filters.map((f) => [f, f || 'All']), { value: filter, attrs: 'data-act="ledgerFilter"' })}</div>
    <div class="bp-board-sum"><span><b class="${sum.overdue ? 'bp-risk' : ''}">${fmtAED(sum.overdue)}</b> overdue</span><span><b>${fmtAED(sum.owedToAgents)}</b> owed to agents</span></div></div>
    <div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer bp-ledger"><thead><tr>
      <th>Deal</th><th>Trail</th><th>Value</th><th>Commission</th><th>Co-broke</th><th>Firm net</th><th>VAT</th><th>Agent</th><th>Status</th><th></th></tr></thead><tbody>
    ${shown.map((r) => `<tr><td><a class="bp-link" href="portal/#/deal/${esc(r.deal.id)}/commission"><b>${esc(r.deal.clientName)}</b></a><div class="bp-small bp-muted">${esc(r.deal.id)} · ${esc(r.deal.type)} · ${esc(r.payer)}</div></td>
      <td class="bp-small">${r.lead ? `<a class="bp-link" href="portal/#/lead/${esc(r.lead.id)}">${esc(r.lead.id)}</a> · ${esc(r.source)}` : '—'}${r.campaign ? `<div>${uIcon('campaign', 'slds-icon_xx-small')} <a class="bp-link" href="portal/#/campaigns/${esc(r.campaign.id)}">${esc(r.campaign.name)}</a></div>` : ''}</td>
      <td>${fmtCompact(r.deal.value)}</td><td>${fmtAED(r.gross)} <span class="bp-small bp-muted">${r.deal.commission.rate}%</span></td><td>${r.coBrokeShare ? fmtAED(r.coBrokeShare) : '—'}</td>
      <td><b>${fmtAED(r.firmNet)}</b></td><td>${fmtAED(r.vat)}</td><td>${fmtAED(r.agentPayout)}<div class="bp-small bp-muted">${esc(r.owner ? r.owner.name : '')}</div></td>
      <td>${badge(r.status, STATUS_THEME[r.status])}${r.overdueDays ? `<div class="bp-small bp-risk">${r.overdueDays} days overdue</div>` : ''}${r.status === 'Invoiced' && r.deal.commission.invoiceDueAt ? `<div class="bp-small bp-muted">due ${fmtDate(r.deal.commission.invoiceDueAt)}</div>` : ''}</td>
      <td class="bp-row-actions">${r.status === 'Invoiced' ? `<button type="button" class="slds-button slds-button_neutral" data-act="chaseInvoice" data-id="${esc(r.deal.id)}">Chase</button>` : ''}
        ${['Invoiced', 'Collected'].includes(r.status) ? `<button type="button" class="slds-button slds-button_neutral" data-act="ledgerAdvance" data-id="${esc(r.deal.id)}">Mark ${r.status === 'Invoiced' ? 'collected' : 'paid out'}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
  return `<div class="bp-page-title"><div><h1>Commission</h1><p class="bp-muted bp-small">Every amount links to its deal, lead, source and campaign.</p></div></div>
    <div class="bp-tiles">
      <div class="bp-tile"><div class="bp-tile-label">Expected</div><div class="bp-tile-value">${fmtCompact(sum.expected)}</div><div class="bp-tile-sub">AED from open deals</div></div>
      <div class="bp-tile ${sum.overdue ? 'bad' : ''}"><div class="bp-tile-label">Invoiced, not collected</div><div class="bp-tile-value">${fmtCompact(sum.invoiced)}</div><div class="bp-tile-sub">${fmtAED(sum.overdue)} overdue</div></div>
      <div class="bp-tile"><div class="bp-tile-label">Collected</div><div class="bp-tile-value">${fmtCompact(sum.collected)}</div><div class="bp-tile-sub">${fmtAED(sum.owedToAgents)} owed to agents</div></div>
      <div class="bp-tile good"><div class="bp-tile-label">Paid out</div><div class="bp-tile-value">${fmtCompact(sum.paidOut)}</div><div class="bp-tile-sub">AED firm net</div></div>
    </div>
    <div class="bp-grid bp-cols-2">${flow}<div class="bp-grid">${ageCard}${payCard}</div></div>
    <div class="slds-card bp-card slds-m-top_medium">${table}</div>`;
}

export const ledgerActions = (getActor, refresh) => ({
  ledgerFilter(el) { tabSession.set('ledgerStatus', el.value); refresh(); },
  chaseInvoice(el) { sendReminder(getActor(), el.dataset.id); toast('success', 'Reminder sent', 'Logged on the deal.'); },
  ledgerAdvance(el) { advanceCommission(getActor(), el.dataset.id); toast('success', 'Commission updated'); },
});
