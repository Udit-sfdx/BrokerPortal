// Convert a qualified lead into a deal: deal type, unit, value, optional co-broking with another firm.
// LWC equivalent: c-bp-convert-modal (creates the Individual Account/Contact and the deal in Salesforce).

import { openModal, field, select, checkbox, readForm, uIcon } from '../core/ui.js';
import { esc } from '../core/util.js';
import { DEAL_TYPES, COMMISSION_RULES } from '../core/config.js';
import { getLead, convertLead } from '../services/leadService.js';
import { go } from '../core/app.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';

export function openConvert(actor, lead) {
  const type = DEAL_TYPES.includes(lead.lob) ? lead.lob : 'Secondary';
  const html = `<input type="hidden" name="leadId" value="${esc(lead.id)}">
    <p class="slds-m-bottom_small">Creates the client record and a deal for <b>${esc(lead.name)}</b>. Documents, KYC and payments are handled in the deal room.</p>
    <div class="slds-grid slds-gutters_small slds-wrap">
      <div class="slds-col slds-size_1-of-2">${select('cvType', 'Deal type', DEAL_TYPES, { value: type, required: true, name: 'type' })}</div>
      <div class="slds-col slds-size_1-of-2">${field('cvValue', type === 'Rental' ? 'Annual rent (AED)' : 'Deal value (AED)', { type: 'number', value: lead.budgetMax || '', required: true, name: 'value', attrs: 'min="1" step="1000"' })}</div>
      <div class="slds-col slds-size_1-of-1">${field('cvUnit', 'Unit', { value: lead.project ? `${lead.project} · ` : '', required: true, name: 'unitRef', attrs: 'placeholder="e.g. Tower A · 1204"' })}</div>
    </div>
    <p class="bp-small bp-muted slds-m-bottom_small">Commission default: ${Object.entries(COMMISSION_RULES).map(([t, r]) => `${t} ${r.rate}% from the ${r.payer.toLowerCase()}`).join(' · ')}.</p>
    ${checkbox('cvCo', 'Co-broking with another firm', { name: 'coBroke', attrs: 'data-act="toggleCoBroke"' })}
    <div id="cv-co" class="bp-subform" hidden>
      <div class="slds-grid slds-gutters_small slds-wrap">
        <div class="slds-col slds-size_1-of-2">${field('cvCoFirm', 'Other firm', { name: 'coFirm' })}</div>
        <div class="slds-col slds-size_1-of-2">${field('cvCoOrn', 'Their ORN', { name: 'coOrn', attrs: 'inputmode="numeric" maxlength="6"' })}</div>
        <div class="slds-col slds-size_1-of-2">${field('cvCoAgent', 'Their agent', { name: 'coAgent' })}</div>
        <div class="slds-col slds-size_1-of-2">${field('cvCoSplit', 'Their share of commission (%)', { type: 'number', value: '50', name: 'coSplit', attrs: 'min="1" max="90"' })}</div>
      </div>
    </div>`;
  openModal(`${uIcon('opportunity', 'slds-icon_x-small')} Convert to deal`, modalForm('cv-form', 'submitConvert', html), modalFooter('cv-form', 'Create deal'));
}

export const convertActions = (getActor) => ({
  convertLead(el) {
    const actor = getActor();
    const lead = getLead(actor, el.dataset.id);
    if (lead) openConvert(actor, lead);
  },
  toggleCoBroke(el) {
    const box = document.getElementById('cv-co');
    if (box) box.hidden = !el.checked;
  },
  submitConvert(form) {
    const f = readForm(form);
    const deal = submitModal(() => convertLead(getActor(), f.leadId, f), { title: 'Deal created', message: (d) => `${esc(d.id)} is in ${esc(d.stage)}. Next: documents and KYC.` });
    if (deal) go(`deal/${deal.id}`);
  },
});
