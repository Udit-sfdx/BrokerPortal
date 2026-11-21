// ThinkVibes operator actions: join requests, invites, firm review and lifecycle.
// Mirrors: an internal Lightning app used by ThinkVibes sales and operations.
// Operators never read a firm's leads, deals or clients: only counts appear here.

import { getState, mutate, now, nextId, audit, sendEmail } from '../core/store.js';
import { DAY, isEmail, isBlank, assertValid } from '../core/util.js';
import { EMIRATES, INVITE_TTL_DAYS, TRIAL_DAYS, PLANS, defaultFirmSettings } from '../core/config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const opLabel = (op) => `${op.name} (ThinkVibes)`;

function newToken() {
  const s = getState();
  let token;
  do {
    token = Array.from({ length: 7 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  } while (s.invites.some((i) => i.token === token));
  return token;
}

export function inviteState(invite, t = now()) {
  if (invite.revokedAt) return 'Revoked';
  if (invite.usedAt) return 'Used';
  if (invite.expiresAt < t) return 'Expired';
  return 'Pending';
}

/* ---------- invites ---------- */

export function createInvite(op, input, requestId = null) {
  const problems = [];
  if (isBlank(input.firmName)) problems.push('Firm name is required.');
  if (isBlank(input.ownerName)) problems.push("Owner's name is required.");
  if (!isEmail(input.ownerEmail)) problems.push("Enter the owner's email address.");
  if (!EMIRATES.includes(input.emirate)) problems.push('Choose an emirate.');
  assertValid(problems);
  const s = getState();
  const pending = s.invites.find((i) => sameText(i.ownerEmail, input.ownerEmail) && inviteState(i) === 'Pending');
  assertValid(pending ? [`There is already a pending invite for this email (${pending.token}). Resend it instead.`] : []);
  const active = s.users.find((u) => sameText(u.email, input.ownerEmail) && u.status === 'Active');
  assertValid(active ? ['This email belongs to an active user of another firm. They must be deactivated there first.'] : []);

  return mutate((st) => {
    const invite = {
      token: newToken(), firmName: input.firmName.trim(), ownerName: input.ownerName.trim(), ownerEmail: input.ownerEmail.trim(),
      emirate: input.emirate, requestId, createdAt: now(), expiresAt: now() + INVITE_TTL_DAYS * DAY, usedAt: null, revokedAt: null,
      createdBy: op.name, firmId: null,
    };
    st.invites.unshift(invite);
    sendEmail(invite.ownerEmail, 'Your invitation to Broker Portal',
      `${invite.firmName} is invited to join Broker Portal. The link expires in ${INVITE_TTL_DAYS} days.`, `join/#/invite/${invite.token}`);
    audit(opLabel(op), 'Invite sent', `${invite.firmName} (${invite.ownerEmail}), code ${invite.token}.`);
    return invite;
  });
}

export function resendInvite(op, token) {
  const invite = getState().invites.find((i) => i.token === token);
  assertValid(invite ? [] : ['Invite not found.']);
  const st = inviteState(invite);
  assertValid(['Used', 'Revoked'].includes(st) ? [`This invite is ${st.toLowerCase()} and can't be resent.`] : []);
  mutate((s) => {
    const inv = s.invites.find((i) => i.token === token);
    inv.expiresAt = now() + INVITE_TTL_DAYS * DAY;
    sendEmail(inv.ownerEmail, 'Reminder: your invitation to Broker Portal', `Your invite for ${inv.firmName} is valid for ${INVITE_TTL_DAYS} more days.`, `join/#/invite/${inv.token}`);
    audit(opLabel(op), 'Invite resent', `${inv.firmName}, valid until ${new Date(inv.expiresAt).toISOString().slice(0, 10)}.`);
  });
}

export function revokeInvite(op, token) {
  const invite = getState().invites.find((i) => i.token === token);
  assertValid(invite ? [] : ['Invite not found.']);
  assertValid(inviteState(invite) === 'Pending' || inviteState(invite) === 'Expired' ? [] : ['Only unused invites can be withdrawn.']);
  mutate((s) => {
    s.invites.find((i) => i.token === token).revokedAt = now();
    audit(opLabel(op), 'Invite withdrawn', `${invite.firmName} (${invite.token}).`);
  });
}

/* ---------- join requests ---------- */

export function acceptRequest(op, requestId) {
  const req = getState().joinRequests.find((r) => r.id === requestId);
  assertValid(req ? [] : ['Request not found.']);
  assertValid(req.status === 'Requested' ? [] : [`This request is already ${req.status.toLowerCase()}.`]);
  const invite = createInvite(op, { firmName: req.firmName, ownerName: req.contactName, ownerEmail: req.email, emirate: req.emirate }, req.id);
  mutate((s) => {
    const r = s.joinRequests.find((x) => x.id === requestId);
    Object.assign(r, { status: 'Invited', decidedAt: now(), decidedBy: op.name });
    audit(opLabel(op), 'Request accepted', `${r.firmName}: invite ${invite.token} sent.`);
  });
  return invite;
}

export function declineRequest(op, requestId, reason) {
  const req = getState().joinRequests.find((r) => r.id === requestId);
  assertValid(req ? [] : ['Request not found.']);
  assertValid(req.status === 'Requested' ? [] : [`This request is already ${req.status.toLowerCase()}.`]);
  assertValid(String(reason || '').trim().length >= 10 ? [] : ['Give the firm a reason of at least 10 characters.']);
  mutate((s) => {
    const r = s.joinRequests.find((x) => x.id === requestId);
    Object.assign(r, { status: 'Declined', reason: reason.trim(), decidedAt: now(), decidedBy: op.name });
    sendEmail(r.email, 'About your request to join Broker Portal', reason.trim());
    audit(opLabel(op), 'Request declined', `${r.firmName}: ${reason.trim()}`);
  });
}

/* ---------- firm review ---------- */

function requireFirm(firmId) {
  const firm = getState().firms.find((f) => f.id === firmId);
  assertValid(firm ? [] : ['Firm not found.']);
  return firm;
}

function setStatus(st, firm, status, by, note = '') {
  firm.status = status;
  firm.statusHistory.push({ at: now(), status, by, note });
}

export function approveFirm(op, firmId) {
  const firm = requireFirm(firmId);
  assertValid(['Pending verification', 'Needs information'].includes(firm.status) ? [] : [`${firm.name} is ${firm.status}; only firms waiting for review can be approved.`]);
  assertValid(firm.verification?.result === 'verified' ? [] : ['Document verification has not returned "verified" yet.']);
  assertValid(firm.checks.every((c) => c.ok) ? [] : ['Some automatic checks failed. Ask the firm for more information instead.']);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    const owner = s.users.find((u) => u.id === f.ownerId);
    const status = f.plan === 'Trial' ? 'Trial' : 'Active';
    setStatus(s, f, status, opLabel(op));
    f.approvedAt = now();
    f.trialEndsAt = status === 'Trial' ? now() + TRIAL_DAYS * DAY : null;
    f.settings = f.settings || defaultFirmSettings();
    owner.status = 'Active';
    owner.activatedAt = now();
    s.notifications.unshift({ id: nextId('N'), userId: owner.id, text: 'Your firm is approved. Finish setup to invite your team.', link: '#/onboarding', at: now(), read: false });
    sendEmail(owner.email, `${f.name} is approved`, 'Your workspace is ready. Sign in to finish setting up your firm.', 'portal/');
    audit(opLabel(op), 'Firm approved', `${f.name}: workspace created (${status}).`, f.id);
  });
}

