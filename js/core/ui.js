// Rendering helpers shared by every component: SLDS markup builders, toasts and modals.
// Components return HTML strings; actions are wired by the app through data-act attributes.

import { esc, initials } from './util.js';

const SPRITE = {
  utility: 'assets/vendor/icons/utility-sprite/svg/symbols.svg',
  standard: 'assets/vendor/icons/standard-sprite/svg/symbols.svg',
};

/* ---------- icons ---------- */

export const uIcon = (name, cls = 'slds-icon_x-small slds-icon-text-default') =>
  `<svg class="slds-icon ${cls}" aria-hidden="true"><use href="${SPRITE.utility}#${name}"></use></svg>`;

export const bIcon = (name, pos = 'left') =>
  `<svg class="slds-button__icon slds-button__icon_${pos}" aria-hidden="true"><use href="${SPRITE.utility}#${name}"></use></svg>`;

export const bIconOnly = (name) =>
  `<svg class="slds-button__icon" aria-hidden="true"><use href="${SPRITE.utility}#${name}"></use></svg>`;

export const sIcon = (name, size = 'small') =>
  `<span class="slds-icon_container slds-icon-standard-${name.replace(/_/g, '-')}"><svg class="slds-icon slds-icon_${size}" aria-hidden="true"><use href="${SPRITE.standard}#${name}"></use></svg></span>`;

export const avatar = (name, colour = '#0b5cab', size = 32) =>
  `<span class="bp-avatar" style="--bp-av:${esc(colour)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px" aria-hidden="true">${esc(initials(name))}</span>`;

/* ---------- small building blocks ---------- */

const BADGE_THEMES = {
  success: 'slds-theme_success',
  warning: 'slds-theme_warning',
  error: 'slds-theme_error',
  inverse: 'slds-badge_inverse',
  light: 'slds-badge_lightest',
  info: 'bp-badge-info',
};

export const badge = (text, theme = '') => `<span class="slds-badge ${BADGE_THEMES[theme] || ''}">${esc(text)}</span>`;

const STATUS_THEME = {
  Active: 'success', Trial: 'info', 'Pending verification': 'warning', 'Needs information': 'warning', Suspended: 'error',
  Offboarded: 'light', Requested: 'warning', Declined: 'light', Invited: 'info', Pending: 'warning', Deactivated: 'light',
  Expired: 'light', Used: 'success', Revoked: 'light', Rejected: 'error',
};
export const statusBadge = (status) => badge(status, STATUS_THEME[status] || '');

export function card(title, body, { actions = '', icon = '', footer = '', cls = '' } = {}) {
  return `<article class="slds-card bp-card ${cls}">
    <div class="slds-card__header slds-grid"><header class="slds-media slds-media_center slds-has-flexi-truncate">
      ${icon ? `<div class="slds-media__figure">${sIcon(icon)}</div>` : ''}
      <div class="slds-media__body"><h2 class="slds-card__header-title"><span class="slds-truncate">${title}</span></h2></div>
      ${actions ? `<div class="slds-no-flex">${actions}</div>` : ''}
    </header></div>
    <div class="slds-card__body slds-card__body_inner">${body}</div>
    ${footer ? `<footer class="slds-card__footer">${footer}</footer>` : ''}
  </article>`;
}

export function pageHeader(icon, kicker, title, { actions = '', meta = '' } = {}) {
  return `<div class="slds-page-header bp-page-header">
    <div class="slds-page-header__row"><div class="slds-page-header__col-title"><div class="slds-media">
      <div class="slds-media__figure">${sIcon(icon, 'medium')}</div>
      <div class="slds-media__body"><div class="slds-page-header__name"><div class="slds-page-header__name-title"><h1>
        <span>${esc(kicker)}</span><span class="slds-page-header__title slds-truncate">${title}</span></h1></div></div>
        ${meta ? `<p class="slds-page-header__name-meta">${meta}</p>` : ''}</div></div></div>
      ${actions ? `<div class="slds-page-header__col-actions"><div class="slds-page-header__controls"><div class="slds-page-header__control">${actions}</div></div></div>` : ''}
    </div></div>`;
}

