// Sign-in with email + one-time code (simulated: the code is shown on screen in the demo).
// Mirrors: Experience Cloud passwordless login + a custom login LWC.

import { getState, mutate, now, tabSession, audit } from '../core/store.js';
import { MIN, isEmail, assertValid } from '../core/util.js';

const CODE_TTL = 10 * MIN;
const MAX_ATTEMPTS = 5;

const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Explains why an email can't sign in to the firm portal, or returns null when it can. */
function portalBlocker(email) {
  const s = getState();
  const matches = s.users.filter((u) => sameEmail(u.email, email));
  if (!matches.length) return 'No Broker Portal account uses this email. Ask your firm admin for an invitation.';
  const active = matches.find((u) => u.status === 'Active');
  if (active) {
    const firm = s.firms.find((f) => f.id === active.firmId);
    if (firm && firm.status === 'Offboarded') return 'Your firm has left Broker Portal.';
    return null;
  }
  if (matches.some((u) => u.status === 'Pending')) return "Your firm is still being verified by ThinkVibes. You'll get an email when it's approved.";
  if (matches.some((u) => u.status === 'Invited')) return 'Accept your invitation first: use the link in your invitation email.';
  return 'Your access has been removed. Contact your firm admin if this is a mistake.';
}

/** Step 1: send a code. Returns the code so the demo can display it. */
export function requestCode(email, app) {
  const clean = String(email || '').trim();
  assertValid(isEmail(clean) ? [] : ['Enter a valid email address.']);
  const s = getState();
  if (app === 'console') {
    assertValid(s.operators.some((o) => sameEmail(o.email, clean)) ? [] : ['This console is for ThinkVibes staff only.']);
  } else {
    const blocker = portalBlocker(clean);
    assertValid(blocker ? [blocker] : []);
  }
  const code = makeCode();
  mutate((st) => {
    st.otp[clean.toLowerCase()] = { code, expiresAt: now() + CODE_TTL, attempts: 0 };
  });
  return code;
}

/** Step 2: check the code and sign this tab in. */
export function verifyCode(email, code, app) {
  const key = String(email || '').trim().toLowerCase();
  const entry = getState().otp[key];
  const problems = [];
  if (!/^\d{6}$/.test(String(code || '').trim())) problems.push('Enter the 6-digit code.');
  else if (!entry) problems.push('Request a new code.');
  else if (entry.expiresAt < now()) problems.push('This code has expired. Request a new one.');
  else if (entry.attempts >= MAX_ATTEMPTS) problems.push('Too many attempts. Request a new code.');
  else if (entry.code !== String(code).trim()) {
    mutate((st) => { st.otp[key].attempts += 1; });
    problems.push('That code is not correct.');
  }
  assertValid(problems);

  mutate((st) => { delete st.otp[key]; });
  const s = getState();
  if (app === 'console') {
    const op = s.operators.find((o) => sameEmail(o.email, key));
    tabSession.set('operatorId', op.id);
    return op;
  }
  const user = s.users.find((u) => sameEmail(u.email, key) && u.status === 'Active');
  assertValid(user ? [] : [portalBlocker(key) || 'Sign-in failed.']);
  tabSession.set('userId', user.id);
  mutate(() => audit(user.name, 'Signed in', 'Portal sign-in with one-time code', user.firmId));
  return user;
}

/** Demo shortcut (presenter panel): sign in as a listed account without a code, same rules apply. */
export function demoSignIn(userId) {
  const s = getState();
  const user = s.users.find((u) => u.id === userId);
  assertValid(user ? [] : ['Unknown account.']);
  if (user.status !== 'Active') assertValid([portalBlocker(user.email) || 'This account is not active.']);
  tabSession.set('userId', user.id);
  return user;
}

export function demoOperatorSignIn(operatorId) {
  tabSession.set('operatorId', operatorId);
}

export function currentUser() {
  const id = tabSession.get('userId');
  if (!id) return null;
  const user = getState().users.find((u) => u.id === id);
  // A user deactivated while signed in loses access on the next render.
  if (!user || user.status !== 'Active') {
    tabSession.set('userId', null);
    return null;
  }
  return user;
}

export function currentOperator() {
  const id = tabSession.get('operatorId');
  return id ? getState().operators.find((o) => o.id === id) || null : null;
}

export function signOut(app) {
  tabSession.set(app === 'console' ? 'operatorId' : 'userId', null);
}
