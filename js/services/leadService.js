// Leads and tasks. Mirrors BP_LeadService / BP_TaskService (Apex) one method each.
// In Salesforce, leads are Broker_Lead__c and tasks BP_Task__c: the standard Lead and Task objects
// are not available to Customer Community Plus (Login) users. Every method scopes to the caller's firm
// and role first, the way WITH USER_MODE queries and sharing do in the real build.

import { getState, mutate, now, nextId, audit } from '../core/store.js';
import { assertValid, isBlank, isEmail, isPhone, normPhone, rng, MIN, HOUR, DAY, fmtTime, fmtDateTime } from '../core/util.js';
import { FIRM_WIDE_ROLES, OPEN_LEAD_STATUSES, LEAD_SOURCES, LOST_REASONS, LINES_OF_BUSINESS, DEAL_TYPES, AREAS, PURPOSES, TIMELINES, FINANCING, BEDROOMS, MESSAGE_TEMPLATES } from '../core/config.js';
import { routeLead, scoreLead, missingQualification, buildPayments, buildHandover, newCommission, stagesFor, scheduleNextPayments } from '../core/rules.js';
import { makeLead } from '../core/seedDrop2.js';
import { firmOf } from './firmService.js';
import { fillTemplate } from './aiService.js';

const MANAGERS = ['Owner', 'Director', 'Team Leader'];
export const isOpenLead = (l) => OPEN_LEAD_STATUSES.includes(l.status);

/* ---------- visibility ---------- */

/** Firm first, then role: agents see their own, team leaders their team plus unassigned, firm-wide roles all. */
export function canSeeLead(actor, lead) {
  if (!actor || !lead || lead.firmId !== actor.firmId) return false;
  if (FIRM_WIDE_ROLES.includes(actor.role)) return true;
  if (actor.role === 'Team Leader') {
    if (!lead.ownerId) return true;
    const owner = getState().users.find((u) => u.id === lead.ownerId);
    return lead.ownerId === actor.id || (owner && owner.teamId === actor.teamId);
  }
  return lead.ownerId === actor.id;
}

export const visibleLeads = (actor) => getState().leads.filter((l) => canSeeLead(actor, l));
export const getLead = (actor, id) => getState().leads.find((l) => l.id === id && canSeeLead(actor, l)) || null;

/** Writable firm: suspended or offboarded firms are read-only. */
function requireWritable(actor) {
  const firm = firmOf(actor);
  assertValid(firm && ['Active', 'Trial'].includes(firm.status) ? [] : ['Your firm is read-only right now: no changes can be saved.']);
  return firm;
}

/** The lead's owner, or a manager who can see it, may work it. */
export function canWorkLead(actor, lead) {
  return canSeeLead(actor, lead) && (lead.ownerId === actor.id || MANAGERS.includes(actor.role));
}

function requireLead(actor, id) {
  requireWritable(actor);
  const lead = getLead(actor, id);
  assertValid(lead ? [] : ['Lead not found, or you do not have access to it.']);
  assertValid(canWorkLead(actor, lead) ? [] : ['Only the lead owner or a manager can change this lead.']);
  return lead;
}

const findIn = (s, id) => s.leads.find((l) => l.id === id);
const userName = (s, id) => s.users.find((u) => u.id === id)?.name || 'Unassigned';
const rescore = (l, t) => { const sc = scoreLead(l, t); l.score = sc.score; l.scoreReasons = sc.reasons; };
const log = (l, at, type, text, by) => { l.activities.unshift({ at, type, text, by }); l.lastActivityAt = at; };

function notify(s, userId, text, link) {
  if (!userId) return;
  s.notifications.unshift({ id: nextId('N'), userId, text, link, at: now(), read: false });
}

/** Marks the first response (any call attempt or message) and moves New → Contacted. */
function firstTouch(l, t) {
  if (!l.firstResponseAt) l.firstResponseAt = t;
  if (l.status === 'New') l.status = 'Contacted';
}

