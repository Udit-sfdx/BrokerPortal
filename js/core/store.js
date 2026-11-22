// Browser data store shared by every page (join, portal, console) and every open tab.
// Shared data lives in localStorage; each tab's signed-in user lives in sessionStorage.
// Data resets after 8 hours without activity, or when the seed version changes.

import { buildSeed, SEED_VERSION } from './seed.js';
import { addDrop2Data } from './seedDrop2.js';
import { addDrop3Data } from './seedDrop3.js';

const KEY = 'bp.state';
const SESSION_KEY = 'bp.session';
const IDLE_MS = 8 * 60 * 60 * 1000;

let state = null;
const listeners = new Set();

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - (parsed.lastActive || 0) > IDLE_MS) return null;
    return upgrade(parsed);
  } catch (err) {
    console.warn('Broker Portal: stored data unreadable, starting fresh.', err);
    return null;
  }
}

/** Brings data saved by an older drop up to date, keeping firms and people registered in this browser. */
function upgrade(parsed) {
  if (parsed.version === SEED_VERSION) return parsed;
  if (parsed.version === 2 || parsed.version === 3) {
    if (parsed.version === 2) addDrop2Data(parsed, Date.now());
    addDrop3Data(parsed, Date.now());
    parsed.version = SEED_VERSION;
    return parsed;
  }
  return null;
}

function fresh() {
  const seeded = buildSeed(Date.now());
  seeded.version = SEED_VERSION;
  seeded.lastActive = Date.now();
  return seeded;
}

function write() {
  state.lastActive = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Broker Portal: could not save to browser storage.', err);
  }
}

const notify = () => listeners.forEach((fn) => fn());

/** Current state without building it (null while the seed is being generated). */
export const peekState = () => state;

export function getState() {
  if (!state) {
    state = readStored() || fresh();
    write();
  }
  return state;
}

/** Runs a change against the shared state, saves it, and re-renders every subscriber. */
export function mutate(change) {
  const s = getState();
  const result = change(s);
  write();
  notify();
  return result;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetAll() {
  state = fresh();
  write();
  notify();
}

/** Demo clock: real time plus an offset the presenter can move. */
export function now() {
  const s = getState();
  return Date.now() + (s.clockOffset || 0);
}

export function nextId(prefix) {
  const s = getState();
  s.seq = (s.seq || 1000) + 1;
  return `${prefix}-${s.seq}`;
}

/** Appends to the audit trail; every service action that changes data calls this. */
export function audit(actor, action, detail, firmId = null) {
  const s = getState();
  s.audit.unshift({ id: nextId('AU'), at: now(), actor, action, detail, firmId });
  if (s.audit.length > 500) s.audit.length = 500;
}

/** Simulated outgoing email, listed in the operator console's email log. */
export function sendEmail(to, subject, body, link = null) {
  const s = getState();
  s.outbox.unshift({ id: nextId('EM'), at: now(), to, subject, body, link });
}

// Another tab changed the data: pick it up and re-render.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY || !event.newValue) return;
  try {
    const parsed = upgrade(JSON.parse(event.newValue));
    if (parsed) {
      state = parsed;
      notify();
    }
  } catch (err) {
    console.warn('Broker Portal: ignored unreadable update from another tab.', err);
  }
});

/** Per-tab session: who is signed in here, plus drafts that must not leak to other tabs. */
export const tabSession = {
  get(key, fallback = null) {
    try {
      const all = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
      return key in all ? all[key] : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      const all = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
      if (value === null || value === undefined) delete all[key];
      else all[key] = value;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(all));
    } catch (err) {
      console.warn('Broker Portal: could not save tab session.', err);
    }
  },
};
