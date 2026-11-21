// ThinkVibes operator console pages (P15). Operators manage firms, never firm records:
// only counts of leads and deals appear, and no lead, deal or client is listed anywhere here.
// LWC equivalent: an internal Lightning app with c-bp-request-queue, c-bp-invite-manager,
// c-bp-verification-review and c-bp-firm-directory.

import { pageHeader, card, statusBadge, badge, button, openModal, closeModal, field, select, textarea, showModalErrors, toast, readForm, uIcon, alertBox, tabs } from '../core/ui.js';
import { esc, fmtDate, fmtDateTime, fmtAgo, DAY } from '../core/util.js';
import { getState, now, tabSession } from '../core/store.js';
import { EMIRATES, PLANS, FIELD_LABELS, FIRM_DOCUMENTS } from '../core/config.js';
import {
  inviteState, createInvite, resendInvite, revokeInvite, acceptRequest, declineRequest, approveFirm, requestInformation,
  rejectFirm, suspendFirm, reactivateFirm, changePlan, offboardFirm, firmUsage,
} from '../services/operatorService.js';
import { reviewDueAt } from '../services/registrationService.js';
import { go } from '../core/app.js';

export const CONSOLE_NAV = [
  { group: 'Pipeline' },
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'requests', label: 'Join requests', icon: 'inbox' },
  { id: 'invites', label: 'Invites', icon: 'email' },
  { id: 'verification', label: 'Verification queue', icon: 'shield' },
  { group: 'Firms' },
  { id: 'firms', label: 'All firms', icon: 'company' },
  { group: 'Records' },
  { id: 'emails', label: 'Email log', icon: 'send' },
  { id: 'audit', label: 'Audit log', icon: 'list' },
];

const absolute = (rel) => new URL(rel, document.baseURI).href;
const fieldValue = (k, v) => (['licenceExpiry', 'ornExpiry', 'eidExpiry'].includes(k) ? fmtDate(v) : esc(v));

function tile(label, value, sub, link, cls = '') {
  return `<a class="bp-tile ${cls}" href="console/#/${link}" style="text-decoration:none;color:inherit"><div class="bp-tile-label">${esc(label)}</div><div class="bp-tile-value">${value}</div><div class="bp-tile-sub">${sub}</div></a>`;
}

export function navCounts() {
  const s = getState();
  return {
    requests: s.joinRequests.filter((r) => r.status === 'Requested').length,
    verification: s.firms.filter((f) => ['Pending verification', 'Needs information'].includes(f.status)).length,
  };
}

/* ---------- overview ---------- */

export function bpConsoleOverview(op) {
  const s = getState();
  const t = now();
  const c = navCounts();
  const pendingInvites = s.invites.filter((i) => inviteState(i, t) === 'Pending').length;
  const live = s.firms.filter((f) => ['Active', 'Trial'].includes(f.status));
  const trialsEnding = s.firms.filter((f) => f.status === 'Trial' && f.trialEndsAt - t < 5 * DAY);
  const licences = s.firms.filter((f) => ['Active', 'Trial'].includes(f.status) && (f.licenceExpiry - t < 60 * DAY || f.ornExpiry - t < 60 * DAY));
  const attention = [
    ...s.firms.filter((f) => f.status === 'Pending verification').map((f) => ({ t: f.createdAt, html: `<b>${esc(f.name)}</b> is waiting for review (due ${fmtDateTime(reviewDueAt(f))})`, link: `firm/${f.id}` })),
    ...s.joinRequests.filter((r) => r.status === 'Requested').map((r) => ({ t: r.at, html: `<b>${esc(r.firmName)}</b> asked to join (${r.agents} agents, ${esc(r.emirate)})`, link: 'requests' })),
    ...trialsEnding.map((f) => ({ t: f.trialEndsAt, html: `<b>${esc(f.name)}</b> trial ends ${fmtDate(f.trialEndsAt)}`, link: `firm/${f.id}` })),
    ...licences.map((f) => ({ t: Math.min(f.licenceExpiry, f.ornExpiry), html: `<b>${esc(f.name)}</b> licence or ORN expires ${fmtDate(Math.min(f.licenceExpiry, f.ornExpiry))}`, link: `firm/${f.id}` })),
  ];
  return pageHeader('home', 'ThinkVibes console', `Good to see you, ${esc(op.name.split(' ')[0])}`, { meta: 'Broker Portal firms, requests and invitations' })
    + `<div class="bp-tiles">
      ${tile('Join requests to review', c.requests, 'reply within 2 business days', 'requests', c.requests ? 'warn' : 'good')}
      ${tile('Firms awaiting verification', c.verification, 'review within 1 business day', 'verification', c.verification ? 'warn' : 'good')}
      ${tile('Pending invites', pendingInvites, 'sent, not yet used', 'invites')}
      ${tile('Live firms', live.length, `${live.filter((f) => f.status === 'Trial').length} on trial`, 'firms', 'good')}
    </div>`
    + `<div class="bp-grid bp-cols-2">${card('Needs attention', attention.length ? `<ul class="bp-list">${attention.map((a) => `<li><span style="flex:1">${a.html}</span><a class="bp-link bp-small" href="console/#/${a.link}">Open</a></li>`).join('')}</ul>` : '<div class="bp-empty">All clear.</div>', { icon: 'task' })}
      ${card('Privacy', `<div class="bp-privacy">${uIcon('lock', 'slds-icon_x-small')}<span>This console shows firms, plans, people and usage counts. It never shows a firm's leads, deals or clients. Support access to a firm's data needs that firm's own approval.</span></div>`, { icon: 'disclosure_and_compliance' })}</div>`;
}

