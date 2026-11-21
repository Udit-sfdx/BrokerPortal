// Product-wide constants and the default settings every new firm workspace starts with.

export const ROLES = ['Owner', 'Director', 'Team Leader', 'Agent', 'Marketing', 'Compliance'];

/** Roles that see the whole firm's records; the rest see their team (TL) or their own (Agent). */
export const FIRM_WIDE_ROLES = ['Owner', 'Director', 'Marketing', 'Compliance'];

export const PLANS = {
  Trial: { label: 'Trial', detail: '14 days, every feature, up to 5 users', marketing: true },
  A: { label: 'Option A · Lead Operations', detail: 'Leads, deals, compliance, commission', marketing: false },
  B: { label: 'Option B · Lead Ops + Marketing', detail: 'Everything in A plus campaigns, permits and ROI', marketing: true },
};

export const FIRM_STATUSES = ['Pending verification', 'Needs information', 'Trial', 'Active', 'Suspended', 'Rejected', 'Offboarded'];

export const EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Umm Al Quwain', 'Fujairah'];

export const LANGUAGES = ['English', 'Arabic', 'Hindi', 'Urdu', 'Russian', 'French', 'German', 'Mandarin', 'Malayalam'];

export const LINES_OF_BUSINESS = ['Off-plan', 'Secondary', 'Rental', 'Commercial'];

export const BRAND_COLOURS = ['#0b5cab', '#2e844a', '#b85c00', '#7526e3', '#ba0517', '#0d9dda', '#3e3e3c'];

export const INVITE_TTL_DAYS = 7;
export const TRIAL_DAYS = 14;

/** Document types a firm uploads during sign-up, with the fields the Document Reader extracts. */
export const FIRM_DOCUMENTS = [
  { key: 'tradeLicence', label: 'Trade licence (DED)', fields: ['licenceNo', 'licenceExpiry', 'activity', 'legalName'] },
  { key: 'ornCertificate', label: 'RERA office registration (ORN) certificate', fields: ['orn', 'ornExpiry'] },
  { key: 'ownerEid', label: "Owner's Emirates ID", fields: ['eidName', 'eidExpiry'] },
];

export const FIELD_LABELS = {
  licenceNo: 'Trade licence number',
  licenceExpiry: 'Trade licence expiry',
  activity: 'Licensed activity',
  legalName: 'Legal name',
  orn: 'ORN',
  ornExpiry: 'ORN expiry',
  eidName: 'Name on Emirates ID',
  eidExpiry: 'Emirates ID expiry',
};

export function defaultFirmSettings() {
  return {
    sla: { firstResponseMin: 15, reassignAfterMin: 15 },
    callWindow: { start: 9, end: 18 },
    routing: [
      { id: 'licence', label: 'Valid BRN licence', hard: true, on: true },
      { id: 'lob', label: 'Line of business match', on: true },
      { id: 'lang', label: 'Language match', on: true },
      { id: 'workload', label: 'Lowest open workload', on: true, order: true },
      { id: 'rr', label: 'Round-robin tie-break', on: true, order: true },
    ],
    visibility: 'role',
    golive: { propertyFinder: false, bayut: false, whatsapp: false, firstLead: false },
  };
}

/* ---------- drop 2: leads, deals, templates ---------- */

/** Ten lead channels. quality feeds the Lead Qualifier score; consent = WhatsApp opt-in captured at source. */
export const LEAD_SOURCES = {
  'Property Finder': { quality: 14, consent: 0.6 },
  Bayut: { quality: 13, consent: 0.6 },
  Dubizzle: { quality: 8, consent: 0.5 },
  'Meta ads': { quality: 6, consent: 1 },
  WhatsApp: { quality: 12, consent: 1 },
  Website: { quality: 11, consent: 0.8 },
  'Google ads': { quality: 9, consent: 0.7 },
  'Walk-in': { quality: 16, consent: 1 },
  Referral: { quality: 18, consent: 1 },
  'Developer event': { quality: 15, consent: 1 },
};

