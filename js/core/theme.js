// Light and dark mode. Choice: 'light', 'dark' or 'system' (follows the device), stored per browser.
// The page template sets data-theme before CSS loads (no flash); this module keeps it in sync and
// handles the toggle button. Real build: SLDS 2 light/dark theme on the Experience Cloud site.

const KEY = 'bp.theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function themeChoice() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export const effectiveTheme = (choice = themeChoice()) => (choice === 'system' ? (media && media.matches ? 'dark' : 'light') : choice);

export function applyTheme() {
  const t = effectiveTheme();
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
    const c = themeChoice();
    b.setAttribute('aria-label', `Theme: ${c}. Switch theme`);
    b.title = `Theme: ${c === 'system' ? `system (${t})` : c}. Click to change.`;
    b.dataset.mode = c;
  });
}

/** Cycles light → dark → system. */
export function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(themeChoice()) + 1) % order.length];
  try { if (next === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* storage blocked: session only */ }
  applyTheme();
  return next;
}

/** Toggle button markup (sun / moon / auto). Works in any app via a document-level listener. */
export const themeToggle = (cls = '') => `<button type="button" class="slds-button slds-button_icon slds-button_icon-border-filled bp-theme-btn ${cls}" data-theme-toggle data-mode="${themeChoice()}" aria-label="Switch theme">
  <svg class="bp-theme-ico sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
  <svg class="bp-theme-ico moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>
  <svg class="bp-theme-ico auto" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" class="fill"/></svg></button>`;

let wired = false;
export function initTheme() {
  applyTheme();
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) { e.preventDefault(); cycleTheme(); }
  });
  if (media && media.addEventListener) media.addEventListener('change', () => { if (themeChoice() === 'system') applyTheme(); });
  window.addEventListener('storage', (e) => { if (e.key === KEY) applyTheme(); });
}