/* ---------- arrival and routing ---------- */

function routingContext(s, firmId) {
  const openCount = {};
  const lastAssignedAt = {};
  for (const l of s.leads) {
    if (l.firmId !== firmId || !l.ownerId) continue;
    if (isOpenLead(l)) openCount[l.ownerId] = (openCount[l.ownerId] || 0) + 1;
    lastAssignedAt[l.ownerId] = Math.max(lastAssignedAt[l.ownerId] || 0, l.createdAt);
  }
  return { openCount, lastAssignedAt };
}

/** Same phone in the same firm with an open lead = duplicate (never across firms). */
function findDuplicate(s, firmId, phone) {
  const p = normPhone(phone);
  return p ? s.leads.find((l) => l.firmId === firmId && normPhone(l.phone) === p && isOpenLead(l)) : null;
}

/** Demo DNC registry: any number already flagged do-not-call in this firm's records. */
const onDncRegistry = (s, firmId, phone) => s.leads.some((l) => l.firmId === firmId && l.dnc && normPhone(l.phone) === normPhone(phone));

/** Inserts a lead and routes it (inside a mutate). Returns the lead. */
function insertLead(s, firm, lead, t, { by = 'System', ownerId } = {}) {
  lead.id = nextId('L');
  lead.firmId = firm.id;
  lead.createdAt = t;
  lead.slaDueAt = t + firm.settings.sla.firstResponseMin * MIN;
  lead.activities = [];
  lead.dnc = lead.dnc || onDncRegistry(s, firm.id, lead.phone);
  const dup = findDuplicate(s, firm.id, lead.phone);
  log(lead, t, 'created', `${by === 'System' ? `Enquiry from ${lead.source}` : `Captured by ${by} (${lead.source})`}: ${lead.interest}.`, by);
  if (dup) {
    lead.duplicateOf = dup.id;
    lead.ownerId = dup.ownerId;
    lead.routingTrace = ['Matched an open lead with the same phone in your firm', `Kept with ${userName(s, dup.ownerId)}`];
  } else if (ownerId) {
    lead.ownerId = ownerId;
    lead.routingTrace = [`Captured by ${userName(s, ownerId)}: kept with them`];
  } else {
    const agents = s.users.filter((u) => u.firmId === firm.id);
    const routed = routeLead(lead, agents, firm.settings.routing, { ...routingContext(s, firm.id), t });
    lead.ownerId = routed.ownerId;
    lead.routingTrace = routed.trace;
  }
  log(lead, t + 1, 'assign', lead.ownerId ? `Routed to ${userName(s, lead.ownerId)} in under a second.` : 'No eligible agent: waiting for the team leader.', 'Routing');
  rescore(lead, t);
  s.leads.push(lead);
  if (lead.ownerId && lead.ownerId !== ownerId) notify(s, lead.ownerId, `New lead: ${lead.name} (${lead.source}). Reply within ${firm.settings.sla.firstResponseMin} min.`, `#/lead/${lead.id}`);
  if (!lead.ownerId) {
    s.users.filter((u) => u.firmId === firm.id && u.status === 'Active' && ['Owner', 'Team Leader'].includes(u.role))
      .forEach((u) => notify(s, u.id, `Unassigned lead: ${lead.name} needs an owner.`, `#/lead/${lead.id}`));
  }
  if (!firm.settings.golive.firstLead) firm.settings.golive.firstLead = true;
  return lead;
}

/** Demo: a lead arrives from a portal or ad channel, as the integrations will deliver them. */
export function simulateArrival(actor) {
  const firm = requireWritable(actor);
  return mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    const t = now();
    const r = rng(t % 2147483647);
    const lobs = f.plan === 'A' && f.id === 'F-PA' ? ['Secondary', 'Rental'] : ['Off-plan', 'Secondary', 'Rental'];
    const lead = makeLead(r, f, t, t, lobs[Math.floor(r() * lobs.length)]);
    const created = insertLead(s, f, lead, t);
    s.feed = s.feed || {};
    s.feed[`last:${f.id}`] = t;
    audit('Routing', 'Lead arrived', `${created.name} via ${created.source} → ${userName(s, created.ownerId)}.`, f.id);
    return created;
  });
}

