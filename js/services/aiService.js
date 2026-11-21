// Scripted AI agents for the demo site: Lead Qualifier, Follow-up Writer, Deal Coach, Document Reader,
// Compliance Checker, and the My Day brief. Pure functions over records the caller is already allowed to see,
// so an agent can never read another firm's data (the Agentforce build runs as the asking user the same way).
// Every output is labelled as AI in the UI and nothing here changes data: a person confirms each action.

import { DAY, HOUR, MIN, fmtAED, fmtDuration, fmtTime, fmtDate } from '../core/util.js';
import { MESSAGE_TEMPLATES, TIMELINES, BEDROOMS, AREAS } from '../core/config.js';
import { slaState, missingQualification, dealRisks, nextGate, scoreBand, screenName } from '../core/rules.js';

const first = (name) => String(name || '').split(' ')[0];

/** The unit the client asked about, written in Arabic (place and project names stay as they are). */
export function interestArabic(lead) {
  const beds = lead.beds === 'Studio' ? 'استوديو' : lead.beds ? `شقة ${lead.beds === '1' ? 'بغرفة نوم واحدة' : `${lead.beds} غرف نوم`}` : 'عقار';
  const where = lead.project || lead.area;
  return `${beds}${lead.lob === 'Rental' ? ' للإيجار' : ''}${where ? ` في ${where}` : ''}`;
}

/** Fills a template's placeholders. Unknown values fall back to neutral words, never "undefined". */
export function fillTemplate(templateId, lang, { lead, agent, firm, when = '' }) {
  const tpl = MESSAGE_TEMPLATES.find((t) => t.id === templateId) || MESSAGE_TEMPLATES[0];
  const arabic = lang === 'Arabic';
  const text = (arabic ? tpl.ar : tpl.en) || tpl.en;
  const values = {
    first: first(lead.name), agent: agent ? first(agent.name) : '', firm: firm ? firm.name : '',
    interest: arabic ? interestArabic(lead) : lead.interest || 'your property search',
    when: when || (arabic ? 'في الموعد المتفق عليه' : 'the agreed time'),
  };
  return text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
}

/** Lead Qualifier: what it can read from the enquiry and replies, as proposed field values (not saved). */
export function qualifierProposal(lead) {
  const text = (lead.activities || []).filter((a) => ['inbound', 'created', 'call'].includes(a.type)).map((a) => a.text).join(' ').toLowerCase();
  const out = {};
  if (!lead.beds) {
    const m = text.match(/(\d)\s?br|studio/);
    if (m) out.beds = m[0].startsWith('studio') ? 'Studio' : m[1];
  }
  if (!lead.area) { const a = AREAS.find((x) => text.includes(x.toLowerCase())); if (a) out.area = a; }
  if (!lead.purpose) out.purpose = /rent|move|family|school/.test(text) || lead.lob === 'Rental' ? 'End use' : 'Investment';
  if (!lead.timeline) out.timeline = /now|urgent|this month|asap/.test(text) ? 'Now' : /payment plan|floor plan/.test(text) ? '1–3 months' : '3–6 months';
  if (!lead.financing && lead.lob !== 'Rental') out.financing = /mortgage|loan|bank/.test(text) ? 'Mortgage' : /cash/.test(text) ? 'Cash' : 'Not sure';
  if (!lead.budgetMax) out.budgetMax = lead.lob === 'Rental' ? 120000 : 1500000;
  const sources = [];
  if (out.beds || out.area) sources.push('enquiry text');
  if ((lead.activities || []).some((a) => a.type === 'inbound')) sources.push("client's replies");
  if (out.budgetMax) sources.push('typical budget for this unit type (please check)');
  return { fields: out, sources };
}

/** Conversation summary for the lead workspace. */
export function leadSummary(lead, t) {
  const acts = lead.activities || [];
  const calls = acts.filter((a) => a.type === 'call');
  const inbound = acts.filter((a) => a.type === 'inbound');
  const parts = [`${first(lead.name)} enquired via ${lead.source} ${fmtDuration(t - lead.createdAt)} ago about ${lead.interest}.`];
  if (lead.budgetMax) parts.push(`Budget up to ${fmtAED(lead.budgetMax)}${lead.financing ? `, ${lead.financing.toLowerCase()}` : ''}.`);
  if (calls.length) parts.push(`${calls.length} call${calls.length === 1 ? '' : 's'} logged; last: ${calls[0].text.replace(/^Call: /, '')}`);
  else parts.push('No call logged yet.');
  if (inbound.length) parts.push(`Last message from the client: "${inbound[0].text.replace(/^Client: /, '')}"`);
  const missing = missingQualification(lead);
  if (missing.length && !['Converted', 'Lost'].includes(lead.status)) parts.push(`Still unknown: ${missing.join(', ').toLowerCase()}.`);
  return parts.join(' ');
}

