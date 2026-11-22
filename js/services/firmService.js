// Firm workspace: setup wizard, people (invite, accept, deactivate), and role-based scoping.
// Mirrors: BP_FirmService and BP_UserService (Apex), with Customer Community Plus users.

import { getState, peekState, mutate, now, nextId, audit, sendEmail } from '../core/store.js';
import { DAY, isEmail, isBlank, slug, passwordProblems, assertValid, parseDateInput } from '../core/util.js';
import { BRAND_COLOURS, LANGUAGES, LINES_OF_BUSINESS, FIRM_WIDE_ROLES } from '../core/config.js';

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const ASSIGNABLE_ROLES = ['Director', 'Team Leader', 'Agent', 'Marketing', 'Compliance'];
const LICENSED_ROLES = ['Team Leader', 'Agent'];

import { setPipelineResolver } from '../core/rules.js';
import { PIPELINES, LOCKED_GATES, MESSAGE_TEMPLATES, INTEGRATIONS, PLANS } from '../core/config.js';

// Firm settings override stage gates and stuck limits per firm (Firm settings → Pipelines). No code change needed.
setPipelineResolver((firmId, type) => {
  const st = peekState();
  const firm = st && st.firms.find((f) => f.id === firmId);
  const o = firm && firm.settings.gates && firm.settings.gates[type];
  if (!o) return null;
  return PIPELINES[type].map((st) => (o[st.id] ? { ...st, gate: o[st.id].gate ?? st.gate, stuckDays: o[st.id].stuckDays ?? st.stuckDays } : st));
});

export const firmOf = (user) => (user ? getState().firms.find((f) => f.id === user.firmId) || null : null);
export const isAdmin = (user) => !!user && user.role === 'Owner';

function requireAdmin(actor) {
  assertValid(isAdmin(actor) ? [] : ['Only the firm owner can change this.']);
  const firm = firmOf(actor);
  assertValid(firm && !['Suspended', 'Offboarded', 'Rejected'].includes(firm.status) ? [] : ['Your firm is read-only while it is suspended.']);
  return firm;
}

/* ---------- scoping (privacy) ---------- */

/** Users the actor may see: only people in the actor's own firm. Never another firm. */
export function visibleUsers(actor) {
  if (!actor) return [];
  return getState().users.filter((u) => u.firmId === actor.firmId);
}

/** Whose records the actor may see inside the firm, by role (decided: visibility by role). */
export function visibleOwnerIds(actor) {
  if (!actor) return new Set();
  const people = visibleUsers(actor);
  if (FIRM_WIDE_ROLES.includes(actor.role)) return new Set(people.map((u) => u.id));
  if (actor.role === 'Team Leader') return new Set(people.filter((u) => u.teamId === actor.teamId || u.id === actor.id).map((u) => u.id));
  return new Set([actor.id]);
}

export const seatsUsed = (firmId) => getState().users.filter((u) => u.firmId === firmId && ['Active', 'Invited'].includes(u.status)).length;

/* ---------- setup wizard ---------- */

export function saveBranding(actor, { brand, logoText }) {
  const firm = requireAdmin(actor);
  const problems = [];
  if (!/^#[0-9a-f]{6}$/i.test(brand || '')) problems.push('Choose a brand colour.');
  if (logoText && String(logoText).trim().length > 3) problems.push('Logo initials can be at most 3 characters.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.brand = brand;
    f.logoText = String(logoText || '').trim().toUpperCase() || null;
    audit(actor.name, 'Branding updated', `${f.name} brand colour ${brand}.`, f.id);
  });
}

export function saveTeams(actor, names) {
  const firm = requireAdmin(actor);
  const clean = names.map((n) => String(n || '').trim()).filter(Boolean);
  const problems = [];
  if (!clean.length) problems.push('Add at least one team.');
  if (clean.some((n) => n.length > 40)) problems.push('Team names can be at most 40 characters.');
  if (new Set(clean.map((n) => n.toLowerCase())).size !== clean.length) problems.push('Team names must be unique.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    // Keep ids of teams whose name is unchanged so members stay in them.
    f.teams = clean.map((name) => f.teams.find((t) => sameText(t.name, name)) || { id: nextId('T'), name });
    const ids = new Set(f.teams.map((t) => t.id));
    s.users.filter((u) => u.firmId === f.id && u.teamId && !ids.has(u.teamId)).forEach((u) => { u.teamId = null; });
    audit(actor.name, 'Teams updated', clean.join(', '), f.id);
  });
}

