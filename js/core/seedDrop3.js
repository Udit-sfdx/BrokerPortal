// Drop 3 demo data: projects and units, resale and rental listings, campaigns with permits, spend and creatives,
// campaign attribution on leads, a KYC queue, coaching notes and integration status. Deterministic.
// Also used to upgrade data saved by drops 1–2 in this browser. All names and numbers are fictional.

import { DAY, HOUR, rng } from './util.js';
import { AREAS, LOCKED_GATES } from './config.js';
import { PROJECTS } from './seedDrop2.js';

const pick = (r, list) => list[Math.floor(r() * list.length)];
const BEDS = ['Studio', '1', '2', '3', '4'];
const PPSF = { 'Jumeirah Village Circle': 1350, 'Dubai Hills Estate': 2100, 'Dubai Creek Harbour': 2400, 'Dubai South': 950 };
const SIZE = { Studio: 430, 1: 760, 2: 1180, 3: 1690, 4: 2450 };
const BUILDINGS = ['Marina Crest Tower', 'Bayview Residences 2', 'Greenline Villas', 'Lakeside Court', 'Canal Point', 'Palmview Heights', 'Cedar Gate', 'Skyline Terraces'];

export function addDrop3Data(s, t0) {
  s.projects = s.projects || [];
  s.units = s.units || [];
  s.campaigns = s.campaigns || [];
  s.coachingNotes = s.coachingNotes || [];
  s.seq = Math.max(s.seq || 3000, 3000);
  const nid = (prefix) => `${prefix}-${++s.seq}`;
  const r = rng(404);

  for (const f of s.firms) {
    f.settings.integrations = f.settings.integrations || {
      propertyFinder: !!f.settings.golive?.propertyFinder, bayut: !!f.settings.golive?.bayut, meta: f.id === 'F-CK', whatsapp: !!f.settings.golive?.whatsapp,
      telephony: f.id === 'F-CK' || f.id === 'F-PA', trakheesi: f.id === 'F-CK', goaml: f.id === 'F-CK',
    };
    f.settings.gates = f.settings.gates || {};
    f.settings.commission = f.settings.commission || {};
    f.settings.templates = f.settings.templates || {};
    f.settings.lockedGates = LOCKED_GATES;
  }

  // Off-plan projects and units (Crescent Key 3 projects ~120 units, Desert Rose 1 project).
  for (const [firmId, projects] of Object.entries(PROJECTS)) {
    if (!s.firms.some((f) => f.id === firmId) || s.projects.some((p) => p.firmId === firmId)) continue;
    projects.forEach((p, i) => {
      const project = {
        id: nid('PRJ'), firmId, name: p.name, developer: p.developer, area: p.area, handover: `Q${1 + ((i + 2) % 4)} ${2027 + (i % 3)}`,
        plan: ['60/40', '50/50', '70/30'][i % 3], offer: ['4% DLD fee waived', 'Free service charge for 2 years', '1% booking until month end'][i % 3],
        commissionPct: [5, 6, 4][i % 3],
      };
      s.projects.push(project);
      const count = firmId === 'F-DR' ? 20 : [50, 40, 30][i];
      for (let n = 0; n < count; n++) {
        const beds = firmId === 'F-DR' ? pick(r, ['3', '4']) : pick(r, BEDS);
        const size = Math.round(SIZE[beds] * (0.9 + r() * 0.25));
        const floor = 2 + Math.floor(r() * 40);
        const status = r() < 0.58 ? 'Available' : r() < 0.4 ? 'Reserved' : 'Sold';
        s.units.push({
          id: nid('U'), firmId, kind: 'Off-plan', projectId: project.id, area: p.area, beds, sizeSqft: size,
          price: Math.round((size * (PPSF[p.area] || 1500) * (1 + floor * 0.004)) / 1e3) * 1e3,
          ref: firmId === 'F-DR' ? `Villa ${100 + n}` : `${pick(r, ['Tower A', 'Tower B', 'Block C'])} · ${floor}${String(1 + (n % 12)).padStart(2, '0')}`,
          floor, view: pick(r, ['Pool', 'Park', 'City', 'Community', 'Water']), status, reservedFor: null,
        });
      }
    });
  }

  // Palm Arc resale and rental listings (~40).
  if (s.firms.some((f) => f.id === 'F-PA') && !s.units.some((u) => u.firmId === 'F-PA')) {
    for (let n = 0; n < 40; n++) {
      const kind = n % 2 ? 'Rental' : 'Resale';
      const beds = pick(r, BEDS);
      const area = pick(r, ['Dubai Marina', 'Jumeirah Lake Towers', 'Business Bay', 'Al Barsha', 'Jumeirah Village Circle', 'Downtown Dubai']);
      const size = Math.round(SIZE[beds] * (0.9 + r() * 0.3));
      s.units.push({
        id: nid('U'), firmId: 'F-PA', kind, projectId: null, area, beds, sizeSqft: size,
        price: kind === 'Rental' ? Math.round((size * (75 + r() * 60)) / 1e3) * 1e3 : Math.round((size * (1300 + r() * 1300)) / 1e4) * 1e4,
        ref: `Apt ${100 + Math.floor(r() * 3000)}, ${pick(r, BUILDINGS)}`, floor: 1 + Math.floor(r() * 30), view: pick(r, ['Sea', 'Marina', 'Lake', 'City', 'Community']),
        status: r() < 0.7 ? 'Available' : r() < 0.5 ? 'Reserved' : 'Sold', reservedFor: null,
        listingNo: `${kind === 'Rental' ? 'RL' : 'SL'}-${70000 + n * 37}`,
      });
    }
  }

  // Crescent Key campaigns: one with no permit, one whose permit expires soon.
  if (s.firms.some((f) => f.id === 'F-CK') && !s.campaigns.some((c) => c.firmId === 'F-CK')) {
    const prj = (name) => s.projects.find((p) => p.name === name)?.id || null;
    const defs = [
      { name: 'Azure Crest launch', project: 'Azure Crest Residences', channels: ['Meta ads', 'Google ads'], status: 'Live', permit: { number: '7104452', expiresAt: t0 + 140 * DAY }, budget: 3200, start: 56, lob: 'Off-plan' },
      { name: 'Palmyra Gardens VIP preview', project: 'Palmyra Gardens', channels: ['Developer event', 'Meta ads'], status: 'Live', permit: { number: '7109918', expiresAt: t0 + 12 * DAY }, budget: 2600, start: 40, lob: 'Off-plan' },
      { name: 'Harbor Lights Q4', project: 'Harbor Lights Tower', channels: ['Google ads'], status: 'Draft', permit: null, budget: 2000, start: 0, lob: 'Off-plan' },
      { name: 'Secondary listings always-on', project: null, channels: ['Meta ads'], status: 'Paused', permit: { number: '7098120', expiresAt: t0 + 75 * DAY }, budget: 1500, start: 58, lob: 'Secondary' },
    ];
    for (const d of defs) {
      const c = {
        id: nid('CMP'), firmId: 'F-CK', name: d.name, projectId: prj(d.project), lob: d.lob, channels: d.channels, status: d.status, permit: d.permit,
        budget: d.budget, startAt: t0 - d.start * DAY, endAt: t0 + 30 * DAY, createdAt: t0 - (d.start + 5) * DAY, spend: [], creatives: [],
        history: [{ at: t0 - (d.start + 5) * DAY, text: 'Campaign created.', by: 'Maya Rizk' }],
      };
      // Weekly spend per channel since the start; the always-on campaign stopped two weeks ago.
      for (let w = Math.floor(d.start / 7); w >= (d.status === 'Paused' ? 2 : 0) && d.start; w--) {
        for (const ch of d.channels) c.spend.push({ at: t0 - w * 7 * DAY, channel: ch, amount: Math.round((d.budget / Math.max(1, d.start / 7) / d.channels.length) * (0.75 + r() * 0.5)) });
      }
      const label = d.project || 'ready homes';
      c.creatives = [
        { id: nid('CR'), name: 'Hero video', lang: 'English', headline: `${label}: move-in ready payment plans`, body: `Own at ${label} with an easy payment plan. Book a private viewing.${d.permit ? ` Permit ${d.permit.number}` : ''}`, status: d.status === 'Draft' ? 'Draft' : 'Approved', channel: d.channels[0] },
        { id: nid('CR'), name: 'Carousel (Arabic)', lang: 'Arabic', headline: `${label}: خطط دفع مرنة`, body: `امتلك وحدتك في ${label} بخطة دفع مريحة. احجز معاينة خاصة.${d.permit ? ` تصريح ${d.permit.number}` : ''}`, status: d.status === 'Draft' ? 'Draft' : 'Approved', channel: d.channels[d.channels.length - 1] },
      ];
      s.campaigns.push(c);
    }
    // Attribute paid-channel leads to the campaign running for their project/line of business at the time.
    const camps = s.campaigns.filter((c) => c.firmId === 'F-CK' && c.spend.length);
    for (const l of s.leads.filter((x) => x.firmId === 'F-CK' && ['Meta ads', 'Google ads', 'Developer event'].includes(x.source))) {
      const projectId = l.project ? s.projects.find((p) => p.name === l.project)?.id : null;
      const c = camps.find((x) => x.channels.includes(l.source) && l.createdAt >= x.startAt && (x.projectId ? x.projectId === projectId : x.lob === l.lob));
      if (c) {
        l.campaignId = c.id;
        const cr = c.creatives.find((k) => k.channel === l.source) || c.creatives[0];
        l.creativeId = cr.id;
      }
    }
  }

  // KYC queue of 6 at Crescent Key: deals with both IDs confirmed, waiting for Compliance.
  const queue = s.deals.filter((d) => d.firmId === 'F-CK' && d.ownerId !== 'U-CK-10' && d.kyc.status === 'Not started' && d.documents.passport?.confirmed && d.documents.eid?.confirmed && !['Won', 'Lost'].includes(d.stage));
  const candidates = queue.length >= 6 ? queue : s.deals.filter((d) => d.firmId === 'F-CK' && d.ownerId !== 'U-CK-10' && ['EOI', 'Viewing', 'Offer'].includes(d.stage) && d.kyc.status === 'Not started' && d.clientName !== 'Viktor Brankovich');
  for (const d of candidates.slice(0, Math.max(0, 6 - s.deals.filter((x) => x.firmId === 'F-CK' && x.kyc.status === 'Submitted').length))) {
    for (const key of ['passport', 'eid']) {
      if (!d.documents[key]?.confirmed) {
        d.documents[key] = { file: `${key}-${d.id.toLowerCase()}.pdf`, uploadedAt: t0 - 2 * DAY, by: 'Agent', confirmed: true, fields: { fullName: d.clientName } };
      }
    }
    d.kyc.fields = { ...d.kyc.fields, fullName: d.clientName };
    d.kyc.status = 'Submitted';
    d.kyc.submittedAt = t0 - (2 + Math.floor(r() * 30)) * HOUR;
  }

  // A few coaching notes written by team leaders last week.
  if (!s.coachingNotes.length) {
    const ck = (id) => s.users.find((u) => u.id === id);
    for (const [agentId, by, text] of [
      ['U-CK-11', 'U-CK-3', 'Strong on calls. Log the outcome straight after each call so the SLA clock stops.'],
      ['U-CK-12', 'U-CK-3', 'Follow-ups slipping on Fridays. Block 30 minutes after lunch for them.'],
      ['U-CK-16', 'U-CK-4', 'Great secondary conversions. Share your viewing checklist with the team.'],
    ]) {
      if (ck(agentId) && ck(by)) s.coachingNotes.push({ id: nid('CN'), firmId: 'F-CK', agentId, by: ck(by).name, at: t0 - (3 + s.coachingNotes.length) * DAY, text });
    }
  }
  return s;
}

export const _demo = { AREAS };
