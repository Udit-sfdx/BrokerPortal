// Firm registration: request to join, invite validation, sign-up, document reading and verification.
// Mirrors: BP_RegistrationService (Apex) + a guest-user site flow in the Salesforce build.

import { getState, mutate, now, nextId, audit, sendEmail } from '../core/store.js';
import { DAY, HOUR, isEmail, isPhone, isBlank, normPhone, slug, passwordProblems, assertValid } from '../core/util.js';
import { EMIRATES, PLANS, FIRM_DOCUMENTS, defaultFirmSettings } from '../core/config.js';

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/* ---------- request to join (no invite) ---------- */

export function requestToJoin(input) {
  const problems = [];
  if (isBlank(input.firmName)) problems.push('Firm name is required.');
  if (!EMIRATES.includes(input.emirate)) problems.push('Choose an emirate.');
  if (isBlank(input.contactName)) problems.push('Contact name is required.');
  if (!isEmail(input.email)) problems.push('Enter a valid email address.');
  if (!isPhone(input.phone)) problems.push('Enter a valid mobile number, e.g. +971 50 123 4567.');
  const agents = Number(input.agents);
  if (!Number.isInteger(agents) || agents < 1 || agents > 1000) problems.push('Number of agents must be a whole number from 1 to 1000.');
  if ((input.message || '').length > 1000) problems.push('Message must be 1000 characters or fewer.');
  assertValid(problems);

  const s = getState();
  const open = s.joinRequests.find((r) => sameText(r.email, input.email) && r.status === 'Requested');
  assertValid(open ? ['We already have a request from this email. Our sales team will be in touch.'] : []);
  const existing = s.firms.find((f) => sameText(f.name, input.firmName) && f.status !== 'Offboarded');
  assertValid(existing ? ['A firm with this name is already on Broker Portal. If you work there, ask its admin to invite you.'] : []);

  return mutate((st) => {
    const req = {
      id: nextId('JR'), firmName: input.firmName.trim(), emirate: input.emirate, contactName: input.contactName.trim(),
      email: input.email.trim(), phone: normPhone(input.phone), agents, message: (input.message || '').trim(),
      status: 'Requested', reason: '', at: now(), decidedAt: null, decidedBy: null,
    };
    st.joinRequests.unshift(req);
    st.notifications.unshift({ id: nextId('N'), userId: 'OP-ALL', text: `New request to join: ${req.firmName}.`, link: '#/requests', at: now(), read: false });
    sendEmail(req.email, 'We received your request', `Thanks, ${req.contactName}. Our sales team reviews requests within 2 business days.`);
    audit(req.contactName, 'Request to join', `${req.firmName} asked to join Broker Portal.`);
    return req;
  });
}

/* ---------- invites ---------- */

/** Returns { invite } when usable, or { reason } explaining why not. Token match ignores case. */
export function checkInvite(token) {
  const t = String(token || '').trim().toUpperCase();
  if (!t) return { reason: 'Enter your invite code.' };
  const invite = getState().invites.find((i) => i.token === t);
  if (!invite) return { reason: 'This invite code is not valid. Check the link in your email.' };
  if (invite.revokedAt) return { reason: 'This invite was withdrawn. Contact the ThinkVibes sales team.' };
  if (invite.usedAt) return { reason: 'This invite has already been used. If your firm is set up, sign in to the portal instead.', used: true };
  if (invite.expiresAt < now()) return { reason: 'This invite expired. Ask the ThinkVibes sales team to send a new one.' };
  return { invite };
}

/* ---------- Document Reader (simulated AI extraction) ---------- */

/**
 * Simulates the Document Reader agent reading an uploaded file.
 * Returns extracted fields; the owner must confirm or correct them before submitting.
 * File names containing "expired" or "mismatch" produce those cases for the demo.
 */
export function readDocument(docKey, fileName, form) {
  const name = String(fileName || '').toLowerCase();
  const expired = name.includes('expired');
  const mismatch = name.includes('mismatch');
  const t = now();
  const valid = (days) => (expired ? t - 20 * DAY : t + days * DAY);
  const firmName = form.firmName || 'Your firm';
  switch (docKey) {
    case 'tradeLicence':
      return {
        licenceNo: mismatch ? 'DED-9999001' : form.tradeLicence || 'DED-1400000',
        licenceExpiry: valid(340),
        activity: 'Real estate brokerage',
        legalName: `${firmName} L.L.C`,
      };
    case 'ornCertificate':
      return { orn: mismatch ? '99001' : form.orn || '32000', ornExpiry: valid(300) };
    case 'ownerEid':
      return { eidName: form.ownerName || '', eidExpiry: valid(800) };
    default:
      throw new Error(`Unknown document type: ${docKey}`);
  }
}

