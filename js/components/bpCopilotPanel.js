// P13 Copilot panel: a side panel on every page. Ask questions, run actions (after confirming), see sources.
// Runs as the signed-in user; refuses questions about other firms. Every answer is labelled and can be rated.
// LWC equivalent: c-bp-copilot-panel (Agentforce in the real build).

import { uIcon, toast } from '../core/ui.js';
import { esc } from '../core/util.js';
import { tabSession } from '../core/store.js';
import { askCopilot, runCopilotAction, proxyAvailable, askModel } from '../services/copilotService.js';

const SUGGESTIONS = {
  Agent: ['Show my overdue follow-ups', 'Which new leads are waiting?', 'Who should I call first?', '2BR leads from Meta this week'],
  'Team Leader': ['Which deals are at risk?', 'Show team overdue follow-ups', 'Which new leads are waiting?', 'Re-assign … to …'],
  default: ['Which deals are at risk?', 'How many leads this week?', 'Any overdue commission invoices?', 'How many leads does Palm Arc have?'],
};

const history = () => tabSession.get('copilot', []);
const save = (list) => tabSession.set('copilot', list.slice(-30));

export function bpCopilotPanel(user) {
  const msgs = history();
  const chips = SUGGESTIONS[user.role] || SUGGESTIONS.default;
  return `<aside class="bp-copilot" aria-label="Copilot">
    <header class="bp-copilot-head">${uIcon('sparkles', 'slds-icon_x-small')}<b>Copilot</b><span class="bp-small bp-muted">sees only what you can see</span>
      <button type="button" class="slds-button slds-button_icon" title="Clear" aria-label="Clear conversation" data-act="copilotClear">${uIcon('refresh', 'slds-icon_x-small')}</button>
      <button type="button" class="slds-button slds-button_icon" title="Close" aria-label="Close Copilot" data-act="toggleCopilot">${uIcon('close', 'slds-icon_x-small')}</button></header>
    <div class="bp-copilot-body" id="copilot-body">
      ${msgs.length ? '' : `<div class="bp-copilot-hello"><p>Hi ${esc(user.name.split(' ')[0])}. Ask about your leads, deals and follow-ups, or tell me what to do. I ask before changing anything.</p></div>`}
      ${msgs.map((m, i) => m.role === 'user' ? `<div class="bp-msg-user">${esc(m.text)}</div>` : `<div class="bp-msg-bot ${m.refused ? 'refused' : ''}">
        <div class="bp-ai-tag">${uIcon(m.refused ? 'lock' : 'sparkles', 'slds-icon_xx-small')} ${m.model ? 'Copilot (model)' : 'Copilot'}</div>
        <p>${esc(m.text)}</p>
        ${m.items && m.items.length ? `<ul>${m.items.map((it) => `<li>${it.link ? `<a class="bp-link" href="portal/${esc(it.link)}">${esc(it.label)}</a>` : esc(it.label)}</li>`).join('')}</ul>` : ''}
        ${m.action && !m.done ? `<div class="bp-form-actions"><button type="button" class="slds-button slds-button_brand" data-act="copilotConfirm" data-i="${i}">${esc(m.action.label)}</button><button type="button" class="slds-button slds-button_neutral" data-act="copilotCancel" data-i="${i}">Cancel</button></div>` : ''}
        ${m.done ? `<div class="bp-small bp-ok-text">${uIcon('check', 'slds-icon_xx-small')} ${esc(m.done)}</div>` : ''}
        ${m.sources && m.sources.length && !m.items?.length ? `<div class="bp-small bp-muted">Sources: ${m.sources.map((s) => `<a class="bp-link" href="portal/${esc(s.link)}">${esc(s.label)}</a>`).join(', ')}</div>` : ''}
        ${m.thinking ? '<div class="bp-small bp-muted">Thinking…</div>' : `<div class="bp-copilot-rate">${m.rated ? `<span class="bp-small bp-muted">Thanks for rating.</span>` : `<button type="button" class="bp-rate" data-act="copilotRate" data-i="${i}" data-v="up" aria-label="Helpful">👍</button><button type="button" class="bp-rate" data-act="copilotRate" data-i="${i}" data-v="down" aria-label="Not helpful">👎</button>`}</div>`}
      </div>`).join('')}
    </div>
    <div class="bp-copilot-chips">${chips.map((c) => `<button type="button" class="bp-pill" data-act="copilotChip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <form class="bp-copilot-form" data-submit="copilotAsk"><label class="slds-assistive-text" for="copilot-q">Ask the Copilot</label>
      <input class="slds-input" id="copilot-q" name="q" autocomplete="off" placeholder="Ask or tell me what to do…" maxlength="300">
      <button type="submit" class="slds-button slds-button_brand">Ask</button></form>
  </aside>`;
}

/** Scrolls the conversation to the latest message after each render. */
export function copilotAfterRender() {
  const b = document.getElementById('copilot-body');
  if (b) b.scrollTop = b.scrollHeight;
}

export const copilotActions = (getActor, refresh) => {
  const ask = (q) => {
    const text = String(q || '').trim();
    if (!text) return;
    const actor = getActor();
    const answer = askCopilot(actor, text);
    const list = [...history(), { role: 'user', text }, { role: 'bot', ...answer }];
    save(list);
    refresh();
    // Free-form questions the built-in engine can't answer go to the model when the site has the proxy.
    if (answer.unknown) {
      proxyAvailable().then(async (ok) => {
        if (!ok) return;
        const l2 = history();
        l2[l2.length - 1] = { role: 'bot', text: 'Let me check…', thinking: true, sources: [] };
        save(l2);
        refresh();
        try {
          const m = await askModel(getActor(), text);
          const l3 = history();
          l3[l3.length - 1] = { role: 'bot', ...m };
          save(l3);
        } catch (err) {
          const l3 = history();
          l3[l3.length - 1] = { role: 'bot', ...answer };
          save(l3);
        }
        refresh();
      });
    }
  };
  return {
    copilotAsk(form) { const q = new FormData(form).get('q'); ask(q); setTimeout(() => document.getElementById('copilot-q')?.focus(), 0); },
    copilotChip(el) {
      if (el.dataset.q.includes('…')) { const i = document.getElementById('copilot-q'); i.value = 'Re-assign '; i.focus(); return; }
      ask(el.dataset.q);
    },
    copilotConfirm(el) {
      const list = history();
      const m = list[Number(el.dataset.i)];
      if (!m || !m.action) return;
      runCopilotAction(getActor(), m.action);
      m.done = `${m.action.label}: done. Logged with your approval.`;
      save(list);
      toast('success', 'Done', m.done);
    },
    copilotCancel(el) { const list = history(); const m = list[Number(el.dataset.i)]; if (m) { m.done = 'Cancelled. Nothing changed.'; save(list); refresh(); } },
    copilotRate(el) { const list = history(); const m = list[Number(el.dataset.i)]; if (m) { m.rated = el.dataset.v; save(list); refresh(); } },
    copilotClear() { save([]); refresh(); },
  };
};
