// Split layout used by public pages (join) and sign-in pages: brand panel left, content right.
// LWC equivalent: c-bp-auth-layout with a default slot.

import { uIcon } from '../core/ui.js';
import { esc } from '../core/util.js';
import { themeToggle } from '../core/theme.js';

const DEFAULT_POINTS = [
  'Every portal lead captured, routed and followed up in minutes',
  'RERA, telemarketing and AML rules built into each step',
  'Deals, documents, payment plans and commission in one place',
  "AI agents that do the busy work; you approve what's sent",
];

export function bpAuthLayout(content, { headline, sub, points = DEFAULT_POINTS, narrow = false } = {}) {
  return `<div class="bp-auth">
    <aside class="bp-auth-art">
      <div class="bp-brandmark"><span class="bp-logo">BP</span><span>Broker Portal</span></div>
      <h1>${esc(headline || 'Run your whole brokerage from one portal')}</h1>
      <p>${esc(sub || 'For UAE real estate firms: leads, deals, marketing, compliance and commission, with AI built in.')}</p>
      <ul>${points.map((p) => `<li>${uIcon('check', 'slds-icon_x-small')}<span>${esc(p)}</span></li>`).join('')}</ul>
      <div class="bp-auth-foot">A ThinkVibes product · demonstration environment · all data is fictional</div>
    </aside>
    <main class="bp-auth-body"><div class="bp-auth-theme">${themeToggle()}</div><div class="bp-auth-panel ${narrow ? 'narrow' : ''}">${content}</div></main>
  </div>`;
}