/** Automatic checks run on submit; each check is shown to the owner and to ThinkVibes. */
export function runChecks(draft, excludeFirmId = null) {
  const s = getState();
  const t = now();
  const lic = draft.documents.tradeLicence?.fields || {};
  const orn = draft.documents.ornCertificate?.fields || {};
  const dup = s.firms.find((f) => f.id !== excludeFirmId && f.status !== 'Offboarded' && f.status !== 'Rejected'
    && ((lic.licenceNo && sameText(f.tradeLicence, lic.licenceNo)) || (orn.orn && sameText(f.orn, orn.orn))));
  return [
    { label: 'Trade licence is valid', ok: !!lic.licenceExpiry && lic.licenceExpiry > t, fail: 'The trade licence has expired.' },
    { label: 'ORN is valid', ok: !!orn.ornExpiry && orn.ornExpiry > t, fail: 'The ORN certificate has expired.' },
    { label: 'Licensed activity covers real estate brokerage', ok: /brokerage/i.test(lic.activity || ''), fail: 'The trade licence does not list real estate brokerage.' },
    { label: 'Firm not already registered', ok: !dup, fail: 'A firm with this trade licence or ORN is already registered.' },
  ];
}

/**
 * Validates the sign-up draft. Returns [{ step, message }] so the wizard can check one step at a time.
 * Steps: 0 account, 1 firm, 2 documents, 3 plan.
 */
export function validateDraft(draft) {
  const out = [];
  const add = (step, message) => out.push({ step, message });
  const a = draft.account || {};
  const f = draft.firm || {};
  if (isBlank(a.ownerName)) add(0, 'Your full name is required.');
  if (!isPhone(a.mobile)) add(0, 'Enter a valid mobile number.');
  else if (!a.mobileVerified || normPhone(a.mobileVerified) !== normPhone(a.mobile)) add(0, 'Verify your mobile number with the code we send.');
  const pw = passwordProblems(a.password || '');
  if (pw.length) add(0, `Password needs ${pw.join(', ')}.`);
  if ((a.password || '') !== (a.confirm || '')) add(0, 'Passwords do not match.');
  if (isBlank(f.firmName)) add(1, 'Firm name is required.');
  if (!EMIRATES.includes(f.emirate)) add(1, 'Choose your emirate.');
  if (isBlank(f.address)) add(1, 'Office address is required.');
  if (!/^DED-\d{7}$/i.test(String(f.tradeLicence || '').trim())) add(1, 'Trade licence number must look like DED-1234567.');
  if (!/^\d{5}$/.test(String(f.orn || '').trim())) add(1, 'ORN must be 5 digits.');
  const agents = Number(f.agents);
  if (!Number.isInteger(agents) || agents < 1 || agents > 1000) add(1, 'Number of agents must be a whole number from 1 to 1000.');
  for (const doc of FIRM_DOCUMENTS) {
    const d = draft.documents?.[doc.key];
    if (!d || !d.file) add(2, `Upload the ${doc.label}.`);
    else if (!d.confirmed) add(2, `Confirm the details read from the ${doc.label}.`);
  }
  const lic = draft.documents?.tradeLicence?.fields;
  const orn = draft.documents?.ornCertificate?.fields;
  const eid = draft.documents?.ownerEid?.fields;
  if (lic && f.tradeLicence && !sameText(lic.licenceNo, f.tradeLicence)) add(2, "The trade licence number on the document doesn't match the one you entered.");
  if (orn && f.orn && !sameText(orn.orn, f.orn)) add(2, "The ORN on the certificate doesn't match the one you entered.");
  const firstName = String(a.ownerName || '').trim().toLowerCase().split(/\s+/)[0];
  if (eid && firstName && !String(eid.eidName || '').toLowerCase().includes(firstName)) add(2, "The name on the Emirates ID doesn't match your name.");
  const plan = draft.plan || {};
  if (!PLANS[plan.plan]) add(3, 'Choose a plan.');
  const seats = Number(plan.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 500) add(3, 'Seats must be a whole number from 1 to 500.');
  else if (plan.plan === 'Trial' && seats > 5) add(3, 'The trial includes up to 5 users.');
  if (!plan.terms) add(3, 'Accept the terms of service.');
  if (!plan.dpa) add(3, 'Accept the data processing agreement (PDPL).');
  return out;
}