export function requestInformation(op, firmId, note) {
  const firm = requireFirm(firmId);
  assertValid(['Pending verification', 'Needs information'].includes(firm.status) ? [] : ['Only firms under review can be asked for more information.']);
  assertValid(String(note || '').trim().length >= 10 ? [] : ['Describe what is needed in at least 10 characters.']);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    setStatus(s, f, 'Needs information', opLabel(op), note.trim());
    f.reviewNotes.push({ at: now(), by: op.name, note: note.trim() });
    sendEmail(s.users.find((u) => u.id === f.ownerId).email, 'More information needed', note.trim());
    audit(opLabel(op), 'More information requested', `${f.name}: ${note.trim()}`, f.id);
  });
}

export function rejectFirm(op, firmId, reason) {
  const firm = requireFirm(firmId);
  assertValid(['Pending verification', 'Needs information'].includes(firm.status) ? [] : ['Only firms under review can be rejected.']);
  assertValid(String(reason || '').trim().length >= 10 ? [] : ['Give a reason of at least 10 characters.']);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    setStatus(s, f, 'Rejected', opLabel(op), reason.trim());
    const owner = s.users.find((u) => u.id === f.ownerId);
    owner.status = 'Deactivated';
    owner.deactivatedAt = now();
    sendEmail(owner.email, 'About your Broker Portal registration', reason.trim());
    audit(opLabel(op), 'Firm rejected', `${f.name}: ${reason.trim()}`, f.id);
  });
}