export const button = (label, act, { variant = 'neutral', icon = '', attrs = '', disabled = false } = {}) =>
  `<button type="button" class="slds-button slds-button_${variant}" data-act="${esc(act)}" ${attrs} ${disabled ? 'disabled' : ''}>${icon ? bIcon(icon) : ''}${esc(label)}</button>`;

export const emptyState = (title, text, action = '') =>
  `<div class="bp-empty"><div class="bp-empty-title">${esc(title)}</div><p>${esc(text)}</p>${action}</div>`;

export const comingSoon = (title, drop, bullets) =>
  `<div class="bp-coming">${sIcon('custom')}<h2 class="slds-text-heading_medium slds-m-top_small">${esc(title)}</h2>
   <p class="bp-muted slds-m-vertical_x-small">Arrives in drop ${drop}. It will include:</p>
   <ul class="slds-list_dotted bp-small">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`;

/** Horizontal step indicator for wizards. steps: [{label}], current index, completed up to current-1. */
export function stepper(steps, current) {
  return `<ol class="bp-stepper">${steps.map((s, i) => {
    const state = i < current ? 'done' : i === current ? 'current' : 'todo';
    return `<li class="bp-step bp-step-${state}"><span class="bp-step-dot">${i < current ? uIcon('check', 'slds-icon_xx-small') : i + 1}</span><span class="bp-step-label">${esc(s)}</span></li>`;
  }).join('')}</ol>`;
}

export function tabs(list, active, act) {
  return `<div class="slds-tabs_default"><ul class="slds-tabs_default__nav" role="tablist">${list.map(([id, label]) =>
    `<li class="slds-tabs_default__item ${id === active ? 'slds-is-active' : ''}" role="presentation"><a class="slds-tabs_default__link" role="tab" aria-selected="${id === active}" data-act="${esc(act)}" data-id="${esc(id)}">${esc(label)}</a></li>`).join('')}</ul></div>`;
}

export const alertBox = (kind, html) => {
  const cls = { error: 'slds-alert_error', warning: 'slds-alert_warning', info: 'slds-alert_offline bp-alert-info', success: 'bp-alert-success' }[kind] || '';
  return `<div class="slds-notify slds-notify_alert ${cls}" role="alert"><h2>${html}</h2></div>`;
};

/* ---------- form fields ---------- */

const req = (required) => (required ? '<abbr class="slds-required" title="required">* </abbr>' : '');

export function field(id, label, { value = '', type = 'text', required = false, attrs = '', help = '', error = '' } = {}) {
  return `<div class="slds-form-element ${error ? 'slds-has-error' : ''} slds-m-bottom_small">
    <label class="slds-form-element__label" for="${id}">${req(required)}${esc(label)}</label>
    <div class="slds-form-element__control"><input class="slds-input" id="${id}" name="${id}" type="${type}" value="${esc(value)}" ${attrs}></div>
    ${help ? `<div class="slds-form-element__help bp-help">${esc(help)}</div>` : ''}
    ${error ? `<div class="slds-form-element__help">${esc(error)}</div>` : ''}
  </div>`;
}

export function textarea(id, label, { value = '', required = false, attrs = '' } = {}) {
  return `<div class="slds-form-element slds-m-bottom_small"><label class="slds-form-element__label" for="${id}">${req(required)}${esc(label)}</label>
    <div class="slds-form-element__control"><textarea class="slds-textarea" id="${id}" name="${id}" ${attrs}>${esc(value)}</textarea></div></div>`;
}

