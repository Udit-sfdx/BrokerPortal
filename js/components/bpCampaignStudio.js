// P8 Campaign studio: campaigns with DLD ad permits, channels, spend, creatives, the funnel to commission and ROI.
// Marketing Analyst explains cost per lead and ROI, and drafts ad copy in English and Arabic with the permit number.
// LWC equivalent: c-bp-campaign-studio composed of c-bp-campaign-list, c-bp-permit-badge, c-bp-chart, c-bp-creative-list.
// Acceptance: a campaign cannot go live without a valid permit.

import { card, uIcon, badge, emptyState, openModal, field, select, checkbox, textarea, readForm, toast, alertBox } from '../core/ui.js';
import { esc, fmtAED, fmtCompact, fmtDate, toDateInput, DAY } from '../core/util.js';
import { now, getState } from '../core/store.js';
import { permitState } from '../core/rules.js';
import {
  visibleCampaigns, getCampaign, funnelFor, goLiveProblems, createCampaign, setPermit, setCampaignStatus, addCreative, approveCreative,
  canApproveCreative, spendSummary, campaignsEnabled, CHANNELS,
} from '../services/campaignService.js';
import { visibleProjects } from '../services/inventoryService.js';
import { firmOf } from '../services/firmService.js';
import { modalForm, modalFooter, submitModal } from './bpModalForm.js';
import { barChart, funnelChart, trendChart } from './bpChart.js';
import { go } from '../core/app.js';

const aiTag = (label) => `<span class="bp-ai-tag">${uIcon('sparkles', 'slds-icon_xx-small')} ${esc(label)}</span>`;
const STATUS_THEME = { Draft: 'light', Live: 'success', Paused: 'warning', Ended: 'inverse' };
const PERMIT_THEME = { valid: 'success', expiring: 'warning', expired: 'error', missing: 'error' };

const permitBadge = (c, t) => { const ps = permitState(c.permit, t); return badge(c.permit ? `${ps.text}${ps.state === 'valid' ? ` · ${c.permit.number}` : ''}` : 'No permit', PERMIT_THEME[ps.state]); };
const roiText = (f) => (f.roi === null ? '—' : `${f.roi.toFixed(1)}×`);

/** Marketing Analyst: plain-language read of cost per lead and ROI against the firm's other campaigns. */
function analystNotes(c, f, all) {
  const others = all.filter((x) => x.c.id !== c.id && x.f.leads);
  const avgCpl = others.length ? others.reduce((n, x) => n + x.f.cpl, 0) / others.length : null;
  const notes = [];
  if (!f.spend) notes.push('No spend yet. Add a permit, get a creative approved and go live to start collecting leads.');
  else {
    if (f.cpl && avgCpl) notes.push(`Cost per lead is ${fmtAED(f.cpl)}, ${f.cpl < avgCpl ? `${Math.round((1 - f.cpl / avgCpl) * 100)}% below` : `${Math.round((f.cpl / avgCpl - 1) * 100)}% above`} your other campaigns (${fmtAED(Math.round(avgCpl))}).`);
    if (f.leads && f.contacted / f.leads < 0.8) notes.push(`Only ${Math.round((f.contacted / f.leads) * 100)}% of its leads got a reply: slow follow-up is wasting spend.`);
    if (f.won) notes.push(`${f.won} won deal${f.won === 1 ? '' : 's'} returned ${fmtAED(f.commission)} in commission: ${roiText(f)} the spend.`);
    else if (f.deals) notes.push(`${f.deals} deal${f.deals === 1 ? '' : 's'} in progress; ROI shows once a deal is won.`);
    else notes.push(`${f.qualified} qualified lead${f.qualified === 1 ? '' : 's'} so far, no deal yet. Check the follow-up on qualified leads before adding budget.`);
  }
  const ps = permitState(c.permit, now());
  if (ps.state === 'expiring') notes.push(`${ps.text}: renew it, or the campaign must stop.`);
  return notes;
}