/* ---------- lifecycle ---------- */

export function suspendFirm(op, firmId, reason) {
  const firm = requireFirm(firmId);
  assertValid(['Active', 'Trial'].includes(firm.status) ? [] : ['Only active or trial firms can be suspended.']);
  assertValid(String(reason || '').trim().length >= 10 ? [] : ['Give a reason of at least 10 characters.']);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    f.statusBeforeSuspension = f.status;
    setStatus(s, f, 'Suspended', opLabel(op), reason.trim());
    audit(opLabel(op), 'Firm suspended', `${f.name}: ${reason.trim()}`, f.id);
  });
}

export function reactivateFirm(op, firmId) {
  const firm = requireFirm(firmId);
  assertValid(firm.status === 'Suspended' ? [] : ['Only suspended firms can be reactivated.']);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    setStatus(s, f, f.statusBeforeSuspension || 'Active', opLabel(op));
    audit(opLabel(op), 'Firm reactivated', f.name, f.id);
  });
}

export function changePlan(op, firmId, plan, seats) {
  const firm = requireFirm(firmId);
  const n = Number(seats);
  const problems = [];
  if (!PLANS[plan] || plan === 'Trial') problems.push('Choose Option A or Option B.');
  if (!Number.isInteger(n) || n < 1 || n > 500) problems.push('Seats must be a whole number from 1 to 500.');
  const used = getState().users.filter((u) => u.firmId === firmId && ['Active', 'Invited'].includes(u.status)).length;
  if (n < used) problems.push(`The firm already has ${used} active or invited users.`);
  if (!['Active', 'Trial'].includes(firm.status)) problems.push(`Plans can't change while the firm is ${firm.status.toLowerCase()}.`);
  assertValid(problems);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    f.plan = plan;
    f.seats = n;
    if (f.status === 'Trial') {
      setStatus(s, f, 'Active', opLabel(op), `Upgraded to ${PLANS[plan].label}`);
      f.trialEndsAt = null;
    }
    audit(opLabel(op), 'Plan changed', `${f.name}: ${PLANS[plan].label}, ${n} seats.`, f.id);
  });
}

export function offboardFirm(op, firmId, confirmName) {
  const firm = requireFirm(firmId);
  assertValid(sameText(confirmName, firm.name) ? [] : ['Type the firm name exactly to confirm.']);
  assertValid(firm.status === 'Offboarded' ? ['This firm is already offboarded.'] : []);
  mutate((s) => {
    const f = s.firms.find((x) => x.id === firmId);
    setStatus(s, f, 'Offboarded', opLabel(op), 'Data export sent to the owner; deletion scheduled after the 30-day notice period.');
    s.users.filter((u) => u.firmId === firmId && u.status !== 'Deactivated').forEach((u) => {
      u.status = 'Deactivated';
      u.deactivatedAt = now();
    });
    audit(opLabel(op), 'Firm offboarded', `${f.name}: all logins deactivated; data export sent.`, f.id);
  });
}

/** Counts only: the console never reads a firm's records. */
export function firmUsage(firmId) {
  const s = getState();
  const users = s.users.filter((u) => u.firmId === firmId);
  return {
    active: users.filter((u) => u.status === 'Active').length,
    invited: users.filter((u) => u.status === 'Invited').length,
    deactivated: users.filter((u) => u.status === 'Deactivated').length,
    leads: s.leads.filter((l) => l.firmId === firmId).length,
    deals: s.deals.filter((d) => d.firmId === firmId).length,
    lastSignIn: s.audit.find((a) => a.firmId === firmId && a.action === 'Signed in')?.at || null,
  };
}

export function markNotificationsRead(audience) {
  mutate((s) => s.notifications.forEach((n) => { if (n.userId === audience) n.read = true; }));
}
