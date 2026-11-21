// Invite sign-up wizard (P0): account → firm details → documents (Document Reader) → plan → submit.
// LWC equivalent: c-bp-invite-signup composed of c-bp-stepper and c-bp-document-reader.

import { field, select, checkbox, formErrors, readForm, stepper, button, toast, openModal, closeModal, spinner, uIcon, alertBox } from '../core/ui.js';
import { esc, fmtDate, toDateInput, parseDateInput, isPhone, normPhone } from '../core/util.js';
import { EMIRATES, PLANS, FIRM_DOCUMENTS, FIELD_LABELS } from '../core/config.js';
import { bpAuthLayout } from './bpAuthLayout.js';
import { checkInvite, readDocument, validateDraft, runChecks, submitRegistration, verifyDocuments } from '../services/registrationService.js';
import { tabSession } from '../core/store.js';
import { go } from '../core/app.js';

const STEPS = ['Your account', 'Firm details', 'Documents', 'Plan & agreement'];
const DATE_FIELDS = ['licenceExpiry', 'ornExpiry', 'eidExpiry'];
const MAX_FILE = 10 * 1024 * 1024;
const OK_TYPES = /\.(pdf|jpe?g|png)$/i;

const keyFor = (token) => `signup:${token}`;

function loadDraft(invite) {
  return tabSession.get(keyFor(invite.token)) || {
    step: 0,
    errors: [],
    account: { ownerName: invite.ownerName, mobile: '', mobileVerified: '', password: '', confirm: '' },
    firm: { firmName: invite.firmName, emirate: invite.emirate, address: '', agents: '', tradeLicence: '', orn: '' },
    documents: {},
    plan: { plan: 'Trial', seats: 5, terms: false, dpa: false },
    otp: null,
  };
}

const saveDraft = (token, draft) => tabSession.set(keyFor(token), draft);

/** Copies the visible step's inputs into the draft. */
function capture(draft) {
  const root = document.getElementById('wizard');
  if (!root) return draft;
  const v = readForm(root);
  if (draft.step === 0) Object.assign(draft.account, { ownerName: v.ownerName, mobile: v.mobile, password: v.password, confirm: v.confirm });
  if (draft.step === 1) Object.assign(draft.firm, { firmName: v.firmName, emirate: v.emirate, address: v.address, agents: v.agents, tradeLicence: v.tradeLicence, orn: v.orn });
  if (draft.step === 2) {
    for (const doc of FIRM_DOCUMENTS) {
      const d = draft.documents[doc.key];
      if (!d || !d.fields) continue;
      for (const f of doc.fields) {
        const name = `doc.${doc.key}.${f}`;
        if (name in v) d.fields[f] = DATE_FIELDS.includes(f) ? parseDateInput(v[name]) : v[name];
      }
    }
  }
  if (draft.step === 3) Object.assign(draft.plan, { seats: v.seats, terms: !!v.terms, dpa: !!v.dpa });
  return draft;
}

