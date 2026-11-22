// App shell: firm-branded sidebar, top bar (search, notifications, Copilot, user menu), banners.
// LWC equivalent: the LWR site theme layout c-bp-app-shell with header and navigation regions.

import { uIcon, bIconOnly, avatar } from '../core/ui.js';
import { esc, initials, fmtDate, fmtAgo, DAY } from '../core/util.js';
import { getState, now } from '../core/store.js';
import { PLANS } from '../core/config.js';

/** Portal navigation: which roles see which page, and which drop delivers it. */
export const PORTAL_NAV = [
  { group: 'Work' },
  { id: 'home', label: 'Home', icon: 'home', roles: 'all', labelFor: { Agent: 'My Day', 'Team Leader': 'My Day' } },
  { id: 'leads', label: 'Leads', icon: 'lead', roles: ['Owner', 'Director', 'Team Leader', 'Agent'] },
  { id: 'pipeline', label: 'Pipeline', icon: 'opportunity', roles: ['Owner', 'Director', 'Team Leader', 'Agent', 'Compliance'] },
  { id: 'inventory', label: 'Inventory', icon: 'apps', roles: ['Owner', 'Director', 'Team Leader', 'Agent', 'Marketing'] },
  { group: 'Grow and run' },
  { id: 'campaigns', label: 'Campaigns', icon: 'campaign', roles: ['Owner', 'Director', 'Marketing'], plan: 'marketing' },
  { id: 'team', label: 'Team performance', icon: 'chart', roles: ['Owner', 'Director', 'Team Leader'] },
  { id: 'commission', label: 'Commission', icon: 'moneybag', roles: ['Owner', 'Director', 'Compliance'] },
  { id: 'compliance', label: 'Compliance', icon: 'shield', roles: ['Owner', 'Director', 'Compliance'] },
  { group: 'Admin' },
  { id: 'onboarding', label: 'Finish setup', icon: 'setup_assistant_guide', roles: ['Owner'], setupOnly: true },
  { id: 'people', label: 'People', icon: 'people', roles: ['Owner'] },
  { id: 'settings', label: 'Firm settings', icon: 'settings', roles: ['Owner'] },
];

export function navFor(user, firm) {
  const plan = PLANS[firm.plan] || PLANS.A;
  const items = PORTAL_NAV.filter((n) => n.group || ((n.roles === 'all' || n.roles.includes(user.role))
    && (!n.plan || plan.marketing) && (!n.setupOnly || !firm.setupComplete)));
  // Drop group labels that have no items under them.
  return items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
}

function banner(firm) {
  const t = now();
  if (firm.status === 'Suspended') return `<div class="bp-banner error">${uIcon('lock', 'slds-icon_x-small')}<span>Your firm is suspended. Everything is read-only and no new leads arrive. Contact ThinkVibes.</span></div>`;
  if (firm.status === 'Trial' && firm.trialEndsAt) {
    const days = Math.max(0, Math.ceil((firm.trialEndsAt - t) / DAY));
    return `<div class="bp-banner info">${uIcon('clock', 'slds-icon_x-small')}<span>Trial: ${days} day${days === 1 ? '' : 's'} left (ends ${fmtDate(firm.trialEndsAt)}).</span></div>`;
  }
  const licenceDays = Math.ceil((firm.licenceExpiry - t) / DAY);
  if (licenceDays <= 30) return `<div class="bp-banner warn">${uIcon('warning', 'slds-icon_x-small')}<span>Your trade licence expires in ${licenceDays} days. Upload the renewal in Firm settings to avoid suspension.</span></div>`;
  return '';
}

function notificationsPanel(userId) {
  const list = getState().notifications.filter((n) => n.userId === userId).slice(0, 12);
  return `<div class="slds-popover slds-popover_panel bp-pop" role="dialog" aria-label="Notifications"><div class="slds-popover__body slds-p-around_small">
    <div class="slds-grid slds-grid_align-spread slds-m-bottom_x-small"><b>Notifications</b><a class="bp-link bp-small" data-act="markAllRead">Mark all read</a></div>
    ${list.length ? list.map((n) => `<a class="bp-notif ${n.read ? '' : 'unread'}" data-act="openNotification" data-id="${esc(n.id)}"><span>${esc(n.text)}</span><small>${fmtAgo(n.at, now())}</small></a>`).join('') : '<div class="bp-empty">Nothing yet.</div>'}
  </div></div>`;
}

/**
 * Renders the shell around a page body.
 * opts: { user, firm, active, body, notifOpen, userMenuOpen, console: bool, nav (override), title }
 */