/** Automatic arrivals while someone works the inbox: at most one per firm every `everyMs`, shared by all tabs. */
export function maybeAutoArrive(actor, everyMs) {
  const s = getState();
  const firm = firmOf(actor);
  if (!firm || !['Active', 'Trial'].includes(firm.status)) return null;
  const last = (s.feed && s.feed[`last:${firm.id}`]) || s.feed?.lastArrivalAt || 0;
  if (now() - last < everyMs) return null;
  return simulateArrival(actor);
}

/** Quick capture (walk-in, referral, phone call): stays with the agent who captured it if their BRN is valid. */
export function captureLead(actor, form) {
  const firm = requireWritable(actor);
  const problems = [];
  if (isBlank(form.name)) problems.push('Client name is required.');
  if (isBlank(form.phone) && isBlank(form.email)) problems.push('Enter a mobile number or an email.');
  if (!isBlank(form.phone) && !isPhone(form.phone)) problems.push('Mobile number is not valid.');
  if (!isBlank(form.email) && !isEmail(form.email)) problems.push('Email is not valid.');
  if (!LEAD_SOURCES[form.source]) problems.push('Choose a source.');
  if (!LINES_OF_BUSINESS.includes(form.lob) || form.lob === 'Commercial') problems.push('Choose a deal type.');
  const budget = isBlank(form.budgetMax) ? 0 : Number(form.budgetMax);
  if (!Number.isFinite(budget) || budget < 0) problems.push('Budget must be a positive number.');
  assertValid(problems);
  return mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    const me = s.users.find((u) => u.id === actor.id);
    const t = now();
    const keepWithMe = me.role === 'Agent' && me.brnExpiry > t;
    const lead = {
      name: form.name.trim(), phone: normPhone(form.phone), email: (form.email || '').trim(), nationality: '', lang: form.lang || 'English',
      source: form.source, lob: form.lob, beds: form.beds || '', budgetMax: budget, area: form.area || '', project: null,
      purpose: '', timeline: '', financing: '', status: 'New', ownerId: null, firstResponseAt: null, nextFollowUpAt: null,
      dnc: false, consent: { whatsapp: !!form.consentWhatsapp, email: true }, duplicateOf: null, lostReason: null, dealId: null,
      routingTrace: [], escalated: false, notes: form.notes || '',
    };
    lead.interest = `${lead.beds ? (lead.beds === 'Studio' ? 'a studio' : `a ${lead.beds}BR`) : 'a property'}${lead.lob === 'Rental' ? ' to rent' : ''}${lead.area ? ` in ${lead.area}` : ''}`;
    const created = insertLead(s, f, lead, t, { by: actor.name, ownerId: keepWithMe ? actor.id : undefined });
    if (form.notes) log(created, t + 2, 'note', form.notes.trim(), actor.name);
    audit(actor.name, 'Lead captured', `${created.name} (${created.source}).`, f.id);
    return created;
  });
}

/* ---------- assignment ---------- */

/** People a lead can be given to by this actor: active agents with a valid BRN (team leaders: own team only). */
export function assignableUsers(actor) {
  if (!MANAGERS.includes(actor.role)) return [];
  const t = now();
  return getState().users.filter((u) => u.firmId === actor.firmId && u.status === 'Active' && ['Agent', 'Team Leader'].includes(u.role)
    && u.brnExpiry > t && (actor.role !== 'Team Leader' || u.teamId === actor.teamId));
}

