// Drop 2 demo data: leads, deals, tasks for the seed firms. Deterministic (same story on every reset).
// Also used to upgrade data saved by drop 1, so firms registered in this browser are kept.
// All names, numbers, projects and developers are fictional.

import { DAY, HOUR, MIN, rng } from './util.js';
import { LEAD_SOURCES, PIPELINES, DEAL_DOCUMENTS, LOST_REASONS, AREAS, TIMELINES, FINANCING, PURPOSES } from './config.js';
import { routeLead, scoreLead, buildPayments, buildHandover, newCommission, stagesFor, scheduleNextPayments } from './rules.js';

const PEOPLE = [
  { nat: 'Indian', lang: 'Hindi', first: ['Ankit', 'Neha', 'Vivek', 'Sunita', 'Karan', 'Pooja', 'Rahul', 'Divya'], last: ['Bansal', 'Kapoor', 'Iyer', 'Desai', 'Malhotra', 'Menon', 'Chawla', 'Reddy'] },
  { nat: 'Emirati', lang: 'Arabic', first: ['Ahmed', 'Mona', 'Hamad', 'Reem', 'Saeed', 'Noura'], last: ['Al Falasi', 'Al Hashimi', 'Al Ketbi', 'Al Marri', 'Al Shamsi', 'Al Nuaimi'] },
  { nat: 'Egyptian', lang: 'Arabic', first: ['Youssef', 'Layla', 'Omar', 'Dina', 'Tamer', 'Heba'], last: ['Darwish', 'Fahmy', 'Mansour', 'Ezzat', 'Salem', 'Naguib'] },
  { nat: 'Russian', lang: 'Russian', first: ['Alexei', 'Sergei', 'Pavel', 'Dmitry', 'Mikhail', 'Ivan'], last: ['Morozov', 'Pavlov', 'Sokolov', 'Lebedev', 'Novikov', 'Fedorov'] },
  { nat: 'British', lang: 'English', first: ['James', 'Emma', 'Oliver', 'Sophie', 'Harry', 'Charlotte'], last: ['Whitaker', 'Collins', 'Grant', 'Turnbull', 'Hughes', 'Pemberton'] },
  { nat: 'German', lang: 'German', first: ['Markus', 'Julia', 'Stefan', 'Anna'], last: ['Weber', 'Hoffmann', 'Becker', 'Schulz'] },
  { nat: 'Chinese', lang: 'Mandarin', first: ['Wei', 'Fang', 'Jie', 'Min', 'Lei', 'Yan'], last: ['Zhang', 'Wang', 'Chen', 'Zhou', 'Xu', 'Sun'], lastFirst: true },
  { nat: 'Pakistani', lang: 'Urdu', first: ['Bilal', 'Sana', 'Hamza', 'Ayesha', 'Usman', 'Hira'], last: ['Ahmed', 'Mirza', 'Qureshi', 'Siddiqui', 'Butt', 'Chaudhry'] },
  { nat: 'French', lang: 'French', first: ['Claire', 'Antoine', 'Camille', 'Julien'], last: ['Dubois', 'Laurent', 'Moreau', 'Girard'] },
];

export const PROJECTS = {
  'F-CK': [
    { name: 'Azure Crest Residences', developer: 'Meridian Developments', area: 'Jumeirah Village Circle' },
    { name: 'Palmyra Gardens', developer: 'Sandstone Living', area: 'Dubai Hills Estate' },
    { name: 'Harbor Lights Tower', developer: 'Coralline Properties', area: 'Dubai Creek Harbour' },
  ],
  'F-DR': [{ name: 'Sahara Bloom Villas', developer: 'Dunecrest Homes', area: 'Dubai South' }],
};

const PRICE = { 'Off-plan': [650e3, 950e3, 1.6e6, 2.6e6, 4e6], Secondary: [700e3, 1.1e6, 1.8e6, 2.9e6, 4.6e6], Rental: [55e3, 85e3, 130e3, 190e3, 260e3] };
const BEDS = ['Studio', '1', '2', '3', '4'];
const COBROKER = { firm: 'Harbour View Estates', orn: '28810', agent: 'Leah Gomez', splitPct: 50 };

