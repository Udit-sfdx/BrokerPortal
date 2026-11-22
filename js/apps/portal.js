// Firm portal: sign-in, invitation accept, shell and pages.
// Drop 2: My Day (agents and team leaders), Leads inbox, Lead workspace, Pipeline, Deal room.
// Pages for drops 3–4 show what's coming.

import { createApp, currentRoute, go } from '../core/app.js';
import { getState, mutate, tabSession, now, subscribe } from '../core/store.js';
import { card, toast } from '../core/ui.js';
import { esc } from '../core/util.js';
import { slaState } from '../core/rules.js';
import { currentUser, signOut } from '../services/authService.js';
import { firmOf } from '../services/firmService.js';
import { visibleLeads, maybeAutoArrive, leadOwnerName } from '../services/leadService.js';
import { bpAppShell, navFor } from '../components/bpAppShell.js';
import { bpSignIn, bpAcceptInvite, signInActions } from '../components/bpSignIn.js';
import { bpHome } from '../components/bpHome.js';
import { bpMyDay } from '../components/bpMyDay.js';
import { bpLeadInbox, inboxActions } from '../components/bpLeadInbox.js';
import { bpLeadWorkspace, workspaceActions } from '../components/bpLeadWorkspace.js';
import { bpPipelineBoard, boardActions, wireBoardDragAndDrop } from '../components/bpPipelineBoard.js';
import { bpDealRoom, dealRoomActions } from '../components/bpDealRoom.js';
import { quickCaptureActions } from '../components/bpQuickCapture.js';
import { callGuardActions } from '../components/bpCallGuard.js';
import { composerActions } from '../components/bpMessageComposer.js';
import { convertActions } from '../components/bpConvertModal.js';
import { startSlaTicker } from '../components/bpLeadBits.js';
import { bpPeopleAdmin, peopleActions } from '../components/bpPeopleAdmin.js';
import { bpOnboardingWizard, onboardingActions } from '../components/bpOnboardingWizard.js';
import { bpInventoryBrowser, inventoryActions } from '../components/bpInventoryBrowser.js';
import { bpCampaignStudio, campaignActions } from '../components/bpCampaignStudio.js';
import { bpTeamPerformance, teamActions } from '../components/bpTeamPerformance.js';
import { bpCommissionLedger, ledgerActions } from '../components/bpCommissionLedger.js';
import { bpComplianceCenter, complianceActions } from '../components/bpComplianceCenter.js';
import { bpFirmSettings, settingsActions } from '../components/bpFirmSettings.js';
import { bpCopilotPanel, copilotActions, copilotAfterRender } from '../components/bpCopilotPanel.js';
import { paletteActions } from '../components/bpCommandPalette.js';
import { fmtDateTime, fmtDuration } from '../core/util.js';



/** Detail routes and the nav page they belong to (for access and highlighting). */
const DETAIL_ROUTES = { lead: 'leads', deal: 'pipeline' };
const MY_DAY_ROLES = ['Agent', 'Team Leader'];
const AUTO_ARRIVAL_MS = 2 * 60 * 1000;
const MAX_AUTO_ARRIVALS_PER_TAB = 15;

const ui = { notifOpen: false, userMenuOpen: false, menuOpen: false };
const copilotOpen = () => !!tabSession.get('copilotOpen', false);
const actor = () => currentUser();

function render() {
  const { name, params } = currentRoute('home');
  if (name === 'accept') return bpAcceptInvite(params[0]);
  const user = currentUser();
  if (!user) return bpSignIn('portal');
  const firm = firmOf(user);
  const nav = navFor(user, firm);
  const allowed = nav.filter((n) => !n.group).map((n) => n.id);
  const navPage = DETAIL_ROUTES[name] || name;
  const page = allowed.includes(navPage) ? name : 'home';
  let body;
  if (page === 'home') body = MY_DAY_ROLES.includes(user.role) ? bpMyDay(user) : bpHome(user);
  else if (page === 'leads') body = bpLeadInbox(user, params);
  else if (page === 'lead') body = bpLeadWorkspace(user, params[0]);
  else if (page === 'pipeline') body = bpPipelineBoard(user);
  else if (page === 'deal') body = bpDealRoom(user, params[0], params[1]);
  else if (page === 'people') body = bpPeopleAdmin(user);
  else if (page === 'onboarding') body = bpOnboardingWizard(user);
  else if (page === 'inventory') body = bpInventoryBrowser(user, params);
  else if (page === 'campaigns') body = bpCampaignStudio(user, params);
  else if (page === 'team') body = bpTeamPerformance(user);
  else if (page === 'commission') body = bpCommissionLedger(user);
  else if (page === 'compliance') body = bpComplianceCenter(user);
  else if (page === 'settings') body = bpFirmSettings(user, params);
  else body = card('Not found', 'This page does not exist.');
  const t = now();
  const waiting = visibleLeads(user).filter((l) => slaState(l, t).state === 'running' || slaState(l, t).state === 'breached').length;
  const navWithCounts = nav.map((n) => (n.id === 'leads' && waiting ? { ...n, count: waiting } : n));
  const offset = getState().clockOffset || 0;
  const demo = { clock: fmtDateTime(t), offset: offset ? `${offset > 0 ? '+' : '−'}${fmtDuration(Math.abs(offset))}` : '' };
  return bpAppShell({
    user, firm, active: DETAIL_ROUTES[page] || page, body, notifOpen: ui.notifOpen, userMenuOpen: ui.userMenuOpen, nav: navWithCounts,
    copilot: copilotOpen() ? bpCopilotPanel(user) : '', menuOpen: ui.menuOpen, demo,
  });
}

