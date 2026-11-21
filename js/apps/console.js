// ThinkVibes operator console (P15): requests, invites, verification, firms, email and audit logs.

import { createApp, currentRoute, go } from '../core/app.js';
import { getState, mutate } from '../core/store.js';
import { toast } from '../core/ui.js';
import { currentOperator, signOut } from '../services/authService.js';
import { bpAppShell } from '../components/bpAppShell.js';
import { bpSignIn, signInActions } from '../components/bpSignIn.js';
import {
  CONSOLE_NAV, navCounts, bpConsoleOverview, bpRequestQueue, bpInviteManager, bpVerificationQueue, bpFirmDetail,
  bpFirmDirectory, bpEmailLog, bpAuditLog, consoleActions,
} from '../components/bpConsolePages.js';

const ui = { notifOpen: false, userMenuOpen: false };

function render() {
  const op = currentOperator();
  if (!op) return bpSignIn('console');
  const { name, params } = currentRoute('overview');
  const counts = navCounts();
  const nav = CONSOLE_NAV.map((n) => ({ ...n, count: n.id === 'requests' ? counts.requests || '' : n.id === 'verification' ? counts.verification || '' : '' }));
  const pages = {
    overview: () => bpConsoleOverview(op),
    requests: bpRequestQueue,
    invites: bpInviteManager,
    verification: bpVerificationQueue,
    firms: bpFirmDirectory,
    firm: () => bpFirmDetail(params[0]),
    emails: bpEmailLog,
    audit: bpAuditLog,
  };
  const page = pages[name] ? name : 'overview';
  const active = page === 'firm' ? (getState().firms.find((f) => f.id === params[0])?.status.match(/Pending|Needs/) ? 'verification' : 'firms') : page;
  return bpAppShell({ user: op, firm: null, active, body: pages[page](), consoleMode: true, nav, notifOpen: ui.notifOpen, userMenuOpen: ui.userMenuOpen });
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
    mutate((s) => s.notifications.forEach((n) => { if (n.userId === 'OP-ALL') n.read = true; }));
  },
  openNotification(el) {
    const n = getState().notifications.find((x) => x.id === el.dataset.id);
    ui.notifOpen = false;
    if (!n) return;
    mutate(() => { n.read = true; });
    if (n.link) location.hash = n.link;
  },
  signOut() {
    signOut('console');
    ui.userMenuOpen = false;
    go('');
  },
  openSearch() {
    toast('info', 'Search arrives in drop 4');
  },
  openCopilot() {},
};

document.addEventListener('click', (e) => {
  if ((ui.notifOpen || ui.userMenuOpen) && !e.target.closest('.bp-rel')) {
    ui.notifOpen = false;
    ui.userMenuOpen = false;
    app.refresh();
  }
});

const app = createApp({ mount: 'app', render, actions: { ...signInActions, ...shellActions, ...consoleActions(currentOperator) } });