const pick = (r, list) => list[Math.floor(r() * list.length)];
function weighted(r, pairs) {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
}

function person(r) {
  const g = pick(r, PEOPLE);
  const first = pick(r, g.first);
  const last = pick(r, g.last);
  const name = g.lastFirst ? `${last} ${first}` : `${first} ${last}`;
  const local = name.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).join('.');
  const prefix = { Russian: '+79', British: '+447', Chinese: '+861', German: '+491' }[g.nat];
  const phone = prefix && r() < 0.35 ? `${prefix}${String(Math.floor(r() * 1e9)).padStart(9, '0')}` : `+9715${pick(r, ['0', '2', '4', '5', '6', '8'])}${String(Math.floor(r() * 1e7)).padStart(7, '0')}`;
  const lang = g.lang === 'Hindi' || g.lang === 'Urdu' ? (r() < 0.6 ? 'English' : g.lang) : g.lang === 'Arabic' ? (r() < 0.75 ? 'Arabic' : 'English') : r() < 0.5 ? g.lang : 'English';
  return { name, phone, email: r() < 0.85 ? `${local}@mail.example` : '', nationality: g.nat, lang };
}

function interestFor(lead, projects) {
  if (lead.lob === 'Off-plan' && lead.project) return `${lead.beds === 'Studio' ? 'a studio' : `a ${lead.beds}BR`} at ${lead.project}`;
  if (lead.lob === 'Rental') return `${lead.beds === 'Studio' ? 'a studio' : `a ${lead.beds}BR`} to rent in ${lead.area}`;
  return `${lead.beds === 'Studio' ? 'a studio' : `a ${lead.beds}BR`} in ${lead.area}`;
}

/** Creates one lead record (not yet routed). Also used by the live lead feed. */
export function makeLead(r, firm, t0, createdAt, lob, overrides = {}) {
  const p = person(r);
  const bi = Math.floor(r() * BEDS.length);
  const projects = PROJECTS[firm.id] || [];
  const project = lob === 'Off-plan' && projects.length ? pick(r, projects) : null;
  const sourceWeights = lob === 'Off-plan'
    ? [['Property Finder', 3], ['Bayut', 2], ['Meta ads', 5], ['WhatsApp', 3], ['Website', 2], ['Google ads', 2], ['Developer event', 2], ['Referral', 1], ['Walk-in', 1], ['Dubizzle', 1]]
    : [['Property Finder', 5], ['Bayut', 5], ['Dubizzle', 3], ['Meta ads', 1], ['WhatsApp', 2], ['Website', 2], ['Google ads', 1], ['Referral', 2], ['Walk-in', 1], ['Developer event', 0]];
  const source = weighted(r, sourceWeights);
  const filled = r();
  const lead = {
    id: null, firmId: firm.id, ...p, source, lob,
    beds: BEDS[bi], budgetMax: filled < 0.85 ? Math.round((PRICE[lob][bi] * (0.85 + r() * 0.4)) / 1e4) * 1e4 : 0,
    area: project ? project.area : pick(r, AREAS), project: project ? project.name : null,
    purpose: filled < 0.7 ? (lob === 'Rental' ? 'End use' : pick(r, PURPOSES)) : '',
    timeline: filled < 0.75 ? pick(r, TIMELINES) : '', financing: lob === 'Rental' ? '' : filled < 0.6 ? pick(r, FINANCING) : '',
    status: 'New', ownerId: null, createdAt, slaDueAt: createdAt + firm.settings.sla.firstResponseMin * MIN,
    firstResponseAt: null, lastActivityAt: createdAt, nextFollowUpAt: null, score: 0, scoreReasons: [],
    dnc: r() < 0.05, consent: { whatsapp: r() < (LEAD_SOURCES[source]?.consent ?? 0.5), email: true }, duplicateOf: null,
    lostReason: null, dealId: null, routingTrace: [], activities: [], escalated: false, notes: '',
    ...overrides,
  };
  lead.interest = interestFor(lead, projects);
  return lead;
}

