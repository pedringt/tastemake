import { evidenceRecords } from "./evidence.js";

// #326 Design A (docs/proposals/326-refresh-options.md, section 4): the refresh ledger. Ratings carry no date,
// so "new since the last refresh" is decided by a short fingerprint per tried item: its kind (liked, loved,
// disliked, starred, starter favorite, which says both direction and strength) and its reasons. After each
// refresh that placed items, the ledger holds the fingerprint each one had when it was placed. An item is new
// when it isn't in the ledger or its fingerprint changed (a liked item now disliked, a reason added).
//
// Stored as state.profileLedger, beside the patterns (saved in localStorage with the rest of the profile):
//   items     { [ref]: fingerprint }   placed (or given up on) at that fingerprint
//   pool      [ref]                    "not yet explained": placed as unexplained, or failed 3 refreshes
//   failures  { [ref]: n }             refreshes whose answer had no valid placement for this item
// No ledger (state saved before Design A, or a restored backup) is the first run: every tried item no stored
// pattern cites is new (Paige, Nov 14, decision 7). Anything else unusable is treated the same way.

export const LEDGER_VERSION = 1;
export const MAX_ITEMS_PER_CALL = 30;      // decision 7: the rest waits for the next refresh
export const MAX_POOL_PER_CALL = 30;
export const FAILURES_BEFORE_POOL = 3;     // an item that can't be placed 3 times moves to the pool

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// The ledger as stored, or null when there is none or it can't be used. Never throws.
export function readLedger(raw) {
  if (!isPlainObject(raw) || raw.version !== LEDGER_VERSION || !isPlainObject(raw.items)) return null;
  const items = Object.fromEntries(Object.entries(raw.items).filter(([ref, fp]) => ref.startsWith("ev:") && typeof fp === "string"));
  const pool = Array.isArray(raw.pool) ? [...new Set(raw.pool.filter((ref) => typeof ref === "string" && ref in items))] : [];
  const failures = isPlainObject(raw.failures)
    ? Object.fromEntries(Object.entries(raw.failures).filter(([ref, n]) => ref.startsWith("ev:") && Number.isInteger(n) && n > 0))
    : {};
  return { version: LEDGER_VERSION, items, pool, failures };
}

export const triedEvidence = (state) => evidenceRecords(state).filter((row) => row.class === "experienced");

export function fingerprint(row) {
  const reasons = (row.refinements ?? []).map((r) => (typeof r === "string" ? r : r?.id)).filter(Boolean);
  return `${row.kind}|${[...new Set(reasons)].sort().join(",")}`;
}

const citedRefs = (patterns) => new Set((patterns ?? []).flatMap((p) => [...(p.supports ?? []), ...(p.counters ?? [])]));

// What this refresh has to place.
//   items     the new tried items sent this time (at most MAX_ITEMS_PER_CALL, oldest first so none waits forever)
//   waiting   how many more are new but wait for the next refresh
//   pool      pooled items still present (at most MAX_POOL_PER_CALL, the most recently pooled)
//   changed   new items the ledger had at a different fingerprint, with what they were before
//   removed   ledger entries whose rating is gone
//   firstRun  true when there was no usable ledger
export function refreshQueue(state) {
  const rows = triedEvidence(state);
  const byRef = new Map(rows.map((row) => [row.ref, row]));
  const ledger = readLedger(state.profileLedger);
  const firstRun = !ledger;
  const cited = citedRefs(state.modelHypotheses);
  const isNew = (row) => (firstRun ? !cited.has(row.ref) : ledger.items[row.ref] !== fingerprint(row));
  const fresh = rows.filter(isNew);
  const changed = firstRun ? [] : fresh.filter((row) => row.ref in ledger.items).map((row) => ({ ref: row.ref, was: ledger.items[row.ref], now: fingerprint(row) }));
  const removed = firstRun ? [] : Object.keys(ledger.items).filter((ref) => !byRef.has(ref));
  const freshRefs = new Set(fresh.map((row) => row.ref));
  const pool = (ledger?.pool ?? []).filter((ref) => byRef.has(ref) && !freshRefs.has(ref)).slice(-MAX_POOL_PER_CALL);
  return {
    items: fresh.slice(0, MAX_ITEMS_PER_CALL).map((row) => row.ref),
    waiting: Math.max(0, fresh.length - MAX_ITEMS_PER_CALL),
    pool,
    changed,
    removed,
    firstRun
  };
}

// The ledger after a refresh. `placed` are items with a valid placement this time, `pooled` the ones that go to
// the pool (unexplained, or out of tries), `failed` the ones whose placement was missing or invalid. Items not
// mentioned (waiting, or a call that failed) are left exactly as they were, so they stay new.
export function advanceLedger(state, { placed = [], pooled = [], failed = [], unpooled = [] } = {}) {
  const rows = new Map(triedEvidence(state).map((row) => [row.ref, row]));
  const before = readLedger(state.profileLedger);
  const ledger = before ?? { version: LEDGER_VERSION, items: {}, pool: [], failures: {} };
  if (!before) {
    // First run: everything that wasn't new (cited by a stored pattern) was seen at its current fingerprint.
    const cited = citedRefs(state.modelHypotheses);
    for (const [ref, row] of rows) if (cited.has(ref)) ledger.items[ref] = fingerprint(row);
  }
  const items = { ...ledger.items };
  const failures = { ...ledger.failures };
  let pool = [...ledger.pool];
  for (const ref of Object.keys(items)) if (!rows.has(ref)) { delete items[ref]; delete failures[ref]; }
  const outOfTries = [];
  for (const ref of failed) {
    if (!rows.has(ref)) continue;
    failures[ref] = (failures[ref] ?? 0) + 1;
    if (failures[ref] >= FAILURES_BEFORE_POOL) outOfTries.push(ref);
  }
  const settle = (ref) => { items[ref] = fingerprint(rows.get(ref)); delete failures[ref]; };
  const leaving = new Set([...placed, ...unpooled]);
  pool = pool.filter((ref) => rows.has(ref) && !leaving.has(ref));
  for (const ref of [...placed, ...pooled, ...outOfTries]) if (rows.has(ref)) settle(ref);
  for (const ref of [...pooled, ...outOfTries]) if (rows.has(ref) && !pool.includes(ref)) pool.push(ref);
  // A pooled item whose rating changed is new again; it leaves the pool until it is placed again.
  pool = pool.filter((ref) => items[ref] === fingerprint(rows.get(ref)));
  return { version: LEDGER_VERSION, items, pool, failures };
}

// After a refresh that rebuilt the whole profile (today's path, used for a first build or as the fallback while
// the flag is on): every tried item was seen. Items no pattern cites go to the pool.
export function ledgerAfterFullRefresh(state) {
  const cited = citedRefs(state.modelHypotheses);
  const rows = triedEvidence(state);
  return {
    version: LEDGER_VERSION,
    items: Object.fromEntries(rows.map((row) => [row.ref, fingerprint(row)])),
    pool: rows.filter((row) => !cited.has(row.ref) && row.polarity > 0).map((row) => row.ref),
    failures: {}
  };
}
