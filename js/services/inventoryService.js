// Inventory: projects, units and listings (firm-wide records), unit matching and holds.
// Mirrors BP_InventoryService (Apex). Firm-wide records are shared to the firm's role group only.

import { getState, mutate, now, nextId, audit } from '../core/store.js';
import { assertValid, isBlank, fmtAED } from '../core/util.js';
import { UNIT_STATUSES } from '../core/config.js';
import { matchUnits } from '../core/rules.js';
import { firmOf } from './firmService.js';
import { getLead, canWorkLead, isOpenLead } from './leadService.js';

const EDITORS = ['Owner', 'Director'];
export const canEditInventory = (actor) => EDITORS.includes(actor.role);

export const visibleProjects = (actor) => getState().projects.filter((p) => p.firmId === actor.firmId);
export const visibleUnits = (actor) => getState().units.filter((u) => u.firmId === actor.firmId);
export const getUnit = (actor, id) => getState().units.find((u) => u.id === id && u.firmId === actor.firmId) || null;

/** Top units for one of the actor's leads (never another firm's stock). */
export function matchesForLead(actor, leadId, limit = 5) {
  const lead = getLead(actor, leadId);
  if (!lead) return [];
  return matchUnits(lead, visibleUnits(actor), visibleProjects(actor), limit);
}

/** Short unit description used in messages: "2BR, Tower A · 1204, Palmyra Gardens". */
export function unitLabel(unit, projects) {
  const p = projects.find((x) => x.id === unit.projectId);
  return `${unit.beds === 'Studio' ? 'Studio' : `${unit.beds}BR`}, ${unit.ref}${p ? `, ${p.name}` : `, ${unit.area}`}`;
}

export const unitPriceText = (unit) => (unit.kind === 'Rental' ? `${fmtAED(unit.price)} a year` : fmtAED(unit.price));

function requireWritable(actor) {
  const firm = firmOf(actor);
  assertValid(firm && ['Active', 'Trial'].includes(firm.status) ? [] : ['Your firm is read-only right now: no changes can be saved.']);
}

/** Holds a unit for one of the actor's open leads (Available → Reserved). */
export function holdUnit(actor, unitId, leadId) {
  requireWritable(actor);
  const unit = getUnit(actor, unitId);
  const lead = getLead(actor, leadId);
  const problems = [];
  if (!unit) problems.push('Unit not found.');
  else if (unit.status !== 'Available') problems.push(`This unit is ${unit.status.toLowerCase()}.`);
  if (!lead) problems.push('Choose one of your leads.');
  else if (!canWorkLead(actor, lead) || !isOpenLead(lead)) problems.push('You can only hold units for your own open leads.');
  assertValid(problems);
  return mutate((s) => {
    const u = s.units.find((x) => x.id === unitId);
    const l = s.leads.find((x) => x.id === leadId);
    const t = now();
    Object.assign(u, { status: 'Reserved', reservedFor: leadId, reservedBy: actor.name, reservedAt: t });
    l.activities.unshift({ at: t, type: 'note', text: `Held unit ${u.ref} for this client.`, by: actor.name });
    l.lastActivityAt = t;
    return u;
  });
}

export function releaseUnit(actor, unitId) {
  requireWritable(actor);
  const unit = getUnit(actor, unitId);
  assertValid(unit && unit.status === 'Reserved' ? [] : ['Only a held unit can be released.']);
  const lead = unit.reservedFor ? getState().leads.find((l) => l.id === unit.reservedFor) : null;
  assertValid(canEditInventory(actor) || (lead && lead.ownerId === actor.id) ? [] : ['Only the agent who holds it or a manager can release this unit.']);
  return mutate((s) => {
    const u = s.units.find((x) => x.id === unitId);
    Object.assign(u, { status: 'Available', reservedFor: null, reservedBy: null, reservedAt: null });
    return u;
  });
}

export function updateUnit(actor, unitId, { price, status }) {
  requireWritable(actor);
  const unit = getUnit(actor, unitId);
  const problems = [];
  if (!canEditInventory(actor)) problems.push('Only the owner or a director can change prices and availability.');
  if (!unit) problems.push('Unit not found.');
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0 || p > 1e9) problems.push('Price must be a positive number.');
  if (!UNIT_STATUSES.includes(status)) problems.push('Choose a status.');
  assertValid(problems);
  return mutate((s) => {
    const u = s.units.find((x) => x.id === unitId);
    const before = `${fmtAED(u.price)}, ${u.status}`;
    u.price = Math.round(p);
    u.status = status;
    if (status !== 'Reserved') { u.reservedFor = null; u.reservedBy = null; }
    audit(actor.name, 'Unit updated', `${u.ref}: ${before} → ${fmtAED(u.price)}, ${u.status}.`, actor.firmId);
    return u;
  });
}

export const _isBlank = isBlank;
export const _nextId = nextId;
