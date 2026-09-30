import { areaOn } from "../model/taste.js";
import { evidenceRecords } from "../model/evidence.js";

// What the product hands a model (and the validator). Built only from product state, never from model output.
// The model gets typed evidence and a list of eligible candidates; it never gets the power to decide
// what counts as evidence, what was already seen, or which areas are on.

export function eligibleCandidates(state, extraCandidates = []) {
  // #120 follow-up: the wire payload now sends recommendationSets as arrays of ids, not full item
  // objects (see serializeAiState in ai/live-client.js) -- this was the only thing ever read from
  // them server-side anyway. Accepts a bare id or a full object (still the shape several test
  // fixtures construct directly).
  const shown = new Set([
    ...(state.seenItemIds ?? []),
    ...state.recommendationSets.flat().map((entry) => (typeof entry === "string" ? entry : entry?.id))
  ]);
  const reacted = new Set(Object.keys(state.feedbackByRecommendation));
  const pool = [...extraCandidates];
  const seen = new Set();
  return pool.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return !shown.has(item.id) && !reacted.has(item.id) && areaOn(state, item);
  });
}

export function buildContext(state, extraCandidates = []) {
  return {
    evidence: evidenceRecords(state),
    candidates: eligibleCandidates(state, extraCandidates),
    curveball: state.curveball !== false,
    recommendationStyle: state.recommendationStyle ?? (state.curveball === false ? "safe" : "balanced"),
    statements: state.patternStatements ?? [],   // user-confirmed statements (pattern corrections; not built yet)
    contexts: [],                                 // contexts the user gave (taste modes; not collected yet)
    recommendationFilter: state.recommendationFilter ?? "all"
  };
}
