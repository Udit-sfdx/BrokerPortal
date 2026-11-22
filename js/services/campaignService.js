// Campaigns: permits (Trakheesi), channels, spend, creatives and the funnel to commission.
// Mirrors BP_CampaignService (Apex). Option B and Trial plans only.
// Rule: a campaign cannot go live without a valid permit and at least one approved creative.

import { getState, mutate, now, nextId, audit } from '../core/store.js';
import { assertValid, isBlank, parseDateInput, DAY } from '../core/util.js';
import { CAMPAIGN_CHANNELS, PLANS } from '../core/config.js';
import { permitState, campaignFunnel } from '../core/rules.js';
import { firmOf } from './firmService.js';

const MARKETERS = ['Owner', 'Director', 'Marketing'];
const APPROVERS = ['Owner', 'Director'];
export const canApproveCreative = (actor) => APPROVERS.includes(actor.role);

export function campaignsEnabled(actor) {
  const firm = firmOf(actor);
  return !!firm && !!(PLANS[firm.plan] || {}).marketing && MARKETERS.includes(actor.role);
}

export const visibleCampaigns = (actor) => (campaignsEnabled(actor) ? getState().campaigns.filter((c) => c.firmId === actor.firmId) : []);
export const getCampaign = (actor, id) => visibleCampaigns(actor).find((c) => c.id === id) || null;

/** Funnel uses the firm's own leads and deals only. */
export function funnelFor(actor, campaign) {
  const s = getState();
  return campaignFunnel(campaign, s.leads.filter((l) => l.firmId === actor.firmId), s.deals.filter((d) => d.firmId === actor.firmId));
}

function requireCampaign(actor, id) {
  const firm = firmOf(actor);
  assertValid(firm && ['Active', 'Trial'].includes(firm.status) ? [] : ['Your firm is read-only right now.']);
  assertValid(campaignsEnabled(actor) ? [] : ['Campaigns are part of Option B. Ask the owner to change plan.']);
  const c = getCampaign(actor, id);
  assertValid(c ? [] : ['Campaign not found.']);
  return c;
}

const log = (c, text, by) => c.history.unshift({ at: now(), text, by });

/** Everything that blocks going live, in plain words. */
export function goLiveProblems(c, t = now()) {
  const out = [];
  const ps = permitState(c.permit, t);
  if (ps.state === 'missing') out.push('Add the DLD ad permit (Trakheesi) number first.');
  if (ps.state === 'expired') out.push('The ad permit has expired: renew it before going live.');
  if (!c.creatives.some((k) => k.status === 'Approved')) out.push('At least one creative must be approved by the owner or a director.');
  if (!c.channels.length) out.push('Choose at least one channel.');
  if (!(c.budget > 0)) out.push('Set a budget.');
  return out;
}

export function createCampaign(actor, form) {
  const firm = firmOf(actor);
  assertValid(campaignsEnabled(actor) ? [] : ['Campaigns are part of Option B.']);
  const problems = [];
  if (isBlank(form.name) || form.name.length > 80) problems.push('Name the campaign (up to 80 characters).');
  const channels = CAMPAIGN_CHANNELS.filter((ch) => form[`ch_${ch}`]);
  if (!channels.length) problems.push('Choose at least one channel.');
  const budget = Number(form.budget);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1e7) problems.push('Budget must be a positive amount.');
  if (getState().campaigns.some((c) => c.firmId === firm.id && c.name.toLowerCase() === String(form.name || '').trim().toLowerCase())) problems.push('A campaign with this name already exists.');
  assertValid(problems);
  return mutate((s) => {
    const t = now();
    const c = {
      id: nextId('CMP'), firmId: firm.id, name: form.name.trim(), projectId: form.projectId || null, lob: form.lob || 'Off-plan', channels, status: 'Draft', permit: null,
      budget: Math.round(budget), startAt: t, endAt: t + 30 * DAY, createdAt: t, spend: [], creatives: [], history: [{ at: t, text: 'Campaign created.', by: actor.name }],
    };
    s.campaigns.push(c);
    audit(actor.name, 'Campaign created', c.name, firm.id);
    return c;
  });
}

