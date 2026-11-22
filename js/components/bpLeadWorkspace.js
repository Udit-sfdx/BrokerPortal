// P4 Lead workspace: profile, needs and qualification, AI summary / suggested reply / next best action,
// timeline with notes, calls (call guard), WhatsApp and email (composer), tasks, qualify, convert, lost.
// LWC equivalent: c-bp-lead-workspace composed of c-bp-lead-header, c-bp-ai-assist, c-bp-lead-needs,
// c-bp-lead-timeline, c-bp-lead-tasks, with c-bp-call-guard, c-bp-message-composer and c-bp-convert-modal.
// Acceptance: a lead is qualified and converted without leaving the page.

import { card, uIcon, badge, avatar, emptyState, openModal, field, select, textarea, readForm, toast, toggle } from '../core/ui.js';
import { esc, fmtAED, fmtDateTime, fmtAgo, fmtTime, toDateInput, parseDateInput, HOUR, MIN, DAY } from '../core/util.js';
import { now, getState } from '../core/store.js';
import { QUALIFICATION_FIELDS, BEDROOMS, AREAS, PURPOSES, TIMELINES, FINANCING, LOST_REASONS, DEAL_TYPES } from '../core/config.js';
import { slaState, missingQualification } from '../core/rules.js';
import {
  getLead, canWorkLead, callCheck, isOpenLead, qualifyLead, updateLead, markLost, addNote, scheduleTask, completeTask,
  assignableUsers, assignLeads, leadOwnerName, TASK_TYPES, simulateReply,
} from '../services/leadService.js';
import { leadSummary, suggestReply, nextBestAction, qualifierProposal } from '../services/aiService.js';
import { firmOf } from '../services/firmService.js';
import { go } from '../core/app.js';
import { slaTimer, scoreChip, leadFlags, leadStatusBadge, timeline } from './bpLeadBits.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';
import { openComposer } from './bpMessageComposer.js';
import { matchList } from './bpInventoryBrowser.js';

const MANAGERS = ['Owner', 'Director', 'Team Leader'];
const aiTag = (label) => `<span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} ${esc(label)}</span>`;

const NEED_FIELDS = [
  ['lob', 'Deal type', DEAL_TYPES], ['beds', 'Bedrooms', BEDROOMS], ['area', 'Preferred area', AREAS], ['purpose', 'Purpose', PURPOSES],
  ['timeline', 'Timeline', TIMELINES], ['financing', 'Financing', FINANCING],
];

function header(user, lead, t, canWork) {
  const open = isOpenLead(lead);
  const call = callCheck(user, lead);
  const btn = (label, act, icon, { variant = 'neutral', disabled = false, title = '' } = {}) =>
    `<button type="button" class="slds-button slds-button_${variant}" data-act="${act}" data-id="${esc(lead.id)}" ${disabled ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${uIcon(icon, 'slds-icon_x-small')}&nbsp;${esc(label)}</button>`;
  const actions = canWork && open ? `
    ${btn('Call', 'callLead', 'call', { variant: call.ok ? 'brand' : 'neutral', title: call.ok ? '' : call.problems[0] })}
    ${btn('Message', 'composeMessage', 'chat')}
    ${btn('Schedule', 'scheduleLeadTask', 'event')}
    ${['New', 'Contacted'].includes(lead.status) ? btn('Mark qualified', 'qualifyLead', 'check') : ''}
    ${['Qualified', 'Viewing'].includes(lead.status) ? btn('Convert to deal', 'convertLead', 'opportunity', { variant: 'brand' }) : ''}
    ${btn('Lost', 'loseLead', 'close')}` : lead.dealId ? `<a class="slds-button slds-button_brand" href="portal/#/deal/${esc(lead.dealId)}">Open deal ${esc(lead.dealId)}</a>` : '';
  return `<div class="bp-record-head">
    <a class="bp-back" href="portal/#/leads">${uIcon('back', 'slds-icon_xx-small')} Leads</a>
    <div class="bp-record-title">
      ${avatar(lead.name, firmOf(user).brand, 44)}
      <div style="min-width:0"><h1>${esc(lead.name)} ${leadStatusBadge(lead.status)} ${scoreChip(lead)}</h1>
        <div class="bp-small bp-muted">${esc(lead.interest)} · ${esc(lead.source)} · owner ${esc(leadOwnerName(lead))} · ${esc(lead.id)}</div>
        <div>${leadFlags(lead)} ${slaTimer(lead, t)}</div></div>
      <div class="bp-record-actions">${actions}</div>
    </div></div>`;
}