const act = (at, type, text, by) => ({ at, type, text, by });

/** Adds leads, deals, tasks and saved views for the seed firms to a state object (mutates it). */
export function addDrop2Data(s, t0) {
  s.leads = s.leads || [];
  s.deals = s.deals || [];
  s.tasks = s.tasks || [];
  s.savedViews = s.savedViews || [];
  s.feed = s.feed || { lastArrivalAt: t0 };
  s.seq = Math.max(s.seq || 2000, 2000);
  const nid = (prefix) => `${prefix}-${++s.seq}`;
  const userName = (id) => s.users.find((u) => u.id === id)?.name || 'Unassigned';

  const plans = [
    { firmId: 'F-CK', count: 180, lob: [['Off-plan', 55], ['Secondary', 35], ['Rental', 10]], deals: { 'Off-plan': 20, Secondary: 10 }, seed: 101 },
    { firmId: 'F-PA', count: 70, lob: [['Secondary', 50], ['Rental', 50]], deals: { Secondary: 8, Rental: 7 }, seed: 202 },
    { firmId: 'F-DR', count: 5, lob: [['Off-plan', 1]], deals: {}, seed: 303, recentOnly: true },
  ];

  for (const plan of plans) {
    const firm = s.firms.find((f) => f.id === plan.firmId);
    if (!firm || s.leads.some((l) => l.firmId === firm.id)) continue;
    const r = rng(plan.seed);
    const agents = s.users.filter((u) => u.firmId === firm.id && u.role === 'Agent' && u.status === 'Active');
    const openCount = {};
    const lastAssignedAt = {};
    const leads = [];

    // Hand-made fresh leads (the live part of the demo): Hindi-speaking off-plan buyers route to Sara Khan.
    const fresh = plan.firmId === 'F-CK'
      ? [[3, 'Off-plan', { lang: 'Hindi', source: 'Property Finder', timeline: 'Now', financing: 'Cash', budgetMax: 2400000, beds: '2' }],
        [8, 'Off-plan', { lang: 'Hindi', source: 'Meta ads', timeline: '1–3 months' }],
        [12, 'Secondary', {}], [19, 'Off-plan', {}], [27, 'Rental', {}], [44, 'Secondary', { lang: 'Russian' }]]
      : plan.firmId === 'F-PA' ? [[5, 'Rental', {}], [16, 'Secondary', {}], [33, 'Rental', { lang: 'Arabic' }]]
        : [[6, 'Off-plan', {}], [22, 'Off-plan', {}], [70, 'Off-plan', {}], [5 * 60, 'Off-plan', {}], [26 * 60, 'Off-plan', {}]];

    for (const [minsAgo, lob, over] of fresh) leads.push(makeLead(r, firm, t0, t0 - minsAgo * MIN, lob, over));
    const remaining = plan.count - fresh.length;
    for (let i = 0; i < remaining; i++) {
      const age = (0.05 + Math.pow(r(), 1.5) * 59.9) * DAY;
      leads.push(makeLead(r, firm, t0, t0 - age, weighted(r, plan.lob)));
    }
    leads.sort((a, b) => a.createdAt - b.createdAt);

    for (const lead of leads) {
      lead.id = nid('L');
      const routed = routeLead(lead, agents, firm.settings.routing, { openCount, lastAssignedAt, t: lead.createdAt });
      lead.ownerId = routed.ownerId;
      lead.routingTrace = routed.trace;
      if (routed.ownerId) {
        openCount[routed.ownerId] = (openCount[routed.ownerId] || 0) + 1;
        lastAssignedAt[routed.ownerId] = lead.createdAt;
      }
      lead.activities.push(act(lead.createdAt, 'created', `Enquiry from ${lead.source}: ${lead.interest}.`, 'System'));
      lead.activities.push(act(lead.createdAt + 2000, 'assign', routed.ownerId ? `Routed to ${userName(routed.ownerId)} in 2 seconds.` : 'No eligible agent; waiting for the team leader.', 'Routing'));

      const age = t0 - lead.createdAt;
      if (age < HOUR) { lead.status = 'New'; }
      else {
        lead.status = age < 2 * DAY
          ? weighted(r, [['Contacted', 50], ['Qualified', 25], ['New', 15], ['Lost', 10]])
          : age < 14 * DAY ? weighted(r, [['Contacted', 25], ['Qualified', 28], ['Viewing', 22], ['Lost', 25]])
            : weighted(r, [['Contacted', 8], ['Qualified', 14], ['Viewing', 10], ['Lost', 68]]);
      }
      if (lead.status !== 'New' && lead.ownerId) {
        const took = r() < 0.72 ? (2 + r() * 12) * MIN : (16 + r() * 80) * MIN;
        lead.firstResponseAt = lead.createdAt + took;
        const by = userName(lead.ownerId);
        if (lead.dnc || !lead.consent.whatsapp) lead.activities.push(act(lead.firstResponseAt, 'email', 'Sent "First reply" email.', by));
        else if (r() < 0.55) lead.activities.push(act(lead.firstResponseAt, 'call', 'Call: answered, 4 min. Interested; asked for payment plan.', by));
        else lead.activities.push(act(lead.firstResponseAt, 'whatsapp', 'Sent "First reply" on WhatsApp.', by));
        if (r() < 0.5) lead.activities.push(act(lead.firstResponseAt + (20 + r() * 300) * MIN, 'inbound', pick(r, ['Client: Thanks, can you share the floor plans?', 'Client: Is the price negotiable?', 'Client: I can talk after 6pm.', 'Client: Please send the payment plan.']), lead.name));
      } else if (lead.status !== 'New') lead.status = 'New';
      if (['Qualified', 'Viewing'].includes(lead.status)) {
        lead.budgetMax = lead.budgetMax || Math.round(PRICE[lead.lob][BEDS.indexOf(lead.beds)] / 1e4) * 1e4;
        lead.purpose = lead.purpose || (lead.lob === 'Rental' ? 'End use' : 'Investment');
        lead.timeline = lead.timeline || '1–3 months';
        lead.activities.push(act(lead.firstResponseAt + HOUR, 'status', 'Marked Qualified.', userName(lead.ownerId)));
      }
      if (lead.status === 'Lost') {
        lead.lostReason = pick(r, LOST_REASONS.filter((x) => x !== 'Duplicate'));
        lead.activities.push(act(Math.min(t0 - HOUR, (lead.firstResponseAt || lead.createdAt) + 2 * DAY), 'status', `Marked Lost: ${lead.lostReason}.`, userName(lead.ownerId)));
        if (lead.ownerId) openCount[lead.ownerId]--;
      }
      if (['Contacted', 'Qualified', 'Viewing'].includes(lead.status)) {
        lead.nextFollowUpAt = t0 + Math.round((-2 + r() * 6) * 24) * HOUR;
      }
      lead.lastActivityAt = lead.activities[lead.activities.length - 1].at;
      lead.activities.reverse();
    }

    // Duplicates inside this firm: the same person enquires again through another channel.
    const dupBase = leads.filter((l) => l.status !== 'Lost').slice(10, 13);
    for (const base of dupBase) {
      const d = makeLead(r, firm, t0, t0 - (2 + r() * 20) * HOUR, base.lob, { name: base.name, phone: base.phone, email: base.email, nationality: base.nationality, lang: base.lang, source: 'WhatsApp' });
      d.id = nid('L');
      d.ownerId = base.ownerId;
      d.duplicateOf = base.id;
      d.routingTrace = ['Matched an open lead with the same phone in your firm', `Kept with ${userName(base.ownerId)}`];
      d.activities = [act(d.createdAt + 2000, 'assign', `Same phone as ${base.id}: kept with ${userName(base.ownerId)}.`, 'Routing'), act(d.createdAt, 'created', `Enquiry from WhatsApp: ${d.interest}.`, 'System')];
      leads.push(d);
    }

    // Deals: converted from older leads; Sara Khan gets the first five off-plan deals.
    const used = new Set();
    for (const [type, n] of Object.entries(plan.deals)) {
      const candidates = leads.filter((l) => l.lob === type && t0 - l.createdAt > 6 * DAY && l.ownerId && !l.duplicateOf)
        .sort((a, b) => a.createdAt - b.createdAt);
      const sara = candidates.filter((l) => l.ownerId === 'U-CK-10').slice(0, type === 'Off-plan' ? 5 : 0);
      const others = candidates.filter((l) => l.ownerId !== 'U-CK-10');
      const chosen = [...sara, ...others].filter((l) => !used.has(l.id)).slice(0, n);
      chosen.forEach((lead, i) => {
        used.add(lead.id);
        const deal = makeDeal(r, s, firm, lead, type, i, t0, nid);
        s.deals.push(deal);
        lead.status = 'Converted';
        lead.dealId = deal.id;
        lead.nextFollowUpAt = null;
        lead.firstResponseAt = lead.firstResponseAt || lead.createdAt + 6 * MIN;
        lead.activities.unshift(act(deal.createdAt, 'convert', `Converted to deal ${deal.id} (${type}).`, userName(lead.ownerId)));
        lead.lastActivityAt = deal.createdAt;
      });
    }

    for (const lead of leads) {
      const sc = scoreLead(lead, t0);
      lead.score = sc.score;
      lead.scoreReasons = sc.reasons;
    }
    s.leads.push(...leads);

    // Tasks: follow-ups for open leads, viewings for leads at Viewing, and a fixed day for Sara Khan.
    for (const lead of leads) {
      if (!lead.ownerId || !lead.nextFollowUpAt) continue;
      if (lead.status === 'Viewing') {
        s.tasks.push({ id: nid('T'), firmId: firm.id, ownerId: lead.ownerId, type: 'viewing', title: `Viewing: ${lead.interest}`, leadId: lead.id, dealId: null, dueAt: lead.nextFollowUpAt, done: false, doneAt: null, createdAt: lead.lastActivityAt });
      } else {
        s.tasks.push({ id: nid('T'), firmId: firm.id, ownerId: lead.ownerId, type: 'followup', title: `Follow up with ${lead.name}`, leadId: lead.id, dealId: null, dueAt: lead.nextFollowUpAt, done: false, doneAt: null, createdAt: lead.lastActivityAt });
      }
    }
  }

  // Sara Khan's day: two viewings later today and one follow-up already overdue, on her own open leads.
  const saraLeads = s.leads.filter((l) => l.ownerId === 'U-CK-10' && ['Contacted', 'Qualified'].includes(l.status)).slice(0, 3);
  if (saraLeads.length === 3 && !s.tasks.some((t) => t.ownerId === 'U-CK-10' && t.title.startsWith('Viewing: ') && t.seeded)) {
    const [a, b, c] = saraLeads;
    for (const [lead, inH, type] of [[a, 2, 'viewing'], [b, 5, 'viewing'], [c, -3, 'followup']]) {
      if (type === 'viewing') lead.status = 'Viewing';
      lead.nextFollowUpAt = t0 + inH * HOUR;
      s.tasks = s.tasks.filter((t) => t.leadId !== lead.id);
      s.tasks.push({ id: nid('T'), firmId: 'F-CK', ownerId: 'U-CK-10', type, title: type === 'viewing' ? `Viewing: ${lead.interest}` : `Follow up with ${lead.name}`, leadId: lead.id, dealId: null, dueAt: lead.nextFollowUpAt, done: false, doneAt: null, createdAt: t0 - DAY, seeded: true });
    }
  }

  // Two clients enquire at both Crescent Key and Palm Arc: each firm has its own lead, and neither is flagged.
  const ckLead = s.leads.find((l) => l.firmId === 'F-CK' && l.lob === 'Secondary' && l.status === 'Contacted');
  const paLead = s.leads.find((l) => l.firmId === 'F-PA' && l.lob === 'Secondary' && l.status === 'Contacted');
  if (ckLead && paLead && !s.leads.some((l) => l.crossFirmTwin)) {
    paLead.name = ckLead.name; paLead.phone = ckLead.phone; paLead.email = ckLead.email; paLead.nationality = ckLead.nationality;
    paLead.crossFirmTwin = true; ckLead.crossFirmTwin = true;
  }
  s.feed.lastArrivalAt = t0;
  return s;
}

