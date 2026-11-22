// P14 Command palette (Ctrl+K) and global search: records the user can see, pages and actions.
// Understands phrases like "2BR leads from Meta this week". Never returns another firm's records.
// LWC equivalent: c-bp-command-palette calling BP_SearchService.

import { openModal, closeModal, uIcon } from '../core/ui.js';
import { esc } from '../core/util.js';
import { searchAll } from '../services/searchService.js';

function results(actor, q, allowedPages) {
  const r = searchAll(actor, q, { allowedPages });
  if (!r.groups.length) return `<div class="bp-empty">Nothing found in ${esc(r.firm)} for "${esc(q)}".</div>`;
  let n = 0;
  return `${r.parsed.length ? `<div class="bp-small bp-muted slds-m-bottom_x-small">${uIcon('sparkles', 'slds-icon_xx-small')} Understood: ${esc(r.parsed.join(' · '))}</div>` : ''}
    ${r.groups.map((g) => `<div class="bp-cmdk-group"><div class="bp-cmdk-label">${esc(g.label)}${g.total > g.items.length ? ` <span class="bp-muted">(${g.items.length} of ${g.total})</span>` : ''}</div>
      ${g.items.map((it) => `<button type="button" class="bp-cmdk-item ${n++ === 0 ? 'is-first' : ''}" ${it.act ? `data-act="cmdkAct" data-run="${esc(it.act)}"` : `data-act="cmdkGo" data-link="${esc(it.link || '')}"`}>
        ${uIcon(it.icon || 'record', 'slds-icon_x-small')}<span><b>${esc(it.label)}</b><small>${esc(it.sub || '')}</small></span></button>`).join('')}</div>`).join('')}`;
}

/** Opens the palette. allowedPages = nav ids the user can open. runAction(name) runs an app action. */
export function openCommandPalette(actor, allowedPages) {
  openModal('Search', `<div class="bp-cmdk"><div class="slds-form-element"><label class="slds-assistive-text" for="cmdk-q">Search</label>
      <input class="slds-input bp-cmdk-input" id="cmdk-q" autocomplete="off" placeholder='Try "2BR leads from Meta this week", a name, a phone or a page'></div>
      <div id="cmdk-results" class="bp-cmdk-results" role="listbox">${results(actor, '', allowedPages)}</div>
      <div class="bp-small bp-muted slds-m-top_x-small">Enter opens the first result · Esc closes · Only ${esc('your firm')}'s records you can see.</div></div>`, '');
  const input = document.getElementById('cmdk-q');
  const box = document.getElementById('cmdk-results');
  input.focus();
  input.addEventListener('input', () => { box.innerHTML = results(actor, input.value, allowedPages); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); box.querySelector('.bp-cmdk-item')?.click(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); box.querySelector('.bp-cmdk-item')?.focus(); }
  });
  box.addEventListener('keydown', (e) => {
    const items = [...box.querySelectorAll('.bp-cmdk-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); (items[i + 1] || items[i]).focus(); }
    if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); (i === 0 ? input : items[i - 1]).focus(); }
  });
}

export const paletteActions = (getActor, getAllowedPages, runAction) => ({
  openSearch() { openCommandPalette(getActor(), getAllowedPages()); },
  cmdkGo(el) { closeModal(); if (el.dataset.link) location.hash = el.dataset.link; },
  cmdkAct(el) { closeModal(); runAction(el.dataset.run); },
});