export function select(id, label, options, { value = '', required = false, attrs = '' } = {}) {
  const opts = options.map((o) => {
    const [v, t] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`;
  }).join('');
  return `<div class="slds-form-element slds-m-bottom_small"><label class="slds-form-element__label" for="${id}">${req(required)}${esc(label)}</label>
    <div class="slds-form-element__control"><div class="slds-select_container"><select class="slds-select" id="${id}" name="${id}" ${attrs}>${opts}</select></div></div></div>`;
}

export function checkbox(id, label, { checked = false, attrs = '' } = {}) {
  return `<div class="slds-form-element slds-m-bottom_x-small"><div class="slds-form-element__control"><div class="slds-checkbox">
    <input type="checkbox" id="${id}" name="${id}" ${checked ? 'checked' : ''} ${attrs}>
    <label class="slds-checkbox__label" for="${id}"><span class="slds-checkbox_faux"></span><span class="slds-form-element__label">${label}</span></label>
  </div></div></div>`;
}

export function toggle(label, checked, act, { attrs = '', disabled = false } = {}) {
  return `<div class="slds-form-element"><label class="slds-checkbox_toggle slds-grid"><span class="slds-form-element__label slds-m-bottom_none">${label}</span>
    <input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} data-act="${esc(act)}" ${attrs}>
    <span class="slds-checkbox_faux_container"><span class="slds-checkbox_faux"></span><span class="slds-checkbox_on">On</span><span class="slds-checkbox_off">Off</span></span></label></div>`;
}

export const formErrors = (messages) =>
  messages && messages.length
    ? `<div class="slds-notify slds-notify_alert slds-alert_error slds-m-bottom_small bp-form-errors" role="alert"><h2>${messages.map(esc).join('<br>')}</h2></div>`
    : '';

/** Reads named inputs inside a container into a plain object (checkboxes → booleans). */
export function readForm(root) {
  const out = {};
  if (!root) return out;
  root.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type !== 'file') out[el.name] = el.value;
  });
  return out;
}

/* ---------- toast & modal ---------- */

export function toast(kind, title, message = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const icon = { success: 'success', warning: 'warning', error: 'error', info: 'info' }[kind] || 'info';
  const el = document.createElement('div');
  el.className = `slds-notify slds-notify_toast slds-theme_${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="slds-icon_container slds-m-right_small slds-no-flex slds-align-top">${uIcon(icon, `slds-icon_small${kind === 'warning' ? ' slds-icon-text-default' : ''}`)}</span>
    <div class="slds-notify__content"><h2 class="slds-text-heading_small">${esc(title)}</h2>${message ? `<p>${message}</p>` : ''}</div>
    <div class="slds-notify__close"><button type="button" class="slds-button slds-button_icon ${kind === 'warning' ? '' : 'slds-button_icon-inverse'}" title="Close" data-act="closeToast">${bIconOnly('close')}</button></div>`;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => el.remove(), 5500);
}

export function openModal(title, body, footer = '', size = '') {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="bp-modal-title" class="slds-modal slds-fade-in-open ${size ? `slds-modal_${size}` : ''}">
    <div class="slds-modal__container">
      <button type="button" class="slds-button slds-button_icon slds-modal__close" title="Close" data-act="closeModal">${bIconOnly('close')}</button>
      <div class="slds-modal__header"><h1 id="bp-modal-title" class="slds-modal__title slds-hyphenate">${title}</h1></div>
      <div class="slds-modal__content slds-p-around_medium" id="modal-body">${body}</div>
      <div class="slds-modal__footer">${footer || '<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Close</button>'}</div>
    </div></section><div class="slds-backdrop slds-backdrop_open"></div>`;
  const first = root.querySelector('input, select, textarea');
  if (first) first.focus();
}

export const closeModal = () => {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
};

export const modalOpen = () => !!document.querySelector('#modal-root .slds-modal');

export function showModalErrors(messages) {
  const el = document.getElementById('modal-errors');
  if (el) el.innerHTML = formErrors(messages);
}

/** Spinner block used while a simulated API call runs. */
export const spinner = (label) =>
  `<div class="bp-spinner-row"><div role="status" class="slds-spinner slds-spinner_small slds-spinner_brand bp-inline-spinner"><span class="slds-assistive-text">${esc(label)}</span><div class="slds-spinner__dot-a"></div><div class="slds-spinner__dot-b"></div></div><span>${esc(label)}</span></div>`;