export function assignLeads(actor, ids, toUserId) {
  requireWritable(actor);
  const problems = [];
  if (!MANAGERS.includes(actor.role)) problems.push('Only team leaders, directors and the owner can assign leads.');
  if (!ids || !ids.length) problems.push('Select at least one lead.');
  const s0 = getState();
  const target = s0.users.find((u) => u.id === toUserId);
  if (!target || target.firmId !== actor.firmId) problems.push('Choose someone in your firm.');
  else if (target.status !== 'Active') problems.push(`${target.name} is not active.`);
  else if (!(target.brnExpiry > now())) problems.push(`${target.name}'s BRN has expired: they cannot receive leads until it is renewed.`);
  else if (actor.role === 'Team Leader' && target.teamId !== actor.teamId) problems.push('Team leaders can only assign to their own team.');
  const leads = (ids || []).map((id) => getLead(actor, id));
  if (leads.some((l) => !l)) problems.push('Some selected leads are not visible to you.');
  if (leads.some((l) => l && !isOpenLead(l))) problems.push('Converted and lost leads cannot be re-assigned.');
  assertValid(problems);
  return mutate((s) => {
    const t = now();
    let moved = 0;
    for (const id of ids) {
      const l = findIn(s, id);
      if (l.ownerId === toUserId) continue;
      const from = userName(s, l.ownerId);
      l.ownerId = toUserId;
      l.escalated = false;
      l.routingTrace = [...(l.routingTrace || []), `Re-assigned by ${actor.name}: ${from} → ${target.name}`];
      log(l, t, 'assign', `${actor.name} assigned the lead to ${target.name} (was ${from}).`, actor.name);
      moved++;
    }
    if (moved) notify(s, toUserId, `${actor.name} assigned you ${moved} lead${moved === 1 ? '' : 's'}.`, '#/leads');
    audit(actor.name, 'Leads assigned', `${moved} lead(s) to ${target.name}.`, actor.firmId);
    return moved;
  });
}

/* ---------- call guard (telemarketing rules) ---------- */

/** GST hour now (0–23). */
const gstHour = (t) => new Date(t + 4 * HOUR).getUTCHours();

/** Whether the actor may call this lead right now, with every reason it is blocked. */
export function callCheck(actor, lead) {
  const problems = [];
  const firm = firmOf(actor);
  if (!canWorkLead(actor, lead)) problems.push('Only the lead owner or a manager can call this lead.');
  if (lead.dnc) problems.push('This number is on the do-not-call registry. Contact the client by WhatsApp or email instead.');
  if (!lead.phone) problems.push('No phone number on this lead.');
  const h = gstHour(now());
  const { start, end } = firm.settings.callWindow;
  const outside = h < start || h >= end;
  if (outside && !getState().demo?.ignoreCallHours) problems.push(`Calls are allowed ${String(start).padStart(2, '0')}:00–${end}:00 GST only (now ${fmtTime(now())}).`);
  return { ok: problems.length === 0, problems, outsideHours: outside };
}

/** Demo only: lets a presenter show calling outside office hours. The rule stays on in the real product. */
export function setDemoCallHours(ignore) {
  mutate((s) => { s.demo = { ...(s.demo || {}), ignoreCallHours: !!ignore }; });
}

export const CALL_OUTCOMES = ['Answered', 'No answer', 'Busy', 'Wrong number'];

export function logCall(actor, id, { outcome, minutes: mins, note }) {
  const lead = requireLead(actor, id);
  const check = callCheck(actor, lead);
  assertValid(check.ok ? [] : check.problems);
  const problems = [];
  if (!CALL_OUTCOMES.includes(outcome)) problems.push('Choose the call outcome.');
  const m = Number(mins || 0);
  if (outcome === 'Answered' && (!Number.isFinite(m) || m < 1 || m > 180)) problems.push('Call length must be 1 to 180 minutes.');
  assertValid(problems);
  return mutate((s) => {
    const l = findIn(s, id);
    const t = now();
    firstTouch(l, t);
    log(l, t, 'call', `Call: ${outcome.toLowerCase()}${outcome === 'Answered' ? `, ${m} min` : ''}.${note ? ` ${note.trim()}` : ''}`, actor.name);
    if (outcome === 'Wrong number') { l.status = 'Lost'; l.lostReason = 'Invalid number'; log(l, t + 1, 'status', 'Marked Lost: Invalid number.', actor.name); }
    rescore(l, t);
    return l;
  });
}