export function bpAppShell({ user, firm, active, body, notifOpen = false, userMenuOpen = false, consoleMode = false, nav = null, copilot = '', menuOpen = false, demo = null }) {
  const items = nav || navFor(user, firm);
  const brand = consoleMode ? '#3e3e3c' : firm.brand;
  const audience = consoleMode ? 'OP-ALL' : user.id;
  const unread = getState().notifications.filter((n) => n.userId === audience && !n.read).length;
  const logo = consoleMode ? 'TV' : esc(firm.logoText || initials(firm.name));
  const subtitle = consoleMode ? 'ThinkVibes console' : `${esc(PLANS[firm.plan]?.label.split(' · ')[0] || firm.plan)} · ${esc(firm.emirate)}`;
  const navHtml = items.map((n) => n.group
    ? `<li class="bp-nav-group">${esc(n.group)}</li>`
    : `<li><a href="${consoleMode ? 'console' : 'portal'}/#/${n.id}" class="${active === n.id ? 'is-active' : ''}" ${n.id === 'onboarding' ? 'style="background:rgba(221,122,1,.25)"' : ''}>${uIcon(n.icon, 'slds-icon_x-small')}<span>${esc((n.labelFor && n.labelFor[user.role]) || n.label)}</span>${n.drop ? `<span class="bp-soon">drop ${n.drop}</span>` : ''}${n.count ? `<span class="bp-soon">${n.count}</span>` : ''}</a></li>`).join('');

  const tab = (id, label, icon, act) => `<${act ? `button type="button" data-act="${act}"` : `a href="portal/#/${id}"`} class="bp-tab ${active === id || (act && copilot) ? 'is-active' : ''}">${uIcon(icon, 'slds-icon_x-small')}<span>${label}</span></${act ? 'button' : 'a'}>`;
  const bottomBar = consoleMode ? '' : `<nav class="bp-bottom" aria-label="Quick navigation">${tab('home', ['Agent', 'Team Leader'].includes(user.role) ? 'Today' : 'Home', 'home')}
    ${items.some((n) => n.id === 'leads') ? tab('leads', 'Leads', 'lead') : ''}${items.some((n) => n.id === 'pipeline') ? tab('pipeline', 'Deals', 'opportunity') : ''}${tab('copilot', 'Copilot', 'sparkles', 'toggleCopilot')}</nav>
    ${items.some((n) => n.id === 'leads') ? `<button type="button" class="bp-fab" data-act="quickCapture" aria-label="Quick capture a lead">${uIcon('add', 'slds-icon_small')}</button>` : ''}`;
  const demoControls = consoleMode || !demo ? '' : `<div class="bp-demo-controls"><div class="bp-small"><b>Demo controls</b> <span class="bp-muted">(demo only)</span></div>
    <div class="bp-small bp-muted">Demo clock: ${esc(demo.clock)}${demo.offset ? ` (moved ${esc(demo.offset)})` : ''}</div>
    <div class="bp-form-actions"><button type="button" class="slds-button slds-button_neutral" data-act="demoClock" data-h="1">+1 hour</button><button type="button" class="slds-button slds-button_neutral" data-act="demoClock" data-h="24">+1 day</button>${demo.offset ? '<button type="button" class="slds-button slds-button_neutral" data-act="demoClock" data-h="0">Real time</button>' : ''}</div>
    <div class="bp-form-actions"><button type="button" class="slds-button slds-button_neutral" data-act="simulateLead">Simulate lead</button><button type="button" class="slds-button slds-button_neutral" data-act="switchPersona">View as…</button><button type="button" class="slds-button slds-button_text-destructive" data-act="resetDemo">Reset demo</button></div></div>`;

  return `<div class="bp-shell ${consoleMode ? 'bp-console' : ''} ${copilot ? 'has-copilot' : ''} ${menuOpen ? 'menu-open' : ''}" style="--bp-brand:${esc(brand)}">
    <aside class="bp-side">
      <div class="bp-side-firm"><span class="bp-logo">${logo}</span><div><b>${esc(consoleMode ? 'Broker Portal' : firm.name)}</b><span>${subtitle}</span></div></div>
      <ul class="bp-nav">${navHtml}</ul>
      <div class="bp-side-foot">Broker Portal by ThinkVibes · demo data</div>
    </aside>
    <div>
      <header class="bp-top">
        <button type="button" class="slds-button slds-button_icon bp-menu-btn" data-act="toggleMenu" aria-label="Menu" aria-expanded="${menuOpen}">${uIcon('rows', 'slds-icon_small')}</button>
        <div class="bp-search" data-act="openSearch" role="button" tabindex="0">${uIcon('search', 'slds-icon_x-small')}<span>Search ${consoleMode ? 'firms and requests' : 'leads, deals, people'}…</span><kbd>Ctrl K</kbd></div>
        <div class="bp-top-right">
          ${consoleMode ? '' : `<button type="button" class="slds-button ${copilot ? 'slds-button_brand' : 'slds-button_neutral'} bp-copilot-btn" data-act="toggleCopilot" aria-pressed="${!!copilot}">${uIcon('sparkles', 'slds-icon_x-small')}&nbsp;Copilot</button>`}
          <div class="bp-rel">
            <button type="button" class="slds-button slds-button_icon slds-button_icon-border-filled" title="Notifications" data-act="toggleNotifications">${bIconOnly('notification')}</button>
            ${unread ? `<span class="bp-count">${unread}</span>` : ''}
            ${notifOpen ? notificationsPanel(audience) : ''}
          </div>
          <div class="bp-rel">
            <div class="bp-user" data-act="toggleUserMenu" role="button" tabindex="0">${avatar(user.name, brand, 32)}<div><b>${esc(user.name)}</b><span>${esc(consoleMode ? `ThinkVibes ${user.role}` : user.role)}</span></div></div>
            ${userMenuOpen ? `<div class="slds-popover slds-popover_panel bp-pop bp-pop-sm"><div class="slds-popover__body slds-p-around_small">
              <div class="bp-small bp-muted">${esc(user.email)}</div>
              ${consoleMode ? '' : `<div class="bp-small bp-muted slds-m-bottom_small">Login username: ${esc(user.username)}</div>`}
              ${demoControls}
              <button type="button" class="slds-button slds-button_neutral slds-button_stretch" data-act="signOut">Sign out</button></div></div>` : ''}
          </div>
        </div>
      </header>
      ${consoleMode ? '' : banner(firm)}
      <main class="bp-main" id="main">${body}</main>
    </div>
    ${copilot}
    ${bottomBar}
  </div>`;
}