function aiCard(user, lead, t, canWork) {
  const firm = firmOf(user);
  const nba = nextBestAction(lead, t, { canCall: callCheck(user, lead).ok });
  const reply = suggestReply(lead, user, firm);
  const nbaBtn = nba.act && canWork ? `<button type="button" class="slds-button slds-button_brand" data-act="${nba.act}" data-id="${esc(lead.id)}">${esc(nba.label)}</button>` : '';
  return card(`${uIcon('sparkles', 'slds-icon_x-small')} Assist`, `
    <div class="bp-ai-block"><div class="bp-ai-head">${aiTag('Conversation summary')}</div><p>${esc(leadSummary(lead, t))}</p></div>
    <div class="bp-ai-block"><div class="bp-ai-head">${aiTag('Next best action')}</div>
      <div class="bp-nba"><div><b>${esc(nba.label)}</b><div class="bp-small bp-muted">${esc(nba.why)}</div></div>${nbaBtn}</div></div>
    ${isOpenLead(lead) ? `<div class="bp-ai-block"><div class="bp-ai-head">${aiTag('Suggested reply')} <span class="bp-small bp-muted">${esc(reply.why)}</span></div>
      <blockquote class="bp-quote" dir="${reply.lang === 'Arabic' ? 'rtl' : 'ltr'}" lang="${reply.lang === 'Arabic' ? 'ar' : 'en'}">${esc(reply.text)}</blockquote>
      ${canWork ? `<button type="button" class="slds-button slds-button_neutral" data-act="useSuggestedReply" data-id="${esc(lead.id)}">Use this reply</button>` : ''}</div>` : ''}
    <div class="bp-small bp-muted">AI suggestions only use this lead's own records. Rate: <button type="button" class="bp-rate" data-act="rateAi" data-v="up" aria-label="Helpful">👍</button><button type="button" class="bp-rate" data-act="rateAi" data-v="down" aria-label="Not helpful">👎</button></div>`,
  { cls: 'bp-ai-card' });
}

function needsCard(lead, canWork) {
  const missing = missingQualification(lead);
  const editable = canWork && isOpenLead(lead);
  const inputs = `<div class="slds-grid slds-gutters_small slds-wrap">
    ${field('nd-budget', lead.lob === 'Rental' ? 'Budget, annual rent (AED)' : 'Budget (AED)', { type: 'number', value: lead.budgetMax || '', name: 'budgetMax', attrs: `min="0" step="10000" ${editable ? '' : 'disabled'}` }).replace('slds-m-bottom_small', 'slds-m-bottom_small slds-col slds-size_1-of-2')}
    ${NEED_FIELDS.map(([k, label, opts]) => select(`nd-${k}`, label, [['', '—'], ...opts], { value: lead[k] || '', name: k, attrs: editable ? '' : 'disabled' }).replace('slds-m-bottom_small', 'slds-m-bottom_small slds-col slds-size_1-of-2')).join('')}
  </div>`;
  return card('Needs and qualification', `
    ${missing.length && isOpenLead(lead) ? `<div class="bp-missing">${uIcon('warning', 'slds-icon_xx-small')} To qualify, fill: ${esc(missing.join(', '))}</div>` : isOpenLead(lead) ? `<div class="bp-ready">${uIcon('check', 'slds-icon_xx-small')} Ready to qualify</div>` : ''}
    <form id="needs-form" data-submit="saveNeeds"><input type="hidden" name="leadId" value="${esc(lead.id)}">${inputs}
    ${editable ? `<div class="bp-form-actions"><button type="submit" class="slds-button slds-button_neutral">Save</button>
      ${missing.length ? `<button type="button" class="slds-button slds-button_neutral" data-act="runQualifier" data-id="${esc(lead.id)}">${uIcon('sparkles', 'slds-icon_x-small')}&nbsp;Ask Lead Qualifier</button>` : ''}</div>` : ''}</form>`,
  { icon: 'quick_text' });
}