/* ---------- messages ---------- */

/** Consent and contact checks for a channel: [] when the message may be sent. */
export function messageProblems(lead, channel) {
  const out = [];
  if (channel === 'WhatsApp') {
    if (!lead.phone) out.push('No mobile number on this lead.');
    if (!lead.consent?.whatsapp) out.push('No WhatsApp consent recorded for this client. Ask for consent on a call, or send an email.');
  } else if (channel === 'Email') {
    if (!lead.email) out.push('No email address on this lead.');
  } else out.push('Choose WhatsApp or email.');
  return out;
}

export function sendMessage(actor, id, { channel, templateId, lang, text }) {
  const lead = requireLead(actor, id);
  const problems = messageProblems(lead, channel);
  if (isBlank(text)) problems.push('The message is empty.');
  else if (text.length > 1000) problems.push('Keep the message under 1,000 characters.');
  if (templateId && !MESSAGE_TEMPLATES.some((t) => t.id === templateId)) problems.push('Unknown template.');
  assertValid(problems);
  return mutate((s) => {
    const l = findIn(s, id);
    const t = now();
    firstTouch(l, t);
    const tpl = MESSAGE_TEMPLATES.find((x) => x.id === templateId);
    log(l, t, channel === 'WhatsApp' ? 'whatsapp' : 'email', `${channel}${tpl ? ` ("${tpl.name}", ${lang || 'English'})` : ''}: ${text.trim()}`, actor.name);
    rescore(l, t);
    return l;
  });
}

/** Demo: the client replies (so the AI summary and score react). */
export function simulateReply(actor, id) {
  const lead = requireLead(actor, id);
  return mutate((s) => {
    const l = findIn(s, lead.id);
    const t = now();
    const replies = ['Client: Thanks! Can you send the payment plan?', 'Client: I can do a viewing this weekend.', 'Client: What is the service charge?', 'Client: Is there a 3BR option?'];
    log(l, t, 'inbound', replies[(l.activities.length + l.name.length) % replies.length], l.name);
    rescore(l, t);
    return l;
  });
}

export function addNote(actor, id, text) {
  requireLead(actor, id);
  assertValid(isBlank(text) ? ['Write a note first.'] : text.length > 2000 ? ['Notes can be at most 2,000 characters.'] : []);
  return mutate((s) => { const l = findIn(s, id); log(l, now(), 'note', text.trim(), actor.name); return l; });
}

/* ---------- qualification ---------- */

const ALLOWED = {
  lob: DEAL_TYPES, beds: BEDROOMS, area: AREAS, purpose: PURPOSES, timeline: TIMELINES, financing: FINANCING,
};

