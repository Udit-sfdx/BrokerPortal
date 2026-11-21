// People (P12, owner only): invite, resend, deactivate. Deactivation removes access at once;
// records stay with the firm and open leads are re-routed or handed to a colleague.
// LWC equivalent: c-bp-people-admin (datatable + modals), backed by BP_UserService.

import { pageHeader, card, statusBadge, badge, avatar, openModal, closeModal, select, showModalErrors, toast, button, tabs } from '../core/ui.js';
import { esc, fmtDate, DAY } from '../core/util.js';
import { getState, now, tabSession } from '../core/store.js';
import { visibleUsers, firmOf, seatsUsed, inviteUsers, deactivateUser, resendUserInvite } from '../services/firmService.js';
import { bpInviteRows, getRows, setRows, captureRows, emptyRow, parsePasted } from './bpInviteRows.js';

function brnCell(u) {
  if (!u.brn) return '<span class="bp-muted">—</span>';
  const t = now();
  const tag = u.brnExpiry <= t ? badge('Expired', 'error') : u.brnExpiry - t < 30 * DAY ? badge('Expires soon', 'warning') : '';
  return `${esc(u.brn)} <span class="bp-muted bp-small">to ${fmtDate(u.brnExpiry)}</span> ${tag}`;
}

export function bpPeopleAdmin(actor) {
  const firm = firmOf(actor);
  const filter = tabSession.get('people:filter', 'current');
  const all = visibleUsers(actor);
  const people = all.filter((u) => (filter === 'current' ? u.status !== 'Deactivated' : u.status === 'Deactivated'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const teamName = (id) => firm.teams.find((t) => t.id === id)?.name || '—';
  const used = seatsUsed(firm.id);
  const rows = people.map((u) => `<tr>
    <td><div class="slds-grid slds-grid_vertical-align-center" style="gap:8px">${avatar(u.name, firm.brand, 28)}<div><b>${esc(u.name)}</b><div class="bp-small bp-muted">${esc(u.email)}</div></div></div></td>
    <td>${esc(u.role)}</td><td>${esc(teamName(u.teamId))}</td><td>${brnCell(u)}</td>
    <td>${statusBadge(u.status)}${u.status === 'Deactivated' ? `<div class="bp-small bp-muted">${fmtDate(u.deactivatedAt)}</div>` : ''}</td>
    <td class="bp-small bp-muted">${esc(u.username)}</td>
    <td class="slds-text-align_right">${u.status === 'Invited' ? button('Resend', 'resendUserInvite', { attrs: `data-id="${u.id}"` }) : ''}
      ${u.status !== 'Deactivated' && u.role !== 'Owner' ? button(u.status === 'Invited' ? 'Withdraw' : 'Deactivate', 'askDeactivate', { variant: 'destructive-text', attrs: `data-id="${u.id}"` }) : ''}</td>
  </tr>`).join('');
  return pageHeader('people', 'Firm admin', 'People', {
    actions: button('Invite people', 'openInvite', { variant: 'brand', icon: 'add' }),
    meta: `${used} of ${firm.seats} seats used · ${all.filter((u) => u.status === 'Active').length} active · ${all.filter((u) => u.status === 'Invited').length} invited`,
  }) + card('', `${tabs([['current', 'Current'], ['former', 'Former members']], filter, 'peopleFilter')}
    <div class="bp-table-wrap slds-m-top_small"><table class="slds-table slds-table_cell-buffer slds-table_bordered">
    <thead><tr><th>Person</th><th>Role</th><th>Team</th><th>BRN</th><th>Status</th><th>Login username</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7"><div class="bp-empty">Nobody here.</div></td></tr>'}</tbody></table></div>
    <p class="bp-small bp-muted slds-m-top_small">People sign in with their email. The login username is unique per firm, so someone who moves to another brokerage gets a new login there; their old one stays deactivated.</p>`);
}

function openInviteModal(actor, errors = []) {
  openModal('Invite people', `<div id="modal-errors"></div>${bpInviteRows(actor, errors)}`,
    `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_brand" data-act="sendInvites">Send invitations</button>`, 'large');
}

export function peopleActions(getActor) {
  return {
    peopleFilter(el) {
      tabSession.set('people:filter', el.dataset.id);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    openInvite() {
      setRows([emptyRow()]);
      openInviteModal(getActor());
    },
    resendUserInvite(el) {
      resendUserInvite(getActor(), el.dataset.id);
      toast('success', 'Invitation resent');
    },
    askDeactivate(el) {
      const actor = getActor();
      const user = getState().users.find((u) => u.id === el.dataset.id);
      const colleagues = visibleUsers(actor).filter((u) => u.status === 'Active' && u.id !== user.id && ['Agent', 'Team Leader'].includes(u.role));
      const openLeads = getState().leads.filter((l) => l.ownerId === user.id && !['Converted', 'Lost'].includes(l.status)).length;
      openModal(`${user.status === 'Invited' ? 'Withdraw invitation' : 'Deactivate'}: ${esc(user.name)}`, `<div id="modal-errors"></div>
        <p>${user.status === 'Invited' ? 'The invitation link stops working.' : `${esc(user.name)} loses access immediately and can't see anything of ${esc(firmOf(actor).name)} again. Their leads, deals and history stay with the firm.`}</p>
        ${user.status === 'Active' ? `<p class="slds-m-vertical_small">${openLeads} open lead${openLeads === 1 ? '' : 's'} to hand over.</p>
        ${select('handTo', 'Open leads go to', [['routing', 'Lead routing (automatic)'], ...colleagues.map((c) => [c.id, c.name])], { value: 'routing' })}` : ''}
        <p class="bp-small bp-muted">If they join another firm on Broker Portal, that firm invites them with a new login.</p>`,
      `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_destructive" data-act="confirmDeactivate" data-id="${user.id}">${user.status === 'Invited' ? 'Withdraw' : 'Deactivate'}</button>`);
    },
    confirmDeactivate(el) {
      const handTo = (document.getElementById('handTo') || {}).value || 'routing';
      try {
        const { user, moved } = deactivateUser(getActor(), el.dataset.id, { handTo });
        closeModal();
        toast('success', `${esc(user.name)} deactivated`, moved ? `${moved} open lead(s) ${handTo === 'routing' ? 're-routed' : 'handed over'}.` : '');
      } catch (err) {
        if (!err.messages) throw err;
        showModalErrors(err.messages);
      }
    },
    addRow() {
      const rows = captureRows();
      rows.push(emptyRow());
      setRows(rows);
      rerenderRows(getActor());
    },
    removeRow(el) {
      const rows = captureRows();
      rows.splice(Number(el.dataset.idx), 1);
      setRows(rows.length ? rows : [emptyRow()]);
      rerenderRows(getActor());
    },
    rowsChanged() {
      captureRows();
      rerenderRows(getActor());
    },
    checkRows() {
      captureRows();
      rerenderRows(getActor());
    },
    pasteRows() {
      captureRows();
      const holder = document.getElementById('paste-box');
      if (holder) return;
      const box = document.createElement('div');
      box.id = 'paste-box';
      box.className = 'slds-m-top_small';
      box.innerHTML = `<label class="slds-form-element__label" for="paste-text">One person per line: name, email, role, team, BRN, BRN expiry (yyyy-mm-dd)</label>
        <textarea class="slds-textarea" id="paste-text" rows="4" placeholder="Nadia Rahim, nadia@firm.example, Agent, Off-plan team, 51234, 2027-06-30"></textarea>
        <button type="button" class="slds-button slds-button_neutral slds-m-top_x-small" data-act="applyPaste">Add these people</button>`;
      document.querySelector('.bp-inline-rows').after(box);
    },
    applyPaste() {
      const actor = getActor();
      const parsed = parsePasted(document.getElementById('paste-text').value, firmOf(actor));
      if (!parsed.length) {
        toast('warning', 'Nothing to add', 'Paste at least one line.');
        return;
      }
      const rows = captureRows().filter((r) => r.name || r.email);
      setRows([...rows, ...parsed]);
      rerenderRows(actor);
    },
    sendInvites() {
      const actor = getActor();
      const rows = captureRows().filter((r) => r.name || r.email);
      try {
        const created = inviteUsers(actor, rows);
        setRows([emptyRow()]);
        if (document.querySelector('#modal-root .slds-modal')) closeModal();
        toast('success', `${created.length} invitation${created.length === 1 ? '' : 's'} sent`);
        return created;
      } catch (err) {
        if (!err.messages) throw err;
        rerenderRows(actor, err.messages);
        return null;
      }
    },
  };
}

/** Re-draws only the rows area (modal or wizard) so typed values in other fields stay put. */
export function rerenderRows(actor, errors = []) {
  const host = document.getElementById('invite-rows-host') || document.getElementById('modal-body');
  if (!host) return;
  host.innerHTML = `${host.id === 'modal-body' ? '<div id="modal-errors"></div>' : ''}${bpInviteRows(actor, errors)}`;
}

export { getRows };