/** Follow-up Writer: picks a template and language for the next message, with the reason. */
export function suggestReply(lead, agent, firm) {
  const acts = lead.activities || [];
  const lastCall = acts.find((a) => a.type === 'call');
  const inbound = acts.find((a) => a.type === 'inbound');
  let templateId = 'intro';
  let why = 'No message sent yet: start with a first reply.';
  if (lastCall && /no answer|busy/i.test(lastCall.text)) { templateId = 'followup'; why = 'Your last call was not answered.'; }
  else if (inbound && /payment plan|floor plan/i.test(inbound.text)) { templateId = 'plan'; why = 'The client asked for the payment plan.'; }
  else if (lead.status === 'Viewing') { templateId = 'viewing'; why = 'A viewing is booked: confirm it.'; }
  else if (acts.some((a) => ['whatsapp', 'email'].includes(a.type))) { templateId = 'followup'; why = 'You have messaged before; keep the thread warm.'; }
  const lang = lead.lang === 'Arabic' ? 'Arabic' : 'English';
  if (lang === 'Arabic') why += ' Written in Arabic, the client\'s language.';
  return { templateId, lang, why, text: fillTemplate(templateId, lang, { lead, agent, firm }) };
}

/** Next best action for a lead, with the reason. act matches a workspace action name. */
export function nextBestAction(lead, t, { canCall }) {
  const sla = slaState(lead, t);
  if (lead.status === 'Converted') return { label: 'Open the deal', act: 'openDeal', why: 'This lead is already a deal.' };
  if (lead.status === 'Lost') return { label: 'No action', act: null, why: `Marked lost: ${lead.lostReason}.` };
  if (sla.state === 'running' || sla.state === 'breached') {
    return canCall
      ? { label: 'Call now', act: 'callLead', why: sla.state === 'running' ? `First-response SLA ends in ${fmtDuration(sla.left)}.` : `First response is ${fmtDuration(-sla.left)} late.` }
      : { label: 'Send a WhatsApp or email', act: 'composeMessage', why: lead.dnc ? 'Number is on the do-not-call list: message instead.' : 'Calls are outside the allowed hours: message now, call from 09:00.' };
  }
  const missing = missingQualification(lead);
  if (missing.length) return { label: 'Fill qualification', act: 'runQualifier', why: `Missing: ${missing.join(', ').toLowerCase()}. The Lead Qualifier can propose values.` };
  if (lead.status === 'Contacted') return { label: 'Mark qualified', act: 'qualifyLead', why: 'All qualification fields are filled.' };
  if (lead.status === 'Qualified') return { label: 'Book a viewing', act: 'scheduleViewing', why: 'Qualified leads that view within a week convert far more often.' };
  if (lead.status === 'Viewing') return { label: 'Convert to deal', act: 'convertLead', why: 'Viewing done or booked: open the deal once the client says yes.' };
  return { label: 'Log a call', act: 'callLead', why: 'Keep the conversation moving.' };
}

/**
 * My Day brief: the next actions for this agent in order, each with why.
 * Inputs are already scoped to the user (their own leads, tasks and deals).
 */
