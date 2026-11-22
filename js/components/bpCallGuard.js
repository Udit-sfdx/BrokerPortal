// Click-to-call with the telemarketing rules: blocked for do-not-call numbers and outside the firm's
// calling hours (09:00–18:00 GST by default), with the reason and a messaging alternative.
// LWC equivalent: c-bp-call-guard; the real build hands the number to the firm's telephony (CTI) adapter.

import { openModal, select, field, textarea, alertBox, uIcon, readForm } from '../core/ui.js';
import { esc } from '../core/util.js';
import { callCheck, logCall, CALL_OUTCOMES, getLead, setDemoCallHours, recordBlockedCall } from '../services/leadService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';

export function openCallGuard(actor, lead) {
  const check = callCheck(actor, lead);
  if (!check.ok) {
    if (lead.dnc) recordBlockedCall(actor, lead, check.problems);
    openModal('Call blocked', `${alertBox('warning', `${uIcon('ban', 'slds-icon_x-small')} You can't call ${esc(lead.name)} right now.`)}
      <ul class="slds-list_dotted slds-m-top_small bp-blocked-list">${check.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <p class="bp-small bp-muted slds-m-top_small">These rules follow the UAE telemarketing regulation. They are enforced for every user and logged.</p>
      ${check.outsideHours && !lead.dnc ? `<div class="bp-demo-switch"><b>Demo only:</b> presenting outside office hours? <a class="bp-link" data-act="demoAllowCalls" data-id="${esc(lead.id)}">Allow calls outside hours for this demo</a>. The do-not-call rule still applies.</div>` : ''}`,
    `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Close</button>
     <button type="button" class="slds-button slds-button_brand" data-act="composeMessage" data-id="${esc(lead.id)}">Send a message instead</button>`);
    return;
  }
  const body = `<div class="bp-calling">${uIcon('call', 'slds-icon_small')}<div><b>${esc(lead.name)}</b><div class="bp-small"><a class="bp-link" href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a> · dialling from your work line</div></div></div>
    <div class="slds-grid slds-gutters_small">
      <div class="slds-col slds-size_1-of-2">${select('callOutcome', 'Outcome', [['', 'Choose…'], ...CALL_OUTCOMES], { required: true, name: 'outcome' })}</div>
      <div class="slds-col slds-size_1-of-2">${field('callMinutes', 'Minutes (if answered)', { type: 'number', name: 'minutes', attrs: 'min="1" max="180"' })}</div>
    </div>
    ${textarea('callNote', 'What did you learn?', { name: 'note', attrs: 'rows="3" placeholder="Budget, timing, objections…"' })}
    <p class="bp-small bp-muted">Logging the call counts as the first response for the SLA. "Wrong number" closes the lead.</p>`;
  openModal(`Call ${esc(lead.name)}`, modalForm('call-form', 'submitCall', `<input type="hidden" name="leadId" value="${esc(lead.id)}">${body}`), modalFooter('call-form', 'Log call'));
}

export const callGuardActions = (getActor) => ({
  demoAllowCalls(el) {
    setDemoCallHours(true);
    const actor = getActor();
    const lead = getLead(actor, el.dataset.id);
    if (lead) openCallGuard(actor, lead);
  },
  callLead(el) {
    const actor = getActor();
    const lead = getLead(actor, el.dataset.id);
    if (lead) openCallGuard(actor, lead);
  },
  submitCall(form) {
    const f = readForm(form);
    submitModal(() => logCall(getActor(), f.leadId, { outcome: f.outcome, minutes: f.minutes, note: f.note }), { title: 'Call logged' });
  },
});
