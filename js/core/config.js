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
