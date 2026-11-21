// Join page entry (P0): sign up with an invite code, or request to join.
// LWC equivalent: c-bp-join-start on the public guest page.

import { button, field, select, textarea, formErrors, readForm, alertBox, toast } from '../core/ui.js';
import { esc } from '../core/util.js';
import { EMIRATES } from '../core/config.js';
import { bpAuthLayout } from './bpAuthLayout.js';
import { checkInvite, requestToJoin } from '../services/registrationService.js';
import { go } from '../core/app.js';
import { tabSession } from '../core/store.js';

export function bpJoinStart() {
  const err = tabSession.get('join:codeError');
  return bpAuthLayout(`
    <div class="slds-text-heading_large slds-m-bottom_x-small">Join Broker Portal</div>
    <p class="bp-muted slds-m-bottom_large">Firms join by invitation from our sales team. Have an invite? Start your sign-up. Otherwise, request to join and we'll be in touch.</p>
    <div class="bp-choice">
      <form class="bp-choice-card" data-submit="useCode">
        <h3>I have an invite</h3>
        <p class="bp-muted bp-small slds-m-bottom_small">Use the link in your email, or type the 7-character code.</p>
        ${field('inviteCode', 'Invite code', { value: tabSession.get('join:code', ''), attrs: 'autocomplete="off" maxlength="7" style="text-transform:uppercase"', error: err || '' })}
        <button type="submit" class="slds-button slds-button_brand slds-button_stretch">Start sign-up</button>
      </form>
      <div class="bp-choice-card">
        <h3>Request to join</h3>
        <p class="bp-muted bp-small slds-m-bottom_small">Tell us about your firm. Our sales team reviews every request within 2 business days.</p>
        ${button('Request to join', 'goRequest', { variant: 'outline-brand', attrs: 'style="width:100%"' })}
      </div>
    </div>
    <p class="bp-small bp-muted slds-m-top_large">Already set up? <a class="bp-link" href="portal/">Sign in to your portal</a></p>
    <div class="bp-demo"><b>Demo:</b> invite code <code>MGR7Q2K</code> works (Marina Gate Realty). <code>HBV2M8D</code> is expired and <code>OPP5X9M</code> is already used.</div>
  `, { headline: 'Join the platform UAE brokerages run on' });
}

export function bpRequestForm() {
  const errors = tabSession.get('join:requestErrors', []);
  const v = tabSession.get('join:requestDraft', {});
  return bpAuthLayout(`
    <a class="bp-link bp-small" href="join/#/">← Back</a>
    <div class="slds-text-heading_large slds-m-vertical_x-small">Request to join</div>
    <p class="bp-muted slds-m-bottom_medium">Our sales team reviews each request. If it's a fit, you'll receive an invitation to sign up.</p>
    ${formErrors(errors)}
    <form id="request-form" data-submit="submitRequest">
      <div class="slds-grid slds-wrap slds-gutters_x-small">
        <div class="slds-col slds-size_1-of-2">${field('firmName', 'Firm name', { value: v.firmName, required: true })}</div>
        <div class="slds-col slds-size_1-of-2">${select('emirate', 'Emirate', ['', ...EMIRATES], { value: v.emirate || 'Dubai', required: true })}</div>
        <div class="slds-col slds-size_1-of-2">${field('contactName', 'Your name', { value: v.contactName, required: true })}</div>
        <div class="slds-col slds-size_1-of-2">${field('agents', 'Number of agents', { value: v.agents, type: 'number', required: true, attrs: 'min="1" max="1000"' })}</div>
        <div class="slds-col slds-size_1-of-2">${field('email', 'Work email', { value: v.email, type: 'email', required: true })}</div>
        <div class="slds-col slds-size_1-of-2">${field('phone', 'Mobile', { value: v.phone, type: 'tel', required: true, attrs: 'placeholder="+971 50 123 4567"' })}</div>
        <div class="slds-col slds-size_1-of-1">${textarea('message', 'What would you like Broker Portal to help with?', { value: v.message, attrs: 'maxlength="1000"' })}</div>
      </div>
      <button type="submit" class="slds-button slds-button_brand">Send request</button>
    </form>`, { headline: 'Tell us about your brokerage' });
}

export function bpRequestSent(id) {
  return bpAuthLayout(`
    ${alertBox('success', 'Request received')}
    <div class="slds-text-heading_large slds-m-vertical_small">Thank you</div>
    <p>We've received your request (${esc(id)}) and emailed you a confirmation. Our sales team reviews requests within 2 business days.</p>
    <p class="slds-m-top_small">If it's a fit, you'll receive an invitation link to sign up your firm.</p>
    <a class="slds-button slds-button_neutral slds-m-top_large" href="join/#/">Back to start</a>
  `, { headline: 'Thanks for your interest' });
}

export const joinStartActions = {
  useCode(form) {
    const code = String(readForm(form).inviteCode || '').trim().toUpperCase();
    tabSession.set('join:code', code);
    const res = checkInvite(code);
    if (!res.invite) {
      tabSession.set('join:codeError', res.reason);
      go('');
      return;
    }
    tabSession.set('join:codeError', null);
    go(`invite/${res.invite.token}`);
  },
  goRequest() {
    tabSession.set('join:requestErrors', []);
    go('request');
  },
  submitRequest(form) {
    const values = readForm(form);
    tabSession.set('join:requestDraft', values);
    try {
      const req = requestToJoin(values);
      tabSession.set('join:requestDraft', null);
      tabSession.set('join:requestErrors', []);
      toast('success', 'Request sent', 'Our sales team will review it.');
      go(`request/sent/${req.id}`);
    } catch (err) {
      if (!err.messages) throw err;
      tabSession.set('join:requestErrors', err.messages);
      go('request');
    }
  },
};
