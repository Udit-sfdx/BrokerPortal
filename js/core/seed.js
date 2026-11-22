// Starting data. Deterministic: the same people, firms and records on every reset.
// All people, firms, licence numbers and figures are fictional.

import { DAY, HOUR, slug } from './util.js';
import { defaultFirmSettings } from './config.js';
import { addDrop2Data } from './seedDrop2.js';
import { addDrop3Data } from './seedDrop3.js';

export const SEED_VERSION = 4;

function makeUser(firm, n, name, role, extra = {}) {
  const first = name.toLowerCase().replace(/[^a-z ]/g, '').split(' ');
  const local = first.join('.');
  const email = extra.email || `${local}@${firm ? slug(firm.name) : 'thinkvibes'}.example`;
  return {
    id: `U-${firm ? firm.code : 'TV'}-${n}`,
    firmId: firm ? firm.id : null,
    name,
    email,
    username: `${local}@${firm ? slug(firm.name) : 'thinkvibes'}.bp`,
    role,
    teamId: null,
    status: 'Active',
    brn: null,
    brnExpiry: null,
    langs: ['English'],
    lob: [],
    invitedAt: null,
    activatedAt: null,
    deactivatedAt: null,
    inviteToken: null,
    ...extra,
  };
}

export function buildSeed(t0) {
  const ago = (ms) => t0 - ms;
  const ahead = (ms) => t0 + ms;

  const firm = (id, code, name, extra) => ({
    id,
    code,
    name,
    legalName: `${name} L.L.C`,
    emirate: 'Dubai',
    address: '',
    agentsExpected: 0,
    tradeLicence: '',
    licenceExpiry: null,
    activity: 'Real estate brokerage',
    orn: '',
    ornExpiry: null,
    brand: '#0b5cab',
    logo: null,
    status: 'Active',
    plan: 'B',
    seats: 10,
    trialEndsAt: null,
    setupComplete: true,
    createdAt: ago(120 * DAY),
    approvedAt: ago(119 * DAY),
    loginAccessGranted: false,
    documents: {},
    checks: [],
    verification: null,
    reviewNotes: [],
    statusHistory: [],
    teams: [],
    settings: defaultFirmSettings(),
    ownerId: null,
    ...extra,
  });

  const ck = firm('F-CK', 'CK', 'Crescent Key Realty', {
    brand: '#0b5cab', plan: 'B', seats: 20, tradeLicence: 'DED-1048572', licenceExpiry: ahead(210 * DAY),
    orn: '29871', ornExpiry: ahead(160 * DAY), agentsExpected: 12, address: 'Office 1204, Bay Square 3, Business Bay',
    teams: [{ id: 'T-CK-1', name: 'Off-plan team' }, { id: 'T-CK-2', name: 'Secondary team' }],
  });
  ck.settings.golive = { propertyFinder: true, bayut: true, whatsapp: true, firstLead: true };

  const pa = firm('F-PA', 'PA', 'Palm Arc Properties', {
    brand: '#2e844a', plan: 'A', seats: 10, tradeLicence: 'DED-1177301', licenceExpiry: ahead(95 * DAY),
    orn: '30412', ornExpiry: ahead(70 * DAY), agentsExpected: 6, createdAt: ago(80 * DAY), approvedAt: ago(79 * DAY),
    address: 'Unit 305, Marina Plaza, Dubai Marina', teams: [{ id: 'T-PA-1', name: 'Sales and leasing' }],
  });
  pa.settings.golive = { propertyFinder: true, bayut: true, whatsapp: false, firstLead: true };

  const dr = firm('F-DR', 'DR', 'Desert Rose Homes', {
    brand: '#b85c00', plan: 'Trial', status: 'Trial', seats: 5, tradeLicence: 'DED-1290466', licenceExpiry: ahead(300 * DAY),
    orn: '31108', ornExpiry: ahead(280 * DAY), agentsExpected: 3, createdAt: ago(3 * DAY), approvedAt: ago(2 * DAY),
    trialEndsAt: ahead(12 * DAY), setupComplete: false, address: 'Shop 7, Al Barsha South', teams: [],
  });

  const op = firm('F-OP', 'OP', 'Oasis Point Properties', {
    brand: '#7526e3', plan: 'A', status: 'Pending verification', seats: 8, tradeLicence: 'DED-1302215', licenceExpiry: ahead(330 * DAY),
    orn: '31790', ornExpiry: ahead(300 * DAY), agentsExpected: 7, createdAt: ago(20 * HOUR), approvedAt: null, setupComplete: false,
    address: 'Office 902, Arenco Tower, Dubai Media City', teams: [],
    documents: {
      tradeLicence: { file: 'oasis-trade-licence.pdf', uploadedAt: ago(20 * HOUR), fields: { licenceNo: 'DED-1302215', licenceExpiry: ahead(330 * DAY), activity: 'Real estate brokerage', legalName: 'Oasis Point Properties L.L.C' }, confirmed: true },
      ornCertificate: { file: 'oasis-orn.pdf', uploadedAt: ago(20 * HOUR), fields: { orn: '31790', ornExpiry: ahead(300 * DAY) }, confirmed: true },
      ownerEid: { file: 'owner-eid.jpg', uploadedAt: ago(20 * HOUR), fields: { eidName: 'Tariq Al Amiri', eidExpiry: ahead(700 * DAY) }, confirmed: true },
    },
    checks: [
      { label: 'Trade licence is valid', ok: true },
      { label: 'ORN is valid', ok: true },
      { label: 'Licensed activity covers real estate brokerage', ok: true },
      { label: 'Firm not already registered', ok: true },
    ],
    verification: { requestedAt: ago(20 * HOUR), respondedAt: ago(20 * HOUR - 2000), result: 'verified', source: 'stub' },
  });

  const firms = [ck, pa, dr, op];
  for (const f of firms) {
    f.statusHistory.push({ at: f.createdAt, status: 'Pending verification', by: 'System' });
    if (f.approvedAt) f.statusHistory.push({ at: f.approvedAt, status: f.status === 'Active' ? 'Active' : 'Trial', by: 'Ananya Iyer (ThinkVibes)' });
  }

  const users = [];
  const add = (u) => {
    users.push(u);
    return u;
  };

  // Crescent Key Realty: owner, director, 2 team leaders, 12 agents, marketing, compliance.
  const ckOwner = add(makeUser(ck, 1, 'Khalid Mansour', 'Owner', { activatedAt: ck.approvedAt }));
  ck.ownerId = ckOwner.id;
  add(makeUser(ck, 2, 'Noor Hamdan', 'Director', { activatedAt: ago(110 * DAY) }));
  add(makeUser(ck, 3, 'Rania Aziz', 'Team Leader', { teamId: 'T-CK-1', brn: '40018', brnExpiry: ahead(150 * DAY), langs: ['Arabic', 'English', 'French'], lob: ['Off-plan'], activatedAt: ago(110 * DAY) }));
  add(makeUser(ck, 4, 'Sameer Joshi', 'Team Leader', { teamId: 'T-CK-2', brn: '40177', brnExpiry: ahead(190 * DAY), langs: ['English', 'Hindi'], lob: ['Secondary', 'Rental'], activatedAt: ago(110 * DAY) }));
  add(makeUser(ck, 5, 'Maya Rizk', 'Marketing', { activatedAt: ago(100 * DAY) }));
  add(makeUser(ck, 6, 'Huda Karim', 'Compliance', { activatedAt: ago(100 * DAY) }));
  const ckAgents = [
    ['Sara Khan', 'T-CK-1', ['English', 'Arabic', 'Hindi'], ['Off-plan'], 300],
    ['Omar Haddad', 'T-CK-1', ['Arabic', 'English'], ['Off-plan'], 260],
    ['Lena Fischer', 'T-CK-1', ['German', 'English', 'Russian'], ['Off-plan'], 330],
    ['Dmitri Volkov', 'T-CK-1', ['Russian', 'English'], ['Off-plan'], -24],
    ['Aisha Rahman', 'T-CK-1', ['English', 'Arabic', 'Urdu'], ['Off-plan'], 200],
    ['Chen Wei', 'T-CK-1', ['Mandarin', 'English'], ['Off-plan'], 180],
    ['Priya Nair', 'T-CK-2', ['English', 'Hindi', 'Malayalam'], ['Secondary', 'Rental'], 120],
    ['Yusuf Saleh', 'T-CK-2', ['Arabic', 'English'], ['Secondary'], 22],
    ['Grace Morris', 'T-CK-2', ['English'], ['Secondary', 'Rental'], 240],
    ['Karim Nasser', 'T-CK-2', ['Arabic', 'English', 'French'], ['Secondary'], 310],
    ['Elena Petrova', 'T-CK-2', ['Russian', 'English'], ['Secondary', 'Rental'], 140],
  ];
  ckAgents.forEach(([name, teamId, langs, lob, days], i) =>
    add(makeUser(ck, 10 + i, name, 'Agent', { teamId, langs, lob, brn: String(48200 + i * 37), brnExpiry: ahead(days * DAY), activatedAt: ago((90 - i) * DAY) })),
  );
  // Vikram left Crescent Key and joined Palm Arc: old login deactivated, new login at Palm Arc.
  add(makeUser(ck, 30, 'Vikram Rao', 'Agent', {
    teamId: 'T-CK-2', langs: ['English', 'Hindi'], lob: ['Secondary'], brn: '47731', brnExpiry: ahead(260 * DAY),
    email: 'vikram.rao@example.com', status: 'Deactivated', activatedAt: ago(100 * DAY), deactivatedAt: ago(9 * DAY),
  }));

  // Palm Arc Properties: owner, team leader, 6 agents (Vikram is the newest).
  const paOwner = add(makeUser(pa, 1, 'Faisal Noor', 'Owner', { activatedAt: pa.approvedAt }));
  pa.ownerId = paOwner.id;
  add(makeUser(pa, 2, 'Mariam Al Zaabi', 'Team Leader', { teamId: 'T-PA-1', brn: '41290', brnExpiry: ahead(220 * DAY), langs: ['Arabic', 'English'], lob: ['Secondary', 'Rental'], activatedAt: ago(78 * DAY) }));
  const paAgents = [
    ['Daniel Carter', ['English'], ['Secondary', 'Rental'], 250],
    ['Fatima Al Suwaidi', ['Arabic', 'English'], ['Rental'], 18],
    ['Arjun Mehta', ['English', 'Hindi'], ['Secondary'], 270],
    ['Olga Smirnova', ['Russian', 'English'], ['Secondary', 'Rental'], 160],
    ['Tariq Saleh', ['Arabic', 'English'], ['Rental'], 210],
  ];
  paAgents.forEach(([name, langs, lob, days], i) =>
    add(makeUser(pa, 10 + i, name, 'Agent', { teamId: 'T-PA-1', langs, lob, brn: String(49100 + i * 41), brnExpiry: ahead(days * DAY), activatedAt: ago((70 - i) * DAY) })),
  );
  add(makeUser(pa, 30, 'Vikram Rao', 'Agent', {
    teamId: 'T-PA-1', langs: ['English', 'Hindi'], lob: ['Secondary'], brn: '47731', brnExpiry: ahead(260 * DAY),
    email: 'vikram.rao@example.com', activatedAt: ago(7 * DAY), invitedAt: ago(8 * DAY),
  }));

  // Desert Rose Homes: approved two days ago; the owner hasn't finished setup yet.
  const drOwner = add(makeUser(dr, 1, 'Zara Malik', 'Owner', { activatedAt: dr.approvedAt }));
  dr.ownerId = drOwner.id;

  // Oasis Point Properties: applied yesterday, waiting for ThinkVibes review; no access yet.
  const opOwner = add(makeUser(op, 1, 'Tariq Al Amiri', 'Owner', { status: 'Pending', activatedAt: null }));
  op.ownerId = opOwner.id;

  // ThinkVibes staff (operator console only; never members of a firm).
  const operators = [
    { id: 'OP-1', name: 'Ananya Iyer', email: 'ananya.iyer@thinkvibes.example', role: 'Sales' },
    { id: 'OP-2', name: 'Rohan Verma', email: 'rohan.verma@thinkvibes.example', role: 'Operations' },
  ];

  const joinRequests = [
    { id: 'JR-1', firmName: 'Skyline Homes Real Estate', emirate: 'Dubai', contactName: 'Hassan Qureshi', email: 'hassan@skylinehomes.example', phone: '+971509902410', agents: 9, message: 'We run off-plan sales for three developers and want to move off spreadsheets.', status: 'Requested', reason: '', at: ago(2 * HOUR), decidedAt: null, decidedBy: null },
    { id: 'JR-2', firmName: 'Golden Sands Realty', emirate: 'Sharjah', contactName: 'Peter Walsh', email: 'peter@goldensands.example', phone: '+971555120034', agents: 4, message: 'Interested in the leasing features.', status: 'Declined', reason: 'Sharjah rule pack not available yet; we will contact you when it launches.', at: ago(6 * DAY), decidedAt: ago(5 * DAY), decidedBy: 'Ananya Iyer' },
    { id: 'JR-3', firmName: 'Marina Gate Realty', emirate: 'Dubai', contactName: 'Omar Saeed', email: 'omar@marinagate.example', phone: '+971527713390', agents: 6, message: 'Referred by Crescent Key Realty.', status: 'Invited', reason: '', at: ago(2 * DAY), decidedAt: ago(1 * DAY), decidedBy: 'Ananya Iyer' },
  ];

  const invites = [
    { token: 'MGR7Q2K', firmName: 'Marina Gate Realty', ownerName: 'Omar Saeed', ownerEmail: 'omar@marinagate.example', emirate: 'Dubai', requestId: 'JR-3', createdAt: ago(1 * DAY), expiresAt: ahead(6 * DAY), usedAt: null, revokedAt: null, createdBy: 'Ananya Iyer', firmId: null },
    { token: 'HBV2M8D', firmName: 'Harbour View Estates', ownerName: 'Leah Gomez', ownerEmail: 'leah@harbourview.example', emirate: 'Dubai', requestId: null, createdAt: ago(9 * DAY), expiresAt: ago(2 * DAY), usedAt: null, revokedAt: null, createdBy: 'Ananya Iyer', firmId: null },
    { token: 'OPP5X9M', firmName: 'Oasis Point Properties', ownerName: 'Tariq Al Amiri', ownerEmail: opOwner.email, emirate: 'Dubai', requestId: null, createdAt: ago(3 * DAY), expiresAt: ahead(4 * DAY), usedAt: ago(20 * HOUR), revokedAt: null, createdBy: 'Rohan Verma', firmId: 'F-OP' },
    { token: 'DRH4K7P', firmName: 'Desert Rose Homes', ownerName: 'Zara Malik', ownerEmail: drOwner.email, emirate: 'Dubai', requestId: null, createdAt: ago(5 * DAY), expiresAt: ahead(2 * DAY), usedAt: ago(3 * DAY), revokedAt: null, createdBy: 'Ananya Iyer', firmId: 'F-DR' },
  ];

  const audit = [
    { id: 'AU-3', at: ago(20 * HOUR), actor: 'Tariq Al Amiri', action: 'Registration submitted', detail: 'Oasis Point Properties submitted documents; verification API answered verified (stub).', firmId: 'F-OP' },
    { id: 'AU-2', at: ago(2 * DAY), actor: 'Ananya Iyer (ThinkVibes)', action: 'Firm approved', detail: 'Desert Rose Homes approved; trial workspace created.', firmId: 'F-DR' },
    { id: 'AU-1', at: ago(9 * DAY), actor: 'Khalid Mansour', action: 'User deactivated', detail: 'Vikram Rao left Crescent Key Realty; login deactivated, open leads re-routed.', firmId: 'F-CK' },
  ];

  const outbox = [
    { id: 'EM-2', at: ago(1 * DAY), to: 'omar@marinagate.example', subject: 'Your invitation to Broker Portal', body: 'Marina Gate Realty is invited to join Broker Portal. The link expires in 7 days.', link: 'join/#/invite/MGR7Q2K' },
    { id: 'EM-1', at: ago(2 * DAY), to: drOwner.email, subject: 'Desert Rose Homes is approved', body: 'Your trial workspace is ready. Sign in to finish setting up your firm.', link: 'portal/' },
  ];

  const notifications = [
    { id: 'N-1', userId: drOwner.id, text: 'Your firm is approved. Finish setup to invite your team.', link: '#/onboarding', at: ago(2 * DAY), read: false },
    { id: 'N-2', userId: 'OP-ALL', text: 'Oasis Point Properties is waiting for review.', link: '#/verification', at: ago(20 * HOUR), read: false },
    { id: 'N-3', userId: 'OP-ALL', text: 'New request to join: Skyline Homes Real Estate.', link: '#/requests', at: ago(2 * HOUR), read: false },
  ];

  const state = {
    seq: 2000,
    clockOffset: 0,
    firms,
    users,
    operators,
    joinRequests,
    invites,
    audit,
    outbox,
    notifications,
    otp: {},
    leads: [],
    deals: [],
    campaigns: [],
    projects: [],
    activities: [],
    tasks: [],
    savedViews: [],
    createdAt: t0,
  };
  return addDrop3Data(addDrop2Data(state, t0), t0);
}