/* ---------- join requests ---------- */

export function bpRequestQueue() {
  const filter = tabSession.get('console:reqFilter', 'Requested');
  const list = getState().joinRequests.filter((r) => filter === 'all' || r.status === filter);
  return pageHeader('lead', 'Pipeline', 'Join requests', { meta: 'Firms without an invite ask to join here. Accepting sends them an invite.' })
    + card('', `${tabs([['Requested', 'To review'], ['Invited', 'Invited'], ['Declined', 'Declined'], ['all', 'All']], filter, 'reqFilter')}
      <div class="bp-table-wrap slds-m-top_small"><table class="slds-table slds-table_cell-buffer slds-table_bordered"><thead><tr><th>Firm</th><th>Contact</th><th>Agents</th><th>Message</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr><td><b>${esc(r.firmName)}</b><div class="bp-small bp-muted">${esc(r.emirate)}</div></td>
        <td>${esc(r.contactName)}<div class="bp-small bp-muted">${esc(r.email)} · ${esc(r.phone)}</div></td><td>${r.agents}</td>
        <td class="bp-small" style="max-width:280px">${esc(r.message) || '<span class="bp-muted">—</span>'}${r.reason ? `<div class="bp-muted">Reason: ${esc(r.reason)}</div>` : ''}</td>
        <td class="bp-small">${fmtAgo(r.at, now())}</td><td>${statusBadge(r.status)}</td>
        <td class="slds-text-align_right">${r.status === 'Requested' ? `${button('Accept', 'askAccept', { variant: 'brand', attrs: `data-id="${r.id}"` })} ${button('Decline', 'askDecline', { attrs: `data-id="${r.id}"` })}` : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="bp-empty">No requests here.</div></td></tr>'}
      </tbody></table></div>`);
}

/* ---------- invites ---------- */

