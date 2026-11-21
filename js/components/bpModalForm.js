// Modal form helpers: a form inside the modal body, a submit button in the footer, and service
// validation errors shown inside the modal (not as a toast) so the user can fix them in place.
// LWC equivalent: lightning-modal with a lightning-record-edit-form-like body and an errors region.

import { showModalErrors, closeModal, toast } from '../core/ui.js';
import { ValidationError, esc } from '../core/util.js';

export const modalForm = (formId, submitAct, body) => `<div id="modal-errors"></div><form id="${esc(formId)}" data-submit="${esc(submitAct)}" novalidate>${body}</form>`;

export const modalFooter = (formId, label, { variant = 'brand', extra = '' } = {}) =>
  `${extra}<button type="button" class="slds-button slds-button_neutral" data-act="closeModal">Cancel</button>
   <button type="submit" form="${esc(formId)}" class="slds-button slds-button_${variant}">${esc(label)}</button>`;

/**
 * Runs a service call for a modal: validation problems stay in the modal; success closes it and toasts.
 * Returns the service result, or undefined when validation failed.
 */
export function submitModal(fn, { title, message = '' } = {}) {
  try {
    const result = fn();
    closeModal();
    if (title) toast('success', title, typeof message === 'function' ? message(result) : message);
    return result;
  } catch (err) {
    if (err instanceof ValidationError) {
      showModalErrors(err.messages);
      return undefined;
    }
    throw err;
  }
}