function profileCard(lead, canWork) {
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  return card('Contact', `<dl class="bp-kv bp-kv-narrow">
    ${row('Mobile', lead.phone ? `${esc(lead.phone)}${lead.dnc ? ' <span class="bp-flag dnc">DNC</span>' : ''}` : '—')}
    ${row('Email', esc(lead.email || '—'))}
    ${row('Language', esc(lead.lang || '—'))}
    ${row('Nationality', esc(lead.nationality || '—'))}
    ${row('Source', esc(lead.source))}
    ${row('Arrived', `${fmtDateTime(lead.createdAt)}`)}
  </dl>
  <div class="slds-m-top_small">${toggle('WhatsApp consent recorded', !!lead.consent?.whatsapp, 'toggleConsent', { attrs: `data-id="${esc(lead.id)}"`, disabled: !(canWork && isOpenLead(lead)) })}</div>
  <p class="bp-small bp-muted">Only switch on when the client agreed to WhatsApp (on a call or in writing).</p>`, { icon: 'person_account' });
}

function slaCard(user, lead, t) {
  const firm = firmOf(user);
  const sla = slaState(lead, t);
  const text = { running: 'Waiting for the first reply.', breached: 'First reply is late.', met: 'First reply within the SLA.', missed: 'First reply was late.', none: 'No SLA on this lead.' }[sla.state];
  return card('Routing and SLA', `<p class="bp-small">${slaTimer(lead, t)} ${esc(text)} SLA: ${firm.settings.sla.firstResponseMin} min.</p>
    <ol class="bp-trace">${(lead.routingTrace || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${MANAGERS.includes(user.role) && isOpenLead(lead) ? `<button type="button" class="slds-button slds-button_neutral slds-m-top_x-small" data-act="reassignLead" data-id="${esc(lead.id)}">${uIcon('change_owner', 'slds-icon_x-small')}&nbsp;Re-assign</button>` : ''}`,
  { icon: 'assignment' });
}

function tasksCard(user, lead, t, canWork) {
  const tasks = getState().tasks.filter((k) => k.leadId === lead.id).sort((a, b) => a.done - b.done || a.dueAt - b.dueAt);
  return card('Follow-ups and viewings', tasks.length ? `<ul class="bp-agenda">${tasks.map((k) => `<li class="${k.done ? 'done' : k.dueAt < t ? 'late' : ''}">
      <span class="bp-agenda-time">${k.done ? '✓' : k.dueAt < t ? '<b class="bp-late">late</b>' : fmtTime(k.dueAt)}</span>
      <span class="bp-agenda-title"><b>${esc(k.title)}</b><span class="bp-small bp-muted">${esc(TASK_TYPES[k.type])} · ${fmtDateTime(k.dueAt)}${k.cancelled ? ' · cancelled' : ''}</span></span>
      ${canWork && !k.cancelled ? `<button type="button" class="slds-button slds-button_icon slds-button_icon-border" title="${k.done ? 'Re-open' : 'Mark done'}" aria-label="${k.done ? 'Re-open' : 'Mark done'}: ${esc(k.title)}" data-act="toggleTask" data-id="${esc(k.id)}" data-done="${k.done ? '0' : '1'}">${uIcon(k.done ? 'undo' : 'check', 'slds-icon_xx-small')}</button>` : ''}
    </li>`).join('')}</ul>` : '<div class="bp-empty">Nothing scheduled.</div>', { icon: 'event' });
}

function timelineCard(lead, t, canWork) {
  return card('Timeline', `${canWork ? `<form class="bp-note-form" data-submit="addLeadNote"><input type="hidden" name="leadId" value="${esc(lead.id)}">
      ${textarea('noteText', 'Add a note', { name: 'text', attrs: 'rows="2" placeholder="What happened? Only your firm can see notes."' })}
      <div class="bp-form-actions"><button type="submit" class="slds-button slds-button_neutral">Add note</button>
      <button type="button" class="slds-button slds-button_neutral" data-act="simulateClientReply" data-id="${esc(lead.id)}" title="Demo: the client answers on WhatsApp">${uIcon('reply', 'slds-icon_x-small')}&nbsp;Simulate client reply</button></div></form>` : ''}
    ${timeline(lead.activities || [], t)}`, { icon: 'feed' });
}