export function bpInviteManager() {
  const t = now();
  const list = getState().invites;
  return pageHeader('email', 'Pipeline', 'Invites', { actions: button('New invite', 'askInvite', { variant: 'brand', icon: 'add' }), meta: 'Only invited firms can sign up. Each invite is single-use and expires after 7 days.' })
    + card('', `<div class="bp-table-wrap"><table class="slds-table slds-table_cell-buffer slds-table_bordered"><thead><tr><th>Firm</th><th>Owner</th><th>Code</th><th>Status</th><th>Expires</th><th>Sent by</th><th></th></tr></thead><tbody>
      ${list.map((i) => {
        const st = inviteState(i, t);
        return `<tr><td><b>${esc(i.firmName)}</b><div class="bp-small bp-muted">${esc(i.emirate)}</div></td><td>${esc(i.ownerName)}<div class="bp-small bp-muted">${esc(i.ownerEmail)}</div></td>
          <td><code>${esc(i.token)}</code></td><td>${statusBadge(st)}</td><td class="bp-small">${st === 'Used' ? `used ${fmtDate(i.usedAt)}` : fmtDate(i.expiresAt)}</td><td class="bp-small">${esc(i.createdBy)}</td>
          <td class="slds-text-align_right">${st === 'Pending' ? `<a class="slds-button slds-button_neutral" href="${esc(absolute(`join/#/invite/${i.token}`))}" target="_blank" rel="noopener">Open link</a> ${button('Copy link', 'copyInvite', { attrs: `data-token="${i.token}"` })}` : ''}
            ${['Pending', 'Expired'].includes(st) ? `${button('Resend', 'resendInvite', { attrs: `data-token="${i.token}"` })} ${button('Withdraw', 'revokeInvite', { variant: 'destructive-text', attrs: `data-token="${i.token}"` })}` : ''}
            ${st === 'Used' && i.firmId ? `<a class="bp-link bp-small" href="console/#/firm/${i.firmId}">View firm</a>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`);
}

/* ---------- verification queue and firm detail ---------- */

export function bpVerificationQueue() {
  const list = getState().firms.filter((f) => ['Pending verification', 'Needs information'].includes(f.status));
  return pageHeader('approval', 'Pipeline', 'Verification queue', { meta: 'Check each firm\'s documents by hand, then approve, ask for more information or reject. Target: 1 business day.' })
    + card('', list.length ? `<ul class="bp-list">${list.map((f) => {
      const late = reviewDueAt(f) < now();
      return `<li><span class="bp-logo" style="background:${esc(f.brand)}">${esc(f.name.slice(0, 2).toUpperCase())}</span>
        <span style="flex:1"><b>${esc(f.name)}</b><div class="bp-small bp-muted">${esc(f.emirate)} · ${esc(PLANS[f.plan]?.label || f.plan)} · submitted ${fmtAgo(f.createdAt, now())}</div></span>
        ${statusBadge(f.status)} ${badge(late ? 'Review overdue' : `Due ${fmtDateTime(reviewDueAt(f))}`, late ? 'error' : '')}
        <a class="slds-button slds-button_brand" href="console/#/firm/${f.id}">Review</a></li>`;
    }).join('')}</ul>` : '<div class="bp-empty">Nothing waiting for review.</div>');
}

export function bpFirmDetail(firmId) {
  const s = getState();
  const f = s.firms.find((x) => x.id === firmId);
  if (!f) return card('Firm', '<div class="bp-empty">Firm not found.</div>');
  const usage = firmUsage(f.id);
  const owner = s.users.find((u) => u.id === f.ownerId);
  const people = s.users.filter((u) => u.firmId === f.id);
  const underReview = ['Pending verification', 'Needs information'].includes(f.status);
  const v = f.verification || {};
  const actions = underReview
    ? `${button('Approve', 'askApprove', { variant: 'success', attrs: `data-id="${f.id}"` })} ${button('Ask for information', 'askInfo', { attrs: `data-id="${f.id}"` })} ${button('Reject', 'askReject', { variant: 'destructive', attrs: `data-id="${f.id}"` })}`
    : `${f.status === 'Suspended' ? button('Reactivate', 'reactivate', { variant: 'success', attrs: `data-id="${f.id}"` }) : ''}
       ${['Active', 'Trial'].includes(f.status) ? `${button('Change plan', 'askPlan', { attrs: `data-id="${f.id}"` })} ${button('Suspend', 'askSuspend', { attrs: `data-id="${f.id}"` })}` : ''}
       ${!['Offboarded', 'Rejected'].includes(f.status) ? button('Offboard', 'askOffboard', { variant: 'destructive-text', attrs: `data-id="${f.id}"` }) : ''}`;

  const docs = FIRM_DOCUMENTS.map((d) => {
    const doc = f.documents[d.key];
    if (!doc) return `<div class="bp-doc"><b>${esc(d.label)}</b> <span class="bp-muted">not uploaded</span></div>`;
    return `<div class="bp-doc"><div class="bp-doc-head">${uIcon('file', 'slds-icon_small slds-icon-text-default')}<b>${esc(d.label)}</b><span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} Read by AI, confirmed by owner</span></div>
      <div class="bp-doc-body"><div class="bp-doc-thumb">${esc(doc.file)}</div><dl class="bp-kv">${d.fields.map((k) => `<dt>${esc(FIELD_LABELS[k])}</dt><dd>${fieldValue(k, doc.fields[k])}</dd>`).join('')}</dl></div></div>`;
  }).join('');

  return pageHeader('account', `Firm · ${f.id}`, `${esc(f.name)} ${statusBadge(f.status)}`, { actions, meta: `${esc(f.legalName || '')} · ${esc(f.emirate)} · ${esc(PLANS[f.plan]?.label || f.plan)} · ${f.seats} seats` })
    + `<div class="bp-grid bp-cols-2"><div class="bp-grid">
      ${underReview ? card('Documents', docs, { icon: 'file' }) : ''}
      ${card('Profile', `<dl class="bp-kv"><dt>Owner</dt><dd>${owner ? `${esc(owner.name)} · ${esc(owner.email)}` : '—'}</dd><dt>Address</dt><dd>${esc(f.address) || '—'}</dd>
        <dt>Trade licence</dt><dd>${esc(f.tradeLicence)} · expires ${fmtDate(f.licenceExpiry)}</dd><dt>ORN</dt><dd>${esc(f.orn)} · expires ${fmtDate(f.ornExpiry)}</dd>
        <dt>Licensed activity</dt><dd>${esc(f.activity)}</dd><dt>Registered</dt><dd>${fmtDateTime(f.createdAt)}</dd><dt>Approved</dt><dd>${fmtDateTime(f.approvedAt)}</dd>
        ${f.trialEndsAt ? `<dt>Trial ends</dt><dd>${fmtDate(f.trialEndsAt)}</dd>` : ''}</dl>`, { icon: 'account' })}
      ${card('People', `<div class="bp-table-wrap"><table class="slds-table slds-table_cell-buffer slds-table_bordered bp-small"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Username</th></tr></thead><tbody>
        ${people.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${statusBadge(u.status)}</td><td>${esc(u.username)}</td></tr>`).join('')}</tbody></table></div>`, { icon: 'people' })}
    </div><div class="bp-grid">
      ${underReview ? card('Checks', `${f.checks.map((c) => `<div class="bp-check"><span class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'}</span>${esc(c.label)}</div>`).join('')}
        <div class="bp-check"><span class="${v.result === 'verified' ? 'ok' : 'no'}">${v.result === 'verified' ? '✓' : '…'}</span>Verification API: <b>${esc(v.result || 'not called')}</b>${v.source === 'stub' ? ' <span class="bp-muted">(stub)</span>' : ''}</div>
        <p class="bp-small bp-muted slds-m-top_small">The verification API is a stub that always answers "verified". Check the documents above by hand before approving.</p>`, { icon: 'approval' }) : ''}
      ${card('Usage (counts only)', `<dl class="bp-kv"><dt>Active users</dt><dd>${usage.active}</dd><dt>Invited</dt><dd>${usage.invited}</dd><dt>Deactivated</dt><dd>${usage.deactivated}</dd>
        <dt>Leads</dt><dd>${usage.leads}</dd><dt>Deals</dt><dd>${usage.deals}</dd><dt>Last sign-in</dt><dd>${fmtDateTime(usage.lastSignIn)}</dd></dl>
        <div class="bp-privacy slds-m-top_small">${uIcon('lock', 'slds-icon_x-small')}<span>Support access: ${f.loginAccessGranted ? 'granted by the firm' : 'not granted'}. Lead, deal and client records are never shown here.</span></div>`, { icon: 'metrics' })}
      ${card('Status history', `<ul class="bp-list">${f.statusHistory.slice().reverse().map((h) => `<li><span style="flex:1">${statusBadge(h.status)}${h.note ? `<div class="bp-small bp-muted">${esc(h.note)}</div>` : ''}</span><span class="bp-small bp-muted">${esc(h.by)}<br>${fmtDateTime(h.at)}</span></li>`).join('')}</ul>`, { icon: 'timesheet' })}
    </div></div>`;
}

export function bpFirmDirectory() {
  const s = getState();
  const t = now();
  return pageHeader('partners', 'Firms', 'All firms', { meta: `${s.firms.length} firms` })
    + card('', `<div class="bp-table-wrap"><table class="slds-table slds-table_cell-buffer slds-table_bordered"><thead><tr><th>Firm</th><th>Status</th><th>Plan</th><th>Seats</th><th>Leads</th><th>Licence expiry</th><th>Joined</th></tr></thead><tbody>
      ${s.firms.map((f) => {
        const u = firmUsage(f.id);
        const exp = Math.min(f.licenceExpiry || Infinity, f.ornExpiry || Infinity);
        return `<tr><td><a class="bp-link" href="console/#/firm/${f.id}"><b>${esc(f.name)}</b></a><div class="bp-small bp-muted">${esc(f.emirate)}</div></td><td>${statusBadge(f.status)}</td>
          <td class="bp-small">${esc(PLANS[f.plan]?.label || f.plan)}</td><td>${u.active + u.invited} / ${f.seats}</td><td>${u.leads}</td>
          <td>${Number.isFinite(exp) ? `${fmtDate(exp)} ${exp - t < 60 * DAY ? badge('Soon', 'warning') : ''}` : '—'}</td><td class="bp-small">${fmtDate(f.createdAt)}</td></tr>`;
      }).join('')}</tbody></table></div>`);
}

export function bpEmailLog() {
  const list = getState().outbox;
  return pageHeader('email', 'Records', 'Email log', { meta: 'Emails the platform would send. In this demo nothing leaves the browser.' })
    + card('', `<ul class="bp-list">${list.map((m) => `<li><span style="flex:1"><b>${esc(m.subject)}</b><div class="bp-small bp-muted">To ${esc(m.to)} · ${fmtDateTime(m.at)}</div><div class="bp-small">${esc(m.body)}</div></span>
      ${m.link ? `<a class="slds-button slds-button_neutral" href="${esc(absolute(m.link))}" target="_blank" rel="noopener">Open link</a>` : ''}</li>`).join('') || '<li>No emails yet.</li>'}</ul>`);
}

export function bpAuditLog() {
  const s = getState();
  const firm = tabSession.get('console:auditFirm', '');
  const list = s.audit.filter((a) => !firm || a.firmId === firm).slice(0, 200);
  return pageHeader('timesheet', 'Records', 'Audit log', { meta: 'Every change, who made it and when.' })
    + card('', `<div style="max-width:320px">${select('auditFirm', 'Firm', [['', 'All firms'], ...s.firms.map((f) => [f.id, f.name])], { value: firm, attrs: 'data-act="auditFirm"' })}</div>
      <div class="bp-table-wrap"><table class="slds-table slds-table_cell-buffer slds-table_bordered bp-small"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
      ${list.map((a) => `<tr><td>${fmtDateTime(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>`);
}

/* ---------- actions ---------- */

function modalSubmit(fn) {
  try {
    fn();
    closeModal();
  } catch (err) {
    if (!err.messages) throw err;
    showModalErrors(err.messages);
  }
}

export function consoleActions(getOp) {
  return {
    reqFilter(el) {
      tabSession.set('console:reqFilter', el.dataset.id);
      go('requests');
    },
    auditFirm(el) {
      tabSession.set('console:auditFirm', el.value);
      go('audit');
    },
    askAccept(el) {
      const r = getState().joinRequests.find((x) => x.id === el.dataset.id);
      openModal(`Invite ${esc(r.firmName)}`, `<div id="modal-errors"></div><p>An invitation goes to <b>${esc(r.contactName)}</b> at <b>${esc(r.email)}</b>. It works once and expires in 7 days.</p>`,
        `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_brand" data-act="doAccept" data-id="${r.id}">Send invite</button>`);
    },
    doAccept(el) {
      modalSubmit(() => {
        const invite = acceptRequest(getOp(), el.dataset.id);
        toast('success', 'Invite sent', `Code <b>${esc(invite.token)}</b>`);
      });
    },
    askDecline(el) {
      const r = getState().joinRequests.find((x) => x.id === el.dataset.id);
      openModal(`Decline ${esc(r.firmName)}`, `<div id="modal-errors"></div>${textarea('reason', 'Reason (sent to the firm)', { required: true })}`,
        `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_destructive" data-act="doDecline" data-id="${r.id}">Decline</button>`);
    },
    doDecline(el) {
      modalSubmit(() => {
        declineRequest(getOp(), el.dataset.id, document.getElementById('reason').value);
        toast('success', 'Request declined', 'The firm was emailed the reason.');
      });
    },
    askInvite() {
      openModal('New invite', `<div id="modal-errors"></div><div id="invite-form">${field('firmName', 'Firm name', { required: true })}${field('ownerName', "Owner's name", { required: true })}
        ${field('ownerEmail', "Owner's email", { type: 'email', required: true })}${select('emirate', 'Emirate', ['', ...EMIRATES], { value: 'Dubai', required: true })}</div>`,
      '<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_brand" data-act="doInvite">Send invite</button>');
    },
    doInvite() {
      modalSubmit(() => {
        const invite = createInvite(getOp(), readForm(document.getElementById('invite-form')));
        toast('success', 'Invite sent', `Code <b>${esc(invite.token)}</b>`);
      });
    },
    async copyInvite(el) {
      const link = absolute(`join/#/invite/${el.dataset.token}`);
      try {
        await navigator.clipboard.writeText(link);
        toast('success', 'Link copied', esc(link));
      } catch {
        toast('info', 'Copy this link', esc(link));
      }
    },
    resendInvite(el) {
      resendInvite(getOp(), el.dataset.token);
      toast('success', 'Invite resent', 'Valid for 7 more days.');
    },
    revokeInvite(el) {
      revokeInvite(getOp(), el.dataset.token);
      toast('success', 'Invite withdrawn');
    },
    askApprove(el) {
      const f = getState().firms.find((x) => x.id === el.dataset.id);
      openModal(`Approve ${esc(f.name)}`, `<div id="modal-errors"></div><p>Approving creates the firm's workspace: private data area, roles, default rules and the owner's login. ${f.plan === 'Trial' ? 'The 14-day trial starts now.' : `The firm starts on ${esc(PLANS[f.plan].label)}.`}</p>
        ${alertBox('info', 'Confirm you have checked the trade licence, ORN certificate and Emirates ID by hand.')}`,
      `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_success" data-act="doApprove" data-id="${f.id}">Approve and create workspace</button>`);
    },
    doApprove(el) {
      modalSubmit(() => {
        const { firm, owner } = approveFirm(getOp(), el.dataset.id);
        toast('success', `${esc(firm.name)} approved`, `${esc(owner.name)} can now sign in to the portal with <b>${esc(owner.email)}</b>.`);
      });
    },
    askInfo(el) {
      openModal('Ask for more information', `<div id="modal-errors"></div>${textarea('note', 'What is needed (sent to the owner)', { required: true })}`,
        `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_brand" data-act="doInfo" data-id="${el.dataset.id}">Send</button>`);
    },
    doInfo(el) {
      modalSubmit(() => {
        requestInformation(getOp(), el.dataset.id, document.getElementById('note').value);
        toast('success', 'Request sent to the owner');
      });
    },
    askReject(el) {
      openModal('Reject registration', `<div id="modal-errors"></div>${textarea('reason', 'Reason (sent to the owner)', { required: true })}`,
        `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_destructive" data-act="doReject" data-id="${el.dataset.id}">Reject</button>`);
    },
    doReject(el) {
      modalSubmit(() => {
        rejectFirm(getOp(), el.dataset.id, document.getElementById('reason').value);
        toast('success', 'Registration rejected');
      });
    },
    askSuspend(el) {
      openModal('Suspend firm', `<div id="modal-errors"></div><p>Everyone at the firm keeps read-only access; no new leads arrive.</p>${textarea('reason', 'Reason', { required: true })}`,
        `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_destructive" data-act="doSuspend" data-id="${el.dataset.id}">Suspend</button>`);
    },
    doSuspend(el) {
      modalSubmit(() => {
        suspendFirm(getOp(), el.dataset.id, document.getElementById('reason').value);
        toast('success', 'Firm suspended');
      });
    },
    reactivate(el) {
      reactivateFirm(getOp(), el.dataset.id);
      toast('success', 'Firm reactivated');
    },
    askPlan(el) {
      const f = getState().firms.find((x) => x.id === el.dataset.id);
      openModal(`Change plan · ${esc(f.name)}`, `<div id="modal-errors"></div>${select('plan', 'Plan', [['A', PLANS.A.label], ['B', PLANS.B.label]], { value: f.plan === 'Trial' ? 'B' : f.plan })}${field('seats', 'Seats', { type: 'number', value: f.seats, attrs: 'min="1" max="500"' })}`,
        `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_brand" data-act="doPlan" data-id="${f.id}">Save</button>`);
    },
    doPlan(el) {
      modalSubmit(() => {
        changePlan(getOp(), el.dataset.id, document.getElementById('plan').value, document.getElementById('seats').value);
        toast('success', 'Plan updated');
      });
    },
    askOffboard(el) {
      const f = getState().firms.find((x) => x.id === el.dataset.id);
      openModal(`Offboard ${esc(f.name)}`, `<div id="modal-errors"></div><p>All logins are deactivated, the owner receives a data export, and data is deleted after the 30-day notice period.</p>
        ${field('confirmName', `Type "${f.name}" to confirm`, { required: true })}`,
      `<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button><button type="button" class="slds-button slds-button_destructive" data-act="doOffboard" data-id="${f.id}">Offboard</button>`);
    },
    doOffboard(el) {
      modalSubmit(() => {
        offboardFirm(getOp(), el.dataset.id, document.getElementById('confirmName').value);
        toast('success', 'Firm offboarded');
      });
    },
  };
}

