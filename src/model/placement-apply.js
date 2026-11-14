import { evidenceRecords } from "./evidence.js";
import { recordRevision, recordRevisionIfChanged } from "./history.js";
import { allowedCrossDomain, allowedLevel, capLevel, domainScope, evidenceRows } from "./evidence-rules.js";
import { NEEDS_REVIEW, confirmationFor, contextQualifiedFor } from "./statements.js";
import { advanceLedger } from "./refresh-ledger.js";
import { fileSupports } from "../ai/support-filing.js";
import { CROSS_DOMAIN, LEVELS } from "../ai/contract.js";

// #326 Design A: software applies a checked placement answer (src/ai/placement.js) to the stored Taste Profile.
// The model never writes a pattern here; every change below is a rule (Paige's decisions, Nov 14):
//   - supports and counters are added to the named pattern; nothing old is re-cited or reworded (decision 5);
//   - a changed rating comes off a pattern where it no longer fits its side (a liked item now disliked leaves
//     supports; it was sent as new, so it can come back as a counter);
//   - a removed rating comes off an unconfirmed pattern; on a confirmed one it stays cited and the pattern is
//     flagged "Needs another look", as today (#325);
//   - level, areas and cross-area reach are recomputed from the evidence (src/model/evidence-rules.js) for every
//     pattern that changed;
//   - unconfirmed: 2+ counters lower it one level below what its evidence allows; it retires when its counters
//     outnumber its supports (decision 2);
//   - confirmed: never dropped, reworded, narrowed or lowered; 2+ counters added since it was confirmed flag it
//     "Needs another look" (decision 3);
//   - accepted new patterns are added at the level their evidence allows (decision 4);
//   - the #364 support filing runs over the result, as today;
//   - one history entry per changed pattern; the ledger and pool are updated (src/model/refresh-ledger.js).

export const COUNTERS_TO_LOWER = 2;
export const CONFIRMED_COUNTERS_TO_FLAG = 2;
export const PLACEMENT_REASON = "Refresh placed new ratings";

const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const levelOf = (p) => { const l = String(p.strength ?? p.level ?? "emerging").toLowerCase(); return LEVELS.includes(l) ? l : "emerging"; };
const lower = (level) => LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)];
const higher = (a, b) => (LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b);
const reach = (value) => (CROSS_DOMAIN.includes(value) ? value : "untested");
const quoted = (title) => `“${title}”`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Recomputes what a pattern's evidence allows. Returns the next pattern, or null when it retires.
function recompute(state, p, rows, { confirmed }) {
  const supportRows = (p.supports ?? []).map((ref) => rows.get(ref)).filter((r) => r && r.class === "experienced" && r.polarity > 0);
  const counterRows = (p.counters ?? []).map((ref) => rows.get(ref)).filter((r) => r && r.class === "experienced" && r.polarity < 0);
  let allowed = allowedLevel(supportRows, counterRows);
  if (contextQualifiedFor(state, p.id)) allowed = capLevel(allowed, "supported");
  const evidence = supportRows.map((r) => r.title).join(", ") || p.evidence;
  if (confirmed) {
    // Additions only: a confirmed pattern may gain level from new support, never lose any to counters.
    const strength = higher(levelOf(p), allowed);
    const crossDomain = CROSS_DOMAIN[Math.max(CROSS_DOMAIN.indexOf(reach(p.crossDomain)), CROSS_DOMAIN.indexOf(allowedCrossDomain(supportRows, counterRows)))];
    return { ...p, evidence, strength, status: p.status === "conditional" ? "conditional" : strength, crossDomain };
  }
  if (counterRows.length > supportRows.length) return null;
  const strength = counterRows.length >= COUNTERS_TO_LOWER ? lower(allowed) : allowed;
  const supported = domainScope({ supports: evidenceRows(supportRows), against: evidenceRows(counterRows), heldUp: [] }).scope.supported;
  // Areas never widen (a pattern isn't reworded, so it can't take on a new medium); they narrow to where the
  // evidence still holds.
  const kept = (p.domains ?? []).filter((d) => supported.includes(d));
  return {
    ...p,
    evidence,
    strength,
    status: p.status === "conditional" ? "conditional" : strength,
    domains: kept.length ? kept : (p.domains ?? []),
    crossDomain: allowedCrossDomain(supportRows, counterRows)
  };
}