export function morningBrief(user, { leads, tasks, deals }, t) {
  const items = [];
  for (const l of leads) {
    const sla = slaState(l, t);
    if (!['New', 'Contacted', 'Qualified', 'Viewing'].includes(l.status)) continue;
    const whose = l.ownerId && l.ownerId !== user.id ? ` (${l.ownerName || 'team'})` : '';
    if (!l.ownerId) { items.push({ rank: 0, at: l.createdAt, title: `Assign ${l.name}`, why: 'No eligible agent took this lead: give it an owner.', link: `#/lead/${l.id}`, leadId: l.id }); continue; }
    if (sla.state === 'running') items.push({ rank: 0, at: l.slaDueAt, title: `${whose ? 'Chase' : 'Call'} ${l.name}${whose}`, why: `New ${l.source} lead, ${scoreBand(l.score)} (${l.score}). SLA ends in ${fmtDuration(sla.left)}.`, link: `#/lead/${l.id}`, leadId: l.id });
    else if (sla.state === 'breached') items.push({ rank: 1, at: l.slaDueAt, title: `${whose ? 'Chase' : 'Call'} ${l.name}${whose}`, why: `First response is ${fmtDuration(-sla.left)} late.`, link: `#/lead/${l.id}`, leadId: l.id });
  }
  for (const k of tasks) {
    if (k.done) continue;
    const late = k.dueAt < t;
    const today = k.dueAt - t < 16 * HOUR;
    if (!late && !today) continue;
    items.push({ rank: late ? 2 : 3, at: k.dueAt, title: k.title, why: late ? `Overdue by ${fmtDuration(t - k.dueAt)}.` : `${k.type === 'viewing' ? 'Viewing' : 'Due'} at ${fmtTime(k.dueAt)}.`, link: k.leadId ? `#/lead/${k.leadId}` : k.dealId ? `#/deal/${k.dealId}` : '', taskId: k.id });
  }
  for (const d of deals) {
    const risks = dealRisks(d, t);
    if (risks.length) items.push({ rank: 4, at: d.stageChangedAt, title: `Unblock ${d.clientName}'s deal`, why: risks[0], link: `#/deal/${d.id}`, dealId: d.id });
  }
  items.sort((a, b) => a.rank - b.rank || a.at - b.at);
  const hot = leads.filter((l) => l.score >= 70 && !['Converted', 'Lost'].includes(l.status)).length;
  const summary = items.length
    ? `${items.filter((i) => i.rank <= 1).length} new lead${items.filter((i) => i.rank <= 1).length === 1 ? '' : 's'} waiting for a first call, ${items.filter((i) => i.rank === 2).length} overdue follow-up${items.filter((i) => i.rank === 2).length === 1 ? '' : 's'}, ${items.filter((i) => i.rank === 4).length} deal${items.filter((i) => i.rank === 4).length === 1 ? '' : 's'} at risk. ${hot} hot lead${hot === 1 ? '' : 's'} in your list.`
    : 'Nothing urgent. A good time to call your warm leads.';
  return { summary, items };
}

/** Deal Coach: risks plus the one next step that moves the deal. */
export function dealCoach(deal, t) {
  const risks = dealRisks(deal, t);
  const ng = nextGate(deal);
  const missing = ng.items.filter((i) => !i.ok);
  let next = null;
  if (deal.stage === 'Won' || deal.stage === 'Lost') next = null;
  else if (missing.length) next = { text: `For ${ng.stage.label}: ${missing[0].text}.`, tab: missing[0].tab };
  else if (ng.stage) next = { text: `Everything for ${ng.stage.label} is in place: move the deal.`, tab: null };
  return { risks, next };
}

/** Document Reader: simulated extraction of passport / Emirates ID fields for a deal's client. */
export function readClientDocument(deal, key, fileName, t) {
  const f = String(fileName || '').toLowerCase();
  const name = f.includes('mismatch') ? `${deal.clientName.split(' ')[0]} Ali Hassan` : deal.clientName;
  const expired = f.includes('expired');
  const seed = [...deal.id].reduce((n, c) => n + c.charCodeAt(0), 0);
  if (key === 'passport') {
    return { fullName: name, passportNo: `P${String(seed * 7919).padStart(8, '0').slice(0, 8)}`, nationality: deal.nationality || 'Not read', dob: Date.UTC(1980 + (seed % 20), seed % 12, 1 + (seed % 27)), passportExpiry: expired ? t - 40 * DAY : t + (600 + (seed % 900)) * DAY };
  }
  if (key === 'eid') {
    return { fullName: name, eidNo: `784-19${80 + (seed % 19)}-${String(seed * 104729).slice(0, 7)}-${seed % 9}`, eidExpiry: expired ? t - 10 * DAY : t + (300 + (seed % 700)) * DAY };
  }
  return {};
}

/** Compliance Checker: screening result plus a REAR draft when cash crosses the threshold. */
export function screeningResult(name) {
  const hits = screenName(name);
  return { status: hits.length ? 'Possible match' : 'Clear', hits };
}

export function rearDraft(deal, firm) {
  return `REAR draft for the AML officer (not filed).\nFirm: ${firm.name} (ORN ${firm.orn})\nClient: ${deal.clientName}, ${deal.nationality || 'nationality not recorded'}\nDeal: ${deal.id}, ${deal.type}, ${fmtAED(deal.value)}\nCash received: ${fmtAED(deal.cashAmount)} (threshold AED 55,000)\nPrepared on ${fmtDate(Date.now())}. File through goAML after review.`;
}

export const TIMELINE_CHOICES = TIMELINES;
export const BEDROOM_CHOICES = BEDROOMS;
export const _internals = { first, MIN };
