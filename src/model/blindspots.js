import { hypotheses } from "../data/catalog.js";
import { hypothesisMatches } from "./taste.js";
import { isExperiencedNegative } from "./evidence.js";

// Taste Blind Spot (#20): when Tastemake was confident you'd like something and you tried it and
// didn't, that is evidence about the MODEL, not just a thumbs-down. The user says which of the patterns
// it leaned on did not hold up and what got in the way; Tastemake keeps that as evidence.
//
// It never invents a new preference rule from one miss. It records the mismatch, stops counting the
// patterns the user says DID hold up against them (see taste.js), and only calls a theme "recurring"
// once two blind spots share it.

export const REASONS = [
  { id: "tone", label: "The tone wasn't right" },
  { id: "pacing", label: "The pacing" },
  { id: "characters", label: "The characters" },
  { id: "structure", label: "How it was told" },
  { id: "subject", label: "The subject matter" },
  { id: "not-for-me", label: "Fine, just not for me" },
  { id: "other", label: "Something else" }
];
const REASON_LABEL = Object.fromEntries(REASONS.map((reason) => [reason.id, reason.label]));
export const reasonLabel = (id) => REASON_LABEL[id] ?? id;
// These say nothing specific about the model, so they never count towards "recurring".
const VAGUE_REASONS = new Set(["not-for-me", "other"]);

const isDisliked = isExperiencedNegative;

// A blind spot needs a real mismatch: tried and disliked something Tastemake was confident about.
// (An untried pick can't be a prediction failure, and "Worth testing" picks were never confident.)
export function isBlindSpotCandidate(feedback) {
  return isDisliked(feedback) && /^Likely/.test(feedback.item.prediction ?? "") && patternsFor(feedback.item).length > 0;
}

// The patterns (Taste Profile cards) that a pick leaned on.
export function patternsFor(item) {
  return hypotheses.filter((pattern) => hypothesisMatches(item.hypotheses ?? [], pattern.id));
}

// A saved blind spot only counts while the reaction it is about still stands.
export function blindSpotFor(state, itemId) {
  const spot = state.blindSpots?.[itemId];
  return spot && isDisliked(state.feedbackByRecommendation[itemId]) ? spot : null;
}

export function activeBlindSpots(state) {
  return Object.entries(state.blindSpots ?? {})
    .filter(([itemId]) => blindSpotFor(state, itemId))
    .map(([itemId, spot]) => ({ itemId, ...spot, item: state.feedbackByRecommendation[itemId].item }))
    .sort((a, b) => a.order - b.order);
}

export function saveBlindSpot(state, itemId, { broken = [], reasons = [], none = false }) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!isBlindSpotCandidate(feedback)) return null;
  const previous = state.blindSpots[itemId];
  state.blindSpots[itemId] = {
    // which patterns the user says did not hold up; empty + none = "something else, not these"
    hypotheses: none ? [] : [...broken],
    none: Boolean(none),
    reasons: [...reasons],
    predicted: feedback.item.prediction,
    order: previous?.order ?? Object.keys(state.blindSpots).length + 1
  };
  delete state.blindSpotDrafts[itemId];
  return state.blindSpots[itemId];
}

export function removeBlindSpot(state, itemId) {
  delete state.blindSpots[itemId];
  delete state.blindSpotDrafts[itemId];
}

// Active blind spots that name a given pattern as one that did not hold up.
export function blindSpotsFor(state, patternId) {
  return activeBlindSpots(state).filter((spot) => spot.hypotheses.some((id) => hypothesisMatches([patternId], id) || hypothesisMatches([id], patternId)));
}

// "Recurring": the same pattern, or the same specific reason, shows up in two or more blind spots.
export function recurringThemes(state) {
  const spots = activeBlindSpots(state);
  const count = (pick) => {
    const seen = new Map();
    spots.forEach((spot) => new Set(pick(spot)).forEach((key) => seen.set(key, (seen.get(key) ?? 0) + 1)));
    return [...seen].filter(([, n]) => n >= 2);
  };
  return {
    patterns: count((spot) => spot.hypotheses).map(([id, n]) => ({ id, n, title: hypotheses.find((pattern) => pattern.id === id)?.title ?? id })),
    reasons: count((spot) => spot.reasons.filter((id) => !VAGUE_REASONS.has(id))).map(([id, n]) => ({ id, n, label: reasonLabel(id) }))
  };
}

export function isRecurring(state, spot) {
  const { patterns, reasons } = recurringThemes(state);
  return spot.hypotheses.some((id) => patterns.some((theme) => theme.id === id)) || spot.reasons.some((id) => reasons.some((theme) => theme.id === id));
}
