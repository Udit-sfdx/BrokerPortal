// Firm Copilot: answers questions and proposes actions across the portal, as the asking user.
// Prompts are built only from records this user can already see; questions about other firms are refused.
// Every answer lists its sources; every change needs the user's confirmation and is written to the audit log.
// Works offline with a built-in intent engine; when the site has the PHP proxy (api/copilot.php on Hostinger)
// free-form questions also go to the model, with the same user-scoped context.

import { getState, now, mutate, audit } from '../core/store.js';
import { fmtAED, fmtDuration, fmtDateTime, DAY } from '../core/util.js';
import { slaState, dealRisks, scoreBand } from '../core/rules.js';
import { firmOf } from './firmService.js';
import { visibleLeads, isOpenLead, assignableUsers, assignLeads, myTasks } from './leadService.js';
import { visibleDeals, canManageCommission } from './dealService.js';
import { searchAll } from './searchService.js';

const MANAGERS = ['Owner', 'Director', 'Team Leader'];
const lower = (s) => String(s || '').toLowerCase();
const leadSrc = (l) => ({ label: `${l.name} · ${l.status}`, link: `#/lead/${l.id}` });
const dealSrc = (d) => ({ label: `${d.clientName} · ${d.stage}`, link: `#/deal/${d.id}` });

