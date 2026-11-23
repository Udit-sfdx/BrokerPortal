// ThinkVibes operator console (P15): requests, invites, verification, firms, email and audit logs.

import { createApp, currentRoute, go } from '../core/app.js';
import { getState, mutate } from '../core/store.js';
import { currentOperator, signOut } from '../services/authService.js';
import { bpAppShell } from '../components/bpAppShell.js';
import { openSearchPalette, paletteActions } from '../components/bpCommandPalette.js';
import { searchConsole } from '../services/operatorService.js';
import { bpSignIn, signInActions } from '../components/bpSignIn.js';
import {
  CONSOLE_NAV, navCounts, bpConsoleOverview, bpRequestQueue, bpInviteManager, bpVerificationQueue, bpFirmDetail,
  bpFirmDirectory, bpEmailLog, bpAuditLog, consoleActions,
} from '../components/bpConsolePages.js';

const ui = { notifOpen: false, userMenuOpen: false, menuOpen: false };

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
  return bpAppShell({ user: op, firm: null, active, body: pages[page](), consoleMode: true, nav, notifOpen: ui.notifOpen, userMenuOpen: ui.userMenuOpen, menuOpen: ui.menuOpen });
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
    if (!currentOperator()) return;
    openSearchPalette({ search: searchConsole, placeholder: 'Firm name, ORN, trade licence, owner email or invite code', scopeNote: 'Directory only: firm records stay private.' });
  },
  cmdkGo: paletteActions(() => null, () => [], () => {}).cmdkGo,
  toggleMenu() { ui.menuOpen = !ui.menuOpen; app.refresh(); },
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

// Ctrl+K / Cmd+K opens console search; the phone drawer closes on navigation.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && currentOperator()) {
    e.preventDefault();
    shellActions.openSearch();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.menuOpen && !document.querySelector('#modal-root .slds-modal')) { ui.menuOpen = false; app.refresh(); } });
window.addEventListener('hashchange', () => { if (ui.menuOpen) { ui.menuOpen = false; app.refresh(); } });