export function saveRules(actor, { firstResponseMin, reassignAfterMin, routing }) {
  const firm = requireAdmin(actor);
  const a = Number(firstResponseMin);
  const b = Number(reassignAfterMin);
  const problems = [];
  if (!Number.isInteger(a) || a < 1 || a > 240) problems.push('First-response SLA must be 1 to 240 minutes.');
  if (!Number.isInteger(b) || b < 1 || b > 480) problems.push('Re-assign window must be 1 to 480 minutes.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.sla = { firstResponseMin: a, reassignAfterMin: b };
    if (routing) f.settings.routing.forEach((r) => { if (!r.hard && r.id in routing) r.on = !!routing[r.id]; });
    audit(actor.name, 'Lead rules updated', `SLA ${a} min, re-assign after ${b} min.`, f.id);
  });
}

export function setGoLive(actor, key, value) {
  const firm = requireAdmin(actor);
  assertValid(key in firm.settings.golive ? [] : ['Unknown checklist item.']);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.golive[key] = !!value;
    audit(actor.name, 'Go-live checklist', `${key} ${value ? 'done' : 'not done'}.`, f.id);
  });
}

export function finishSetup(actor) {
  const firm = requireAdmin(actor);
  const problems = [];
  if (!firm.teams.length) problems.push('Add at least one team.');
  if (!firm.brand) problems.push('Choose a brand colour.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.setupComplete = true;
    audit(actor.name, 'Setup finished', `${f.name} finished onboarding.`, f.id);
  });
}

/* ---------- people ---------- */

/** Validates one invite row; returns { problems, warnings }. Used by the wizard and the People page. */
export function checkUserInvite(actor, row, pendingEmails = []) {
  const s = getState();
  const firm = firmOf(actor);
  const problems = [];
  const warnings = [];
  if (isBlank(row.name)) problems.push('Name is required.');
  if (!isEmail(row.email)) problems.push('Enter a valid email.');
  if (!ASSIGNABLE_ROLES.includes(row.role)) problems.push('Choose a role.');
  if (['Team Leader', 'Agent'].includes(row.role) && !firm.teams.some((t) => t.id === row.teamId)) problems.push('Choose a team.');
  if (LICENSED_ROLES.includes(row.role)) {
    if (!/^\d{5,6}$/.test(String(row.brn || '').trim())) problems.push('BRN must be 5 or 6 digits.');
    const exp = typeof row.brnExpiry === 'number' ? row.brnExpiry : parseDateInput(row.brnExpiry);
    if (!exp) problems.push('BRN expiry date is required.');
    else if (exp <= now()) warnings.push('BRN has expired: this person can sign in but will receive no leads until it is renewed.');
  }
  if (isEmail(row.email)) {
    if (pendingEmails.some((e) => sameText(e, row.email))) problems.push('This email appears twice in the list.');
    const sameFirm = s.users.find((u) => u.firmId === firm.id && sameText(u.email, row.email) && ['Active', 'Invited', 'Pending'].includes(u.status));
    if (sameFirm) problems.push(`${sameFirm.name} already has a login in your firm.`);
    const elsewhere = s.users.find((u) => u.firmId !== firm.id && sameText(u.email, row.email) && u.status === 'Active');
    if (elsewhere) problems.push('This person is still active at another firm on Broker Portal. That firm must deactivate them before you can invite them.');
  }
  return { problems, warnings };
}

export function inviteUsers(actor, rows) {
  const firm = requireAdmin(actor);
  assertValid(rows.length ? [] : ['Add at least one person.']);
  const all = [];
  rows.forEach((row, i) => {
    const { problems } = checkUserInvite(actor, row, rows.slice(0, i).map((r) => r.email));
    problems.forEach((p) => all.push(`Row ${i + 1}: ${p}`));
  });
  assertValid(all);
  const free = firm.seats - seatsUsed(firm.id);
  assertValid(rows.length <= free ? [] : [`Your plan has ${free} free seat${free === 1 ? '' : 's'}; you are inviting ${rows.length}.`]);

  return mutate((s) => rows.map((row) => {
    const local = row.name.trim().toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).join('.');
    let username = `${local}@${slug(firm.name)}.bp`;
    let n = 2;
    while (s.users.some((u) => u.username === username)) username = `${local}${n++}@${slug(firm.name)}.bp`;
    const token = Math.random().toString(36).slice(2, 10).toUpperCase();
    const user = {
      id: nextId('U'), firmId: firm.id, name: row.name.trim(), email: row.email.trim(), username, role: row.role,
      teamId: row.teamId || null, status: 'Invited', brn: LICENSED_ROLES.includes(row.role) ? String(row.brn).trim() : null,
      brnExpiry: LICENSED_ROLES.includes(row.role) ? (typeof row.brnExpiry === 'number' ? row.brnExpiry : parseDateInput(row.brnExpiry)) : null,
      langs: (row.langs && row.langs.length ? row.langs : ['English']).filter((l) => LANGUAGES.includes(l)),
      lob: (row.lob || []).filter((l) => LINES_OF_BUSINESS.includes(l)),
      invitedAt: now(), activatedAt: null, deactivatedAt: null, inviteToken: token, inviteExpiresAt: now() + 7 * DAY,
    };
    s.users.push(user);
    sendEmail(user.email, `${firm.name} invited you to Broker Portal`, `${actor.name} invited you as ${user.role}.`, `portal/#/accept/${token}`);
    audit(actor.name, 'User invited', `${user.name} as ${user.role}.`, firm.id);
    return user;
  }));
}

