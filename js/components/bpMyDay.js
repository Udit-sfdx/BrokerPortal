// P2 My Day: the agent's daily brief, next three actions, priority list with live SLA timers,
// today's schedule (follow-ups, viewings, meetings), deals needing attention, and quick capture.
// LWC equivalent: c-bp-my-day composed of c-bp-brief, c-bp-priority-list, c-bp-agenda, c-bp-deal-alerts.
// Acceptance: an agent knows the next 3 actions without opening another page.

import { card, uIcon, badge, avatar, emptyState } from '../core/ui.js';
import { esc, fmtTime, fmtDate, fmtAED, fmtCompact, fmtDuration, DAY, HOUR } from '../core/util.js';
import { now, getState } from '../core/store.js';
import { slaState, dealRisks } from '../core/rules.js';
import { visibleLeads, isOpenLead, myTasks, TASK_TYPES } from '../services/leadService.js';
import { visibleDeals } from '../services/dealService.js';
import { morningBrief } from '../services/aiService.js';
import { firmOf } from '../services/firmService.js';
import { slaTimer, scoreChip, leadFlags, leadStatusBadge, followUpLabel } from './bpLeadBits.js';

const tile = (label, value, sub, cls = '', link = '') =>
  `<${link ? `a href="${link}"` : 'div'} class="bp-tile ${cls}"><div class="bp-tile-label">${esc(label)}</div><div class="bp-tile-value">${value}</div><div class="bp-tile-sub">${sub}</div></${link ? 'a' : 'div'}>`;

/** Priority order: SLA running (soonest first), SLA breached, overdue follow-up, then hottest. */
function priorityLeads(leads, t) {
  const rank = (l) => {
    const s = slaState(l, t).state;
    if (s === 'running') return 0;
    if (s === 'breached') return 1;
    if (l.nextFollowUpAt && l.nextFollowUpAt < t) return 2;
    return 3;
  };
  return leads.filter(isOpenLead).sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? a.slaDueAt - b.slaDueAt : b.score - a.score));
}

