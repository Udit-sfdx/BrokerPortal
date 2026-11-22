// P9 Team performance: leaderboard, speed to lead, SLA breaches, ageing leads, re-assign queue, coaching notes.
// LWC equivalent: c-bp-team-performance composed of c-bp-leaderboard, c-bp-chart, c-bp-reassign-queue, c-bp-coaching.
// Acceptance: a team leader can re-assign a stalled lead from this page.

import { card, uIcon, badge, avatar, emptyState, openModal, select, textarea, readForm, toast } from '../core/ui.js';
import { esc, fmtAED, fmtDuration, fmtDate, fmtAgo } from '../core/util.js';
import { now, tabSession } from '../core/store.js';
import { teamStats, reassignQueue, suggestedCoaching, coachingNotes, addCoachingNote } from '../services/teamService.js';
import { assignableUsers, assignLeads, leadOwnerName } from '../services/leadService.js';
import { firmOf } from '../services/firmService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';
import { barChart, gauge } from './bpChart.js';

const PERIODS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [60, 'Last 60 days']];

export function bpTeamPerformance(user) {
  const t = now();
  const days = Number(tabSession.get('teamDays', 30));
  const stats = teamStats(user, days);
  const firm = firmOf(user);
  const queue = reassignQueue(user);
  const people = assignableUsers(user);
  const total = stats.reduce((a, s) => ({ leads: a.leads + s.leads, breaches: a.breaches + s.breaches, won: a.won + s.wonValue }), { leads: 0, breaches: 0, won: 0 });
  const slaPct = total.leads ? Math.round(((total.leads - total.breaches) / total.leads) * 100) : 100;
  const replied = stats.filter((s) => s.avgReplyMs !== null);

  const board = `<div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer bp-board-table"><thead><tr>
    <th>#</th><th>Agent</th><th>Leads</th><th>Avg first reply</th><th>SLA</th><th>Converted</th><th>Won</th><th>Open</th><th>Ageing</th><th></th></tr></thead><tbody>
    ${stats.map((s, i) => `<tr><td>${i + 1}</td><td><span class="bp-owner">${avatar(s.user.name, firm.brand, 24)} <b>${esc(s.user.name)}</b></span>${s.user.role === 'Team Leader' ? ' <span class="bp-small bp-muted">TL</span>' : ''}${!s.brnOk && s.user.role === 'Agent' ? ' <span class="bp-flag dnc">BRN expired</span>' : ''}${s.user.status !== 'Active' ? ` ${badge(s.user.status, 'light')}` : ''}</td>
      <td>${s.leads}</td><td class="${s.avgReplyMs > firm.settings.sla.firstResponseMin * 60e3 ? 'bp-risk' : ''}">${s.avgReplyMs === null ? '—' : fmtDuration(s.avgReplyMs)}</td>
      <td>${s.slaPct === null ? '—' : `${s.slaPct}%`}${s.breaches ? ` <span class="bp-small bp-muted">(${s.breaches} late)</span>` : ''}</td><td>${s.convPct}%</td>
      <td>${s.won ? `${s.won} · ${fmtAED(s.wonValue)}` : '—'}</td><td>${s.open}</td><td class="${s.ageing > 2 ? 'bp-risk' : ''}">${s.ageing}</td>
      <td><button type="button" class="slds-button slds-button_neutral" data-act="coachOpen" data-id="${esc(s.user.id)}">Coaching</button></td></tr>`).join('')}
  </tbody></table></div>`;

  const speed = card('Speed to lead', replied.length ? barChart(replied.map((s) => ({ label: s.user.name.split(' ')[0], value: Math.round(s.avgReplyMs / 60e3), sub: 'min', tone: s.avgReplyMs > firm.settings.sla.firstResponseMin * 60e3 ? 'bad' : 'good' })), { label: 'Average first reply in minutes' }) : '<div class="bp-empty">No replies in this period.</div>', { icon: 'service_appointment' });
  const qCard = card(`Re-assign queue ${queue.length ? `<span class="bp-pill-n">${queue.length}</span>` : ''}`, queue.length ? `<ul class="bp-queue">${queue.slice(0, 15).map(({ lead, reason }) => `<li>
      <div class="bp-queue-main"><a class="bp-link" href="portal/#/lead/${esc(lead.id)}"><b>${esc(lead.name)}</b></a><div class="bp-small bp-muted">${esc(lead.interest)} · ${esc(leadOwnerName(lead))}</div><div class="bp-small bp-risk">${uIcon('warning', 'slds-icon_xx-small')} ${esc(reason)}</div></div>
      <form class="bp-inline-form" data-submit="queueAssign"><input type="hidden" name="leadId" value="${esc(lead.id)}">
        <select class="slds-select" name="to" aria-label="New owner for ${esc(lead.name)}"><option value="">New owner…</option>${people.filter((p) => p.id !== lead.ownerId).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
        <button type="submit" class="slds-button slds-button_brand">Re-assign</button></form></li>`).join('')}</ul>${queue.length > 15 ? `<p class="bp-small bp-muted">${queue.length - 15} more in the inbox.</p>` : ''}`
    : emptyState('Nothing stalled', 'Leads appear here when the first reply is late, nothing has happened for 5 days, or the owner can no longer take leads.'), { icon: 'queue' });

  return `<div class="bp-page-title"><div><h1>Team performance</h1><p class="bp-muted bp-small">${user.role === 'Team Leader' ? 'Your team' : 'Whole firm'} · leads that arrived in the period</p></div>
    <div class="bp-page-actions"><div class="bp-tool">${select('team-days', 'Period', PERIODS, { value: days, attrs: 'data-act="teamPeriod"' })}</div></div></div>
    <div class="bp-tiles">
      <div class="bp-tile">${gauge(slaPct, { label: 'First replies within SLA', tone: slaPct >= 85 ? 'good' : slaPct >= 70 ? 'warn' : 'bad' })}</div>
      <div class="bp-tile"><div class="bp-tile-label">Leads</div><div class="bp-tile-value">${total.leads}</div><div class="bp-tile-sub">${total.breaches} late first replies</div></div>
      <div class="bp-tile"><div class="bp-tile-label">Won</div><div class="bp-tile-value">${fmtAED(total.won)}</div><div class="bp-tile-sub">deal value in the period</div></div>
      <div class="bp-tile ${queue.length ? 'warn' : 'good'}"><div class="bp-tile-label">Stalled leads</div><div class="bp-tile-value">${queue.length}</div><div class="bp-tile-sub">in the re-assign queue</div></div>
    </div>
    ${card('Leaderboard', stats.length ? board : emptyState('No agents yet', 'Invite agents from People.'), { icon: 'reward' })}
    <div class="bp-grid bp-cols-2 slds-m-top_medium">${qCard}${speed}</div>`;
}

export const teamActions = (getActor, refresh) => ({
  teamPeriod(el) { tabSession.set('teamDays', Number(el.value)); refresh(); },
  queueAssign(form) {
    const f = readForm(form);
    const n = assignLeads(getActor(), [f.leadId], f.to);
    toast('success', n ? 'Lead re-assigned' : 'No change', n ? 'The new owner has been notified.' : '');
  },
  coachOpen(el) {
    const actor = getActor();
    const stat = teamStats(actor, Number(tabSession.get('teamDays', 30))).find((s) => s.user.id === el.dataset.id);
    if (!stat) return;
    const notes = coachingNotes(actor, stat.user.id);
    openModal(`Coaching: ${esc(stat.user.name)}`, modalForm('coach-form', 'submitCoaching', `<input type="hidden" name="agentId" value="${esc(stat.user.id)}">
      <p class="slds-m-bottom_x-small"><span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} Weekly coaching suggestion</span> from this period's numbers. Edit before saving.</p>
      ${textarea('coachText', 'Note for the agent', { value: suggestedCoaching(stat), name: 'text', attrs: 'rows="4"' })}
      ${notes.length ? `<div class="bp-small bp-muted slds-m-top_small">Earlier notes</div><ul class="bp-timeline">${notes.slice(0, 5).map((n) => `<li><span class="bp-tl-icon">${uIcon('note', 'slds-icon_xx-small')}</span><div><div class="bp-tl-text">${esc(n.text)}</div><div class="bp-small bp-muted">${esc(n.by)} · ${fmtDate(n.at)}</div></div></li>`).join('')}</ul>` : ''}`),
    modalFooter('coach-form', 'Save and notify'));
  },
  submitCoaching(form) { const f = readForm(form); submitModal(() => addCoachingNote(getActor(), f.agentId, f.text), { title: 'Coaching note saved', message: 'The agent has been notified.' }); },
});

export const _fmtAgo = fmtAgo;