export function bpLeadWorkspace(user, id) {
  const lead = getLead(user, id);
  if (!lead) {
    return card('Lead not found', emptyState('This lead does not exist or is not visible to you', 'Leads are visible to their owner, their team leader and firm managers only.', '<a class="slds-button slds-button_neutral" href="portal/#/leads">Back to leads</a>'));
  }
  const t = now();
  const canWork = canWorkLead(user, lead);
  return `${header(user, lead, t, canWork)}
    <div class="bp-grid bp-cols-2">
      <div class="bp-grid">${aiCard(user, lead, t, canWork)}${timelineCard(lead, t, canWork)}</div>
      <div class="bp-grid">${needsCard(lead, canWork)}${isOpenLead(lead) ? card('Matching units', matchList(user, lead, { compact: true }), { icon: 'home', actions: '<a class="bp-link bp-small" href="portal/#/inventory">Inventory →</a>' }) : ''}${tasksCard(user, lead, t, canWork)}${slaCard(user, lead, t)}${profileCard(lead, canWork)}</div>
    </div>`;
}

/* ---------- modals ---------- */

function openSchedule(lead, type = 'followup') {
  const t = now();
  const when = t + (type === 'viewing' ? DAY : 2 * HOUR);
  const html = `<input type="hidden" name="leadId" value="${esc(lead.id)}">
    <div class="slds-grid slds-gutters_small slds-wrap">
      <div class="slds-col slds-size_1-of-1">${select('tkType', 'Type', Object.entries(TASK_TYPES), { value: type, name: 'type' })}</div>
      <div class="slds-col slds-size_1-of-2">${field('tkDate', 'Date', { type: 'date', value: toDateInput(when), required: true, name: 'date' })}</div>
      <div class="slds-col slds-size_1-of-2">${field('tkTime', 'Time (GST)', { type: 'time', value: fmtTime(when), required: true, name: 'time' })}</div>
      <div class="slds-col slds-size_1-of-1">${field('tkTitle', 'Title (optional)', { name: 'title', attrs: 'maxlength="120"' })}</div>
    </div><p class="bp-small bp-muted">A viewing moves the lead to Viewing. The task shows on the owner's My Day.</p>`;
  openModal(`Schedule for ${esc(lead.name)}`, modalForm('task-form', 'submitLeadTask', html), modalFooter('task-form', 'Schedule'));
}

function openLost(lead) {
  const html = `<input type="hidden" name="leadId" value="${esc(lead.id)}">
    ${select('lostReason', 'Reason', [['', 'Choose…'], ...LOST_REASONS], { required: true, name: 'reason' })}
    ${textarea('lostNote', 'Note (optional)', { name: 'note', attrs: 'rows="2"' })}
    <p class="bp-small bp-muted">Open follow-ups on this lead are cancelled.</p>`;
  openModal(`Mark ${esc(lead.name)} as lost`, modalForm('lost-form', 'submitLost', html), modalFooter('lost-form', 'Mark lost', { variant: 'destructive' }));
}