export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Viewing', 'Converted', 'Lost'];
export const OPEN_LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Viewing'];
export const LOST_REASONS = ['Not reachable', 'Budget mismatch', 'Bought elsewhere', 'Not interested', 'Duplicate', 'Invalid number'];
export const AREAS = ['Dubai Marina', 'Business Bay', 'Downtown Dubai', 'Jumeirah Village Circle', 'Dubai Hills Estate', 'Palm Jumeirah', 'Arjan', 'Dubai Creek Harbour', 'Mohammed Bin Rashid City', 'Dubai South', 'Jumeirah Lake Towers', 'Al Barsha'];
export const PURPOSES = ['Investment', 'End use'];
export const TIMELINES = ['Now', '1–3 months', '3–6 months', '6+ months'];
export const FINANCING = ['Cash', 'Mortgage', 'Not sure'];
export const BEDROOMS = ['Studio', '1', '2', '3', '4', '5+'];

/** Fields a lead needs before it can be marked Qualified (Lead Qualifier fills what it can). */
export const QUALIFICATION_FIELDS = [
  ['lob', 'Deal type'], ['budgetMax', 'Budget'], ['beds', 'Bedrooms'], ['area', 'Preferred area'], ['purpose', 'Purpose'], ['timeline', 'Timeline'],
];

/** Documents a deal can carry. reader: fields the Document Reader extracts into KYC. */
export const DEAL_DOCUMENTS = {
  passport: { label: 'Client passport', reader: ['fullName', 'passportNo', 'nationality', 'dob', 'passportExpiry'] },
  eid: { label: 'Client Emirates ID', reader: ['fullName', 'eidNo', 'eidExpiry'] },
  spa: { label: 'Sale and purchase agreement (SPA)' },
  oqood: { label: 'Oqood registration certificate' },
  formF: { label: 'MOU (Form F)' },
  noc: { label: 'Developer NOC' },
  titleDeed: { label: 'New title deed' },
  tenancy: { label: 'Tenancy contract' },
  ejari: { label: 'Ejari certificate' },
};

export const KYC_FIELD_LABELS = {
  fullName: 'Full name', passportNo: 'Passport number', nationality: 'Nationality', dob: 'Date of birth',
  passportExpiry: 'Passport expiry', eidNo: 'Emirates ID number', eidExpiry: 'Emirates ID expiry',
};

/**
 * Pipelines per deal type. gate = what must be true before a deal may ENTER that stage:
 *   kyc · doc:<key> (uploaded and confirmed) · pay:<key> (payment received) · screening (clear) · handover (checklist done)
 * stuckDays = a deal sitting longer than this in the stage is flagged as stuck.
 */
export const PIPELINES = {
  'Off-plan': [
    { id: 'EOI', label: 'EOI', stuckDays: 7 },
    { id: 'Booking', label: 'Booking', stuckDays: 10, gate: ['doc:passport', 'doc:eid', 'kyc', 'pay:booking'] },
    { id: 'SPA', label: 'SPA signed', stuckDays: 21, gate: ['screening', 'doc:spa'] },
    { id: 'Oqood', label: 'Oqood registered', stuckDays: 30, gate: ['pay:dld', 'doc:oqood'] },
    { id: 'Won', label: 'Won', gate: ['handover'] },
  ],
  Secondary: [
    { id: 'Viewing', label: 'Viewing', stuckDays: 7 },
    { id: 'Offer', label: 'Offer', stuckDays: 7 },
    { id: 'MOU', label: 'MOU signed', stuckDays: 14, gate: ['doc:passport', 'doc:eid', 'kyc', 'doc:formF'] },
    { id: 'NOC', label: 'NOC obtained', stuckDays: 14, gate: ['pay:deposit', 'doc:noc'] },
    { id: 'Transfer', label: 'Transferred', stuckDays: 10, gate: ['screening', 'pay:balance', 'doc:titleDeed'] },
    { id: 'Won', label: 'Won', gate: ['handover'] },
  ],
  Rental: [
    { id: 'Viewing', label: 'Viewing', stuckDays: 5 },
    { id: 'Offer', label: 'Offer', stuckDays: 5 },
    { id: 'Contract', label: 'Contract signed', stuckDays: 7, gate: ['doc:passport', 'doc:eid', 'kyc', 'pay:security', 'doc:tenancy'] },
    { id: 'Ejari', label: 'Ejari registered', stuckDays: 7, gate: ['doc:ejari'] },
    { id: 'Won', label: 'Won', gate: ['handover'] },
  ],
};
export const DEAL_TYPES = Object.keys(PIPELINES);