/** Builds a deal whose documents, KYC and payments match how far it has got. */
function makeDeal(r, s, firm, lead, type, i, t0, nid) {
  const stages = stagesFor(type);
  // Stage mix: early-heavy, a few won, one lost per type.
  const stageId = i === 1 ? 'Lost' : weighted(r, stages.map((st, k) => [st.id, k === stages.length - 1 ? 2 : 4 - Math.min(k, 2)]));
  const createdAt = lead.createdAt + (2 + r() * 4) * DAY;
  const project = (PROJECTS[firm.id] || []).find((p) => p.name === lead.project);
  const bi = Math.max(0, BEDS.indexOf(lead.beds));
  const value = Math.round((PRICE[type][bi] * (0.9 + r() * 0.35)) / 1e4) * 1e4;
  const deal = {
    id: nid('D'), firmId: firm.id, leadId: lead.id, clientName: lead.name, clientPhone: lead.phone, clientEmail: lead.email, nationality: lead.nationality,
    type, stage: stageId, value, ownerId: lead.ownerId, createdAt, stageChangedAt: createdAt, closedAt: null, lostReason: null,
    unit: {
      project: project ? project.name : null, developer: project ? project.developer : null, area: lead.area, beds: lead.beds,
      ref: project ? `${pick(r, ['Tower A', 'Tower B', 'Block C'])} · ${Math.floor(3 + r() * 30)}${String(Math.floor(1 + r() * 12)).padStart(2, '0')}` : `Unit ${Math.floor(100 + r() * 2900)}, ${lead.area}`,
      sizeSqft: [450, 780, 1150, 1650, 2400][bi],
    },
    documents: {}, kyc: { status: 'Not started', fields: {}, submittedAt: null, verifiedAt: null, verifiedBy: null, screening: { status: 'Not run', at: null, hits: [], clearedBy: null } },
    payments: buildPayments(type, value, createdAt), handover: buildHandover(type), coBroke: i % 7 === 3 ? { ...COBROKER } : null,
    commission: newCommission(type), cashAmount: 0, rearDrafted: false, history: [],
  };
  const lostIndex = stageId === 'Lost' ? 1 : stages.findIndex((st) => st.id === stageId);
  const reached = stageId === 'Lost' ? 0 : lostIndex;
  // When the deal entered its current stage: about 30% have sat past the stage's limit (stuck).
  const st = stages[reached];
  const limit = (st && st.stuckDays) || 10;
  const stuck = st && st.stuckDays && stageId !== 'Lost' && r() < 0.3;
  const enteredAt = Math.max(createdAt + HOUR, stuck ? t0 - (limit + 3 + r() * 12) * DAY : t0 - (0.5 + r() * 0.8 * limit) * DAY);
  // Satisfy every gate up to that stage, spread between creation and entering the current stage.
  for (let k = 1; k <= reached; k++) {
    const at = createdAt + ((enteredAt - createdAt) * k) / reached;
    for (const req of stages[k].gate || []) satisfy(deal, req, at - HOUR, r);
    deal.history.push({ at, from: stages[k - 1].id, to: stages[k].id, by: s.users.find((u) => u.id === deal.ownerId)?.name || 'System' });
  }
  deal.stageChangedAt = enteredAt;
  // Half the open deals have started on the next gate (e.g. passport in, Emirates ID missing).
  const next = stages[reached + 1];
  if (stageId !== 'Lost' && next && r() < 0.6) {
    const reqs = next.gate || [];
    reqs.slice(0, Math.max(1, Math.floor(reqs.length / 2))).forEach((req) => satisfy(deal, req, t0 - 2 * DAY, r));
  }
  if (stageId === 'Lost') {
    deal.lostReason = pick(r, ['Client bought elsewhere', 'Finance not approved', 'Seller withdrew']);
    deal.closedAt = createdAt + 10 * DAY;
    deal.stageChangedAt = deal.closedAt;
  }
  if (stageId === 'Won') {
    deal.closedAt = deal.stageChangedAt;
    deal.commission.invoicedAt = deal.closedAt;
    deal.commission.invoiceDueAt = deal.closedAt + 30 * DAY;
    deal.commission.status = deal.commission.invoiceDueAt < t0 && r() < 0.5 ? 'Invoiced' : weighted(r, [['Collected', 2], ['Paid out', 2], ['Invoiced', 1]]);
    if (deal.commission.status !== 'Invoiced') deal.commission.collectedAt = deal.closedAt + 20 * DAY;
  }
  // Scenario: a secondary client whose name is close to a watchlist entry, and a large cash deposit.
  if (firm.id === 'F-CK' && type === 'Secondary' && i === 2) {
    deal.clientName = 'Viktor Brankovich';
    deal.stage = 'Offer';
    deal.kyc = { status: 'Not started', fields: {}, submittedAt: null, verifiedAt: null, verifiedBy: null, screening: { status: 'Not run', at: null, hits: [], clearedBy: null } };
    deal.documents = {};
    deal.payments.forEach((p) => { p.paidAt = null; });
    deal.cashAmount = 120000;
    deal.closedAt = null;
    deal.lostReason = null;
    deal.stageChangedAt = t0 - 2 * DAY;
  }
  scheduleNextPayments(deal);
  return deal;
}

