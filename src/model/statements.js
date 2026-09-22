import { hypotheses } from "../data/catalog.js";
import { hypothesisMatches } from "./taste.js";

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

export const FIT = { accurate: "You confirmed this", "not-me": "You said this isn't you" };
export const WEIGHT = { lot: "Matters a lot to you", little: "Matters a little to you" };

const same = (a, b) => hypothesisMatches([a], b) || hypothesisMatches([b], a);

export function statementFor(state, hypothesisId) {
  return (state.patternStatements ?? []).find((s) => same(s.hypothesisId, hypothesisId)) ?? null;
}

// Toggle one answer. Returns a sentence for the live region.
export function setStatement(state, hypothesisId, field, value) {
  const pattern = hypotheses.find((p) => p.id === hypothesisId);
  if (!pattern || !["says", "weight"].includes(field)) return null;
  state.patternStatements ??= [];
  let entry = statementFor(state, hypothesisId);
  if (!entry) {
    entry = { hypothesisId, label: pattern.title, says: null, weight: null, authority: "user-confirmed" };
    state.patternStatements.push(entry);
  }
  entry[field] = entry[field] === value ? null : value;
  if (!entry.says && !entry.weight) state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  const now = entry[field];
  if (field === "says") return now ? `${pattern.title}: ${FIT[now]}.` : `${pattern.title}: your answer was cleared.`;
  return now ? `${pattern.title}: ${WEIGHT[now]}.` : `${pattern.title}: how much it matters was cleared.`;
}

export function clearStatement(state, hypothesisId) {
  const entry = statementFor(state, hypothesisId);
  if (!entry) return null;
  state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  return `${entry.label}: what you said was removed.`;
}

export function activeStatements(state) {
  return (state.patternStatements ?? []).filter((s) => s.says || s.weight);
}