export function findUserInvite(token) {
  const t = String(token || '').trim().toUpperCase();
  const user = getState().users.find((u) => u.inviteToken === t);
  if (!user) return { reason: 'This invitation link is not valid.' };
  if (user.status !== 'Invited') return { reason: 'This invitation has already been used. Sign in instead.' };
  if (user.inviteExpiresAt < now()) return { reason: 'This invitation expired. Ask your firm admin to send a new one.' };
  const firm = getState().firms.find((f) => f.id === user.firmId);
  if (!firm || ['Suspended', 'Offboarded', 'Rejected'].includes(firm.status)) return { reason: 'Your firm is not active on Broker Portal right now.' };
  return { user, firm };
}

export function acceptUserInvite(token, password, confirm) {
  const { user, reason } = findUserInvite(token);
  assertValid(user ? [] : [reason]);
  const pw = passwordProblems(password);
  const problems = [];
  if (pw.length) problems.push(`Password needs ${pw.join(', ')}.`);
  if (password !== confirm) problems.push('Passwords do not match.');
  const elsewhere = getState().users.find((u) => u.id !== user.id && sameText(u.email, user.email) && u.status === 'Active');
  if (elsewhere) problems.push('You are still active at another firm. Ask that firm to deactivate your old login first.');
  assertValid(problems);
  return mutate((s) => {
    const u = s.users.find((x) => x.id === user.id);
    u.status = 'Active';
    u.activatedAt = now();
    u.inviteToken = null;
    audit(u.name, 'Invitation accepted', `${u.name} joined as ${u.role}.`, u.firmId);
    return u;
  });
}

export function resendUserInvite(actor, userId) {
  const firm = requireAdmin(actor);
  const user = getState().users.find((u) => u.id === userId && u.firmId === firm.id);
  assertValid(user && user.status === 'Invited' ? [] : ['Only pending invitations can be resent.']);
  mutate((s) => {
    const u = s.users.find((x) => x.id === userId);
    u.inviteExpiresAt = now() + 7 * DAY;
    sendEmail(u.email, `Reminder: ${firm.name} invited you`, 'Your invitation is valid for 7 more days.', `portal/#/accept/${u.inviteToken}`);
    audit(actor.name, 'Invitation resent', u.name, firm.id);
  });
}

/**
 * Deactivates a person who leaves the firm: their login stops at once, their records stay with the firm,
 * and their open leads are re-routed or handed to a colleague (handled by the lead service from drop 2).
 */
export function deactivateUser(actor, userId, { handTo = 'routing' } = {}) {
  const firm = requireAdmin(actor);
  const user = getState().users.find((u) => u.id === userId && u.firmId === firm.id);
  const problems = [];
  if (!user) problems.push('Person not found in your firm.');
  else {
    if (user.id === actor.id) problems.push("You can't deactivate yourself.");
    if (user.role === 'Owner') problems.push("The firm owner can't be deactivated. Contact ThinkVibes to transfer ownership.");
    if (user.status === 'Deactivated') problems.push(`${user.name} is already deactivated.`);
  }
  if (handTo !== 'routing') {
    const colleague = getState().users.find((u) => u.id === handTo && u.firmId === firm.id && u.status === 'Active');
    if (!colleague || colleague.id === userId) problems.push('Choose an active colleague to take over the open leads.');
  }
  assertValid(problems);
  return mutate((s) => {
    const u = s.users.find((x) => x.id === userId);
    const wasInvite = u.status === 'Invited';
    u.status = 'Deactivated';
    u.deactivatedAt = now();
    u.inviteToken = null;
    let moved = 0;
    s.leads.filter((l) => l.ownerId === u.id && !['Converted', 'Lost'].includes(l.status)).forEach((l) => {
      l.ownerId = handTo === 'routing' ? null : handTo;
      l.activities = l.activities || [];
      l.activities.unshift({ at: now(), type: 'assign', text: `${u.name} left the firm; lead ${handTo === 'routing' ? 'returned to routing' : `handed to ${s.users.find((x) => x.id === handTo).name}`}.`, by: actor.name });
      moved++;
    });
    audit(actor.name, wasInvite ? 'Invitation withdrawn' : 'User deactivated', `${u.name}: login deactivated; ${moved} open lead(s) ${handTo === 'routing' ? 're-routed' : 'handed over'}.`, firm.id);
    return { user: u, moved };
  });
}