function openQualifier(lead) {
  const p = qualifierProposal(lead);
  const labels = Object.fromEntries([...NEED_FIELDS.map(([k, l]) => [k, l]), ['budgetMax', 'Budget (AED)']]);
  const rows = Object.entries(p.fields);
  if (!rows.length) { toast('info', 'Nothing to propose', 'The Lead Qualifier found no missing fields it could fill.'); return; }
  const html = `<input type="hidden" name="leadId" value="${esc(lead.id)}">
    <p class="slds-m-bottom_small">${aiTag('Lead Qualifier')} proposes these values from the ${esc(p.sources.join(', '))}. Change anything that's wrong, then confirm.</p>
    <table class="slds-table slds-table_bordered bp-proposal"><thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead><tbody>
    ${rows.map(([k, v]) => {
      const opts = NEED_FIELDS.find(([key]) => key === k)?.[2];
      const input = opts ? `<select class="slds-select" name="${k}" aria-label="${esc(labels[k])}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input class="slds-input" type="number" name="${k}" value="${esc(v)}" aria-label="${esc(labels[k])}">`;
      return `<tr><td>${esc(labels[k])}</td><td class="bp-muted">${esc(lead[k] || '—')}</td><td>${input}</td></tr>`;
    }).join('')}</tbody></table>`;
  openModal('Confirm qualification values', modalForm('q-form', 'confirmQualifier', html), modalFooter('q-form', 'Confirm values'));
}

function openReassign(user, lead) {
  const people = assignableUsers(user);
  const html = `<input type="hidden" name="leadId" value="${esc(lead.id)}">
    ${select('raTo', 'New owner', [['', 'Choose…'], ...people.map((u) => [u.id, u.name])], { required: true, name: 'to' })}
    <p class="bp-small bp-muted">Only active agents with a valid BRN${user.role === 'Team Leader' ? ' in your team' : ''} are listed.</p>`;
  openModal(`Re-assign ${esc(lead.name)}`, modalForm('ra-form', 'submitReassign', html), modalFooter('ra-form', 'Re-assign'));
}

export const workspaceActions = (getActor) => {
  const lead = (el) => getLead(getActor(), el.dataset.id || readForm(el).leadId);
  return {
    qualifyLead(el) { qualifyLead(getActor(), el.dataset.id); toast('success', 'Lead qualified', 'Next: book a viewing or convert.'); },
    saveNeeds(form) {
      const f = readForm(form);
      const { leadId, ...fields } = f;
      const changed = updateLead(getActor(), leadId, fields);
      toast('success', changed.length ? 'Saved' : 'No changes', changed.length ? `Updated ${changed.length} field${changed.length === 1 ? '' : 's'}.` : '');
    },
    runQualifier(el) { const l = lead(el); if (l) openQualifier(l); },
    confirmQualifier(form) {
      const { leadId, ...fields } = readForm(form);
      submitModal(() => updateLead(getActor(), leadId, fields, { source: 'ai' }), { title: 'Values confirmed', message: 'The Lead Qualifier\'s values were saved and logged.' });
    },
    useSuggestedReply(el) {
      const actor = getActor();
      const l = lead(el);
      if (!l) return;
      const s = suggestReply(l, actor, firmOf(actor));
      openComposer(actor, l, { templateId: s.templateId, lang: s.lang, text: s.text, why: s.why });
    },
    scheduleLeadTask(el) { const l = lead(el); if (l) openSchedule(l); },
    scheduleViewing(el) { const l = lead(el); if (l) openSchedule(l, 'viewing'); },
    submitLeadTask(form) {
      const f = readForm(form);
      const dueAt = parseDateInput(f.date) !== null && /^\d{2}:\d{2}$/.test(f.time || '') ? parseDateInput(f.date) + Number(f.time.slice(0, 2)) * HOUR + Number(f.time.slice(3)) * MIN : NaN;
      submitModal(() => scheduleTask(getActor(), { leadId: f.leadId, type: f.type, title: f.title, dueAt }), { title: 'Scheduled', message: (k) => `${esc(k.title)} · ${fmtDateTime(k.dueAt)}` });
    },
    toggleTask(el) {
      completeTask(getActor(), el.dataset.id, el.dataset.done === '1');
      toast('success', el.dataset.done === '1' ? 'Done' : 'Re-opened');
    },
    loseLead(el) { const l = lead(el); if (l) openLost(l); },
    submitLost(form) {
      const f = readForm(form);
      submitModal(() => markLost(getActor(), f.leadId, f.reason, f.note), { title: 'Marked lost' });
    },
    addLeadNote(form) {
      const f = readForm(form);
      addNote(getActor(), f.leadId, f.text);
      toast('success', 'Note added');
    },
    toggleConsent(el) {
      updateLead(getActor(), el.dataset.id, { consentWhatsapp: el.checked });
      toast('success', el.checked ? 'WhatsApp consent recorded' : 'WhatsApp consent removed');
    },
    reassignLead(el) { const l = lead(el); if (l) openReassign(getActor(), l); },
    submitReassign(form) {
      const f = readForm(form);
      submitModal(() => assignLeads(getActor(), [f.leadId], f.to), { title: 'Lead re-assigned' });
    },
    simulateClientReply(el) { simulateReply(getActor(), el.dataset.id); toast('info', 'Client replied', 'The summary, score and suggested reply update.'); },
    rateAi(el) { toast('success', 'Thanks for the feedback', el.dataset.v === 'up' ? 'Marked helpful.' : 'Marked not helpful. It is logged for review.'); },
    openDeal(el) { const l = lead(el); if (l && l.dealId) go(`deal/${l.dealId}`); },
  };
};
