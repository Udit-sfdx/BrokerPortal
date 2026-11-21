// Registration status tracker shown to the applicant after submitting (P0).
// LWC equivalent: c-bp-registration-status (guest page, reads only the applicant's own firm).

import { uIcon, statusBadge, alertBox } from '../core/ui.js';
import { esc, fmtDateTime } from '../core/util.js';
import { bpAuthLayout } from './bpAuthLayout.js';
import { getFirm, reviewDueAt } from '../services/registrationService.js';
import { tabSession } from '../core/store.js';

function stepRow(state, title, sub) {
  const dot = state === 'done' ? uIcon('check', 'slds-icon_xx-small') : '';
  return `<li class="${state}"><span class="dot">${dot}</span><div><b>${esc(title)}</b><span>${sub}</span></div></li>`;
}

export function bpRegistrationStatus(firmId) {
  // Applicants only see the registration they submitted from this browser tab.
  if (!firmId || tabSession.get('join:myFirm') !== firmId) {
    return bpAuthLayout(`${alertBox('info', 'Sign in to check your registration.')}
      <p class="slds-m-top_small">For privacy, registration status is only shown in the browser you registered from, or after you sign in.</p>
      <a class="slds-button slds-button_neutral slds-m-top_medium" href="join/#/">Back</a>`, { headline: 'Registration status' });
  }
  const firm = getFirm(firmId);
  if (!firm) return bpAuthLayout(alertBox('warning', 'Registration not found.'), { headline: 'Registration status' });

  const v = firm.verification || {};
  const reviewed = ['Trial', 'Active', 'Suspended', 'Offboarded'].includes(firm.status);
  const needsInfo = firm.status === 'Needs information';
  const rejected = firm.status === 'Rejected';
  const lastNote = firm.reviewNotes[firm.reviewNotes.length - 1];

  const rows = [
    stepRow('done', 'Invitation accepted', 'Your sales invitation was valid.'),
    stepRow('done', 'Documents submitted', fmtDateTime(firm.createdAt)),
    stepRow('done', 'Automatic checks passed', firm.checks.map((c) => esc(c.label)).join(' · ')),
    stepRow(v.result === 'verified' ? 'done' : 'now', 'Document verification', v.result === 'verified' ? `Verified ${fmtDateTime(v.respondedAt)}` : 'In progress…'),
    stepRow(reviewed ? 'done' : rejected ? 'todo' : 'now', 'ThinkVibes review',
      reviewed ? `Approved ${fmtDateTime(firm.approvedAt)}`
        : needsInfo ? `More information needed: ${esc(lastNote ? lastNote.note : '')}`
          : rejected ? 'Not approved. We have emailed you the reason.'
            : `Expected by ${fmtDateTime(reviewDueAt(firm))}`),
    stepRow(reviewed ? 'done' : 'todo', 'Workspace ready', reviewed ? 'Sign in to set up your firm and invite your team.' : 'Created automatically once approved.'),
  ].join('');

  return bpAuthLayout(`
    <div class="slds-grid slds-grid_vertical-align-center slds-m-bottom_small"><div class="slds-text-heading_large slds-m-right_small">${esc(firm.name)}</div>${statusBadge(firm.status)}</div>
    <p class="bp-muted slds-m-bottom_large">Registration status. This page updates by itself.</p>
    <ol class="bp-tracker">${rows}</ol>
    ${reviewed ? '<a class="slds-button slds-button_brand slds-m-top_medium" href="portal/">Sign in to your portal</a>' : ''}
    <div class="bp-demo"><b>Demo:</b> open the <a class="bp-link" href="console/" target="bp-console">operator console</a> in another tab and approve this firm; this page updates on its own.</div>
  `, { headline: 'Almost there' });
}