function satisfy(deal, req, at, r) {
  const [kind, key] = req.split(':');
  if (kind === 'doc') {
    const reader = DEAL_DOCUMENTS[key]?.reader;
    deal.documents[key] = { file: `${key}-${deal.id.toLowerCase()}.pdf`, uploadedAt: at, by: 'Agent', confirmed: true, fields: reader ? kycFields(deal, r) : {} };
    if (reader) Object.assign(deal.kyc.fields, pickFields(deal.documents[key].fields, reader));
  } else if (kind === 'kyc') {
    if (!deal.documents.passport) satisfy(deal, 'doc:passport', at, r);
    if (!deal.documents.eid) satisfy(deal, 'doc:eid', at, r);
    Object.assign(deal.kyc, { status: 'Verified', submittedAt: at, verifiedAt: at + HOUR, verifiedBy: 'Huda Karim' });
  } else if (kind === 'screening') {
    deal.kyc.screening = { status: 'Clear', at, hits: [], clearedBy: null };
  } else if (kind === 'pay') {
    const p = deal.payments.find((x) => x.key === key);
    if (p) { p.paidAt = at; p.method = 'Bank transfer'; }
  } else if (kind === 'handover') {
    deal.handover.forEach((h) => { h.done = true; });
  }
}

function kycFields(deal, r) {
  return {
    fullName: deal.clientName, passportNo: `${String.fromCharCode(65 + Math.floor(r() * 26))}${Math.floor(1e7 + r() * 9e7)}`, nationality: deal.nationality,
    dob: Date.UTC(1965 + Math.floor(r() * 30), Math.floor(r() * 12), 1 + Math.floor(r() * 27)), passportExpiry: deal.createdAt + (400 + r() * 1500) * DAY,
    eidNo: `784-19${Math.floor(60 + r() * 35)}-${Math.floor(1e6 + r() * 9e6)}-${Math.floor(r() * 9)}`, eidExpiry: deal.createdAt + (300 + r() * 900) * DAY,
  };
}

const pickFields = (all, keys) => Object.fromEntries(keys.map((k) => [k, all[k]]));
