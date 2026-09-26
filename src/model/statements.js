import { hypothesisMatches } from "./taste.js";
import { recordRevision } from "./history.js";

// What the user has said about a pattern (pattern corrections). Decided Sept 22, 2026:
//   - This is its own authority, **user-confirmed**. It outranks anything Tastemake or a model inferred.
//   - It is NOT taste evidence: saying "that's me" is not an experience of anything, so it never raises a
//     confidence level (confidence is about what you tried) and it is not in evidenceRecords.
//   - Two independent answers per pattern, each reversible (choose again to clear):
//       fit     "accurate" (a "You confirmed this" badge) | "not-me" (left out of ranking and of what a model may use)
//       weight  "lot" (x1.5 in ranking) | "little" (x0.5 in ranking)
//   - The original pattern and its history stay visible; nothing is deleted.
// Stored as state.patternStatements = [{ hypothesisId, label, says, weight, authority }]; `says` is the fit
// answer (the name the AI validator reads).
//
// #36, expanded in the portfolio-polish pass: context refinement is separate from domain scope.
// "broad" means the user says the pattern usually holds, "some" narrows it to some contexts, and
// "unsure" records uncertainty. Only "some" caps model confidence; none of these are taste evidence.

export const FIT = { accurate: "You confirmed this", "not-me": "You said this isn't you" };
export const WEIGHT = { lot: "Matters a lot to you", little: "Matters a little to you" };
export const CONTEXT = {
  broad: "You said this usually holds",
  some: "You said this only applies in some contexts",
  unsure: "You said you are not sure yet"
};

const same = (a, b) => hypothesisMatches([a], b) || hypothesisMatches([b], a);

export function statementFor(state, hypothesisId) {
  return (state.patternStatements ?? []).find((s) => same(s.hypothesisId, hypothesisId)) ?? null;
}

const MESSAGE = {
  says: (pattern, now) => (now ? `${pattern.title}: ${FIT[now]}.` : `${pattern.title}: your answer was cleared.`),
  weight: (pattern, now) => (now ? `${pattern.title}: ${WEIGHT[now]}.` : `${pattern.title}: how much it matters was cleared.`),
  context: (pattern, now) => (now ? `${pattern.title}: ${CONTEXT[now]}.` : `${pattern.title}: the context qualifier was cleared.`)
};

// Toggle one answer. Returns a sentence for the live region.
export function setStatement(state, hypothesisId, field, value) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === hypothesisId);
  if (!pattern || !["says", "weight", "context"].includes(field)) return null;
  state.patternStatements ??= [];
  let entry = statementFor(state, hypothesisId);
  if (!entry) {
    entry = { hypothesisId, label: pattern.title, says: null, weight: null, context: null, authority: "user-confirmed" };
    state.patternStatements.push(entry);
  }
  entry[field] = entry[field] === value ? null : value;
  if (!entry.says && !entry.weight && !entry.context && !(entry.excludedDomains?.length)) {
    state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  }
  const message = MESSAGE[field](pattern, entry[field]);
  // A user correction outranks model inference (#31) and is its own kind of revision (#37):
  // record it as "user-confirmed" so it stays distinguishable from anything Tastemake infers.
  recordRevision(state, { hypothesisId: pattern.id, claim: pattern.claim, origin: "user-confirmed", reason: message });
  return message;
}

// #36: a lighter correction than "not really me" for the whole pattern — the user can say a pattern
// doesn't apply in one specific domain ("I like this in movies, not in interiors") without rejecting
// it everywhere else. This narrows scope; it never deletes the evidence the exclusion is based on.
export function excludedDomainsFor(state, hypothesisId) {
  return statementFor(state, hypothesisId)?.excludedDomains ?? [];
}

export function contextQualifiedFor(state, hypothesisId) {
  return statementFor(state, hypothesisId)?.context === "some";
}

export function toggleDomainExclusion(state, hypothesisId, domainId) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === hypothesisId);
  if (!pattern) return null;
  state.patternStatements ??= [];
  let entry = statementFor(state, hypothesisId);
  if (!entry) {
    entry = { hypothesisId, label: pattern.title, says: null, weight: null, excludedDomains: [], authority: "user-confirmed" };
    state.patternStatements.push(entry);
  }
  entry.excludedDomains ??= [];
  const excluding = !entry.excludedDomains.includes(domainId);
  entry.excludedDomains = excluding
    ? [...entry.excludedDomains, domainId]
    : entry.excludedDomains.filter((d) => d !== domainId);
  if (!entry.says && !entry.weight && !entry.context && !entry.excludedDomains.length) {
    state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  }
  const message = excluding
    ? `${pattern.title}: marked as not applying to ${domainId}.`
    : `${pattern.title}: ${domainId} is included again.`;
  recordRevision(state, { hypothesisId: pattern.id, claim: pattern.claim, origin: "user-confirmed", reason: message });
  return message;
}

export function clearStatement(state, hypothesisId) {
  const entry = statementFor(state, hypothesisId);
  if (!entry) return null;
  state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === entry.hypothesisId);
  const message = `${entry.label}: what you said was removed.`;
  recordRevision(state, { hypothesisId: entry.hypothesisId, claim: pattern?.claim, origin: "user-confirmed", reason: message });
  return message;
}

export function activeStatements(state) {
  return (state.patternStatements ?? []).filter((s) => s.says || s.weight || s.context || s.excludedDomains?.length);
}
