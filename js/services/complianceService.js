// Compliance centre: KYC queue, screening matches, REAR tasks, expiries 30 days ahead, DNC hits, audit log,
// ad-hoc screening, and the privacy check (10 cross-firm attempts, each must be blocked).
// Mirrors BP_ComplianceService (Apex).

import { getState, now, audit, mutate } from '../core/store.js';
import { assertValid, isBlank, DAY } from '../core/util.js';
import { cashNeedsReport, permitState, screenName } from '../core/rules.js';
import { firmOf } from './firmService.js';
import { visibleLeads, getLead, addNote, assignableUsers, assignLeads } from './leadService.js';
import { visibleDeals, getDeal, moveStage } from './dealService.js';
import { visibleUnits } from './inventoryService.js';
import { askCopilot } from './copilotService.js';
import { searchAll } from './searchService.js';

export const COMPLIANCE_ROLES = ['Owner', 'Director', 'Compliance'];
export const canSeeCompliance = (actor) => COMPLIANCE_ROLES.includes(actor.role);
const WINDOW = 30 * DAY;

export function centre(actor) {
  if (!canSeeCompliance(actor)) return null;
  const s = getState();
  const t = now();
  const firm = firmOf(actor);
  const deals = visibleDeals(actor);
  const expiries = [];
  const soon = (at) => at && at - t < WINDOW;
  for (const u of s.users.filter((x) => x.firmId === actor.firmId && x.status === 'Active' && x.role === 'Agent')) {
    if (soon(u.brnExpiry)) expiries.push({ kind: 'Agent BRN', name: u.name, at: u.brnExpiry, expired: u.brnExpiry < t, link: '#/people' });
  }
  for (const c of s.campaigns.filter((x) => x.firmId === actor.firmId && x.permit)) {
    const ps = permitState(c.permit, t);
    if (ps.state !== 'valid') expiries.push({ kind: 'Ad permit', name: `${c.name} (${c.permit.number})`, at: c.permit.expiresAt, expired: ps.state === 'expired', link: '#/campaigns' });
  }
  if (soon(firm.licenceExpiry)) expiries.push({ kind: 'Trade licence', name: firm.tradeLicence, at: firm.licenceExpiry, expired: firm.licenceExpiry < t, link: '#/settings' });
  if (soon(firm.ornExpiry)) expiries.push({ kind: 'Office registration (ORN)', name: firm.orn, at: firm.ornExpiry, expired: firm.ornExpiry < t, link: '#/settings' });
  expiries.sort((a, b) => a.at - b.at);
  return {
    kycQueue: deals.filter((d) => d.kyc.status === 'Submitted').sort((a, b) => a.kyc.submittedAt - b.kyc.submittedAt),
    matches: deals.filter((d) => d.kyc.screening.status === 'Possible match'),
    rear: deals.filter((d) => cashNeedsReport(d)),
    expiries,
    dncHits: s.audit.filter((a) => a.firmId === actor.firmId && a.action === 'Call blocked').slice(0, 30),
    auditLog: s.audit.filter((a) => a.firmId === actor.firmId).slice(0, 200),
  };
}

/** Ad-hoc screening of any name against the demo watchlist; logged. */
export function screenAnyName(actor, name) {
  assertValid(canSeeCompliance(actor) ? [] : ['Only Compliance, a director or the owner can screen names here.']);
  assertValid(isBlank(name) || name.trim().length < 3 ? ['Enter a full name.'] : []);
  const hits = screenName(name);
  mutate(() => audit(actor.name, 'Ad-hoc screening', `"${name.trim()}": ${hits.length ? `possible match (${hits[0].name})` : 'clear'}.`, actor.firmId));
  return hits;
}

/**
 * Runs 10 attempts to reach another firm's data as the current user. Each must be blocked.
 * Demo of the cross-firm automated test suite the real build runs on every release.
 */
export function privacyCheck(actor) {
  const s = getState();
  const other = s.firms.find((f) => f.id !== actor.firmId && s.leads.some((l) => l.firmId === f.id));
  const theirLead = s.leads.find((l) => l.firmId === other.id);
  const theirDeal = s.deals.find((d) => d.firmId === other.id) || { id: 'D-none' };
  const theirUser = s.users.find((u) => u.firmId === other.id && u.status === 'Active');
  const attempt = (label, control, fn) => {
    let blocked;
    let detail;
    try {
      const r = fn();
      blocked = r.blocked;
      detail = r.detail;
    } catch (err) {
      blocked = true;
      detail = err.messages ? err.messages[0] : err.message;
    }
    return { label, control, blocked, detail };
  };
  const results = [
    attempt(`List leads: any from ${other.name}?`, 'Private sharing, WITH USER_MODE', () => {
      const n = visibleLeads(actor).filter((l) => l.firmId !== actor.firmId).length;
      return { blocked: n === 0, detail: `${n} records from other firms returned` };
    }),
    attempt(`Open a ${other.name} lead by its ID`, 'Record access check', () => ({ blocked: getLead(actor, theirLead.id) === null, detail: 'Not found or not visible' })),
    attempt(`Open a ${other.name} deal by its ID`, 'Record access check', () => ({ blocked: getDeal(actor, theirDeal.id) === null, detail: 'Not found or not visible' })),
    attempt(`Search their client's phone (${theirLead.phone.slice(0, 7)}…)`, 'Search runs as the user', () => {
      const r = searchAll(actor, theirLead.phone);
      const leaked = r.groups.flatMap((g) => g.items).filter((i) => i.firmId && i.firmId !== actor.firmId).length;
      return { blocked: leaked === 0, detail: `${leaked} results from other firms` };
    }),
    attempt("Write a note on their lead", 'Service-side access check', () => { addNote(actor, theirLead.id, 'privacy check'); return { blocked: false, detail: 'Note saved' }; }),
    attempt('Move their deal to another stage', 'Service-side access check', () => { moveStage(actor, theirDeal.id, 'Lost', { lostReason: 'privacy check' }); return { blocked: false, detail: 'Deal moved' }; }),
    attempt(`Assign one of our leads to ${theirUser ? theirUser.name : 'their agent'}`, 'Pickers list own firm only', () => {
      const ours = visibleLeads(actor).find((l) => ['New', 'Contacted', 'Qualified', 'Viewing'].includes(l.status));
      if (!ours || !theirUser) return { blocked: true, detail: 'Nothing to assign' };
      assignLeads(actor, [ours.id], theirUser.id);
      return { blocked: false, detail: 'Assigned' };
    }),
    attempt('Their people in our pickers', 'External user visibility off', () => {
      const n = assignableUsers(actor).filter((u) => u.firmId !== actor.firmId).length;
      return { blocked: n === 0, detail: `${n} people from other firms offered` };
    }),
    attempt('Their units in our inventory', 'Firm-wide records shared to own firm only', () => {
      const n = visibleUnits(actor).filter((u) => u.firmId !== actor.firmId).length;
      return { blocked: n === 0, detail: `${n} units from other firms` };
    }),
    attempt(`Ask the Copilot about ${other.name}'s leads`, 'Agent runs as the asking user', () => {
      const a = askCopilot(actor, `How many leads does ${other.name} have?`);
      return { blocked: a.refused === true, detail: a.text };
    }),
  ];
  mutate(() => audit(actor.name, 'Privacy check', `${results.filter((r) => r.blocked).length} of ${results.length} cross-firm attempts blocked.`, actor.firmId));
  return results;
}
