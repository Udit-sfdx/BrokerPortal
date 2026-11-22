// Team performance: leaderboard, speed to lead, SLA breaches, ageing leads, re-assign queue, coaching notes.
// Mirrors BP_TeamService (Apex). Team leaders see their team; directors and the owner see the firm.

import { getState, mutate, now, nextId, audit } from '../core/store.js';
import { assertValid, isBlank, DAY, fmtDuration } from '../core/util.js';
import { slaState } from '../core/rules.js';
import { visibleLeads, isOpenLead } from './leadService.js';
import { visibleDeals } from './dealService.js';

export const TEAM_ROLES = ['Owner', 'Director', 'Team Leader'];
export const canSeeTeam = (actor) => TEAM_ROLES.includes(actor.role);
const AGEING_DAYS = 5;

/** Agents (and team leaders) this actor manages. */
export function teamMembers(actor) {
  if (!canSeeTeam(actor)) return [];
  return getState().users.filter((u) => u.firmId === actor.firmId && ['Agent', 'Team Leader'].includes(u.role) && u.status !== 'Invited'
    && (actor.role !== 'Team Leader' || u.teamId === actor.teamId));
}

/** Per-person stats over the last `days` days (leads that arrived in the window). */
export function teamStats(actor, days = 30) {
  const t = now();
  const from = t - days * DAY;
  const leads = visibleLeads(actor);
  const deals = visibleDeals(actor);
  return teamMembers(actor).map((u) => {
    const mine = leads.filter((l) => l.ownerId === u.id);
    const inWindow = mine.filter((l) => l.createdAt >= from);
    const replied = inWindow.filter((l) => l.firstResponseAt);
    const breaches = inWindow.filter((l) => ['missed', 'breached'].includes(slaState(l, t).state)).length;
    const myDeals = deals.filter((d) => d.ownerId === u.id);
    const won = myDeals.filter((d) => d.stage === 'Won' && d.closedAt >= from);
    const open = mine.filter(isOpenLead);
    return {
      user: u, leads: inWindow.length, open: open.length,
      avgReplyMs: replied.length ? replied.reduce((n, l) => n + (l.firstResponseAt - l.createdAt), 0) / replied.length : null,
      breaches, slaPct: inWindow.length ? Math.round(((inWindow.length - breaches) / inWindow.length) * 100) : null,
      converted: inWindow.filter((l) => l.status === 'Converted').length,
      convPct: inWindow.length ? Math.round((inWindow.filter((l) => l.status === 'Converted').length / inWindow.length) * 100) : 0,
      openDeals: myDeals.filter((d) => !['Won', 'Lost'].includes(d.stage)).length,
      wonValue: won.reduce((n, d) => n + d.value, 0), won: won.length,
      ageing: open.filter((l) => t - (l.lastActivityAt || l.createdAt) > AGEING_DAYS * DAY).length,
      brnOk: !!u.brnExpiry && u.brnExpiry > t,
    };
  }).sort((a, b) => b.wonValue - a.wonValue || b.convPct - a.convPct);
}

/**
 * Leads that need a new owner: no first reply past the SLA, no activity for 5+ days,
 * owner deactivated or with an expired BRN, or unassigned. Each with the reason.
 */
export function reassignQueue(actor) {
  if (!canSeeTeam(actor)) return [];
  const t = now();
  const users = new Map(getState().users.map((u) => [u.id, u]));
  const out = [];
  for (const l of visibleLeads(actor).filter(isOpenLead)) {
    const owner = users.get(l.ownerId);
    let reason = null;
    if (!l.ownerId) reason = 'Unassigned';
    else if (owner.status !== 'Active') reason = `${owner.name} is ${owner.status.toLowerCase()}`;
    else if (owner.role === 'Agent' && !(owner.brnExpiry > t)) reason = `${owner.name}'s BRN has expired`;
    else if (slaState(l, t).state === 'breached') reason = `No first reply for ${fmtDuration(t - l.createdAt)}`;
    else if (t - (l.lastActivityAt || l.createdAt) > AGEING_DAYS * DAY) reason = `No activity for ${Math.floor((t - l.lastActivityAt) / DAY)} days`;
    if (reason) out.push({ lead: l, owner, reason });
  }
  const rank = (r) => (r.reason === 'Unassigned' ? 0 : r.reason.includes('BRN') || r.reason.includes('is ') ? 1 : r.reason.startsWith('No first') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || b.lead.score - a.lead.score);
}

/** Scripted weekly coaching note (the AI suggestion); the team leader edits and saves it. */
export function suggestedCoaching(stat) {
  const name = stat.user.name.split(' ')[0];
  const tips = [];
  if (!stat.brnOk && stat.user.role === 'Agent') tips.push(`${name}'s BRN has expired: no new leads until it is renewed. Book the renewal this week.`);
  if (stat.avgReplyMs !== null && stat.avgReplyMs > 15 * 60e3) tips.push(`First replies average ${fmtDuration(stat.avgReplyMs)}, over the 15-minute SLA. Turn on new-lead alerts and call before messaging.`);
  if (stat.ageing > 2) tips.push(`${stat.ageing} open leads have had no activity for 5+ days. Close the dead ones and book follow-ups for the rest.`);
  if (stat.convPct >= 15) tips.push(`Converts ${stat.convPct}% of leads: ask ${name} to share how they run viewings.`);
  if (!tips.length) tips.push(`Steady week. Keep first replies under the SLA and push qualified leads to viewings.`);
  return tips.join(' ');
}

export const coachingNotes = (actor, agentId) => getState().coachingNotes.filter((n) => n.firmId === actor.firmId && n.agentId === agentId).sort((a, b) => b.at - a.at);

export function addCoachingNote(actor, agentId, text) {
  const member = teamMembers(actor).find((u) => u.id === agentId);
  const problems = [];
  if (!canSeeTeam(actor)) problems.push('Only team leaders and above can write coaching notes.');
  if (!member) problems.push('Choose someone in your team.');
  if (isBlank(text) || text.trim().length < 10) problems.push('Write at least 10 characters.');
  else if (text.length > 1000) problems.push('Keep notes under 1,000 characters.');
  assertValid(problems);
  return mutate((s) => {
    const note = { id: nextId('CN'), firmId: actor.firmId, agentId, by: actor.name, at: now(), text: text.trim() };
    s.coachingNotes.push(note);
    s.notifications.unshift({ id: nextId('N'), userId: agentId, text: `${actor.name} left you a coaching note.`, link: '#/home', at: now(), read: false });
    audit(actor.name, 'Coaching note', `For ${member.name}.`, actor.firmId);
    return note;
  });
}
