// Home for owners, directors, marketing and compliance: firm snapshot, leads and pipeline, setup progress,
// licence expiries, team and recent activity. Agents and team leaders get My Day instead (bpMyDay).
// LWC equivalent: c-bp-home composed of c-bp-stat-tile, c-bp-firm-card and c-bp-activity-list.

import { card, uIcon, badge, avatar } from '../core/ui.js';
import { esc, fmtDate, fmtAgo, DAY } from '../core/util.js';
import { getState, now } from '../core/store.js';
import { PLANS } from '../core/config.js';
import { firmOf, visibleUsers, seatsUsed } from '../services/firmService.js';
import { visibleLeads, isOpenLead } from '../services/leadService.js';
import { visibleDeals } from '../services/dealService.js';
import { slaState, dealRisks, cashNeedsReport } from '../core/rules.js';
import { fmtAED, fmtDuration } from '../core/util.js';

function tile(label, value, sub = '', cls = '') {
  return `<div class="bp-tile ${cls}"><div class="bp-tile-label">${esc(label)}</div><div class="bp-tile-value">${value}</div><div class="bp-tile-sub">${sub}</div></div>`;
}

function expiry(label, t) {
  const days = Math.ceil((t - now()) / DAY);
  const theme = days <= 0 ? 'error' : days <= 30 ? 'warning' : 'success';
  return `<li><span style="flex:1">${esc(label)}</span><span class="bp-small bp-muted">${fmtDate(t)}</span>${badge(days <= 0 ? 'Expired' : `${days} days`, theme)}</li>`;
}