export const brandColours = BRAND_COLOURS;

/* ---------- drop 3: firm settings (every rule changes behaviour without code) ---------- */

/** Calling hours for the call guard (GST). */
export function saveCallWindow(actor, { start, end }) {
  const firm = requireAdmin(actor);
  const a = Number(start);
  const b = Number(end);
  const problems = [];
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 7 || b > 21 || a >= b) problems.push('Calling hours must be between 07:00 and 21:00, start before end.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.callWindow = { start: a, end: b };
    audit(actor.name, 'Calling hours updated', `${a}:00–${b}:00 GST.`, f.id);
  });
}

/** Moves a soft routing rule up or down (the licence rule always runs first). */
export function moveRoutingRule(actor, ruleId, dir) {
  const firm = requireAdmin(actor);
  const list = firm.settings.routing;
  const i = list.findIndex((r) => r.id === ruleId);
  const j = i + (dir === 'up' ? -1 : 1);
  assertValid(i < 0 || list[i].hard ? ['This rule cannot be moved.'] : j < 0 || j >= list.length || list[j].hard ? ['Already at the limit.'] : []);
  mutate((s) => {
    const r = s.firms.find((x) => x.id === firm.id).settings.routing;
    [r[i], r[j]] = [r[j], r[i]];
    audit(actor.name, 'Routing order changed', r.map((x) => x.label).join(' → '), firm.id);
  });
}

/** Stage gates and stuck limits per deal type. KYC and screening cannot be removed (regulation). */
export function saveGates(actor, type, stageId, { gate, stuckDays }) {
  const firm = requireAdmin(actor);
  const base = PIPELINES[type] && PIPELINES[type].find((s) => s.id === stageId);
  const problems = [];
  if (!base) problems.push('Unknown stage.');
  const days = stuckDays === '' || stuckDays === undefined ? undefined : Number(stuckDays);
  if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 120)) problems.push('Stuck limit must be 1 to 120 days.');
  const locked = (base?.gate || []).filter((g) => LOCKED_GATES.includes(g));
  const missingLocked = locked.filter((g) => !(gate || []).includes(g));
  if (missingLocked.length) problems.push('KYC and screening gates are required by regulation and cannot be switched off.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.gates[type] = f.settings.gates[type] || {};
    f.settings.gates[type][stageId] = { gate: [...gate], ...(days !== undefined ? { stuckDays: days } : {}) };
    audit(actor.name, 'Stage gate changed', `${type} → ${base.label}: ${gate.join(', ') || 'no gate'}${days !== undefined ? `; stuck after ${days} days` : ''}.`, f.id);
  });
}

export function resetGates(actor, type) {
  const firm = requireAdmin(actor);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    delete f.settings.gates[type];
    audit(actor.name, 'Stage gates reset', `${type} back to the product default.`, f.id);
  });
}

/** Default commission per deal type for new deals. */
export function saveCommissionDefaults(actor, type, { rate, agentShare }) {
  const firm = requireAdmin(actor);
  const r = Number(rate);
  const a = Number(agentShare);
  const problems = [];
  if (!PIPELINES[type]) problems.push('Unknown deal type.');
  if (!Number.isFinite(r) || r <= 0 || r > 10) problems.push('Rate must be above 0% and at most 10%.');
  if (!Number.isFinite(a) || a < 0 || a > 100) problems.push("Agent's share must be 0 to 100%.");
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.commission[type] = { rate: r, agentShare: a };
    audit(actor.name, 'Commission defaults', `${type}: ${r}% (agent ${a}%).`, f.id);
  });
}

