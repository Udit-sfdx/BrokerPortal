// P11 Compliance centre: KYC queue, screening matches, REAR/goAML tasks, expiries 30 days ahead, DNC hits,
// audit log, ad-hoc watchlist screening, and the Privacy check (10 cross-firm attempts, each blocked).
// LWC equivalent: c-bp-compliance-center composed of c-bp-kyc-queue, c-bp-expiry-list, c-bp-audit-log, c-bp-privacy-check.
// Acceptance: expiring licences and permits show 30 days ahead.

import { card, uIcon, badge, emptyState, field, openModal, toast } from '../core/ui.js';
import { esc, fmtAED, fmtDate, fmtDateTime, fmtAgo, fmtDuration, DAY } from '../core/util.js';
import { now, tabSession } from '../core/store.js';
import { centre, screenAnyName, privacyCheck } from '../services/complianceService.js';

export function bpComplianceCenter(user) {
  const c = centre(user);
  if (!c) return card('Compliance', emptyState('Not available for your role', 'Compliance, directors and the owner use this page.'));
  const t = now();
  const auditFilter = tabSession.get('auditQ', '');
  const log = c.auditLog.filter((a) => !auditFilter || `${a.actor} ${a.action} ${a.detail}`.toLowerCase().includes(auditFilter.toLowerCase())).slice(0, 60);
  const screenRes = tabSession.get('screenRes', null);

  const kyc = card(`KYC to review ${c.kycQueue.length ? `<span class="bp-pill-n">${c.kycQueue.length}</span>` : ''}`, c.kycQueue.length ? `<ul class="bp-list">${c.kycQueue.map((d) => `<li>
      <span style="flex:1"><a class="bp-link" href="portal/#/deal/${esc(d.id)}/kyc"><b>${esc(d.clientName)}</b></a><div class="bp-small bp-muted">${esc(d.id)} · ${esc(d.type)} · waiting ${fmtDuration(t - d.kyc.submittedAt)}</div></span>
      ${d.kyc.screening.status === 'Not run' ? badge('Screen first', 'warning') : badge(`Screening ${d.kyc.screening.status.toLowerCase()}`, d.kyc.screening.status === 'Clear' ? 'success' : 'error')}
      <a class="slds-button slds-button_neutral" href="portal/#/deal/${esc(d.id)}/kyc">Review</a></li>`).join('')}</ul>` : emptyState('Queue empty', 'Submitted KYC appears here for review.'), { icon: 'approval' });

  const matches = card('Screening matches', c.matches.length ? `<ul class="bp-list">${c.matches.map((d) => `<li><span style="flex:1"><a class="bp-link" href="portal/#/deal/${esc(d.id)}/kyc"><b>${esc(d.clientName)}</b></a>
      <div class="bp-small bp-risk">Possible match: ${esc(d.kyc.screening.hits[0]?.name || '')} (${d.kyc.screening.hits[0]?.pct || 0}%, ${esc(d.kyc.screening.hits[0]?.list || '')})</div></span></li>`).join('')}</ul>` : '<div class="bp-empty">No open matches.</div>', { icon: 'disclosure_and_compliance' });

  const rear = card('REAR / goAML tasks', c.rear.length ? `<ul class="bp-list">${c.rear.map((d) => `<li><span style="flex:1"><a class="bp-link" href="portal/#/deal/${esc(d.id)}/kyc"><b>${esc(d.clientName)}</b></a>
      <div class="bp-small bp-muted">Cash ${fmtAED(d.cashAmount)} on ${esc(d.id)}</div></span>${d.rearDrafted ? badge('Draft ready for the AML officer', 'success') : badge('Draft needed', 'warning')}</li>`).join('')}</ul>
      <p class="bp-small bp-muted">The Compliance Checker drafts; the AML officer files through goAML. Nothing is filed automatically.</p>` : '<div class="bp-empty">No cash above the threshold.</div>', { icon: 'report' });

  const expiries = card('Expiring in the next 30 days', c.expiries.length ? `<ul class="bp-list">${c.expiries.map((e) => `<li><span style="flex:1"><b>${esc(e.name)}</b><div class="bp-small bp-muted">${esc(e.kind)}</div></span>
      ${badge(e.expired ? `Expired ${fmtDate(e.at)}` : `${Math.ceil((e.at - t) / DAY)} days · ${fmtDate(e.at)}`, e.expired ? 'error' : 'warning')}<a class="bp-link bp-small" href="portal/${esc(e.link)}">Open</a></li>`).join('')}</ul>` : '<div class="bp-empty">Nothing expires in the next 30 days.</div>', { icon: 'date_time' });

  const dnc = card('Do-not-call hits', c.dncHits.length ? `<ul class="bp-list">${c.dncHits.map((a) => `<li><span style="flex:1">${esc(a.detail)}<div class="bp-small bp-muted">${esc(a.actor)} · ${fmtAgo(a.at, t)}</div></span>${badge('Blocked', 'success')}</li>`).join('')}</ul>` : '<div class="bp-empty">No blocked calls yet. Every attempt to call a DNC number is blocked and listed here.</div>', { icon: 'call' });

  const screen = card('Screen a name', `<form data-submit="screenName" class="bp-inline-form">${field('scrName', 'Full name', { name: 'name', attrs: 'placeholder="e.g. Viktor Brankovich"' }).replace('slds-m-bottom_small', 'slds-m-bottom_none')}<button type="submit" class="slds-button slds-button_brand" style="align-self:flex-end">Screen</button></form>
    ${screenRes ? `<div class="slds-m-top_small">${screenRes.hits.length ? `<div class="bp-small bp-risk"><b>Possible match</b> for "${esc(screenRes.name)}": ${screenRes.hits.map((h) => `${esc(h.name)} (${h.pct}%, ${esc(h.list)})`).join('; ')}</div>` : `<div class="bp-small bp-ok-text">${uIcon('check', 'slds-icon_xx-small')} "${esc(screenRes.name)}" is clear.</div>`}</div>` : ''}
    <p class="bp-small bp-muted">Demo watchlist (fictional names). Each check is logged.</p>`, { icon: 'search' });

  const privacy = card('Privacy check', `<p class="bp-small">Tries 10 ways to reach another firm's data as you, and shows each one blocked. The real build runs the same suite on every release.</p>
    <button type="button" class="slds-button slds-button_brand slds-m-top_small" data-act="runPrivacyCheck">${uIcon('lock', 'slds-icon_x-small')}&nbsp;Run privacy check</button>`, { icon: 'entitlement_policy' });

  const audit = card('Audit log', `<div class="bp-toolbar" style="padding:0 0 8px"><div class="bp-tool bp-tool-search">${field('auditQ', 'Filter', { value: auditFilter, attrs: 'data-act="auditFilter" placeholder="Person, action or record"' })}</div></div>
    <div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
    ${log.map((a) => `<tr><td class="bp-small">${fmtDateTime(a.at)}</td><td class="bp-small">${esc(a.actor)}</td><td class="bp-small"><b>${esc(a.action)}</b></td><td class="bp-small">${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>`, { icon: 'record' });

  return `<div class="bp-page-title"><div><h1>Compliance centre</h1><p class="bp-muted bp-small">KYC, screening, AML reports, licences and permits, and the audit trail.</p></div></div>
    <div class="bp-tiles">
      <div class="bp-tile ${c.kycQueue.length ? 'warn' : 'good'}"><div class="bp-tile-label">KYC to review</div><div class="bp-tile-value">${c.kycQueue.length}</div><div class="bp-tile-sub">oldest first</div></div>
      <div class="bp-tile ${c.matches.length ? 'bad' : 'good'}"><div class="bp-tile-label">Screening matches</div><div class="bp-tile-value">${c.matches.length}</div><div class="bp-tile-sub">need a decision</div></div>
      <div class="bp-tile ${c.rear.some((d) => !d.rearDrafted) ? 'warn' : 'good'}"><div class="bp-tile-label">REAR cases</div><div class="bp-tile-value">${c.rear.length}</div><div class="bp-tile-sub">${c.rear.filter((d) => !d.rearDrafted).length} without a draft</div></div>
      <div class="bp-tile ${c.expiries.length ? 'warn' : 'good'}"><div class="bp-tile-label">Expiring in 30 days</div><div class="bp-tile-value">${c.expiries.length}</div><div class="bp-tile-sub">licences and permits</div></div>
    </div>
    <div class="bp-grid bp-cols-2"><div class="bp-grid">${kyc}${expiries}${rear}</div><div class="bp-grid">${privacy}${matches}${screen}${dnc}</div></div>
    <div class="slds-m-top_medium">${audit}</div>`;
}

export const complianceActions = (getActor, refresh) => ({
  screenName(form) {
    const name = new FormData(form).get('name');
    const hits = screenAnyName(getActor(), String(name || ''));
    tabSession.set('screenRes', { name, hits });
    refresh();
  },
  auditFilter(el) { tabSession.set('auditQ', el.value); refresh(); },
  runPrivacyCheck() {
    const res = privacyCheck(getActor());
    const blocked = res.filter((r) => r.blocked).length;
    openModal(`Privacy check: ${blocked} of ${res.length} blocked`, `<ol class="bp-privacy-list">${res.map((r) => `<li class="${r.blocked ? 'ok' : 'leak'}">
      <span class="${r.blocked ? 'bp-ok' : 'bp-no'}">${uIcon(r.blocked ? 'check' : 'close', 'slds-icon_xx-small')}</span>
      <div><b>${esc(r.label)}</b><div class="bp-small bp-muted">${r.blocked ? 'Blocked' : 'NOT blocked'}: ${esc(r.detail)}</div><div class="bp-small">Salesforce control: ${esc(r.control)}</div></div></li>`).join('')}</ol>`,
    '<button type="button" class="slds-button slds-button_brand" data-act="closeModal">Close</button>');
    toast(blocked === res.length ? 'success' : 'error', `${blocked} of ${res.length} attempts blocked`, 'Logged in the audit trail.');
  },
});
