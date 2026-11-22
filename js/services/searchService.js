// Global search and command palette (Ctrl+K). Runs as the user: only records they can already see.
// Understands plain phrases: "2BR leads from Meta this week", "hot off-plan leads", "overdue".
// Mirrors BP_SearchService (Apex SOSL WITH USER_MODE plus a small phrase parser).

import { getState, now } from '../core/store.js';
import { DAY } from '../core/util.js';
import { LEAD_SOURCES } from '../core/config.js';
import { visibleLeads, isOpenLead } from './leadService.js';
import { visibleDeals } from './dealService.js';
import { visibleUnits, visibleProjects } from './inventoryService.js';
import { firmOf } from './firmService.js';

const SOURCE_WORDS = {
  meta: 'Meta ads', facebook: 'Meta ads', instagram: 'Meta ads', google: 'Google ads', 'property finder': 'Property Finder', propertyfinder: 'Property Finder',
  bayut: 'Bayut', dubizzle: 'Dubizzle', whatsapp: 'WhatsApp', website: 'Website', 'walk-in': 'Walk-in', walkin: 'Walk-in', referral: 'Referral', event: 'Developer event',
};

/** Pulls filters out of a phrase. Returns { filters, rest, labels }. */
export function parseQuery(q) {
  let text = ` ${String(q || '').toLowerCase()} `;
  const f = {};
  const labels = [];
  const take = (re, fn) => { const m = text.match(re); if (m) { fn(m); text = text.replace(m[0], ' '); } };
  take(/\b(studio|(\d)\s?(?:br|bed|beds|bedroom|bedrooms))\b/, (m) => { f.beds = m[1] === 'studio' ? 'Studio' : m[2]; labels.push(f.beds === 'Studio' ? 'Studio' : `${f.beds}BR`); });
  for (const [w, src] of Object.entries(SOURCE_WORDS)) {
    if (text.includes(` ${w} `) || text.includes(` ${w}s `) || text.includes(`from ${w}`)) { f.source = src; labels.push(src); text = text.replace(w, ' '); break; }
  }
  take(/\b(today)\b/, () => { f.since = 1; labels.push('today'); });
  take(/\b(this week|last 7 days|past week)\b/, () => { f.since = 7; labels.push('this week'); });
  take(/\b(this month|last 30 days)\b/, () => { f.since = 30; labels.push('this month'); });
  take(/\b(off-plan|offplan)\b/, () => { f.lob = 'Off-plan'; labels.push('Off-plan'); });
  take(/\b(secondary|resale)\b/, () => { f.lob = 'Secondary'; labels.push('Secondary'); });
  take(/\b(rental|rent|rentals)\b/, () => { f.lob = 'Rental'; labels.push('Rental'); });
  take(/\b(hot)\b/, () => { f.hot = true; labels.push('hot'); });
  take(/\b(new|uncontacted)\b/, () => { f.status = 'New'; labels.push('new'); });
  take(/\b(qualified)\b/, () => { f.status = 'Qualified'; labels.push('qualified'); });
  take(/\b(lost)\b/, () => { f.status = 'Lost'; labels.push('lost'); });
  take(/\b(overdue)\b/, () => { f.overdue = true; labels.push('overdue follow-up'); });
  const rest = text.replace(/\b(leads?|from|with|the|show|me|find|all|my|in|and|clients?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { filters: f, rest, labels };
}

const PAGES = [
  ['home', 'My Day / Home', 'home'], ['leads', 'Leads inbox', 'lead'], ['pipeline', 'Pipeline', 'opportunity'], ['inventory', 'Inventory', 'apps'],
  ['campaigns', 'Campaign studio', 'campaign'], ['team', 'Team performance', 'chart'], ['commission', 'Commission', 'moneybag'],
  ['compliance', 'Compliance centre', 'shield'], ['people', 'People', 'people'], ['settings', 'Firm settings', 'settings'],
];

/** Search across the user's own leads, deals, units and colleagues, plus pages and actions. */
export function searchAll(actor, query, { allowedPages = PAGES.map((p) => p[0]) } = {}) {
  const t = now();
  const q = String(query || '').trim();
  const { filters: f, rest, labels } = parseQuery(q);
  const words = rest.split(' ').filter((w) => w.length > 1);
  const hasFilters = Object.keys(f).length > 0;
  const match = (...vals) => words.every((w) => vals.some((v) => String(v || '').toLowerCase().includes(w)));
  const groups = [];

  const leads = visibleLeads(actor).filter((l) => (!f.beds || l.beds === f.beds) && (!f.source || l.source === f.source) && (!f.since || t - l.createdAt < f.since * DAY)
    && (!f.lob || l.lob === f.lob) && (!f.hot || (l.score >= 70 && isOpenLead(l))) && (!f.status || l.status === f.status)
    && (!f.overdue || (isOpenLead(l) && l.nextFollowUpAt && l.nextFollowUpAt < t))
    && (!words.length || match(l.name, l.phone, l.email, l.interest, l.id, l.area)));
  if ((q && (words.length || hasFilters)) && leads.length) {
    groups.push({ label: hasFilters ? `Leads: ${labels.join(' · ')}` : 'Leads', total: leads.length, items: leads.sort((a, b) => b.createdAt - a.createdAt).slice(0, 8).map((l) => ({ id: l.id, firmId: l.firmId, label: l.name, sub: `${l.status} · ${l.source} · ${l.interest}`, link: `#/lead/${l.id}`, icon: 'lead' })) });
  }
  if (words.length) {
    const deals = visibleDeals(actor).filter((d) => match(d.clientName, d.id, d.unit.ref, d.unit.project, d.clientPhone));
    if (deals.length) groups.push({ label: 'Deals', total: deals.length, items: deals.slice(0, 6).map((d) => ({ id: d.id, firmId: d.firmId, label: d.clientName, sub: `${d.type} · ${d.stage} · ${d.unit.ref}`, link: `#/deal/${d.id}`, icon: 'opportunity' })) });
    const projects = visibleProjects(actor);
    const units = visibleUnits(actor).filter((u) => match(u.ref, u.area, projects.find((p) => p.id === u.projectId)?.name, u.listingNo));
    if (units.length) groups.push({ label: 'Units', total: units.length, items: units.slice(0, 5).map((u) => ({ id: u.id, firmId: u.firmId, label: u.ref, sub: `${u.kind} · ${u.beds === 'Studio' ? 'Studio' : `${u.beds}BR`} · ${u.status}`, link: `#/inventory/unit/${u.id}`, icon: 'apps' })) });
    const people = getState().users.filter((u) => u.firmId === actor.firmId && u.status === 'Active' && match(u.name, u.email, u.role));
    if (people.length) groups.push({ label: 'People', total: people.length, items: people.slice(0, 5).map((u) => ({ id: u.id, firmId: u.firmId, label: u.name, sub: u.role, link: actor.role === 'Owner' ? '#/people' : '', icon: 'user' })) });
  }
  const pages = PAGES.filter(([id, label]) => allowedPages.includes(id) && (!q || (words.length > 0 && words.every((w) => label.toLowerCase().includes(w)))));
  const actions = [
    { label: 'Quick capture a lead', act: 'quickCapture', icon: 'add' },
    { label: 'Simulate a portal lead (demo)', act: 'simulateLead', icon: 'download' },
    { label: 'Open the Copilot', act: 'toggleCopilot', icon: 'sparkles' },
  ].filter((a) => !q || (words.length > 0 && words.every((w) => a.label.toLowerCase().includes(w))));
  if (pages.length || actions.length) groups.push({ label: 'Go to and actions', total: pages.length + actions.length, items: [...pages.map(([id, label, icon]) => ({ label, sub: 'Page', link: `#/${id === 'home' ? '' : id}`, icon })), ...actions.map((a) => ({ ...a, sub: 'Action' }))].slice(0, 8) });
  return { groups, parsed: labels, firm: firmOf(actor)?.name, sources: LEAD_SOURCES };
}
