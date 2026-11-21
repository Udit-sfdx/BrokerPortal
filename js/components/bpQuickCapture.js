// Quick capture: a walk-in, referral or phone enquiry in a few taps. Stays with the agent who captured it.
// LWC equivalent: c-bp-quick-capture (lightning-modal), calling BP_LeadService.captureLead.

import { openModal, field, select, checkbox, textarea, readForm } from '../core/ui.js';
import { LEAD_SOURCES, LANGUAGES, BEDROOMS, AREAS } from '../core/config.js';
import { captureLead } from '../services/leadService.js';
import { go } from '../core/app.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';
import { esc } from '../core/util.js';

export function openQuickCapture() {
  const body = `<div class="slds-grid slds-gutters_small slds-wrap">
    <div class="slds-col slds-size_1-of-2">${field('qcName', 'Client name', { required: true, name: 'name', attrs: 'autocomplete="off"' })}</div>
    <div class="slds-col slds-size_1-of-2">${select('qcSource', 'Source', ['Walk-in', 'Referral', ...Object.keys(LEAD_SOURCES).filter((s) => !['Walk-in', 'Referral'].includes(s))], { required: true, name: 'source' })}</div>
    <div class="slds-col slds-size_1-of-2">${field('qcPhone', 'Mobile', { name: 'phone', attrs: 'inputmode="tel" placeholder="050 123 4567"' })}</div>
    <div class="slds-col slds-size_1-of-2">${field('qcEmail', 'Email', { type: 'email', name: 'email' })}</div>
    <div class="slds-col slds-size_1-of-3">${select('qcLob', 'Deal type', ['Off-plan', 'Secondary', 'Rental'], { required: true, name: 'lob' })}</div>
    <div class="slds-col slds-size_1-of-3">${select('qcBeds', 'Bedrooms', [['', '—'], ...BEDROOMS], { name: 'beds' })}</div>
    <div class="slds-col slds-size_1-of-3">${field('qcBudget', 'Budget (AED)', { type: 'number', name: 'budgetMax', attrs: 'min="0" step="10000"' })}</div>
    <div class="slds-col slds-size_1-of-2">${select('qcArea', 'Area', [['', '—'], ...AREAS], { name: 'area' })}</div>
    <div class="slds-col slds-size_1-of-2">${select('qcLang', 'Language', LANGUAGES, { name: 'lang' })}</div>
    <div class="slds-col slds-size_1-of-1">${textarea('qcNotes', 'Notes', { name: 'notes', attrs: 'rows="2"' })}</div>
    <div class="slds-col slds-size_1-of-1">${checkbox('qcConsent', 'Client agreed to be contacted on WhatsApp', { name: 'consentWhatsapp' })}</div>
  </div><p class="bp-small bp-muted">The number is checked against your firm's records and the do-not-call registry. A lead you capture stays with you.</p>`;
  openModal('Quick capture', modalForm('qc-form', 'submitQuickCapture', body), modalFooter('qc-form', 'Save lead'));
}

export const quickCaptureActions = (getActor) => ({
  quickCapture() { openQuickCapture(); },
  submitQuickCapture(form) {
    const lead = submitModal(() => captureLead(getActor(), readForm(form)), {
      title: 'Lead saved',
      message: (l) => `${esc(l.name)} · ${l.duplicateOf ? `possible duplicate of ${esc(l.duplicateOf)}` : `owner: you`}${l.dnc ? ' · on the DNC registry' : ''}`,
    });
    if (lead) go(`lead/${lead.id}`);
  },
});
