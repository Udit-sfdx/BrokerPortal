// Sign-in with email and a one-time code, for the firm portal and the ThinkVibes console.
// LWC equivalent: c-bp-login on the site's login page (passwordless login).

import { field, formErrors, readForm, button, avatar, statusBadge, toast } from '../core/ui.js';
import { esc } from '../core/util.js';
import { getState, tabSession } from '../core/store.js';
import { bpAuthLayout } from './bpAuthLayout.js';
import { requestCode, verifyCode, demoSignIn, demoOperatorSignIn } from '../services/authService.js';
import { findUserInvite, acceptUserInvite } from '../services/firmService.js';
import { go } from '../core/app.js';

const DEMO_PEOPLE = {
  'F-CK': ['U-CK-1', 'U-CK-2', 'U-CK-3', 'U-CK-10', 'U-CK-5', 'U-CK-6'],
  'F-PA': ['U-PA-1', 'U-PA-2', 'U-PA-30'],
  'F-DR': ['U-DR-1'],
};

function demoPanel(app) {
  const s = getState();
  if (app === 'console') {
    return `<div class="bp-demo"><b>Demo accounts (ThinkVibes staff):</b><div class="slds-m-top_x-small">${s.operators.map((o) =>
      `<button type="button" class="slds-button slds-button_neutral slds-m-right_x-small slds-m-bottom_x-small" data-act="demoOperator" data-id="${o.id}">${esc(o.name)} · ${esc(o.role)}</button>`).join('')}</div></div>`;
  }
  const groups = Object.entries(DEMO_PEOPLE).map(([firmId, ids]) => {
    const firm = s.firms.find((f) => f.id === firmId);
    const people = ids.map((id) => s.users.find((u) => u.id === id)).filter(Boolean);
    return `<div class="slds-m-top_small"><div class="bp-small"><b>${esc(firm.name)}</b> ${statusBadge(firm.status)}</div>${people.map((u) =>
      `<button type="button" class="slds-button slds-button_neutral bp-demo-person" data-act="demoUser" data-id="${u.id}">${avatar(u.name, firm.brand, 20)} ${esc(u.name)} <span class="bp-muted">· ${esc(u.role)}</span></button>`).join('')}</div>`;
  }).join('');
  return `<div class="bp-demo"><b>Demo accounts.</b> Or type an email above, e.g. <code>sara.khan@crescentkeyrealty.example</code>.
    ${groups}
    <div class="slds-m-top_small bp-small"><b>Blocked cases:</b>
      <button type="button" class="slds-button slds-button_neutral bp-demo-person" data-act="demoUser" data-id="U-CK-30">Vikram Rao · old Crescent Key login (deactivated)</button>
      <button type="button" class="slds-button slds-button_neutral bp-demo-person" data-act="demoUser" data-id="U-OP-1">Tariq Al Amiri · firm under review</button></div></div>`;
}

export function bpSignIn(app) {
  const stage = tabSession.get(`${app}:login`, { step: 'email', email: '', errors: [], code: null });
  const isConsole = app === 'console';
  const body = stage.step === 'email'
    ? `<form data-submit="loginEmail">${field('email', 'Work email', { value: stage.email, type: 'email', required: true, attrs: 'autocomplete="email"' })}
        <button type="submit" class="slds-button slds-button_brand slds-button_stretch">Send sign-in code</button></form>`
    : `<p class="slds-m-bottom_small">We sent a 6-digit code to <b>${esc(stage.email)}</b>.</p>
       <form data-submit="loginCode">${field('code', 'Sign-in code', { attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code"' })}
        <button type="submit" class="slds-button slds-button_brand slds-button_stretch">Sign in</button></form>
       <div class="slds-m-top_small slds-grid slds-grid_align-spread"><a class="bp-link bp-small" data-act="loginBack">Use a different email</a><a class="bp-link bp-small" data-act="loginResend">Resend code</a></div>
       <div class="bp-demo"><b>Demo:</b> the email would contain code <code>${esc(stage.code)}</code>.</div>`;
  return bpAuthLayout(`
    <div class="slds-text-heading_large slds-m-bottom_x-small">${isConsole ? 'ThinkVibes console' : 'Sign in'}</div>
    <p class="bp-muted slds-m-bottom_large">${isConsole ? 'Staff only. Manage join requests, invitations and firms.' : 'Sign in with your work email. No password needed.'}</p>
    ${formErrors(stage.errors)}${body}
    ${isConsole ? '' : '<p class="bp-small bp-muted slds-m-top_large">New firm? <a class="bp-link" href="join/">Join Broker Portal</a></p>'}
    ${demoPanel(app)}`, { narrow: true, headline: isConsole ? 'Broker Portal operations' : undefined });
}