export function bpMyDay(user) {
  const t = now();
  const firm = firmOf(user);
  // Agents: their own work. Team leaders: their team's leads and deals (they coach and unblock), their own tasks.
  const scope = visibleLeads(user);
  const teamLeads = user.role === 'Team Leader' ? scope : [];
  const tasks = myTasks(user).filter((k) => !k.done);
  const deals = user.role === 'Agent' ? visibleDeals(user).filter((d) => d.ownerId === user.id) : visibleDeals(user);
  const users = new Map(getState().users.map((u) => [u.id, u.name.split(' ')[0]]));
  const brief = morningBrief(user, { leads: scope.map((l) => ({ ...l, ownerName: users.get(l.ownerId) })), tasks, deals }, t);
  const top = brief.items.slice(0, 3);
  const hour = new Date(t + 4 * HOUR).getUTCHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const hero = `<div class="bp-hero bp-hero-day"><div style="flex:1;min-width:0">
      <h1>${greeting}, ${esc(user.name.split(' ')[0])}</h1>
      <p class="bp-brief"><span class="bp-ai-tag bp-ai-tag-light">${uIcon('sparkles', 'slds-icon_xx-small')} Morning brief</span> ${esc(brief.summary)}</p></div>
    <button type="button" class="slds-button slds-button_neutral bp-capture-btn" data-act="quickCapture">${uIcon('add', 'slds-icon_x-small')}&nbsp;Quick capture</button></div>`;

  const next = `<section class="bp-next3" aria-label="Your next 3 actions"><h2 class="bp-section-title">Your next 3 actions</h2>
    ${top.length ? `<ol class="bp-next3-list">${top.map((it, i) => `<li class="bp-next-card">
      <span class="bp-next-n">${i + 1}</span>
      <div class="bp-next-body"><b>${esc(it.title)}</b><span>${esc(it.why)}</span></div>
      <div class="bp-next-act">${it.link ? `<a class="slds-button slds-button_brand" href="portal/${it.link}">Open</a>` : ''}
        ${it.taskId ? `<button type="button" class="slds-button slds-button_neutral" data-act="toggleTask" data-id="${esc(it.taskId)}" data-done="1">Done</button>` : ''}</div>
    </li>`).join('')}</ol>` : `<div class="bp-card slds-card">${emptyState('All clear', 'No new leads, overdue follow-ups or blocked deals. Call your warm leads or capture a walk-in.')}</div>`}</section>`;

  const waiting = scope.filter((l) => ['running', 'breached'].includes(slaState(l, t).state));
  const overdue = tasks.filter((k) => k.dueAt < t);
  const openDeals = deals.filter((d) => !['Won', 'Lost'].includes(d.stage));
  const tiles = `<div class="bp-tiles">
    ${tile('Waiting for a first call', String(waiting.length), waiting.filter((l) => slaState(l, t).state === 'breached').length ? `${waiting.filter((l) => slaState(l, t).state === 'breached').length} past the ${firm.settings.sla.firstResponseMin}-min SLA` : `within the ${firm.settings.sla.firstResponseMin}-min SLA`, waiting.some((l) => slaState(l, t).state === 'breached') ? 'bad' : waiting.length ? 'warn' : 'good', 'portal/#/leads/new')}
    ${tile('Overdue follow-ups', String(overdue.length), overdue.length ? 'clear these first' : 'none', overdue.length ? 'bad' : 'good')}
    ${tile(teamLeads.length ? 'Team open leads' : 'My open leads', String(scope.filter(isOpenLead).length), `${scope.filter((l) => isOpenLead(l) && l.score >= 70).length} hot`, '', `portal/#/leads/${teamLeads.length ? 'all' : 'mine'}`)}
    ${tile(teamLeads.length ? 'Team open deals' : 'My open deals', String(openDeals.length), `${fmtAED(openDeals.reduce((n, d) => n + d.value, 0))} in pipeline`, '', 'portal/#/pipeline')}
    ${teamLeads.length ? tile('Team: late first replies', String(teamLeads.filter((l) => slaState(l, t).state === 'breached').length), `${teamLeads.filter((l) => !l.ownerId && isOpenLead(l)).length} unassigned`, teamLeads.some((l) => slaState(l, t).state === 'breached') ? 'bad' : 'good', 'portal/#/leads/new') : ''}
  </div>`;

  const prio = priorityLeads(scope, t).slice(0, 8);
  const prioCard = card('Priority leads', prio.length ? `<ul class="bp-prio">${prio.map((l) => `<li>
      <a class="bp-prio-main" href="portal/#/lead/${esc(l.id)}"><b>${esc(l.name)}</b><span class="bp-small bp-muted">${esc(l.source)} · ${esc(l.interest)}</span></a>
      <span class="bp-prio-flags">${leadFlags(l)}</span>
      ${scoreChip(l)}
      <span class="bp-prio-time">${['running', 'breached'].includes(slaState(l, t).state) ? slaTimer(l, t) : followUpLabel(l, t)}</span>
    </li>`).join('')}</ul>` : emptyState('No open leads', 'New leads are routed to you within seconds of arriving.'),
  { icon: 'lead', actions: `<a class="bp-link bp-small" href="portal/#/leads/${teamLeads.length ? 'all' : 'mine'}">All ${teamLeads.length ? 'team' : 'my'} leads →</a>` });

  const todays = tasks.filter((k) => k.dueAt < t + 18 * HOUR).sort((a, b) => a.dueAt - b.dueAt);
  const agenda = card("Today's schedule", todays.length ? `<ul class="bp-agenda">${todays.map((k) => `<li class="${k.dueAt < t ? 'late' : ''}">
      <span class="bp-agenda-time">${k.dueAt < t ? `<b class="bp-late">late</b>` : `${fmtTime(k.dueAt)}${fmtDate(k.dueAt) !== fmtDate(t) ? '<br><span class="bp-muted">tmrw</span>' : ''}`}</span>
      <span class="bp-agenda-icon ${esc(k.type)}">${uIcon(k.type === 'viewing' ? 'location' : k.type === 'meeting' ? 'event' : 'call', 'slds-icon_xx-small')}</span>
      <a class="bp-agenda-title" href="portal/#/${k.leadId ? `lead/${esc(k.leadId)}` : k.dealId ? `deal/${esc(k.dealId)}` : 'home'}"><b>${esc(k.title)}</b><span class="bp-small bp-muted">${esc(TASK_TYPES[k.type])}${k.dueAt < t ? ` · due ${fmtTime(k.dueAt)}, ${fmtDuration(t - k.dueAt)} ago` : ''}</span></a>
      <button type="button" class="slds-button slds-button_icon slds-button_icon-border" title="Mark done" aria-label="Mark ${esc(k.title)} done" data-act="toggleTask" data-id="${esc(k.id)}" data-done="1">${uIcon('check', 'slds-icon_xx-small')}</button>
    </li>`).join('')}</ul>` : emptyState('Nothing scheduled', 'Book viewings and follow-ups from a lead.'), { icon: 'event' });

  const atRisk = deals.map((d) => ({ d, risks: dealRisks(d, t) })).filter((x) => x.risks.length).slice(0, 5);
  const dealCard = card('Deals needing attention', atRisk.length ? `<ul class="bp-list">${atRisk.map(({ d, risks }) => `<li>
      <span style="flex:1;min-width:0"><a class="bp-link" href="portal/#/deal/${esc(d.id)}"><b>${esc(d.clientName)}</b></a> <span class="bp-small bp-muted">${esc(d.type)} · ${fmtCompact(d.value)} AED</span>
      <div class="bp-small bp-risk">${uIcon('warning', 'slds-icon_xx-small')} ${esc(risks[0])}</div></span></li>`).join('')}</ul>
      <div class="bp-small bp-muted slds-m-top_x-small"><span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} Deal Coach</span> flags deals that are stuck, overdue or blocked.</div>` : emptyState('All deals on track', 'The Deal Coach flags stuck, overdue or blocked deals here.'), { icon: 'opportunity' });

  return `${hero}${next}${tiles}<div class="bp-grid bp-cols-2"><div class="bp-grid">${prioCard}</div><div class="bp-grid">${agenda}${dealCard}</div></div>`;
}