/** Saves needs and qualification fields (inline edit, or values proposed by the Lead Qualifier and confirmed). */
export function updateLead(actor, id, fields, { source = 'manual' } = {}) {
  const lead = requireLead(actor, id);
  const problems = [];
  const clean = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'budgetMax') {
      const n = Number(v);
      if (isBlank(v)) clean.budgetMax = 0;
      else if (!Number.isFinite(n) || n < 0 || n > 1e9) problems.push('Budget must be a number between 0 and 1,000,000,000.');
      else clean.budgetMax = Math.round(n);
    } else if (k === 'email') {
      if (!isBlank(v) && !isEmail(v)) problems.push('Email is not valid.'); else clean.email = String(v || '').trim();
    } else if (k === 'name') {
      if (isBlank(v)) problems.push('Name cannot be empty.'); else clean.name = String(v).trim().slice(0, 80);
    } else if (k === 'consentWhatsapp') {
      clean.consent = { ...lead.consent, whatsapp: !!v };
    } else if (ALLOWED[k]) {
      if (!isBlank(v) && !ALLOWED[k].includes(v)) problems.push(`"${v}" is not a valid ${k}.`); else clean[k] = v || '';
    }
  }
  assertValid(problems);
  return mutate((s) => {
    const l = findIn(s, id);
    const t = now();
    const changed = Object.keys(clean).filter((k) => JSON.stringify(l[k]) !== JSON.stringify(clean[k]));
    Object.assign(l, clean);
    if (changed.length) {
      if (changed.some((k) => ['beds', 'area', 'lob'].includes(k)) && !l.project) {
        l.interest = `${l.beds ? (l.beds === 'Studio' ? 'a studio' : `a ${l.beds}BR`) : 'a property'}${l.lob === 'Rental' ? ' to rent' : ''}${l.area ? ` in ${l.area}` : ''}`;
      }
      log(l, t, 'note', `${source === 'ai' ? 'Lead Qualifier values confirmed' : 'Updated'}: ${changed.map((k) => (k === 'consent' ? 'WhatsApp consent' : k)).join(', ')}.`, actor.name);
      rescore(l, t);
    }
    return changed;
  });
}

export function qualifyLead(actor, id) {
  const lead = requireLead(actor, id);
  const missing = missingQualification(lead);
  const problems = [];
  if (!['New', 'Contacted'].includes(lead.status)) problems.push(`A ${lead.status.toLowerCase()} lead cannot be marked qualified.`);
  if (!lead.firstResponseAt) problems.push('Speak to or message the client before qualifying.');
  if (missing.length) problems.push(`Fill in: ${missing.join(', ')}.`);
  assertValid(problems);
  return mutate((s) => {
    const l = findIn(s, id);
    l.status = 'Qualified';
    log(l, now(), 'status', 'Marked Qualified.', actor.name);
    rescore(l, now());
    return l;
  });
}

export function markLost(actor, id, reason, note = '') {
  const lead = requireLead(actor, id);
  const problems = [];
  if (!isOpenLead(lead)) problems.push('Only open leads can be marked lost.');
  if (!LOST_REASONS.includes(reason)) problems.push('Choose a reason.');
  assertValid(problems);
  return mutate((s) => {
    const l = findIn(s, id);
    const t = now();
    l.status = 'Lost';
    l.lostReason = reason;
    l.nextFollowUpAt = null;
    s.tasks.filter((k) => k.leadId === id && !k.done).forEach((k) => { k.done = true; k.doneAt = t; k.cancelled = true; });
    log(l, t, 'status', `Marked Lost: ${reason}.${note ? ` ${note.trim()}` : ''}`, actor.name);
    return l;
  });
}

/* ---------- tasks (follow-ups and viewings) ---------- */

export const canSeeTask = (actor, task) => {
  if (!actor || task.firmId !== actor.firmId) return false;
  if (task.ownerId === actor.id || FIRM_WIDE_ROLES.includes(actor.role)) return true;
  if (actor.role === 'Team Leader') return getState().users.find((u) => u.id === task.ownerId)?.teamId === actor.teamId;
  return false;
};

export const myTasks = (actor) => getState().tasks.filter((t) => t.ownerId === actor.id && t.firmId === actor.firmId);

export const TASK_TYPES = { followup: 'Follow-up call', viewing: 'Viewing', meeting: 'Meeting', todo: 'To-do' };