export function bpAcceptInvite(token) {
  const res = findUserInvite(token);
  const errors = tabSession.get('accept:errors', []);
  if (!res.user) {
    return bpAuthLayout(`<div class="slds-text-heading_large slds-m-bottom_small">Invitation</div>${formErrors([res.reason])}
      <a class="slds-button slds-button_neutral" href="portal/">Go to sign in</a>`, { narrow: true });
  }
  const { user, firm } = res;
  return bpAuthLayout(`
    <div class="slds-grid slds-grid_vertical-align-center slds-m-bottom_medium"><span class="bp-logo" style="background:${esc(firm.brand)}">${esc(firm.logoText || firm.name.slice(0, 2).toUpperCase())}</span>
      <div class="slds-m-left_small"><div class="slds-text-heading_medium">${esc(firm.name)}</div><div class="bp-small bp-muted">invited you as ${esc(user.role)}</div></div></div>
    <p class="slds-m-bottom_medium">Hi ${esc(user.name.split(' ')[0])}, set a password to activate your login. You'll normally sign in with a one-time code to <b>${esc(user.email)}</b>.</p>
    ${formErrors(errors)}
    <form data-submit="acceptInvite" data-token="${esc(token)}">
      ${field('password', 'Password', { type: 'password', required: true, help: '10+ characters, one capital letter, one number' })}
      ${field('confirm', 'Confirm password', { type: 'password', required: true })}
      <button type="submit" class="slds-button slds-button_brand slds-button_stretch">Activate and sign in</button>
    </form>`, { narrow: true, headline: `Join ${firm.name}` });
}

function setStage(app, patch) {
  const cur = tabSession.get(`${app}:login`, { step: 'email', email: '', errors: [], code: null });
  tabSession.set(`${app}:login`, { ...cur, ...patch });
}

const appName = () => (document.documentElement.dataset.app === 'console' ? 'console' : 'portal');

export const signInActions = {
  loginEmail(form) {
    const app = appName();
    const email = String(readForm(form).email || '').trim();
    try {
      const code = requestCode(email, app);
      setStage(app, { step: 'code', email, errors: [], code });
    } catch (err) {
      if (!err.messages) throw err;
      setStage(app, { step: 'email', email, errors: err.messages });
    }
    go('');
  },
  loginCode(form) {
    const app = appName();
    const stage = tabSession.get(`${app}:login`);
    try {
      verifyCode(stage.email, readForm(form).code, app);
      tabSession.set(`${app}:login`, null);
      toast('success', 'Signed in');
    } catch (err) {
      if (!err.messages) throw err;
      setStage(app, { errors: err.messages });
    }
    go('');
  },
  loginBack() {
    setStage(appName(), { step: 'email', errors: [], code: null });
    go('');
  },
  loginResend() {
    const app = appName();
    const stage = tabSession.get(`${app}:login`);
    const code = requestCode(stage.email, app);
    setStage(app, { code, errors: [] });
    toast('info', 'New code sent');
    go('');
  },
  demoUser(el) {
    try {
      demoSignIn(el.dataset.id);
      tabSession.set('portal:login', null);
      go('home');
    } catch (err) {
      if (!err.messages) throw err;
      setStage('portal', { step: 'email', errors: err.messages });
      go('');
    }
  },
  demoOperator(el) {
    demoOperatorSignIn(el.dataset.id);
    tabSession.set('console:login', null);
    go('overview');
  },
  acceptInvite(form) {
    const v = readForm(form);
    try {
      const user = acceptUserInvite(form.dataset.token, v.password, v.confirm);
      tabSession.set('accept:errors', []);
      tabSession.set('userId', user.id);
      toast('success', `Welcome to ${getState().firms.find((f) => f.id === user.firmId).name}`);
      go('home');
    } catch (err) {
      if (!err.messages) throw err;
      tabSession.set('accept:errors', err.messages);
      go(`accept/${form.dataset.token}`);
    }
  },
};