/** Edits a message template. Placeholders in braces must be ones the product knows. */
export function saveTemplate(actor, id, { en, ar, enabled }) {
  const firm = requireAdmin(actor);
  const known = ['first', 'agent', 'firm', 'interest', 'when', 'unit', 'price'];
  const problems = [];
  if (!MESSAGE_TEMPLATES.some((t) => t.id === id)) problems.push('Unknown template.');
  for (const [lang, text] of [['English', en], ['Arabic', ar]]) {
    if (isBlank(text)) problems.push(`${lang} text is required.`);
    else if (text.length > 600) problems.push(`${lang} text must be under 600 characters.`);
    const bad = (String(text || '').match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)).filter((x) => !known.includes(x));
    if (bad.length) problems.push(`${lang}: unknown placeholder ${bad.map((b) => `{${b}}`).join(', ')}. Use ${known.map((k) => `{${k}}`).join(' ')}.`);
  }
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.templates[id] = { en: en.trim(), ar: ar.trim(), enabled: enabled !== false };
    audit(actor.name, 'Template updated', id, f.id);
  });
}

export function setIntegration(actor, key, on) {
  const firm = requireAdmin(actor);
  const def = INTEGRATIONS.find((i) => i.key === key);
  const problems = [];
  if (!def) problems.push('Unknown integration.');
  else if (def.plan === 'marketing' && on && !PLANS[firm.plan].marketing) problems.push(`${def.label} is part of Option B.`);
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.settings.integrations[key] = !!on;
    audit(actor.name, on ? 'Integration connected' : 'Integration disconnected', def.label, f.id);
  });
}

/** Asks ThinkVibes for a plan or seat change (operators approve it in the console). */
export function requestPlanChange(actor, { plan, seats, note }) {
  const firm = requireAdmin(actor);
  const n = Number(seats);
  const problems = [];
  if (!PLANS[plan] || plan === 'Trial') problems.push('Choose Option A or Option B.');
  if (!Number.isInteger(n) || n < seatsUsed(firm.id) || n > 500) problems.push(`Seats must be at least ${seatsUsed(firm.id)} (people already using a seat).`);
  if (plan === firm.plan && n === firm.seats) problems.push('That is your current plan.');
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firm.id);
    f.planRequest = { plan, seats: n, note: (note || '').trim(), at: now(), by: actor.name };
    audit(actor.name, 'Plan change requested', `${PLANS[plan].label}, ${n} seats.`, f.id);
  });
}

/**
 * Routing suggestion from past results (scripted analysis of this firm's own leads):
 * compares conversion when the owner spoke the client's language vs not, and SLA hit rate by source.
 */
export function routingSuggestion(actor) {
  const s = getState();
  const users = new Map(s.users.map((u) => [u.id, u]));
  const leads = s.leads.filter((l) => l.firmId === actor.firmId && l.ownerId && l.lang && l.lang !== 'English');
  const conv = (list) => (list.length ? list.filter((l) => ['Qualified', 'Viewing', 'Converted'].includes(l.status)).length / list.length : 0);
  const same = leads.filter((l) => (users.get(l.ownerId)?.langs || []).includes(l.lang));
  const diff = leads.filter((l) => !(users.get(l.ownerId)?.langs || []).includes(l.lang));
  const out = [];
  if (same.length >= 5 && diff.length >= 3) {
    const ratio = conv(diff) ? conv(same) / conv(diff) : null;
    out.push(ratio && ratio > 1.1
      ? `Leads handled in the client's own language qualified ${ratio.toFixed(1)}× as often (${Math.round(conv(same) * 100)}% vs ${Math.round(conv(diff) * 100)}%, ${same.length + diff.length} non-English leads). Keep "Language match" above "Lowest open workload".`
      : `Language match made little difference this period (${Math.round(conv(same) * 100)}% vs ${Math.round(conv(diff) * 100)}%). You could move "Lowest open workload" higher to spread leads more evenly.`);
  }
  const arabic = s.users.filter((u) => u.firmId === actor.firmId && u.status === 'Active' && u.role === 'Agent' && (u.langs || []).includes('Arabic')).length;
  const arLeads = s.leads.filter((l) => l.firmId === actor.firmId && l.lang === 'Arabic' && Date.now() - l.createdAt < 30 * DAY).length;
  if (arLeads && arabic) out.push(`${arLeads} Arabic-speaking leads arrived in 30 days for ${arabic} Arabic-speaking agents (${Math.round(arLeads / arabic)} each).`);
  return out.length ? out : ['Not enough history yet. Suggestions appear after a few weeks of leads.'];
}
