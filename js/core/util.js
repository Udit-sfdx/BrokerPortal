// Small shared helpers: escaping, dates, money, validation. No DOM access here.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** HTML-escapes any value; null and undefined become an empty string. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const pad = (n) => String(n).padStart(2, '0');

/** Dates are shown in Gulf Standard Time (UTC+4), whatever the viewer's own time zone. */
const gst = (t) => new Date(t + 4 * HOUR);

export function fmtDate(t) {
  if (!t) return '—';
  const d = gst(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtTime(t) {
  if (!t) return '—';
  const d = gst(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const fmtDateTime = (t) => (t ? `${fmtDate(t)}, ${fmtTime(t)}` : '—');

/** "2h 05m", "3d 4h", "12m": absolute duration, with a leading minus when negative. */
export function fmtDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / MIN);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days) return `${sign}${days}d ${hours}h`;
  if (hours) return `${sign}${hours}h ${pad(mins)}m`;
  return `${sign}${mins}m`;
}

export function fmtAgo(t, now) {
  if (!t) return '—';
  const diff = now - t;
  if (diff < MIN) return 'just now';
  return `${fmtDuration(diff)} ago`;
}

export function fmtAED(value) {
  const n = Number(value);
  return `AED ${Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0'}`;
}

export function fmtCompact(value) {
  const n = Number(value) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

export const initials = (name) =>
  String(name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export const slug = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);

/** Deterministic pseudo-random generator so seed data is identical on every load. */
export function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- validation ---------- */

/** UAE-style normalisation: 050 123 4567 → +971501234567. Returns '' for empty input. */
export function normPhone(raw) {
  if (raw === null || raw === undefined) return '';
  let d = String(raw).replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (d.startsWith('0')) d = `+971${d.slice(1)}`;
  if (!d.startsWith('+')) d = `+${d}`;
  return d;
}

export const isPhone = (raw) => /^\+\d{9,15}$/.test(normPhone(raw));
export const isEmail = (raw) => typeof raw === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
export const isBlank = (raw) => raw === null || raw === undefined || String(raw).trim() === '';

/** Password rule for portal accounts: 10+ characters, one capital letter, one number. */
export function passwordProblems(pw) {
  const problems = [];
  if (!pw || pw.length < 10) problems.push('at least 10 characters');
  if (!/[A-Z]/.test(pw || '')) problems.push('one capital letter');
  if (!/\d/.test(pw || '')) problems.push('one number');
  return problems;
}

/** Throws a ValidationError when the list is non-empty; services use this like Apex addError. */
export class ValidationError extends Error {
  constructor(messages) {
    super(messages.join(' '));
    this.name = 'ValidationError';
    this.messages = messages;
  }
}

export function assertValid(messages) {
  if (messages.length) throw new ValidationError(messages);
}

/** Parses a date input value (yyyy-mm-dd) as midnight GST; returns null when empty or invalid. */
export function parseDateInput(value) {
  if (isBlank(value)) return null;
  const t = Date.parse(`${value}T00:00:00+04:00`);
  return Number.isNaN(t) ? null : t;
}

export function toDateInput(t) {
  if (!t) return '';
  const d = gst(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
