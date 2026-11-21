// Editable rows for inviting people (used by the setup wizard and the People page).
// Each row is checked live with the same rules the service enforces on submit.
// LWC equivalent: c-bp-invite-rows with an @api firm and a rowschange event.

import { esc } from '../core/util.js';
import { bIconOnly, formErrors } from '../core/ui.js';
import { tabSession } from '../core/store.js';
import { checkUserInvite, firmOf } from '../services/firmService.js';

const ROLE_OPTIONS = ['Agent', 'Team Leader', 'Director', 'Marketing', 'Compliance'];
const KEY = 'invite:rows';

export const emptyRow = () => ({ name: '', email: '', role: 'Agent', teamId: '', brn: '', brnExpiry: '' });

export function getRows() {
  return tabSession.get(KEY, null) || [emptyRow()];
}

export function setRows(rows) {
  tabSession.set(KEY, rows);
}

/** Reads the visible rows from the DOM back into the draft before any re-render. */
export function captureRows() {
  const rows = [];
  document.querySelectorAll('[data-invite-row]').forEach((rowEl) => {
    const get = (n) => (rowEl.querySelector(`[data-f="${n}"]`) || {}).value || '';
    rows.push({ name: get('name'), email: get('email'), role: get('role'), teamId: get('teamId'), brn: get('brn'), brnExpiry: get('brnExpiry') });
  });
  if (rows.length) setRows(rows);
  return rows.length ? rows : getRows();
}

/** Parses pasted spreadsheet text: name, email, role, team, BRN, BRN expiry (yyyy-mm-dd). */
export function parsePasted(text, firm) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const c = line.split(/\t|,/).map((x) => x.trim());
    const team = firm.teams.find((t) => t.name.toLowerCase() === (c[3] || '').toLowerCase());
    return { name: c[0] || '', email: c[1] || '', role: ROLE_OPTIONS.includes(c[2]) ? c[2] : 'Agent', teamId: team ? team.id : '', brn: c[4] || '', brnExpiry: c[5] || '' };
  }).filter((r) => r.name.toLowerCase() !== 'name');
}

export function bpInviteRows(actor, errors = []) {
  const firm = firmOf(actor);
  const rows = getRows();
  const emails = [];
  const rowHtml = rows.map((r, i) => {
    const { problems, warnings } = r.name || r.email ? checkUserInvite(actor, r, emails.slice()) : { problems: [], warnings: [] };
    emails.push(r.email);
    const licensed = ['Agent', 'Team Leader'].includes(r.role);
    return `<div class="bp-row-grid" data-invite-row="${i}">
      <div><label class="slds-form-element__label">Name</label><input class="slds-input" data-f="name" value="${esc(r.name)}"></div>
      <div><label class="slds-form-element__label">Email</label><input class="slds-input" type="email" data-f="email" value="${esc(r.email)}"></div>
      <div><label class="slds-form-element__label">Role</label><div class="slds-select_container"><select class="slds-select" data-f="role" data-act="rowsChanged">${ROLE_OPTIONS.map((o) => `<option ${o === r.role ? 'selected' : ''}>${o}</option>`).join('')}</select></div></div>
      <div><label class="slds-form-element__label">Team</label><div class="slds-select_container"><select class="slds-select" data-f="teamId"><option value="">—</option>${firm.teams.map((t) => `<option value="${t.id}" ${t.id === r.teamId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div></div>
      <div><label class="slds-form-element__label">BRN</label><input class="slds-input" data-f="brn" value="${esc(r.brn)}" ${licensed ? '' : 'disabled placeholder="n/a"'}></div>
      <div><label class="slds-form-element__label">BRN expiry</label><input class="slds-input" type="date" data-f="brnExpiry" value="${esc(r.brnExpiry)}" ${licensed ? '' : 'disabled'}></div>
      <div><button type="button" class="slds-button slds-button_icon slds-button_icon-border" title="Remove row" data-act="removeRow" data-idx="${i}">${bIconOnly('delete')}</button></div>
      ${problems.map((p) => `<div class="bp-row-err">${esc(p)}</div>`).join('')}
      ${warnings.map((w) => `<div class="bp-row-warn">${esc(w)}</div>`).join('')}
    </div>`;
  }).join('');
  return `${formErrors(errors)}<div class="bp-inline-rows">${rowHtml}</div>
    <div class="slds-m-top_small slds-grid slds-wrap" style="gap:8px">
      <button type="button" class="slds-button slds-button_neutral" data-act="addRow">Add person</button>
      <button type="button" class="slds-button slds-button_neutral" data-act="checkRows">Check rows</button>
      <button type="button" class="slds-button slds-button_neutral" data-act="pasteRows">Paste from a spreadsheet</button>
    </div>
    <p class="bp-small bp-muted slds-m-top_x-small">Agents and team leaders need a BRN. Anyone with an expired BRN can sign in but receives no leads until it's renewed.</p>`;
}