export function bpHome(user) {
  const firm = firmOf(user);
  const people = visibleUsers(user);
  const active = people.filter((u) => u.status === 'Active');
  const t = now();
  const brnIssues = active.filter((u) => u.brn && u.brnExpiry - t < 30 * DAY);
  const g = firm.settings.golive;
  const steps = [['Brand and teams', firm.teams.length > 0], ['Team invited', people.length > 1], ['Lead sources connected', g.propertyFinder || g.bayut], ['First lead received', g.firstLead]];
  const done = steps.filter((s) => s[1]).length;
  const recent = getState().audit.filter((a) => a.firmId === firm.id).slice(0, 6);
  const leads = visibleLeads(user);
  const leads24 = leads.filter((l) => t - l.createdAt < DAY);
  const late = leads.filter((l) => slaState(l, t).state === 'breached').length;
  const deals = visibleDeals(user);
  const openDeals = deals.filter((d) => !['Won', 'Lost'].includes(d.stage));
  const replied = leads.filter((l) => l.firstResponseAt && t - l.createdAt < 7 * DAY);
  const avgReply = replied.length ? replied.reduce((n, l) => n + (l.firstResponseAt - l.createdAt), 0) / replied.length : null;
  const hour = new Date(t + 4 * 3600e3).getUTCHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const hero = `<div class="bp-hero"><div><h1>${greeting}, ${esc(user.name.split(' ')[0])}</h1>
    <p>${esc(firm.name)} · ${esc(PLANS[firm.plan]?.label || firm.plan)} · ${active.length} active ${active.length === 1 ? 'person' : 'people'}</p></div>
    ${!firm.setupComplete && user.role === 'Owner' ? '<a class="slds-button slds-button_neutral" href="portal/#/onboarding">Finish setup</a>' : ''}</div>`;

  const tiles = `<div class="bp-tiles">
    ${tile('Seats used', `${seatsUsed(firm.id)} / ${firm.seats}`, 'active and invited')}
    ${tile('Setup', `${done} / ${steps.length}`, done === steps.length ? 'all done' : 'steps complete', done === steps.length ? 'good' : 'warn')}
    ${tile('Licences needing action', String(brnIssues.length), 'BRNs expired or expiring in 30 days', brnIssues.length ? 'bad' : 'good')}
    ${tile('Leads in the last 24 hours', String(leads24.length), `${late} past the first-reply SLA`, late ? 'bad' : 'good')}
  </div>`;

  const setup = card('Getting live', `<ul class="bp-list">${steps.map(([label, ok]) => `<li>${ok ? `<span class="slds-badge slds-theme_success">${uIcon('check', 'slds-icon_xx-small')}</span>` : '<span class="slds-badge">To do</span>'}<span>${esc(label)}</span></li>`).join('')}</ul>`, { icon: 'task' });

  const licences = card('Firm licences', `<ul class="bp-list">${expiry('Trade licence', firm.licenceExpiry)}${expiry('RERA office registration (ORN)', firm.ornExpiry)}</ul>
    ${brnIssues.length ? `<div class="slds-m-top_small bp-small"><b>Agent BRNs</b></div><ul class="bp-list">${brnIssues.map((u) => expiry(u.name, u.brnExpiry)).join('')}</ul>` : ''}`, { icon: 'disclosure_and_compliance' });

  const team = card('Your team', `<ul class="bp-list">${active.slice(0, 8).map((u) => `<li>${avatar(u.name, firm.brand, 28)}<span style="flex:1">${esc(u.name)}</span><span class="bp-small bp-muted">${esc(u.role)}</span></li>`).join('')}</ul>
    ${user.role === 'Owner' ? `<div class="slds-m-top_small"><a class="bp-link bp-small" href="portal/#/people">Manage people →</a></div>` : ''}`, { icon: 'people' });

  const activity = card('Recent activity', recent.length ? `<ul class="bp-list">${recent.map((a) => `<li><span style="flex:1"><b>${esc(a.action)}</b><div class="bp-small bp-muted">${esc(a.detail)}</div></span><span class="bp-small bp-muted">${fmtAgo(a.at, t)}</span></li>`).join('')}</ul>` : '<div class="bp-empty">No activity yet.</div>', { icon: 'feed' });

  const pipe = deals.length || leads.length ? card('Leads and pipeline', `<ul class="bp-list">
      <li><span style="flex:1">Open leads</span><b>${leads.filter(isOpenLead).length}</b><a class="bp-link bp-small" href="portal/#/leads">Inbox →</a></li>
      <li><span style="flex:1">Average first reply (7 days)</span><b>${avgReply === null ? '—' : fmtDuration(avgReply)}</b><span class="bp-small bp-muted">SLA ${firm.settings.sla.firstResponseMin} min</span></li>
      <li><span style="flex:1">Open deals</span><b>${openDeals.length} · ${fmtAED(openDeals.reduce((n, d) => n + d.value, 0))}</b><a class="bp-link bp-small" href="portal/#/pipeline">Pipeline →</a></li>
      <li><span style="flex:1">Deals at risk</span><b class="${openDeals.some((d) => dealRisks(d, t).length) ? 'bp-risk' : ''}">${openDeals.filter((d) => dealRisks(d, t).length).length}</b><span class="bp-small bp-muted">Deal Coach</span></li>
    </ul>`, { icon: 'opportunity' }) : '';

  const queue = deals.filter((d) => d.kyc.status === 'Submitted' || d.kyc.screening.status === 'Possible match' || (cashNeedsReport(d) && !d.rearDrafted));
  const compliance = user.role === 'Compliance' || user.role === 'Owner' ? card('Waiting for Compliance', queue.length ? `<ul class="bp-list">${queue.map((d) => `<li><span style="flex:1"><a class="bp-link" href="portal/#/deal/${esc(d.id)}/kyc"><b>${esc(d.clientName)}</b></a><div class="bp-small bp-muted">${esc(d.id)} · ${esc(d.type)}</div></span>
      ${d.kyc.screening.status === 'Possible match' ? badge('Screening match', 'error') : d.kyc.status === 'Submitted' ? badge('KYC to verify', 'warning') : badge('REAR needed', 'warning')}</li>`).join('')}</ul>` : '<div class="bp-empty">Nothing waiting.</div>', { icon: 'approval' }) : '';

  const next = card('Coming next', `<p class="bp-small bp-muted slds-m-bottom_small">Drop 3 adds the rest of the firm's tools.</p>
    <ul class="slds-list_dotted bp-small"><li>Inventory with unit matching</li><li>Campaign studio with ad permits and ROI</li><li>Team performance, commission ledger and compliance centre</li><li>Firm settings: routing, SLAs, pipelines and templates</li></ul>`, { icon: 'einstein_replies' });

  return `${hero}${tiles}<div class="bp-grid bp-cols-2"><div class="bp-grid">${compliance}${pipe}${team}${activity}</div><div class="bp-grid">${firm.setupComplete ? '' : setup}${licences}${next}</div></div>`;
}

