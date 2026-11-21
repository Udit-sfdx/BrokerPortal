// Owner setup wizard (P1): brand → teams → lead rules → invite team → go live.
// LWC equivalent: c-bp-onboarding-wizard composed of c-bp-stepper and c-bp-invite-rows.

import { pageHeader, card, stepper, field, toggle, formErrors, button, toast, uIcon, alertBox } from '../core/ui.js';
import { esc } from '../core/util.js';
import { tabSession, getState } from '../core/store.js';
import { BRAND_COLOURS } from '../core/config.js';
import { firmOf, saveBranding, saveTeams, saveRules, setGoLive, finishSetup, seatsUsed } from '../services/firmService.js';
import { bpInviteRows, captureRows, setRows, emptyRow } from './bpInviteRows.js';
import { peopleActions } from './bpPeopleAdmin.js';
import { go } from '../core/app.js';

const STEPS = ['Brand', 'Teams', 'Lead rules', 'Invite your team', 'Go live'];
const GOLIVE = [
  ['propertyFinder', 'Property Finder connected', 'Leads from your listings arrive automatically'],
  ['bayut', 'Bayut and Dubizzle connected', 'Leads from your listings arrive automatically'],
  ['whatsapp', 'WhatsApp Business connected', 'Approved templates and two-way chat'],
  ['firstLead', 'First lead received', 'Send a test enquiry to check routing'],
];

const state = () => tabSession.get('onboard', { step: 0, errors: [] });
const setState = (patch) => tabSession.set('onboard', { ...state(), ...patch });

function stepBrand(firm) {
  const brand = tabSession.get('onboard:brand', firm.brand);
  return `<p class="bp-muted slds-m-bottom_small">Your logo and colour appear on every page your team sees.</p>
    <div class="slds-grid" style="gap:24px;align-items:flex-start">
      <div>${field('logoText', 'Logo initials (until you upload a logo)', { value: firm.logoText || firm.name.split(' ').map((w) => w[0]).join('').slice(0, 2), attrs: 'maxlength="3" style="width:120px;text-transform:uppercase"' })}
        <label class="slds-form-element__label">Brand colour</label>
        <div class="bp-swatches">${BRAND_COLOURS.map((c) => `<span class="bp-swatch ${c === brand ? 'is-selected' : ''}" style="background:${c}" data-act="pickBrand" data-colour="${c}" title="${c}" role="radio" aria-checked="${c === brand}" tabindex="0"></span>`).join('')}</div></div>
      <div class="bp-preview" style="--bp-brand:${esc(brand)}"><div class="bp-preview-bar"><span class="bp-logo">${esc(firm.logoText || firm.name.slice(0, 2).toUpperCase())}</span><b>${esc(firm.name)}</b></div><div class="bp-preview-body"><span class="bp-preview-btn">Primary button</span></div></div>
    </div>`;
}

function stepTeams(firm) {
  const names = tabSession.get('onboard:teams', firm.teams.length ? firm.teams.map((t) => t.name) : ['Sales team']);
  return `<p class="bp-muted slds-m-bottom_small">Teams group agents under a team leader, who sees the team's leads and deals.</p>
    <div id="team-list">${names.map((n, i) => `<div class="slds-grid slds-grid_vertical-align-end slds-m-bottom_x-small" style="gap:8px">
      <div style="flex:1">${field(`team-${i}`, `Team ${i + 1}`, { value: n, attrs: 'maxlength="40" data-team-input' })}</div>
      <button type="button" class="slds-button slds-button_icon slds-button_icon-border slds-m-bottom_small" title="Remove team" data-act="removeTeam" data-idx="${i}"><svg class="slds-button__icon"><use href="assets/vendor/icons/utility-sprite/svg/symbols.svg#delete"></use></svg></button></div>`).join('')}</div>
    ${button('Add team', 'addTeam', { icon: 'add' })}`;
}

function stepRules(firm) {
  const s = firm.settings;
  return `<p class="bp-muted slds-m-bottom_small">How new leads are shared out and how fast agents must respond. You can change these later.</p>
    <div class="slds-grid slds-wrap slds-gutters_x-small" style="max-width:520px">
      <div class="slds-col slds-size_1-of-2">${field('firstResponseMin', 'First response within (minutes)', { value: s.sla.firstResponseMin, type: 'number', attrs: 'min="1" max="240"' })}</div>
      <div class="slds-col slds-size_1-of-2">${field('reassignAfterMin', 'Re-assign after breach (minutes)', { value: s.sla.reassignAfterMin, type: 'number', attrs: 'min="1" max="480"' })}</div>
    </div>
    <div class="slds-m-top_small">${s.routing.map((r) => `<div class="slds-m-bottom_x-small">${toggle(`${esc(r.label)}${r.hard ? ' <span class="bp-muted bp-small">(required by RERA)</span>' : ''}`, r.on, 'noop', { attrs: `data-rule="${r.id}"`, disabled: !!r.hard })}</div>`).join('')}</div>
    <p class="bp-small bp-muted slds-m-top_small">Calls are always limited to 09:00–18:00 GST and blocked for numbers on the DNC registry (UAE Cabinet Resolution 56/2024).</p>`;
}

