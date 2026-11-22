// WhatsApp and email composer: approved templates in English or Arabic, a Follow-up Writer draft,
// and the consent check. Nothing is sent automatically: the agent reviews and presses Send.
// LWC equivalent: c-bp-message-composer; the real build sends through the WhatsApp Business connector.

import { openModal, select, uIcon, alertBox, readForm } from '../core/ui.js';
import { esc } from '../core/util.js';
import { MESSAGE_TEMPLATES } from '../core/config.js';
import { getLead, messageProblems, sendMessage, templateText } from '../services/leadService.js';
import { suggestReply, firmTemplates } from '../services/aiService.js';
import { firmOf } from '../services/firmService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';

/** Opens the composer. opts.useAi pre-fills the Follow-up Writer's draft. */
export function openComposer(actor, lead, { channel, templateId, lang, text, why, extra } = {}) {
  const ch = channel || (lead.consent?.whatsapp && lead.phone ? 'WhatsApp' : 'Email');
  const tid = templateId || 'intro';
  const lg = lang || (lead.lang === 'Arabic' ? 'Arabic' : 'English');
  const body = text ?? templateText(tid, lg, lead, actor, extra);
  const problems = messageProblems(lead, ch);
  const html = `<input type="hidden" name="leadId" value="${esc(lead.id)}">
    <div class="slds-grid slds-gutters_small slds-wrap">
      <div class="slds-col slds-size_1-of-3">${select('msgChannel', 'Channel', ['WhatsApp', 'Email'], { value: ch, name: 'channel', attrs: 'data-act="composerChange"' })}</div>
      <div class="slds-col slds-size_1-of-3">${select('msgTemplate', 'Template', firmTemplates(firmOf(actor)).map((t) => [t.id, t.name]), { value: tid, name: 'templateId', attrs: 'data-act="composerChange"' })}</div>
      <div class="slds-col slds-size_1-of-3">${select('msgLang', 'Language', ['English', 'Arabic'], { value: lg, name: 'lang', attrs: 'data-act="composerChange"' })}</div>
    </div>
    ${problems.length ? `<div class="slds-m-bottom_small">${alertBox('warning', problems.map(esc).join('<br>'))}</div>` : ''}
    <div class="slds-form-element"><label class="slds-form-element__label" for="msgText">Message to ${esc(ch === 'WhatsApp' ? lead.phone : lead.email || 'no email')}</label>
      <div class="slds-form-element__control"><textarea class="slds-textarea bp-msg" id="msgText" name="text" rows="5" dir="${lg === 'Arabic' ? 'rtl' : 'ltr'}" lang="${lg === 'Arabic' ? 'ar' : 'en'}">${esc(body)}</textarea></div></div>
    <div class="bp-composer-ai"><button type="button" class="slds-button slds-button_neutral" data-act="composerDraft">${uIcon('sparkles', 'slds-icon_x-small')}&nbsp;Draft with Follow-up Writer</button>
      ${why ? `<span class="bp-small"><span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} AI draft</span> ${esc(why)} Review before sending.</span>` : '<span class="bp-small bp-muted">Templates are approved by your firm. The AI drafts; you send.</span>'}</div>`;
  openModal(`Message ${esc(lead.name)}`, modalForm('msg-form', 'submitMessage', html), modalFooter('msg-form', `Send ${ch}`, { variant: problems.length ? 'neutral' : 'brand' }));
}

export const composerActions = (getActor) => ({
  composeMessage(el) {
    const actor = getActor();
    const lead = getLead(actor, el.dataset.id);
    if (lead) openComposer(actor, lead);
  },
  /** Channel, template or language changed: rebuild the composer with the new template text. */
  composerChange() {
    const form = document.getElementById('msg-form');
    const f = readForm(form);
    const actor = getActor();
    const lead = getLead(actor, f.leadId);
    if (lead) openComposer(actor, lead, { channel: f.channel, templateId: f.templateId, lang: f.lang });
  },
  composerDraft() {
    const form = document.getElementById('msg-form');
    const f = readForm(form);
    const actor = getActor();
    const lead = getLead(actor, f.leadId);
    if (!lead) return;
    const s = suggestReply(lead, actor, firmOf(actor));
    openComposer(actor, lead, { channel: f.channel, templateId: s.templateId, lang: s.lang, text: s.text, why: s.why });
  },
  submitMessage(form) {
    const f = readForm(form);
    submitModal(() => sendMessage(getActor(), f.leadId, { channel: f.channel, templateId: f.templateId, lang: f.lang, text: f.text }), { title: `${f.channel} sent`, message: 'Logged on the lead timeline.' });
  },
});