function stepAccount(d, invite) {
  const a = d.account;
  const verified = a.mobileVerified && normPhone(a.mobileVerified) === normPhone(a.mobile);
  return `<div class="slds-grid slds-wrap slds-gutters_x-small">
    <div class="slds-col slds-size_1-of-2">${field('ownerName', 'Your full name (as on Emirates ID)', { value: a.ownerName, required: true })}</div>
    <div class="slds-col slds-size_1-of-2">${field('email', 'Email (from your invite)', { value: invite.ownerEmail, attrs: 'readonly' })}</div>
    <div class="slds-col slds-size_1-of-2">${field('mobile', 'Mobile', { value: a.mobile, type: 'tel', required: true, attrs: 'placeholder="+971 50 123 4567"' })}</div>
    <div class="slds-col slds-size_1-of-2 slds-p-top_large">
      ${verified ? `<span class="slds-badge slds-theme_success">${uIcon('check', 'slds-icon_xx-small')} Mobile verified</span>` : button(d.otp ? 'Resend code' : 'Send code', 'sendMobileCode', { variant: 'neutral' })}
    </div>
    ${d.otp && !verified ? `<div class="slds-col slds-size_1-of-2">${field('mobileCode', 'Code sent by SMS', { attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code"' })}</div>
      <div class="slds-col slds-size_1-of-2 slds-p-top_large">${button('Verify', 'verifyMobile', { variant: 'brand' })}</div>` : ''}
    <div class="slds-col slds-size_1-of-2">${field('password', 'Password', { value: a.password, type: 'password', required: true, help: '10+ characters, one capital letter, one number' })}</div>
    <div class="slds-col slds-size_1-of-2">${field('confirm', 'Confirm password', { value: a.confirm, type: 'password', required: true })}</div>
  </div>`;
}

function stepFirm(d) {
  const f = d.firm;
  return `<div class="slds-grid slds-wrap slds-gutters_x-small">
    <div class="slds-col slds-size_1-of-2">${field('firmName', 'Firm name', { value: f.firmName, required: true })}</div>
    <div class="slds-col slds-size_1-of-2">${select('emirate', 'Emirate', ['', ...EMIRATES], { value: f.emirate, required: true })}</div>
    <div class="slds-col slds-size_1-of-1">${field('address', 'Office address', { value: f.address, required: true })}</div>
    <div class="slds-col slds-size_1-of-3">${field('tradeLicence', 'Trade licence number', { value: f.tradeLicence, required: true, attrs: 'placeholder="DED-1234567"' })}</div>
    <div class="slds-col slds-size_1-of-3">${field('orn', 'ORN (RERA office number)', { value: f.orn, required: true, attrs: 'placeholder="12345" maxlength="5"' })}</div>
    <div class="slds-col slds-size_1-of-3">${field('agents', 'Number of agents', { value: f.agents, type: 'number', required: true, attrs: 'min="1" max="1000"' })}</div>
  </div>
  <div class="bp-demo"><b>Demo:</b> any values in the right format work, e.g. licence <code>DED-1500321</code>, ORN <code>32541</code>. Licence <code>DED-1048572</code> belongs to an existing firm and fails the duplicate check.</div>`;
}

function docBlock(doc, d) {
  if (!d || !d.file) {
    return `<div class="bp-doc"><div class="bp-doc-head">${uIcon('file', 'slds-icon_small slds-icon-text-default')}<b>${esc(doc.label)}</b>
      <label class="slds-button slds-button_neutral">${uIcon('upload', 'slds-icon_xx-small slds-icon-text-default')}&nbsp;Upload<input type="file" accept=".pdf,.jpg,.jpeg,.png" data-act="pickDoc" data-doc="${doc.key}" style="display:none"></label></div>
      <p class="bp-small bp-muted slds-m-top_x-small">PDF, JPG or PNG, up to 10 MB.</p></div>`;
  }
  if (d.reading) {
    return `<div class="bp-doc"><div class="bp-doc-head">${uIcon('file', 'slds-icon_small slds-icon-text-default')}<b>${esc(doc.label)}</b><span class="bp-small bp-muted">${esc(d.file)}</span></div>${spinner('Document Reader is reading the file…')}</div>`;
  }
  const inputs = doc.fields.map((f) => {
    const val = d.fields[f];
    const isDate = DATE_FIELDS.includes(f);
    return `<div class="slds-col slds-size_1-of-2">${field(`doc.${doc.key}.${f}`, FIELD_LABELS[f], { value: isDate ? toDateInput(val) : val, type: isDate ? 'date' : 'text', attrs: d.confirmed ? 'readonly' : '' })}</div>`;
  }).join('');
  return `<div class="bp-doc"><div class="bp-doc-head">${uIcon('file', 'slds-icon_small slds-icon-text-default')}<b>${esc(doc.label)}</b>
      <span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} Read by AI</span>
      <label class="slds-button slds-button_neutral">Replace<input type="file" accept=".pdf,.jpg,.jpeg,.png" data-act="pickDoc" data-doc="${doc.key}" style="display:none"></label></div>
    <div class="bp-doc-body"><div class="bp-doc-thumb">${esc(d.file)}</div>
      <div><div class="slds-grid slds-wrap slds-gutters_x-small">${inputs}</div>
      ${checkbox(`confirm-${doc.key}`, 'I confirm these details match the document', { checked: d.confirmed, attrs: `data-act="confirmDoc" data-doc="${doc.key}"` })}</div></div></div>`;
}

function stepDocuments(d) {
  return `<p class="bp-muted slds-m-bottom_small">Upload each document. The Document Reader fills in the details; check them and confirm, or correct anything it got wrong first.</p>
    ${FIRM_DOCUMENTS.map((doc) => docBlock(doc, d.documents[doc.key])).join('')}
    <div class="bp-demo"><b>Demo:</b> any file works. A file name containing <code>expired</code> reads an expired date; <code>mismatch</code> reads a different licence number or ORN.</div>`;
}

function stepPlan(d) {
  const p = d.plan;
  return `<div class="bp-plans">${Object.entries(PLANS).map(([id, plan]) => `<div class="bp-plan ${p.plan === id ? 'is-selected' : ''}" data-act="pickPlan" data-id="${id}" role="radio" aria-checked="${p.plan === id}" tabindex="0"><b>${esc(plan.label)}</b><span>${esc(plan.detail)}</span></div>`).join('')}</div>
    <div style="max-width:200px">${field('seats', 'Number of users (seats)', { value: p.seats, type: 'number', required: true, attrs: 'min="1" max="500"' })}</div>
    ${checkbox('terms', 'I accept the Broker Portal terms of service', { checked: p.terms })}
    ${checkbox('dpa', 'I accept the data processing agreement under UAE PDPL', { checked: p.dpa })}
    <p class="bp-small bp-muted slds-m-top_small">Billing details are collected after approval. Nothing is charged in this demo.</p>`;
}

export function bpInviteSignup(token) {
  const res = checkInvite(token);
  if (!res.invite) {
    return bpAuthLayout(`${alertBox('warning', esc(res.reason))}
      <div class="slds-m-top_large"><a class="slds-button slds-button_neutral" href="join/#/">Back</a>
      <a class="slds-button slds-button_brand" href="join/#/request">Request to join instead</a>
      ${res.used ? '<a class="slds-button slds-button_outline-brand" href="portal/">Sign in</a>' : ''}</div>`, { headline: 'Invitation problem' });
  }
  const invite = res.invite;
  const d = loadDraft(invite);
  const body = [stepAccount, stepFirm, stepDocuments, stepPlan][d.step](d, invite);
  const last = d.step === STEPS.length - 1;
  return bpAuthLayout(`
    <div class="bp-small bp-muted">Invitation for ${esc(invite.firmName)} · expires ${fmtDate(invite.expiresAt)}</div>
    <div class="slds-text-heading_large slds-m-vertical_x-small">Set up your firm</div>
    ${stepper(STEPS, d.step)}
    ${formErrors(d.errors)}
    <form id="wizard" data-submit="${last ? 'submitSignup' : 'nextStep'}" novalidate>${body}
      <div class="slds-m-top_large slds-grid slds-grid_align-spread">
        ${d.step ? button('Back', 'prevStep') : '<span></span>'}
        <button type="submit" class="slds-button slds-button_brand">${last ? 'Submit for verification' : 'Continue'}</button>
      </div>
    </form>`, { headline: `Welcome, ${invite.ownerName.split(' ')[0]}`, sub: 'Four short steps. Your firm goes live once ThinkVibes has verified your documents.' });
}

function withDraft(fn) {
  const token = location.hash.split('/')[2];
  const { invite, reason } = checkInvite(token);
  if (!invite) {
    toast('error', 'Invitation problem', esc(reason));
    return;
  }
  const d = capture(loadDraft(invite));
  fn(d, invite);
  saveDraft(invite.token, d);
  go(`invite/${invite.token}`);
}

export const signupActions = {
  nextStep() {
    withDraft((d) => {
      const problems = validateDraft(d).filter((p) => p.step === d.step).map((p) => p.message);
      d.errors = problems;
      if (!problems.length) d.step += 1;
    });
  },
  prevStep() {
    withDraft((d) => {
      d.errors = [];
      d.step = Math.max(0, d.step - 1);
    });
  },
  sendMobileCode() {
    withDraft((d) => {
      if (!isPhone(d.account.mobile)) {
        d.errors = ['Enter a valid mobile number first.'];
        return;
      }
      d.errors = [];
      d.otp = { code: String(Math.floor(100000 + Math.random() * 900000)), mobile: normPhone(d.account.mobile) };
      toast('info', 'Code sent by SMS (demo)', `Your code is <b>${d.otp.code}</b>`);
    });
  },
  verifyMobile() {
    const entered = String((document.getElementById('mobileCode') || {}).value || '').trim();
    withDraft((d) => {
      if (!d.otp) d.errors = ['Send a code first.'];
      else if (normPhone(d.account.mobile) !== d.otp.mobile) d.errors = ['The mobile number changed. Send a new code.'];
      else if (entered !== d.otp.code) d.errors = ['That code is not correct.'];
      else {
        d.errors = [];
        d.account.mobileVerified = d.otp.mobile;
        d.otp = null;
      }
    });
  },
  pickDoc(input) {
    const file = input.files && input.files[0];
    const docKey = input.dataset.doc;
    if (!file) return;
    if (!OK_TYPES.test(file.name)) {
      toast('error', 'File type not supported', 'Upload a PDF, JPG or PNG.');
      return;
    }
    if (file.size > MAX_FILE) {
      toast('error', 'File too large', 'The limit is 10 MB.');
      return;
    }
    withDraft((d) => {
      d.errors = [];
      d.documents[docKey] = { file: file.name, uploadedAt: Date.now(), reading: true, fields: null, confirmed: false };
    });
    // Simulated Document Reader call; the real build calls the AI agent here.
    setTimeout(() => withDraft((d) => {
      const doc = d.documents[docKey];
      if (!doc || doc.file !== file.name) return;
      doc.fields = readDocument(docKey, file.name, { firmName: d.firm.firmName, tradeLicence: d.firm.tradeLicence, orn: d.firm.orn, ownerName: d.account.ownerName });
      doc.reading = false;
    }), 1200);
  },
  confirmDoc(input) {
    const docKey = input.dataset.doc;
    const checked = input.checked;
    withDraft((d) => {
      const doc = d.documents[docKey];
      if (doc) doc.confirmed = checked;
    });
  },
  pickPlan(el) {
    withDraft((d) => {
      d.plan.plan = el.dataset.id;
      if (el.dataset.id === 'Trial' && Number(d.plan.seats) > 5) d.plan.seats = 5;
    });
  },
  submitSignup() {
    const token = location.hash.split('/')[2];
    const { invite, reason } = checkInvite(token);
    if (!invite) {
      toast('error', 'Invitation problem', esc(reason));
      return;
    }
    const d = capture(loadDraft(invite));
    const problems = validateDraft(d);
    if (problems.length) {
      d.step = problems[0].step;
      d.errors = problems.filter((p) => p.step === d.step).map((p) => p.message);
      saveDraft(invite.token, d);
      go(`invite/${invite.token}`);
      return;
    }
    const failed = runChecks(d).filter((c) => !c.ok);
    if (failed.length) {
      d.step = 2;
      d.errors = ['Automatic checks failed:', ...failed.map((c) => c.fail)];
      saveDraft(invite.token, d);
      go(`invite/${invite.token}`);
      return;
    }
    const firm = submitRegistration(invite.token, d);
    tabSession.set(keyFor(invite.token), null);
    tabSession.set('join:myFirm', firm.id);
    openModal('Your documents need verification', `${spinner('Sending your documents to the verification service…')}
      <p class="bp-small bp-muted">This checks your trade licence, ORN certificate and Emirates ID.</p>`, '<span></span>');
    verifyDocuments(firm.id).then((v) => {
      document.getElementById('modal-body').innerHTML = `${alertBox('success', `Verification response: <b>${esc(v.result)}</b>`)}
        <p class="slds-m-top_small">Your registration is now with the ThinkVibes team for a final review, usually within 1 business day. We'll email you when your workspace is ready.</p>
        <p class="bp-small bp-muted slds-m-top_x-small">Demo note: the verification API is a stub that always answers "verified". ThinkVibes still checks the documents manually.</p>`;
      document.querySelector('#modal-root .slds-modal__footer').innerHTML = '<button type="button" class="slds-button slds-button_brand" data-act="toStatus">View registration status</button>';
    });
  },
  toStatus() {
    closeModal();
    go(`status/${tabSession.get('join:myFirm')}`);
  },
};
