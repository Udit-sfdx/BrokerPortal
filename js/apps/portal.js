// Firm portal: sign-in, invitation accept, shell and pages. Pages for drops 2–4 show what's coming.

import { createApp, currentRoute, go } from '../core/app.js';
import { getState, mutate, tabSession } from '../core/store.js';
import { card, comingSoon, toast } from '../core/ui.js';
import { currentUser, signOut } from '../services/authService.js';
import { firmOf } from '../services/firmService.js';
import { bpAppShell, navFor } from '../components/bpAppShell.js';
import { bpSignIn, bpAcceptInvite, signInActions } from '../components/bpSignIn.js';
import { bpHome } from '../components/bpHome.js';
import { bpPeopleAdmin, peopleActions } from '../components/bpPeopleAdmin.js';
import { bpOnboardingWizard, onboardingActions } from '../components/bpOnboardingWizard.js';

const COMING = {
  leads: ['Leads', 2, ['Live inbox of portal, Meta and WhatsApp leads', 'Routing trace and SLA countdowns', 'Duplicate and DNC badges', 'Bulk assign and saved views']],
  pipeline: ['Pipeline', 2, ['Boards for off-plan, secondary and rental', 'Drag and drop with document and KYC gates', 'Deal room with payment plan, handover and commission']],
  inventory: ['Inventory', 3, ['Projects, units, availability and payment plans', 'Unit matching for leads']],
  campaigns: ['Campaigns', 3, ['Campaigns with ad permits (Trakheesi)', 'Spend by channel and creative', 'ROI on commission received']],
  team: ['Team performance', 3, ['Leaderboard, speed to lead, SLA breaches', 'Re-assign queue and coaching notes']],
  commission: ['Commission', 3, ['Expected to paid pipeline with VAT', 'Developer ageing, invoices and agent payouts']],
  compliance: ['Compliance', 3, ['KYC queue and REAR/goAML tasks', 'Licence and permit expiries, audit log']],
  settings: ['Firm settings', 3, ['Routing rules, SLAs and pipelines', 'Commission rates, templates and integrations', 'Plan and billing']],
};

const ui = { notifOpen: false, userMenuOpen: false };
const actor = () => currentUser();

function render() {
  const { name, params } = currentRoute('home');
  if (name === 'accept') return bpAcceptInvite(params[0]);
  const user = currentUser();
  if (!user) return bpSignIn('portal');
  const firm = firmOf(user);
  const allowed = navFor(user, firm).filter((n) => !n.group).map((n) => n.id);
  const page = allowed.includes(name) ? name : 'home';
  let body;
  if (page === 'home') body = bpHome(user);
  else if (page === 'people') body = bpPeopleAdmin(user);
  else if (page === 'onboarding') body = bpOnboardingWizard(user);
  else {
    const [title, drop, bullets] = COMING[page];
    body = card(title, comingSoon(title, drop, bullets));
  }
  return bpAppShell({ user, firm, active: page, body, notifOpen: ui.notifOpen, userMenuOpen: ui.userMenuOpen });
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
    go('');
  },
  openSearch() {
    toast('info', 'Search arrives in drop 4', 'Ctrl+K will search leads, deals, people and actions.');
  },
  openCopilot() {
    toast('info', 'Copilot arrives in drop 4', 'Ask questions and run actions in plain words.');
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

const app = createApp({
  mount: 'app',
  render,
  actions: { ...signInActions, ...shellActions, ...peopleActions(actor), ...onboardingActions(actor) },
});