function list(user, rows, t, activeId) {
  return `<div class="bp-table-wrap"><table class="slds-table slds-table_bordered slds-table_cell-buffer"><thead><tr><th>Campaign</th><th>Status</th><th>Permit</th><th>Spend</th><th>Leads</th><th>CPL</th><th>Won</th><th>ROI</th></tr></thead><tbody>
    ${rows.map(({ c, f }) => `<tr class="${c.id === activeId ? 'bp-row-focus' : ''}"><td><a class="bp-link" href="portal/#/campaigns/${esc(c.id)}"><b>${esc(c.name)}</b></a><div class="bp-small bp-muted">${esc(c.channels.join(', '))}</div></td>
      <td>${badge(c.status, STATUS_THEME[c.status])}</td><td>${permitBadge(c, t)}</td><td>${fmtAED(f.spend)}</td><td>${f.leads}</td><td>${f.cpl ? fmtAED(f.cpl) : '—'}</td><td>${f.won}</td><td><b>${roiText(f)}</b></td></tr>`).join('')}
  </tbody></table></div>`;
}

function detail(user, c, f, rows, t) {
  const ps = permitState(c.permit, t);
  const problems = goLiveProblems(c, t);
  const sp = spendSummary(c);
  const project = visibleProjects(user).find((p) => p.id === c.projectId);
  const statusBtns = {
    Draft: `<button type="button" class="slds-button slds-button_brand" data-act="campaignStatus" data-id="${esc(c.id)}" data-status="Live">Go live</button>`,
    Live: `<button type="button" class="slds-button slds-button_neutral" data-act="campaignStatus" data-id="${esc(c.id)}" data-status="Paused">Pause</button><button type="button" class="slds-button slds-button_neutral" data-act="campaignStatus" data-id="${esc(c.id)}" data-status="Ended">End</button>`,
    Paused: `<button type="button" class="slds-button slds-button_brand" data-act="campaignStatus" data-id="${esc(c.id)}" data-status="Live">Resume</button><button type="button" class="slds-button slds-button_neutral" data-act="campaignStatus" data-id="${esc(c.id)}" data-status="Ended">End</button>`,
    Ended: '',
  }[c.status];
  const head = `<div class="bp-record-title slds-m-top_medium"><div style="min-width:0;flex:1"><h1>${esc(c.name)} ${badge(c.status, STATUS_THEME[c.status])}</h1>
      <div class="bp-small bp-muted">${esc(c.channels.join(', '))}${project ? ` · ${esc(project.name)}` : ` · ${esc(c.lob)}`} · budget ${fmtAED(c.budget)}</div></div>
    <div class="bp-record-actions">${permitBadge(c, t)} <button type="button" class="slds-button slds-button_neutral" data-act="permitOpen" data-id="${esc(c.id)}">${c.permit ? 'Update permit' : 'Add permit'}</button>${statusBtns}</div></div>
    ${['Draft', 'Paused'].includes(c.status) && problems.length ? `<div class="slds-m-top_small">${alertBox('warning', `Can't go live yet: ${problems.map(esc).join(' ')}`)}</div>` : ''}
    ${ps.state === 'expiring' && c.status === 'Live' ? `<div class="slds-m-top_small">${alertBox('warning', `${esc(ps.text)}. Renew it before then or the campaign must stop.`)}</div>` : ''}`;
  const funnel = card('Funnel to commission', funnelChart([
    { label: 'Spend', value: Math.max(f.leads, 1) * 4, display: fmtAED(f.spend), pct: false },
    { label: 'Leads', value: f.leads, pct: false }, { label: 'Contacted', value: f.contacted }, { label: 'Qualified', value: f.qualified },
    { label: 'Deals', value: f.deals }, { label: 'Won', value: f.won },
  ], { label: 'Campaign funnel' }) + `<div class="bp-kpis"><div><span>Cost per lead</span><b>${f.cpl ? fmtAED(f.cpl) : '—'}</b></div><div><span>Commission</span><b>${fmtAED(f.commission)}</b></div><div><span>ROI</span><b>${roiText(f)}</b></div></div>`, { icon: 'chart' });
  const spend = card('Spend', `${Object.keys(sp.byChannel).length ? barChart(Object.entries(sp.byChannel).map(([k, v]) => ({ label: k, value: v })), { money: true, label: 'Spend by channel' }) : '<div class="bp-empty">No spend yet.</div>'}
    ${sp.weeks.length ? `<div class="bp-small bp-muted slds-m-top_small">Weekly spend (AED)</div>${trendChart(sp.weeks.slice(-8), { money: true, label: 'Weekly spend' })}` : ''}`, { icon: 'currency' });
  const leadsByCreative = (cr) => getState().leads.filter((l) => l.firmId === user.firmId && l.creativeId === cr.id).length;
  const creatives = card('Creatives', `${c.creatives.length ? `<ul class="bp-creatives">${c.creatives.map((cr) => `<li>
      <div class="bp-creative-head"><b>${esc(cr.name)}</b> ${badge(cr.status, cr.status === 'Approved' ? 'success' : 'warning')} ${cr.ai ? aiTag('Marketing Analyst') : ''}<span class="bp-small bp-muted">${esc(cr.channel)} · ${esc(cr.lang)} · ${leadsByCreative(cr)} leads</span>
        ${cr.status === 'Draft' && canApproveCreative(user) ? `<button type="button" class="slds-button slds-button_success" data-act="approveCreative" data-id="${esc(c.id)}" data-cr="${esc(cr.id)}">Approve</button>` : ''}</div>
      <div class="bp-creative-copy" dir="${cr.lang === 'Arabic' ? 'rtl' : 'ltr'}" lang="${cr.lang === 'Arabic' ? 'ar' : 'en'}"><b>${esc(cr.headline)}</b><br>${esc(cr.body)}</div></li>`).join('')}</ul>` : '<div class="bp-empty">No creatives yet.</div>'}
    <div class="bp-form-actions slds-m-top_small"><button type="button" class="slds-button slds-button_neutral" data-act="creativeOpen" data-id="${esc(c.id)}" data-lang="English">${uIcon('sparkles', 'slds-icon_x-small')}&nbsp;Draft English copy</button>
      <button type="button" class="slds-button slds-button_neutral" data-act="creativeOpen" data-id="${esc(c.id)}" data-lang="Arabic">${uIcon('sparkles', 'slds-icon_x-small')}&nbsp;Draft Arabic copy</button></div>
    <p class="bp-small bp-muted">Copy must carry the permit number. Nothing publishes until the owner or a director approves it.</p>`, { icon: 'quick_text' });
  const analyst = card(`${uIcon('sparkles', 'slds-icon_x-small')} Marketing Analyst`, `<ul class="bp-coach-risks">${analystNotes(c, f, rows).map((n) => `<li>${esc(n)}</li>`).join('')}</ul><p class="bp-small bp-muted">Explains the numbers; it never changes budgets or publishes.</p>`, { cls: 'bp-ai-card' });
  const hist = card('History', `<ul class="bp-timeline">${c.history.slice(0, 10).map((h) => `<li><span class="bp-tl-icon">${uIcon('record', 'slds-icon_xx-small')}</span><div><div class="bp-tl-text">${esc(h.text)}</div><div class="bp-small bp-muted">${esc(h.by)} · ${fmtDate(h.at)}</div></div></li>`).join('')}</ul>`, { icon: 'feed' });
  return `${head}<div class="bp-grid bp-cols-2 slds-m-top_medium"><div class="bp-grid">${funnel}${creatives}</div><div class="bp-grid">${analyst}${spend}${hist}</div></div>`;
}

