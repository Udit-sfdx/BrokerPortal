// Tiny app runtime shared by the join, portal and console pages:
// hash routing, one render function, and event delegation through data-act attributes.
// It stands in for what Lightning navigation + LWC event handling do in the Salesforce build.

import { subscribe } from './store.js';
import { closeModal, modalOpen, toast } from './ui.js';
import { ValidationError, esc } from './util.js';

/** Current route as { name, params }: "#/deal/D-1/payments" → { name: 'deal', params: ['D-1', 'payments'] }. */
export function currentRoute(fallback) {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || fallback, params: parts.slice(1) };
}

export function go(path) {
  const target = `#/${path.replace(/^#?\/?/, '')}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

/**
 * createApp wires a page:
 *  - render(): returns the whole page HTML for the current route and state
 *  - actions: { name(el, event) } called for data-act on click, and on change for inputs/selects
 * Errors thrown by actions are shown as toasts (ValidationError messages are listed).
 */
export function createApp({ mount, render, actions, afterRender }) {
  const root = document.getElementById(mount);
  let pending = false;

  const isTyping = () => {
    const el = document.activeElement;
    return el && root.contains(el) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'checkbox';
  };

  function draw() {
    pending = false;
    const scrollY = window.scrollY;
    root.innerHTML = render();
    if (afterRender) afterRender(root);
    window.scrollTo(0, scrollY);
  }

  /** Re-render now, unless the user is typing: then wait until the field loses focus. */
  function refresh() {
    if (isTyping() || modalOpen()) {
      pending = true;
      return;
    }
    draw();
  }

  function run(name, el, event) {
    const handler = actions[name];
    if (!handler) return false;
    try {
      handler(el, event);
    } catch (err) {
      if (err instanceof ValidationError) toast('error', 'Please check', err.messages.map(esc).join('<br>'));
      else {
        console.error(err);
        toast('error', 'Something went wrong', esc(err.message || String(err)));
      }
    }
    // An action may have saved data while its modal was open, then closed the modal.
    if (pending && !modalOpen() && !isTyping()) draw();
    return true;
  }

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'button') return;
    if (el.dataset.act === 'closeModal') {
      event.preventDefault();
      closeModal();
      if (pending) draw();
      return;
    }
    if (el.dataset.act === 'closeToast') {
      el.closest('.slds-notify').remove();
      return;
    }
    if (run(el.dataset.act, el, event)) event.preventDefault();
  });

  document.addEventListener('change', (event) => {
    const el = event.target;
    if (el.dataset && el.dataset.act && ['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)) run(el.dataset.act, el, event);
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    event.preventDefault();
    if (form.dataset.submit) run(form.dataset.submit, form, event);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalOpen()) {
      closeModal();
      if (pending) draw();
    }
  });

  root.addEventListener('focusout', () => setTimeout(() => {
    if (pending && !isTyping() && !modalOpen()) draw();
  }, 0));

  window.addEventListener('hashchange', () => {
    closeModal();
    draw();
    window.scrollTo(0, 0);
  });

  subscribe(refresh);
  draw();
  return { refresh: draw };
}