function stepInvite(actor, firm) {
  return `<p class="bp-muted slds-m-bottom_small">Invite the people who'll use Broker Portal. ${seatsUsed(firm.id)} of ${firm.seats} seats used. You can skip this and invite people later from People.</p>
    <div id="invite-rows-host">${bpInviteRows(actor, tabSession.get('onboard:inviteErrors', []))}</div>`;
}

function stepGoLive(firm) {
  const g = firm.settings.golive;
  const done = Object.values(g).filter(Boolean).length;
  return `<p class="bp-muted slds-m-bottom_small">Connect your lead sources. ${done} of ${GOLIVE.length} done; you can finish setup now and connect the rest later.</p>
    <ul class="bp-list">${GOLIVE.map(([key, label, sub]) => `<li>${g[key] ? `<span class="slds-badge slds-theme_success">${uIcon('check', 'slds-icon_xx-small')}</span>` : '<span class="slds-badge">To do</span>'}
      <div style="flex:1"><b>${label}</b><div class="bp-small bp-muted">${sub}</div></div>
      ${button(g[key] ? 'Undo' : key === 'firstLead' ? 'Send test lead' : 'Connect (demo)', 'toggleGoLive', { attrs: `data-key="${key}"` })}</li>`).join('')}</ul>`;
}

export function bpOnboardingWizard(actor) {
  const firm = firmOf(actor);
  if (actor.role !== 'Owner') return card('Setup', alertBox('info', 'Only the firm owner can set up the firm.'));
  if (firm.setupComplete) return card('Setup', `${alertBox('success', 'Setup is complete.')}<a class="slds-button slds-button_neutral slds-m-top_small" href="portal/#/home">Go to Home</a>`);
  const st = state();
  const body = [() => stepBrand(firm), () => stepTeams(firm), () => stepRules(firm), () => stepInvite(actor, firm), () => stepGoLive(firm)][st.step]();
  const last = st.step === STEPS.length - 1;
  return pageHeader('custom', `Welcome to Broker Portal, ${actor.name.split(' ')[0]}`, `Set up ${esc(firm.name)}`, { meta: 'About 5 minutes. Everything can be changed later in Firm settings.' })
    + card('', `${stepper(STEPS, st.step)}${formErrors(st.errors)}<div id="wizard-body">${body}</div>`, {
      footer: `<div class="slds-grid slds-grid_align-spread">${st.step ? button('Back', 'onboardBack') : '<span></span>'}
        <span>${st.step === 3 ? button('Skip for now', 'onboardSkip', { variant: 'neutral' }) : ''} ${button(last ? 'Finish setup' : st.step === 3 ? 'Send invitations and continue' : 'Save and continue', last ? 'onboardFinish' : 'onboardNext', { variant: 'brand' })}</span></div>`,
    });
}

function readTeams() {
  return [...document.querySelectorAll('[data-team-input]')].map((el) => el.value);
}

export function onboardingActions(getActor) {
  const people = peopleActions(getActor);
  const redraw = () => go('onboarding');
  return {
    pickBrand(el) {
      tabSession.set('onboard:brand', el.dataset.colour);
      redraw();
    },
    addTeam() {
      tabSession.set('onboard:teams', [...readTeams(), '']);
      redraw();
    },
    removeTeam(el) {
      const names = readTeams();
      names.splice(Number(el.dataset.idx), 1);
      tabSession.set('onboard:teams', names);
      redraw();
    },
    noop() {},
    toggleGoLive(el) {
      const actor = getActor();
      const firm = firmOf(actor);
      setGoLive(actor, el.dataset.key, !firm.settings.golive[el.dataset.key]);
      toast('success', 'Checklist updated');
    },
    onboardBack() {
      setState({ step: Math.max(0, state().step - 1), errors: [] });
      redraw();
    },
    onboardSkip() {
      setRows([emptyRow()]);
      tabSession.set('onboard:inviteErrors', []);
      setState({ step: 4, errors: [] });
      redraw();
    },
    onboardNext() {
      const actor = getActor();
      const st = state();
      try {
        if (st.step === 0) {
          saveBranding(actor, { brand: tabSession.get('onboard:brand', firmOf(actor).brand), logoText: document.getElementById('logoText').value });
        } else if (st.step === 1) {
          saveTeams(actor, readTeams());
          tabSession.set('onboard:teams', null);
        } else if (st.step === 2) {
          const routing = {};
          document.querySelectorAll('[data-rule]').forEach((el) => { routing[el.dataset.rule] = el.checked; });
          saveRules(actor, { firstResponseMin: document.getElementById('firstResponseMin').value, reassignAfterMin: document.getElementById('reassignAfterMin').value, routing });
        } else if (st.step === 3) {
          const rows = captureRows().filter((r) => r.name || r.email);
          if (rows.length) {
            const created = people.sendInvites();
            if (!created) return;
          }
          tabSession.set('onboard:inviteErrors', []);
        }
        setState({ step: st.step + 1, errors: [] });
      } catch (err) {
        if (!err.messages) throw err;
        setState({ errors: err.messages });
      }
      redraw();
    },
    onboardFinish() {
      const actor = getActor();
      try {
        finishSetup(actor);
        tabSession.set('onboard', null);
        toast('success', 'Your firm is set up', `Welcome aboard, ${esc(getState().firms.find((f) => f.id === actor.firmId).name)}.`);
        go('home');
      } catch (err) {
        if (!err.messages) throw err;
        setState({ errors: err.messages });
        redraw();
      }
    },
  };
}