const shellActions = {
  toggleNotifications() {
    ui.notifOpen = !ui.notifOpen;
    ui.userMenuOpen = false;
    app.refresh();
  },
  toggleUserMenu() {
    ui.userMenuOpen = !ui.userMenuOpen;
    ui.notifOpen = false;
    app.refresh();
  },
  markAllRead() {
    const user = actor();
    mutate((s) => s.notifications.forEach((n) => { if (n.userId === user.id) n.read = true; }));
  },
  openNotification(el) {
    const n = getState().notifications.find((x) => x.id === el.dataset.id);
    ui.notifOpen = false;
    if (!n) return;
    mutate(() => { n.read = true; });
    if (n.link) location.hash = n.link;
  },
  signOut() {
    signOut('portal');
    ui.userMenuOpen = false;
    tabSession.set('onboard', null);
    tabSession.set('inbox', null);
    tabSession.set('board', null);
    go('');
  },
  toggleCopilot() {
    tabSession.set('copilotOpen', !copilotOpen());
    app.refresh();
    if (copilotOpen()) setTimeout(() => document.getElementById('copilot-q')?.focus(), 0);
  },
  toggleMenu() { ui.menuOpen = !ui.menuOpen; app.refresh(); },
  /** Demo only: moves the demo clock so SLAs, follow-ups and expiries can be shown moving. */
  demoClock(el) {
    const h = Number(el.dataset.h);
    mutate((s) => { s.clockOffset = h === 0 ? 0 : (s.clockOffset || 0) + h * 3600e3; });
    toast('info', h === 0 ? 'Demo clock back to real time' : `Demo clock moved ${h === 24 ? 'one day' : 'one hour'} ahead`);
  },
  switchPersona() {
    signOut('portal');
    ui.userMenuOpen = false;
    go('');
  },
};

// Close popovers when clicking elsewhere.
document.addEventListener('click', (e) => {
  if ((ui.notifOpen || ui.userMenuOpen) && !e.target.closest('.bp-rel')) {
    ui.notifOpen = false;
    ui.userMenuOpen = false;
    app.refresh();
  }
});

const refresh = () => app.refresh();
const allowedPages = () => { const u = currentUser(); return u ? navFor(u, firmOf(u)).filter((n) => !n.group).map((n) => n.id) : []; };
/** Runs an app action by name (from the command palette), with the same error toasts as a click. */
function runNamedAction(name) {
  try {
    appActions[name]?.(document.body);
  } catch (err) {
    toast('error', 'Could not do that', esc(err.messages ? err.messages.join(' ') : err.message));
  }
}

const appActions = {
    ...signInActions, ...shellActions, ...peopleActions(actor), ...onboardingActions(actor),
    ...quickCaptureActions(actor), ...inboxActions(actor, refresh), ...workspaceActions(actor), ...callGuardActions(actor),
    ...composerActions(actor), ...convertActions(actor), ...boardActions(actor, refresh), ...dealRoomActions(actor),
    ...inventoryActions(actor, refresh), ...campaignActions(actor), ...teamActions(actor, refresh), ...ledgerActions(actor, refresh),
    ...complianceActions(actor, refresh), ...settingsActions(actor, refresh), ...copilotActions(actor, refresh),
    ...paletteActions(actor, allowedPages, (name) => runNamedAction(name)),
};

const app = createApp({ mount: 'app', render, actions: appActions, afterRender: copilotAfterRender });

// Ctrl+K / Cmd+K opens the command palette from anywhere in the portal.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && currentUser()) {
    e.preventDefault();
    appActions.openSearch();
  }
});
window.addEventListener('hashchange', () => { if (ui.menuOpen) { ui.menuOpen = false; app.refresh(); } });

wireBoardDragAndDrop(actor);
startSlaTicker(now);

/* ---------- live lead feed ---------- */

// Leads routed to me that arrived since this tab opened (in this tab or another): toast them once.
const seen = new Set(getState().leads.map((l) => l.id));
subscribe(() => {
  const user = currentUser();
  if (!user) return;
  for (const l of getState().leads) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    if (l.firmId !== user.firmId) continue;
    if (l.ownerId === user.id) toast('info', `New lead: ${l.name}`, `${esc(l.source)} · ${esc(l.interest)}. <a href="portal/#/lead/${esc(l.id)}">Open</a>`);
    else if (!l.ownerId && ['Owner', 'Team Leader'].includes(user.role)) toast('warning', `Unassigned lead: ${l.name}`, 'No eligible agent. Assign it from the inbox.');
  }
});

// While the inbox or My Day is open, a new enquiry arrives every couple of minutes (shared across tabs).
let autoCount = 0;
setInterval(() => {
  const user = currentUser();
  const { name } = currentRoute('home');
  if (!user || document.hidden || autoCount >= MAX_AUTO_ARRIVALS_PER_TAB || !['leads', 'home'].includes(name)) return;
  try {
    const lead = maybeAutoArrive(user, AUTO_ARRIVAL_MS);
    if (lead) {
      autoCount++;
      if (lead.ownerId !== user.id && name === 'leads') toast('info', `New ${lead.source} lead`, `${esc(lead.name)} → ${esc(leadOwnerName(lead))}`);
    }
  } catch (err) {
    console.warn('Broker Portal: automatic lead arrival skipped.', err);
  }
}, 15000);