// queue: from refreshQueue(state). placement: the checked answer ({ placements, invalid, newPatterns, notSent }),
// or null when nothing new was sent (no call). Mutates state (patterns, history, ledger) and returns
// { message, changed, retired, flagged, lowered, created }.
export function applyPlacementResult(state, queue, placement) {
  const rows = new Map(evidenceRecords(state).map((r) => [r.ref, r]));
  const statements = state.patternStatements ?? [];
  const notMe = new Set(statements.filter((s) => s?.says === "not-me").map((s) => s.hypothesisId));
  const confirmed = (p) => Boolean(confirmationFor(statements, p));
  const touched = new Set();
  const flagged = new Map();     // id -> placementReview
  let patterns = (state.modelHypotheses ?? []).map((p) => ({ ...p }));
  const active = (p) => p?.id && !notMe.has(p.id);

  // Removed ratings, and ratings whose side changed.
  const flips = new Map((queue.changed ?? []).map((c) => [c.ref, rows.get(c.ref)]).filter(([, r]) => r));
  for (const p of patterns) {
    if (!active(p)) continue;
    const missing = (p.supports ?? []).filter((ref) => !rows.has(ref));
    const flippedOff = (p.supports ?? []).filter((ref) => flips.get(ref)?.polarity < 0);
    const counterOff = (p.counters ?? []).filter((ref) => !rows.has(ref) || flips.get(ref)?.polarity > 0);
    if (confirmed(p)) {
      if (missing.length) { p.evidenceStatus = NEEDS_REVIEW; touched.add(p.id); }
      if (flippedOff.length) { p.supports = p.supports.filter((ref) => !flippedOff.includes(ref)); flagged.set(p.id, { kind: "changed", refs: flippedOff }); touched.add(p.id); }
      if (counterOff.length) { p.counters = p.counters.filter((ref) => !counterOff.includes(ref)); p.newCounters = (p.newCounters ?? []).filter((ref) => !counterOff.includes(ref)); touched.add(p.id); }
      continue;
    }
    if (missing.length || flippedOff.length || counterOff.length) {
      p.supports = (p.supports ?? []).filter((ref) => !missing.includes(ref) && !flippedOff.includes(ref));
      p.counters = (p.counters ?? []).filter((ref) => !counterOff.includes(ref));
      touched.add(p.id);
    }
  }

  // Placements.
  const placements = placement?.placements ?? [];
  const byId = new Map(patterns.map((p) => [p.id, p]));
  const outcome = new Map();   // ref -> { place, patternId }
  for (const { ref, place, patternId } of placements) {
    outcome.set(ref, { place, patternId });
    const p = patternId ? byId.get(patternId) : null;
    if (!p || !active(p)) continue;
    if (place === "supports" && !(p.supports ?? []).includes(ref)) { p.supports = [...(p.supports ?? []), ref]; touched.add(p.id); }
    if (place === "counter" && !(p.counters ?? []).includes(ref)) {
      p.counters = [...(p.counters ?? []), ref];
      if (confirmed(p)) p.newCounters = [...new Set([...(p.newCounters ?? []), ref])];
      touched.add(p.id);
    }
  }

  // New patterns, from unexplained and pooled items.
  const created = [];
  const unpooled = [];
  const ids = new Set(patterns.map((p) => p.id));
  for (const n of placement?.newPatterns ?? []) {
    let id = `ai-${slug(n.label) || "pattern"}`;
    for (let i = 2; ids.has(id); i += 1) id = `ai-${slug(n.label) || "pattern"}-${i}`;
    ids.add(id);
    const p = { id, title: n.label, claim: n.claim, evidence: "", supports: [...n.evidence], counters: [], domains: [...n.domains], strength: "emerging", status: "emerging", crossDomain: "untested", context: null, aiGenerated: true, provenance: "Based on your reactions so far.", ...(n.conditional ? { status: "conditional" } : {}) };
    patterns.push(p);
    byId.set(id, p);
    touched.add(id);
    created.push(id);
    for (const ref of n.evidence) {
      if (outcome.has(ref)) outcome.set(ref, { place: "new-pattern", patternId: id });
      else unpooled.push(ref);
    }
  }

  // #364 support filing over the profile, as today.
  const activeList = patterns.filter(active);
  const filed = fileSupports(activeList.map((p) => ({ id: p.id, label: p.title ?? p.label, domains: p.domains ?? [], evidence: p.supports ?? [] })), { evidence: [...rows.values()] });
  for (const { id, ref } of filed.refiled) {
    const p = byId.get(id);
    p.supports = p.supports.filter((r) => r !== ref);
    touched.add(id);
  }

  // Recompute what changed; retire, lower and flag by the rules above.
  const retired = [];
  const lowered = [];
  patterns = patterns.flatMap((p) => {
    if (!touched.has(p.id) || !active(p)) return [p];
    const isConfirmed = confirmed(p);
    const next = recompute(state, p, rows, { confirmed: isConfirmed });
    if (!next) { retired.push(p); return []; }
    if (isConfirmed && (next.newCounters ?? []).length >= CONFIRMED_COUNTERS_TO_FLAG && !flagged.has(p.id)) flagged.set(p.id, { kind: "counters", refs: next.newCounters });
    if (flagged.has(p.id)) { next.evidenceStatus = NEEDS_REVIEW; next.placementReview = flagged.get(p.id); }
    if (!isConfirmed && !created.includes(p.id) && LEVELS.indexOf(next.strength) < LEVELS.indexOf(levelOf(p))) lowered.push(next);
    return [next];
  });

  const changed = patterns.filter((p) => touched.has(p.id) && active(p));
  for (const p of changed) {
    recordRevisionIfChanged(state, { hypothesisId: p.id, claim: p.claim, supports: p.supports, counters: p.counters, domains: p.domains, level: p.strength, origin: "model", reason: created.includes(p.id) ? "New pattern from ratings no pattern explained yet" : PLACEMENT_REASON });
  }
  for (const p of retired) {
    recordRevision(state, { hypothesisId: p.id, claim: p.claim, supports: p.supports, counters: p.counters, domains: p.domains, level: p.strength, origin: "system", reason: "Retired: more of what you tried counts against it than for it" });
  }

  // Ledger: placed items are settled; liked unexplained ones go to the pool; invalid ones stay new. Advanced before
  // the patterns are replaced, so a first run records what the stored patterns cited as seen.
  const toPool = (x) => x.place === "unexplained" && rows.get(x.ref)?.polarity > 0 && outcome.get(x.ref)?.place === "unexplained";
  state.profileLedger = advanceLedger(state, { placed: placements.filter((x) => !toPool(x)).map((x) => x.ref), pooled: placements.filter(toPool).map((x) => x.ref), failed: placement?.invalid ?? [], unpooled });
  state.modelHypotheses = patterns;

  const message = placement ? placementMessage({ queue, placement, outcome, byId, retired, lowered, flagged }) : touched.size ? "Updated your Taste Profile for ratings you removed." : NOTHING_NEW_MESSAGE;
  return { message, changed: changed.map((p) => p.id), retired: retired.map((p) => p.id), flagged: [...flagged.keys()], lowered: lowered.map((p) => p.id), created };
}