export function scheduleTask(actor, { leadId, dealId, type, title, dueAt }) {
  requireWritable(actor);
  const problems = [];
  const lead = leadId ? getLead(actor, leadId) : null;
  if (leadId && !lead) problems.push('Lead not found.');
  if (lead && !canWorkLead(actor, lead)) problems.push('Only the lead owner or a manager can schedule on this lead.');
  if (lead && !isOpenLead(lead)) problems.push('This lead is closed.');
  if (!TASK_TYPES[type]) problems.push('Choose a task type.');
  if (!Number.isFinite(dueAt)) problems.push('Choose a date and time.');
  else if (dueAt < now() - 5 * MIN) problems.push('The time must be in the future.');
  else if (dueAt > now() + 180 * DAY) problems.push('Schedule within the next 6 months.');
  if (title && title.length > 120) problems.push('Keep the title under 120 characters.');
  assertValid(problems);
  return mutate((s) => {
    const t = now();
    const ownerId = lead ? lead.ownerId || actor.id : actor.id;
    const task = {
      id: nextId('T'), firmId: actor.firmId, ownerId, type, leadId: leadId || null, dealId: dealId || null, dueAt, done: false, doneAt: null, createdAt: t,
      title: (title && title.trim()) || (type === 'viewing' ? `Viewing: ${lead ? lead.interest : ''}` : `${TASK_TYPES[type]}${lead ? ` with ${lead.name}` : ''}`),
    };
    s.tasks.push(task);
    if (lead) {
      const l = findIn(s, leadId);
      if (type === 'viewing' && ['Contacted', 'Qualified'].includes(l.status)) l.status = 'Viewing';
      l.nextFollowUpAt = Math.min(...s.tasks.filter((k) => k.leadId === leadId && !k.done).map((k) => k.dueAt));
      log(l, t, 'task', `${TASK_TYPES[type]} scheduled for ${fmtDateTime(dueAt)}.`, actor.name);
    }
    if (ownerId !== actor.id) notify(s, ownerId, `${actor.name} scheduled "${task.title}" for you.`, lead ? `#/lead/${lead.id}` : '#/home');
    return task;
  });
}

export function completeTask(actor, taskId, done = true) {
  requireWritable(actor);
  const task = getState().tasks.find((k) => k.id === taskId);
  assertValid(task && canSeeTask(actor, task) ? [] : ['Task not found.']);
  assertValid(task.ownerId === actor.id || MANAGERS.includes(actor.role) ? [] : ['Only the task owner can complete it.']);
  return mutate((s) => {
    const k = s.tasks.find((x) => x.id === taskId);
    const t = now();
    k.done = !!done;
    k.doneAt = done ? t : null;
    if (k.leadId) {
      const l = findIn(s, k.leadId);
      if (l) {
        const open = s.tasks.filter((x) => x.leadId === l.id && !x.done);
        l.nextFollowUpAt = open.length ? Math.min(...open.map((x) => x.dueAt)) : null;
        if (done) log(l, t, 'task', `Done: ${k.title}.`, actor.name);
      }
    }
    return k;
  });
}

/* ---------- convert ---------- */