export function bpCampaignStudio(user, params = []) {
  if (!campaignsEnabled(user)) return card('Campaigns', emptyState('Campaigns are part of Option B', 'Ask your firm owner to move to Option B in Firm settings → Plan.'));
  const t = now();
  const campaigns = visibleCampaigns(user);
  const rows = campaigns.map((c) => ({ c, f: funnelFor(user, c) }));
  const active = params[0] ? campaigns.find((c) => c.id === params[0]) : null;
  const total = rows.reduce((a, { f }) => ({ spend: a.spend + f.spend, leads: a.leads + f.leads, commission: a.commission + f.commission }), { spend: 0, leads: 0, commission: 0 });
  const tiles = `<div class="bp-tiles"><div class="bp-tile"><div class="bp-tile-label">Spend</div><div class="bp-tile-value">${fmtCompact(total.spend)}</div><div class="bp-tile-sub">AED, all campaigns</div></div>
    <div class="bp-tile"><div class="bp-tile-label">Leads</div><div class="bp-tile-value">${total.leads}</div><div class="bp-tile-sub">${total.leads ? `${fmtAED(Math.round(total.spend / total.leads))} per lead` : '—'}</div></div>
    <div class="bp-tile"><div class="bp-tile-label">Commission from campaigns</div><div class="bp-tile-value">${fmtCompact(total.commission)}</div><div class="bp-tile-sub">AED, won deals</div></div>
    <div class="bp-tile ${campaigns.some((c) => permitState(c.permit, t).state !== 'valid' && c.status !== 'Ended') ? 'warn' : 'good'}"><div class="bp-tile-label">Permits needing action</div><div class="bp-tile-value">${campaigns.filter((c) => permitState(c.permit, t).state !== 'valid' && c.status !== 'Ended').length}</div><div class="bp-tile-sub">missing, expiring or expired</div></div></div>`;
  return `<div class="bp-page-title"><div><h1>Campaign studio</h1><p class="bp-muted bp-small">Every campaign needs a DLD ad permit before it can go live.</p></div>
    <div class="bp-page-actions"><button type="button" class="slds-button slds-button_brand" data-act="newCampaignOpen">${uIcon('add', 'slds-icon_x-small')}&nbsp;New campaign</button></div></div>
    ${tiles}<div class="slds-card bp-card">${rows.length ? list(user, rows, t, active?.id) : emptyState('No campaigns yet', 'Create one, add the permit and a creative, then go live.')}</div>
    ${active ? detail(user, active, rows.find((r) => r.c.id === active.id).f, rows, t) : rows.length ? '<p class="bp-small bp-muted slds-m-top_small">Open a campaign to see its funnel, spend, creatives and the Marketing Analyst.</p>' : ''}`;
}