/** Creates the firm in "Pending verification" and the owner's pending login. Throws on any problem. */
export function submitRegistration(token, draft) {
  const { invite, reason } = checkInvite(token);
  assertValid(invite ? [] : [reason]);
  assertValid(validateDraft(draft).map((p) => p.message));
  const checks = runChecks(draft);
  assertValid(checks.filter((c) => !c.ok).map((c) => c.fail));

  const s = getState();
  const activeElsewhere = s.users.find((u) => sameText(u.email, invite.ownerEmail) && u.status === 'Active');
  assertValid(activeElsewhere ? ['This email is still active at another firm on Broker Portal. Ask that firm to deactivate it first.'] : []);

  return mutate((st) => {
    const f = draft.firm;
    const firmId = nextId('F');
    const code = slug(f.firmName).slice(0, 2).toUpperCase() || 'FR';
    const firm = {
      id: firmId, code, name: f.firmName.trim(), legalName: draft.documents.tradeLicence.fields.legalName, emirate: f.emirate,
      address: f.address.trim(), agentsExpected: Number(f.agents), tradeLicence: f.tradeLicence.trim().toUpperCase(),
      licenceExpiry: draft.documents.tradeLicence.fields.licenceExpiry, activity: draft.documents.tradeLicence.fields.activity,
      orn: f.orn.trim(), ornExpiry: draft.documents.ornCertificate.fields.ornExpiry, brand: '#0b5cab', logo: null,
      status: 'Pending verification', plan: draft.plan.plan, seats: Number(draft.plan.seats), trialEndsAt: null, setupComplete: false,
      createdAt: now(), approvedAt: null, loginAccessGranted: false,
      documents: Object.fromEntries(FIRM_DOCUMENTS.map((d) => [d.key, { ...draft.documents[d.key], uploadedAt: draft.documents[d.key].uploadedAt || now() }])),
      checks: checks.map(({ label, ok }) => ({ label, ok })), verification: null, reviewNotes: [],
      statusHistory: [{ at: now(), status: 'Pending verification', by: draft.account.ownerName }], teams: [], settings: defaultFirmSettings(), ownerId: null,
    };
    const local = draft.account.ownerName.trim().toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).join('.');
    const owner = {
      id: nextId('U'), firmId, name: draft.account.ownerName.trim(), email: invite.ownerEmail, username: `${local}@${slug(firm.name)}.bp`,
      role: 'Owner', teamId: null, status: 'Pending', brn: null, brnExpiry: null, langs: ['English'], lob: [], mobile: normPhone(draft.account.mobile),
      invitedAt: invite.createdAt, activatedAt: null, deactivatedAt: null, inviteToken: null,
    };
    firm.ownerId = owner.id;
    st.firms.push(firm);
    st.users.push(owner);
    const inv = st.invites.find((i) => i.token === invite.token);
    inv.usedAt = now();
    inv.firmId = firmId;
    audit(owner.name, 'Registration submitted', `${firm.name} submitted sign-up and documents.`, firmId);
    return firm;
  });
}

/**
 * Calls the document-verification API. Today it is a stub that always answers "verified";
 * ThinkVibes still checks the documents manually before approving the firm.
 */
export function verifyDocuments(firmId) {
  mutate((st) => {
    const firm = st.firms.find((f) => f.id === firmId);
    firm.verification = { requestedAt: now(), respondedAt: null, result: 'pending', source: 'stub' };
  });
  return new Promise((resolve) => {
    setTimeout(() => {
      const result = mutate((st) => {
        const firm = st.firms.find((f) => f.id === firmId);
        firm.verification = { ...firm.verification, respondedAt: now(), result: 'verified' };
        st.notifications.unshift({ id: nextId('N'), userId: 'OP-ALL', text: `${firm.name} is waiting for review.`, link: '#/verification', at: now(), read: false });
        sendEmail(st.users.find((u) => u.id === firm.ownerId).email, 'We received your registration',
          `${firm.name} is being reviewed by ThinkVibes. This usually takes 1 business day.`);
        audit('Verification API (stub)', 'Documents verified', `${firm.name}: response "verified" from the stub API.`, firm.id);
        return firm.verification;
      });
      resolve(result);
    }, 1600);
  });
}

export function getFirm(firmId) {
  return getState().firms.find((f) => f.id === firmId) || null;
}

export const REVIEW_SLA_HOURS = 24;
export const reviewDueAt = (firm) => (firm.verification?.respondedAt || firm.createdAt) + REVIEW_SLA_HOURS * HOUR;