/** Creates a deal from a qualified lead: client, unit, value and optional co-broking agreement. */
export function convertLead(actor, id, form) {
  const lead = requireLead(actor, id);
  const problems = [];
  if (!['Qualified', 'Viewing'].includes(lead.status)) problems.push('Qualify the lead before converting it.');
  if (!DEAL_TYPES.includes(form.type)) problems.push('Choose a deal type.');
  const value = Number(form.value);
  if (!Number.isFinite(value) || value <= 0) problems.push(form.type === 'Rental' ? 'Enter the annual rent.' : 'Enter the deal value.');
  else if (value > 5e8) problems.push('Deal value looks too large.');
  if (isBlank(form.unitRef)) problems.push('Enter the unit (e.g. Tower A · 1204).');
  let coBroke = null;
  if (form.coBroke) {
    const split = Number(form.coSplit);
    if (isBlank(form.coFirm)) problems.push('Co-broking: enter the other firm.');
    if (!/^\d{4,6}$/.test(String(form.coOrn || '').trim())) problems.push("Co-broking: the other firm's ORN must be 4 to 6 digits.");
    if (!Number.isFinite(split) || split < 1 || split > 90) problems.push('Co-broking: their share must be 1 to 90%.');
    coBroke = { firm: String(form.coFirm || '').trim(), orn: String(form.coOrn || '').trim(), agent: String(form.coAgent || '').trim(), splitPct: split };
  }
  assertValid(problems);
  return mutate((s) => {
    const l = findIn(s, id);
    const t = now();
    const deal = {
      id: nextId('D'), firmId: l.firmId, leadId: l.id, clientName: l.name, clientPhone: l.phone, clientEmail: l.email, nationality: l.nationality,
      type: form.type, stage: stagesFor(form.type, l.firmId)[0].id, value: Math.round(value), ownerId: l.ownerId || actor.id, createdAt: t, stageChangedAt: t,
      closedAt: null, lostReason: null,
      unit: { project: form.type === 'Off-plan' ? l.project : null, developer: null, area: l.area, beds: l.beds, ref: form.unitRef.trim(), sizeSqft: null },
      documents: {}, kyc: { status: 'Not started', fields: {}, submittedAt: null, verifiedAt: null, verifiedBy: null, screening: { status: 'Not run', at: null, hits: [], clearedBy: null } },
      payments: buildPayments(form.type, value, t), handover: buildHandover(form.type), coBroke, commission: newCommission(form.type, s.firms.find((f) => f.id === l.firmId).settings.commission),
      cashAmount: 0, rearDrafted: false, history: [{ at: t, from: null, to: stagesFor(form.type, l.firmId)[0].id, by: actor.name }],
    };
    scheduleNextPayments(deal);
    s.deals.push(deal);
    l.status = 'Converted';
    l.dealId = deal.id;
    l.nextFollowUpAt = null;
    s.tasks.filter((k) => k.leadId === id && !k.done).forEach((k) => { k.done = true; k.doneAt = t; });
    log(l, t, 'convert', `Converted to deal ${deal.id} (${deal.type}, ${deal.unit.ref}).${coBroke ? ` Co-broking with ${coBroke.firm} (${coBroke.splitPct}%).` : ''}`, actor.name);
    audit(actor.name, 'Lead converted', `${l.name} → deal ${deal.id}.`, l.firmId);
    return deal;
  });
}

/* ---------- saved views ---------- */

export const savedViews = (actor) => getState().savedViews.filter((v) => v.userId === actor.id);

export function saveView(actor, name, filter) {
  const problems = [];
  if (isBlank(name)) problems.push('Name the view.');
  else if (name.length > 40) problems.push('View names can be at most 40 characters.');
  else if (savedViews(actor).some((v) => v.name.toLowerCase() === name.trim().toLowerCase())) problems.push('You already have a view with this name.');
  if (savedViews(actor).length >= 10) problems.push('You can save up to 10 views.');
  assertValid(problems);
  return mutate((s) => {
    const view = { id: nextId('V'), userId: actor.id, name: name.trim(), filter: { ...filter } };
    s.savedViews.push(view);
    return view;
  });
}

export function deleteView(actor, viewId) {
  assertValid(savedViews(actor).some((v) => v.id === viewId) ? [] : ['View not found.']);
  mutate((s) => { s.savedViews = s.savedViews.filter((v) => v.id !== viewId); });
}

/* ---------- helpers for the UI ---------- */

export const templateText = (templateId, lang, lead, actor, extra = {}) => fillTemplate(templateId, lang, { lead, agent: actor, firm: firmOf(actor), ...extra });

export const leadOwnerName = (lead) => (lead.ownerId ? getState().users.find((u) => u.id === lead.ownerId)?.name || 'Unknown' : 'Unassigned');

export const _test = { gstHour, routingContext };

/** Records a blocked call attempt (do-not-call or hours) for the Compliance centre. */
export function recordBlockedCall(actor, lead, problems) {
  if (!lead || !problems.length) return;
  mutate(() => audit(actor.name, 'Call blocked', `${lead.name} (${lead.id}): ${problems[0]}`, actor.firmId));
}