/** Names of other firms on the platform (to refuse questions about them). */
function otherFirmMentioned(actor, q) {
  const s = getState();
  const mine = firmOf(actor);
  const text = lower(q);
  const hit = s.firms.find((f) => f.id !== mine.id && [f.name, f.name.split(' ').slice(0, 2).join(' ')].some((n) => n.length > 4 && text.includes(lower(n))));
  if (hit) return hit;
  if (/\b(other|another|competitor'?s?|rival)\s+(firm|brokerage|agency|agencies|firms)\b/.test(text)) return { name: 'another firm' };
  return null;
}

/** Finds a person in the actor's assignable list by first or full name. */
const findPerson = (actor, name) => assignableUsers(actor).find((u) => lower(u.name) === lower(name) || lower(u.name).split(' ')[0] === lower(name).split(' ')[0]);

/**
 * Answers a question. Returns { text, items?: [{label, link}], sources: [{label, link}], action?, refused? }.
 * action = { kind, label, ...params } awaiting confirmation via runCopilotAction.
 */
export function askCopilot(actor, question) {
  const q = lower(question).trim();
  const t = now();
  const firm = firmOf(actor);
  if (!q) return { text: 'Ask me about your leads, deals, follow-ups or commission, or tell me what to do.', sources: [] };
  const other = otherFirmMentioned(actor, q);
  if (other) {
    return { refused: true, text: `I can't help with ${other.name}. I only use ${firm.name} records that you can see, and I never share or compare another firm's data.`, sources: [] };
  }
  const leads = visibleLeads(actor);
  const open = leads.filter(isOpenLead);

  // Action: re-assign <lead> to <person>
  const m = q.match(/^(?:please\s+)?(?:re-?assign|assign|give|move)\s+(.+?)\s+to\s+(.+?)[.!?]*$/);
  if (m) {
    if (!MANAGERS.includes(actor.role)) return { text: 'Only team leaders, directors and the owner can re-assign leads.', sources: [] };
    const who = m[1].replace(/^(the\s+)?lead\s+/, '').replace(/'s lead$/, '');
    const lead = open.find((l) => lower(l.name) === who) || open.find((l) => lower(l.name).startsWith(who)) || open.find((l) => lower(l.name).split(' ')[0] === who.split(' ')[0]);
    const person = findPerson(actor, m[2]);
    if (!lead) return { text: `I couldn't find an open lead called "${m[1]}" among the leads you can see.`, sources: [] };
    if (!person) return { text: `"${m[2]}" isn't someone you can assign to. Only active agents with a valid BRN${actor.role === 'Team Leader' ? ' in your team' : ''} can take leads.`, sources: [leadSrc(lead)] };
    if (lead.ownerId === person.id) return { text: `${lead.name} is already with ${person.name}.`, sources: [leadSrc(lead)] };
    const from = getState().users.find((u) => u.id === lead.ownerId);
    return {
      text: `Re-assign ${lead.name} (${lead.interest}) from ${from ? from.name : 'unassigned'} to ${person.name}? ${person.name.split(' ')[0]} will be notified.`,
      sources: [leadSrc(lead)], action: { kind: 'assign', label: `Re-assign to ${person.name}`, leadId: lead.id, toUserId: person.id },
    };
  }

  if (/overdue|follow.?ups?/.test(q)) {
    const team = MANAGERS.includes(actor.role) && /team/.test(q);
    const teamIds = new Set(getState().users.filter((u) => u.firmId === actor.firmId && (actor.role !== 'Team Leader' || u.teamId === actor.teamId)).map((u) => u.id));
    const tasks = (team ? getState().tasks.filter((k) => k.firmId === actor.firmId && teamIds.has(k.ownerId)) : myTasks(actor)).filter((k) => !k.done && k.dueAt < t).sort((a, b) => a.dueAt - b.dueAt);
    const overdueLeads = open.filter((l) => l.nextFollowUpAt && l.nextFollowUpAt < t && (actor.role !== 'Agent' || l.ownerId === actor.id));
    const list = tasks.length ? tasks.slice(0, 8).map((k) => ({ label: `${k.title} · due ${fmtDateTime(k.dueAt)}`, link: k.leadId ? `#/lead/${k.leadId}` : '#/home' })) : overdueLeads.slice(0, 8).map((l) => ({ label: `${l.name} · follow-up due ${fmtDateTime(l.nextFollowUpAt)}`, link: `#/lead/${l.id}` }));
    const n = tasks.length || overdueLeads.length;
    return { text: n ? `${team ? 'Your team has' : 'You have'} ${n} overdue follow-up${n === 1 ? '' : 's'}. Oldest first:` : 'No overdue follow-ups. Nice.', items: list, sources: list };
  }
  if (/(new|waiting|first (reply|response)|sla|uncontacted)/.test(q) && /lead/.test(q)) {
    const w = open.filter((l) => ['running', 'breached'].includes(slaState(l, t).state)).sort((a, b) => a.slaDueAt - b.slaDueAt);
    const items = w.slice(0, 8).map((l) => ({ label: `${l.name} · ${l.source} · ${slaState(l, t).state === 'breached' ? `${fmtDuration(t - l.slaDueAt)} late` : `${fmtDuration(l.slaDueAt - t)} left`}`, link: `#/lead/${l.id}` }));
    return { text: w.length ? `${w.length} lead${w.length === 1 ? ' is' : 's are'} waiting for a first reply (${w.filter((l) => slaState(l, t).state === 'breached').length} past the ${firm.settings.sla.firstResponseMin}-minute SLA):` : 'Every lead has had a first reply.', items, sources: items };
  }
  if (/hot|best leads|top leads|who should i call/.test(q)) {
    const hot = open.filter((l) => l.score >= 70).sort((a, b) => b.score - a.score);
    const items = hot.slice(0, 8).map((l) => ({ label: `${l.name} · ${l.score} · ${l.interest}`, link: `#/lead/${l.id}` }));
    return { text: hot.length ? `${hot.length} hot lead${hot.length === 1 ? '' : 's'} (score 70+). Top of the list:` : 'No hot leads right now. Your warmest:', items: items.length ? items : open.sort((a, b) => b.score - a.score).slice(0, 5).map((l) => ({ label: `${l.name} · ${l.score} (${scoreBand(l.score)})`, link: `#/lead/${l.id}` })), sources: items };
  }
  const deals = visibleDeals(actor);
  if (/risk|stuck|blocked/.test(q)) {
    const risky = deals.map((d) => ({ d, r: dealRisks(d, t) })).filter((x) => x.r.length);
    const items = risky.slice(0, 8).map(({ d, r }) => ({ label: `${d.clientName}: ${r[0]}`, link: `#/deal/${d.id}` }));
    return { text: risky.length ? `${risky.length} deal${risky.length === 1 ? ' is' : 's are'} at risk:` : 'All deals are on track.', items, sources: items };
  }
  if (/pipeline|deals? (worth|value)|how much.*(deal|pipeline)/.test(q)) {
    const openDeals = deals.filter((d) => !['Won', 'Lost'].includes(d.stage));
    const byType = {};
    openDeals.forEach((d) => { byType[d.type] = (byType[d.type] || 0) + d.value; });
    return { text: `${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'} worth ${fmtAED(openDeals.reduce((n, d) => n + d.value, 0))}: ${Object.entries(byType).map(([k, v]) => `${k} ${fmtAED(v)}`).join(', ') || 'none'}.`, sources: [{ label: 'Pipeline', link: '#/pipeline' }] };
  }
  if (/commission|invoice|payout|collect/.test(q)) {
    if (!canManageCommission(actor)) {
      const mine = deals.filter((d) => d.ownerId === actor.id && d.stage === 'Won');
      return { text: `You have ${mine.length} won deal${mine.length === 1 ? '' : 's'}. Commission figures are managed by finance; ask your director for your payout statement.`, sources: mine.slice(0, 5).map(dealSrc) };
    }
    const overdue = deals.filter((d) => d.stage === 'Won' && d.commission.status === 'Invoiced' && d.commission.invoiceDueAt < t);
    const items = overdue.map((d) => ({ label: `${d.clientName} · ${d.unit.developer || d.commission.payer} · ${Math.floor((t - d.commission.invoiceDueAt) / DAY)} days overdue`, link: `#/deal/${d.id}/commission` }));
    return { text: overdue.length ? `${overdue.length} commission invoice${overdue.length === 1 ? ' is' : 's are'} overdue:` : 'No overdue commission invoices.', items, sources: [{ label: 'Commission ledger', link: '#/commission' }, ...items] };
  }
  if (/how many leads|leads (this|today|last)|lead count/.test(q)) {
    const days = /today/.test(q) ? 1 : /month|30/.test(q) ? 30 : 7;
    const n = leads.filter((l) => t - l.createdAt < days * DAY);
    const bySource = {};
    n.forEach((l) => { bySource[l.source] = (bySource[l.source] || 0) + 1; });
    return { text: `${n.length} lead${n.length === 1 ? '' : 's'} ${days === 1 ? 'today' : `in the last ${days} days`}${n.length ? `: ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}.`, sources: [{ label: 'Leads inbox', link: '#/leads' }] };
  }
  if (/kyc|screening|compliance/.test(q) && ['Owner', 'Director', 'Compliance'].includes(actor.role)) {
    const kyc = deals.filter((d) => d.kyc.status === 'Submitted');
    const items = kyc.map((d) => ({ label: `${d.clientName} · KYC waiting`, link: `#/deal/${d.id}/kyc` }));
    return { text: `${kyc.length} KYC review${kyc.length === 1 ? '' : 's'} waiting.`, items, sources: [{ label: 'Compliance centre', link: '#/compliance' }] };
  }
  // Fallback: plain search.
  const found = searchAll(actor, question);
  const items = found.groups.filter((g) => g.label !== 'Go to and actions').flatMap((g) => g.items).slice(0, 8).map((i) => ({ label: `${i.label} · ${i.sub}`, link: i.link }));
  if (items.length) return { text: `Here's what I found${found.parsed.length ? ` for ${found.parsed.join(', ')}` : ''}:`, items, sources: items };
  return {
    text: 'I can answer questions about your leads, deals, follow-ups, pipeline and commission, and re-assign leads. Try: "show my overdue follow-ups", "which deals are at risk?", "2BR leads from Meta this week" or "re-assign Ahmed to Omar".',
    sources: [], unknown: true,
  };
}

/** Runs a confirmed action and records who approved it. */
export function runCopilotAction(actor, action) {
  if (action.kind === 'assign') {
    const n = assignLeads(actor, [action.leadId], action.toUserId);
    mutate(() => audit(actor.name, 'Copilot action', `${action.label} (lead ${action.leadId}), approved by ${actor.name}.`, actor.firmId));
    return n;
  }
  throw new Error('Unknown Copilot action.');
}

/**
 * Context for the model (proxy mode): only the asker's own visible records, trimmed. Never other firms.
 */
export function copilotContext(actor) {
  const t = now();
  const firm = firmOf(actor);
  const leads = visibleLeads(actor).filter(isOpenLead).sort((a, b) => b.score - a.score).slice(0, 25);
  const deals = visibleDeals(actor).filter((d) => !['Won', 'Lost'].includes(d.stage)).slice(0, 20);
  return {
    firm: firm.name, user: { name: actor.name, role: actor.role },
    leads: leads.map((l) => ({ id: l.id, name: l.name, status: l.status, score: l.score, source: l.source, interest: l.interest, sla: slaState(l, t).state })),
    deals: deals.map((d) => ({ id: d.id, client: d.clientName, type: d.type, stage: d.stage, value: d.value, risks: dealRisks(d, t) })),
  };
}

/** Whether the PHP proxy is deployed next to the site (cached per tab). */
let proxyState = null;
export async function proxyAvailable() {
  if (proxyState !== null) return proxyState;
  try {
    const res = await fetch('api/copilot.php?health=1', { cache: 'no-store' });
    proxyState = res.ok && (await res.json()).ok === true;
  } catch {
    proxyState = false;
  }
  return proxyState;
}

export async function askModel(actor, question) {
  const res = await fetch('api/copilot.php', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: String(question).slice(0, 500), context: copilotContext(actor) }),
  });
  if (!res.ok) throw new Error(`Copilot service answered ${res.status}`);
  const data = await res.json();
  return { text: data.text || 'No answer.', sources: [{ label: 'Your open leads and deals', link: '#/leads' }], model: true };
}