/** DLD ad permit: 6–10 digits, expiry in the future. */
export function setPermit(actor, id, { number, expires }) {
  requireCampaign(actor, id);
  const problems = [];
  const n = String(number || '').trim();
  const exp = parseDateInput(expires);
  if (!/^\d{6,10}$/.test(n)) problems.push('Permit number must be 6 to 10 digits, as on the Trakheesi permit.');
  if (exp === null) problems.push('Enter the permit expiry date.');
  else if (exp < now()) problems.push('That permit has already expired.');
  if (getState().campaigns.some((c) => c.id !== id && c.firmId === actor.firmId && c.permit?.number === n)) problems.push('This permit number is already used by another campaign.');
  assertValid(problems);
  return mutate((s) => {
    const c = s.campaigns.find((x) => x.id === id);
    c.permit = { number: n, expiresAt: exp + DAY - 1 };
    log(c, `Ad permit ${n} recorded.`, actor.name);
    return c.permit;
  });
}

export function setCampaignStatus(actor, id, status) {
  const c = requireCampaign(actor, id);
  const flow = { Live: ['Draft', 'Paused'], Paused: ['Live'], Ended: ['Live', 'Paused', 'Draft'] };
  assertValid(flow[status] && flow[status].includes(c.status) ? [] : [`A ${c.status.toLowerCase()} campaign cannot be set to ${status.toLowerCase()}.`]);
  if (status === 'Live') assertValid(goLiveProblems(c));
  return mutate((s) => {
    const x = s.campaigns.find((k) => k.id === id);
    x.status = status;
    log(x, `Status: ${status}.`, actor.name);
    audit(actor.name, `Campaign ${status.toLowerCase()}`, x.name, x.firmId);
    return x;
  });
}

/** Adds a creative as a draft (written by a person or the Marketing Analyst). It needs approval before use. */
export function addCreative(actor, id, { name, lang, headline, body, channel, ai }) {
  const c = requireCampaign(actor, id);
  const problems = [];
  if (isBlank(headline) || headline.length > 90) problems.push('Headline is required (up to 90 characters).');
  if (isBlank(body) || body.length > 500) problems.push('Body is required (up to 500 characters).');
  if (!['English', 'Arabic'].includes(lang)) problems.push('Choose English or Arabic.');
  if (!c.channels.includes(channel)) problems.push('Choose one of the campaign\'s channels.');
  if (c.permit?.number && !String(body).includes(c.permit.number)) problems.push(`Ad copy must show the permit number (${c.permit.number}).`);
  assertValid(problems);
  return mutate((s) => {
    const x = s.campaigns.find((k) => k.id === id);
    const cr = { id: nextId('CR'), name: (name || `${lang} ${channel}`).trim(), lang, headline: headline.trim(), body: body.trim(), channel, status: 'Draft', ai: !!ai, by: actor.name };
    x.creatives.push(cr);
    log(x, `Creative "${cr.name}" drafted${ai ? ' with the Marketing Analyst' : ''}.`, actor.name);
    return cr;
  });
}

export function approveCreative(actor, id, creativeId) {
  const c = requireCampaign(actor, id);
  const cr = c.creatives.find((k) => k.id === creativeId);
  const problems = [];
  if (!canApproveCreative(actor)) problems.push('Only the owner or a director can approve creatives.');
  if (!cr) problems.push('Creative not found.');
  else if (cr.status === 'Approved') problems.push('Already approved.');
  assertValid(problems);
  return mutate((s) => {
    const x = s.campaigns.find((k) => k.id === id);
    const k = x.creatives.find((y) => y.id === creativeId);
    k.status = 'Approved';
    k.approvedBy = actor.name;
    log(x, `Creative "${k.name}" approved.`, actor.name);
    audit(actor.name, 'Creative approved', `${x.name}: ${k.name}`, x.firmId);
  });
}

/** Spend per channel and per week (for the charts). */
export function spendSummary(c) {
  const byChannel = {};
  const byWeek = {};
  for (const x of c.spend) {
    byChannel[x.channel] = (byChannel[x.channel] || 0) + x.amount;
    const wk = Math.floor((now() - x.at) / (7 * DAY));
    byWeek[wk] = (byWeek[wk] || 0) + x.amount;
  }
  return { byChannel, weeks: Object.keys(byWeek).map(Number).sort((a, b) => b - a).map((w) => ({ label: w === 0 ? 'This wk' : `-${w}w`, value: byWeek[w] })) };
}

export const CHANNELS = CAMPAIGN_CHANNELS;
