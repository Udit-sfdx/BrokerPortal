// Small reusable lead pieces: SLA timer, score chip with reasons, lead status and warning badges.
// LWC equivalents: c-bp-sla-timer (with a 1 s ticker), c-bp-score-chip, c-bp-lead-badges.

import { esc, fmtDuration, fmtAgo, fmtDateTime } from '../core/util.js';
import { badge, uIcon } from '../core/ui.js';
import { slaState, scoreBand } from '../core/rules.js';

/**
 * Live SLA countdown. Renders the current value; startSlaTicker() keeps every timer on the page moving.
 * data-due = SLA deadline; data-created for "responded in" display once met.
 */
export function slaTimer(lead, t, { compact = false } = {}) {
  const sla = slaState(lead, t);
  if (sla.state === 'none') return '';
  if (sla.state === 'met' || sla.state === 'missed') {
    return `<span class="bp-sla ${sla.state}" title="First response time">${uIcon(sla.state === 'met' ? 'check' : 'clock', 'slds-icon_xx-small')}${compact ? '' : 'Replied in '}${fmtDuration(sla.took)}</span>`;
  }
  return `<span class="bp-sla ${sla.state}" data-due="${lead.slaDueAt}" title="First-response SLA">${uIcon('clock', 'slds-icon_xx-small')}<span class="bp-sla-text">${slaText(lead.slaDueAt - t)}</span></span>`;
}

const slaText = (left) => (left >= 0 ? `${fmtDuration(left)} left` : `${fmtDuration(-left)} late`);

/** Updates every visible SLA timer once a second without re-rendering the page. */
export function startSlaTicker(getNow) {
  return setInterval(() => {
    const t = getNow();
    document.querySelectorAll('.bp-sla[data-due]').forEach((el) => {
      const left = Number(el.dataset.due) - t;
      const text = el.querySelector('.bp-sla-text');
      if (text) text.textContent = slaText(left);
      el.classList.toggle('running', left >= 0);
      el.classList.toggle('breached', left < 0);
      el.classList.toggle('urgent', left >= 0 && left < 5 * 60e3);
    });
  }, 1000);
}

/** Score chip; hovering or focusing shows the Lead Qualifier's reasons. */
export function scoreChip(lead) {
  const band = scoreBand(lead.score);
  const reasons = (lead.scoreReasons || []).slice(0, 6).map((r) => `<li><b class="${r.pts > 0 ? 'pos' : 'neg'}">${r.pts > 0 ? '+' : ''}${r.pts}</b> ${esc(r.text)}</li>`).join('');
  return `<span class="bp-score ${band}" tabindex="0" aria-label="Lead score ${lead.score}, ${band}">${lead.score}
    <span class="bp-score-pop" role="tooltip"><span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} Lead Qualifier</span><b class="bp-score-head">${lead.score} / 100 · ${band}</b><ul>${reasons}</ul></span></span>`;
}

const LEAD_STATUS_THEME = { New: 'info', Contacted: '', Qualified: 'success', Viewing: 'warning', Converted: 'inverse', Lost: 'light' };
export const leadStatusBadge = (status) => badge(status, LEAD_STATUS_THEME[status] || '');

/** DNC, duplicate, no-consent and escalation flags. */
export function leadFlags(lead) {
  const out = [];
  if (lead.dnc) out.push('<span class="bp-flag dnc" title="On the do-not-call registry: message only">DNC</span>');
  if (lead.duplicateOf) out.push(`<span class="bp-flag dup" title="Same phone as ${esc(lead.duplicateOf)} in your firm">Duplicate</span>`);
  if (!lead.consent?.whatsapp) out.push('<span class="bp-flag nc" title="No WhatsApp consent recorded">No WA consent</span>');
  return out.join('');
}

/** Follow-up due label: "Overdue 3h", "Today 15:00", or the date. */
export function followUpLabel(lead, t) {
  if (!lead.nextFollowUpAt) return '<span class="bp-muted">—</span>';
  if (lead.nextFollowUpAt < t) return `<span class="bp-due late">Overdue ${fmtDuration(t - lead.nextFollowUpAt)}</span>`;
  return `<span class="bp-due">${fmtDateTime(lead.nextFollowUpAt)}</span>`;
}

export const ago = (at, t) => `<span class="bp-muted bp-small">${fmtAgo(at, t)}</span>`;

const ACT_ICONS = { created: 'new', assign: 'change_owner', call: 'call', whatsapp: 'chat', email: 'email', inbound: 'reply', note: 'note', status: 'check', task: 'event', convert: 'opportunity' };

/** Timeline of a lead's activities, newest first. */
export function timeline(activities, t) {
  if (!activities.length) return '<div class="bp-empty">No activity yet.</div>';
  return `<ul class="bp-timeline">${activities.map((a) => `<li class="t-${esc(a.type)}"><span class="bp-tl-icon">${uIcon(ACT_ICONS[a.type] || 'record', 'slds-icon_xx-small')}</span>
    <div><div class="bp-tl-text">${esc(a.text)}</div><div class="bp-small bp-muted">${esc(a.by)} · ${fmtAgo(a.at, t)}</div></div></li>`).join('')}</ul>`;
}