export const NOTHING_NEW_MESSAGE = "No new ratings since the last refresh, so nothing changed.";

// Decision 6: where each new rating went, e.g. "3 new ratings: 2 support “X”, 1 counts against “Y”, and 1 isn't
// part of a pattern yet." The pool itself isn't shown anywhere else.
function placementMessage({ queue, placement, outcome, byId, retired, lowered, flagged }) {
  const sent = queue.items.length;
  const parts = [];
  const group = (place) => {
    const counts = new Map();
    for (const { place: p, patternId } of outcome.values()) if (p === place) counts.set(patternId, (counts.get(patternId) ?? 0) + 1);
    return [...counts];
  };
  for (const [id, n] of group("supports")) parts.push(`${n} ${n === 1 ? "supports" : "support"} ${quoted(byId.get(id)?.title ?? id)}`);
  for (const [id, n] of group("counter")) parts.push(`${n} ${n === 1 ? "counts" : "count"} against ${quoted(byId.get(id)?.title ?? id)}`);
  for (const [id, n] of group("new-pattern")) parts.push(`${n} started a new pattern, ${quoted(byId.get(id)?.title ?? id)}`);
  const loose = [...outcome.values()].filter((o) => o.place === "unexplained" || o.place === "not-taste").length;
  if (loose) parts.push(`${loose} ${loose === 1 ? "isn’t" : "aren’t"} part of a pattern yet`);
  const notPlaced = (placement.invalid ?? []).length + (placement.notSent ?? []).length;
  if (notPlaced) parts.push(`${notPlaced} couldn’t be placed this time and will be checked again`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "none could be placed";
  const sentences = [`${plural(sent, "new rating", "new ratings")}: ${list}.`];
  if (queue.waiting) sentences.push(`${plural(queue.waiting, "more rating", "more ratings")} will be placed on your next refresh.`);
  for (const p of retired) sentences.push(`${quoted(p.title)} was retired: more of what you tried counts against it than for it.`);
  for (const p of lowered) sentences.push(`Tastemake will lean on ${quoted(p.title)} more cautiously.`);
  for (const id of flagged.keys()) sentences.push(`${quoted(byId.get(id)?.title ?? id)} needs another look.`);
  return sentences.join(" ");
}