/** Payment plan templates (pct of deal value; rental: of annual rent). gatePay = keys checked by stage gates. */
export const PAYMENT_PLANS = {
  'Off-plan': [['booking', 'Booking deposit', 10], ['dld', 'DLD registration fee', 4], ['inst1', 'Instalment at 30% construction', 10], ['inst2', 'Instalment at 60% construction', 10], ['handover', 'On handover', 66]],
  Secondary: [['deposit', 'Security deposit (10%)', 10], ['balance', "Balance by manager's cheque", 90]],
  Rental: [['security', 'Security deposit', 5], ['rent1', 'First rent cheque', 25]],
};

export const HANDOVER_CHECKLISTS = {
  'Off-plan': ['SPA copy shared with client', 'Oqood certificate shared', 'Developer commission invoice raised', 'Client welcome call done'],
  Secondary: ['Keys handed over', 'DEWA transferred', 'Title deed copy shared', 'Commission invoice raised'],
  Rental: ['Keys handed over', 'DEWA connected', 'Ejari copy shared', 'Commission invoice raised'],
};

/** Commission defaults by deal type: who pays and the rate. VAT is 5%. */
export const COMMISSION_RULES = {
  'Off-plan': { rate: 5, payer: 'Developer', agentShare: 50 },
  Secondary: { rate: 2, payer: 'Buyer', agentShare: 50 },
  Rental: { rate: 5, payer: 'Tenant', agentShare: 50 },
};
export const VAT_RATE = 5;
/** Cash at or above this amount needs a REAR report to the AML officer (demo threshold). */
export const CASH_REPORT_THRESHOLD = 55000;

/** Message templates (English and Arabic). Placeholders: {first} {agent} {firm} {interest} {when}. */
export const MESSAGE_TEMPLATES = [
  {
    id: 'intro', name: 'First reply',
    en: 'Hi {first}, this is {agent} from {firm}. Thanks for your enquiry about {interest}. When is a good time for a quick call?',
    ar: 'مرحباً {first}، معك {agent} من {firm}. شكراً لاستفسارك عن {interest}. متى يناسبك أن نتحدث هاتفياً؟',
  },
  {
    id: 'followup', name: 'Missed call follow-up',
    en: 'Hi {first}, I tried calling you today about {interest}. Let me know a time that suits you. {agent}, {firm}',
    ar: 'مرحباً {first}، حاولت الاتصال بك اليوم بخصوص {interest}. أخبرني بالوقت المناسب لك. {agent}، {firm}',
  },
  {
    id: 'viewing', name: 'Viewing confirmation',
    en: 'Hi {first}, your viewing is confirmed for {when}. I will share the location before we meet. {agent}, {firm}',
    ar: 'مرحباً {first}، تم تأكيد موعد المعاينة {when}. سأرسل لك الموقع قبل الموعد. {agent}، {firm}',
  },
  {
    id: 'plan', name: 'Payment plan',
    en: 'Hi {first}, as promised here is the payment plan for {interest}. Happy to walk you through it. {agent}, {firm}',
    ar: 'مرحباً {first}، كما وعدتك، هذه خطة الدفع لـ {interest}. يسعدني أن أشرحها لك. {agent}، {firm}',
  },
];

/** Fictional names on the demo screening watchlist. */
export const WATCHLIST = [
  { name: 'Viktor Brankovic', list: 'Demo sanctions list', reason: 'Asset freeze (demo)' },
  { name: 'Hassan Rafiq Dawood', list: 'Demo PEP list', reason: 'Politically exposed person (demo)' },
  { name: 'Marta Kolesnik', list: 'Demo sanctions list', reason: 'Travel ban (demo)' },
];