/** Marketing Analyst ad copy draft (scripted), always including the permit number. */
function draftCopy(c, project, lang) {
  const name = project ? project.name : 'ready homes across Dubai';
  const permit = c.permit ? c.permit.number : '';
  if (lang === 'Arabic') return { headline: `${name}: خطة دفع مرنة`, body: `امتلك منزلك في ${name}${project ? ` مع ${project.offer ? 'عرض خاص' : 'خطة دفع'}` : ''}. احجز معاينتك اليوم.${permit ? ` تصريح رقم ${permit}` : ''}` };
  return { headline: `${name}: easy payment plan`, body: `Own your home at ${name}${project && project.offer ? `. Limited offer: ${project.offer}` : ''}. Book a private viewing today.${permit ? ` Permit ${permit}` : ''}` };
}

export const campaignActions = (getActor) => ({
  newCampaignOpen() {
    const actor = getActor();
    const projects = visibleProjects(actor);
    openModal('New campaign', modalForm('nc-form', 'submitNewCampaign', `${field('ncName', 'Name', { required: true, name: 'name', attrs: 'maxlength="80"' })}
      ${projects.length ? select('ncProject', 'Project (optional)', [['', 'None'], ...projects.map((p) => [p.id, p.name])], { name: 'projectId' }) : ''}
      ${select('ncLob', 'Deal type', ['Off-plan', 'Secondary', 'Rental'], { name: 'lob' })}
      <fieldset class="slds-form-element slds-m-bottom_small"><legend class="slds-form-element__label">Channels</legend>${CHANNELS.map((ch, i) => checkbox(`ncCh${i}`, ch, { name: `ch_${ch}` })).join('')}</fieldset>
      ${field('ncBudget', 'Monthly budget (AED)', { type: 'number', required: true, name: 'budget', attrs: 'min="1"' })}
      <p class="bp-small bp-muted">The campaign starts as a draft. Add the permit and an approved creative to go live.</p>`), modalFooter('nc-form', 'Create'));
  },
  submitNewCampaign(form) {
    const c = submitModal(() => createCampaign(getActor(), readForm(form)), { title: 'Campaign created', message: 'Next: add the ad permit.' });
    if (c) go(`campaigns/${c.id}`);
  },
  permitOpen(el) {
    const c = getCampaign(getActor(), el.dataset.id);
    openModal('DLD ad permit (Trakheesi)', modalForm('pm-form', 'submitPermit', `<input type="hidden" name="id" value="${esc(c.id)}">
      ${field('pmNo', 'Permit number', { value: c.permit?.number || '', required: true, name: 'number', attrs: 'inputmode="numeric" maxlength="10"' })}
      ${field('pmExp', 'Expiry date', { type: 'date', value: c.permit ? toDateInput(c.permit.expiresAt) : toDateInput(now() + 90 * DAY), required: true, name: 'expires' })}
      <p class="bp-small bp-muted">Checked against Trakheesi when the integration is on. Ads must show this number.</p>`), modalFooter('pm-form', 'Save permit'));
  },
  submitPermit(form) { const f = readForm(form); submitModal(() => setPermit(getActor(), f.id, f), { title: 'Permit saved' }); },
  campaignStatus(el) {
    const c = setCampaignStatus(getActor(), el.dataset.id, el.dataset.status);
    toast('success', `${c.name}: ${c.status}`);
  },
  creativeOpen(el) {
    const actor = getActor();
    const c = getCampaign(actor, el.dataset.id);
    const project = visibleProjects(actor).find((p) => p.id === c.projectId);
    const lang = el.dataset.lang;
    const d = draftCopy(c, project, lang);
    openModal(`${uIcon('sparkles', 'slds-icon_x-small')} ${lang} ad copy`, modalForm('cr-form', 'submitCreative', `<input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="lang" value="${esc(lang)}">
      <p class="slds-m-bottom_small">${aiTag('Marketing Analyst')} drafted this. Edit it, then save it as a draft for approval.</p>
      ${select('crChannel', 'Channel', c.channels, { name: 'channel' })}
      ${field('crHead', 'Headline', { value: d.headline, name: 'headline', attrs: `maxlength="90" dir="${lang === 'Arabic' ? 'rtl' : 'ltr'}"` })}
      ${textarea('crBody', 'Body', { value: d.body, name: 'body', attrs: `rows="3" dir="${lang === 'Arabic' ? 'rtl' : 'ltr'}"` })}
      ${c.permit ? '' : '<p class="bp-small bp-risk">Add the permit first: ad copy must carry the permit number.</p>'}`), modalFooter('cr-form', 'Save draft'));
  },
  submitCreative(form) { const f = readForm(form); submitModal(() => addCreative(getActor(), f.id, { ...f, ai: true }), { title: 'Creative saved', message: 'Waiting for approval.' }); },
  approveCreative(el) { approveCreative(getActor(), el.dataset.id, el.dataset.cr); toast('success', 'Creative approved'); },
});

export const _firmOf = firmOf;
