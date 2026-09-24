import { domainById, visibleDomains } from "../data/domains.js";
import { isExperienced, isExperiencedPositive, isSaved, tasteWeight } from "./evidence.js";

// Taste evidence comes only from things the user has actually experienced (decided in #12/#24):
// Loved it before, Liked it before, and Tried it and disliked. A reaction to a pick they have not
// tried steers what comes next (see recommendationDelta) but never changes the taste profile.
// Everything not listed here is 0.
// Taste evidence weight. The table lives in evidence.js (the single source); only experienced reactions move taste:
// Loved it before +2, Liked it before +1.25, Tried it and disliked it -2. Everything else is 0.
export function tasteDelta(feedback) {
  return tasteWeight(feedback);
}

export function recommendationDelta(feedback) {
  if (!feedback) return 0;
  if (feedback.detail === "too-obvious") return 0;

  let score = ({ more: 1, less: -1, "not-tried": 0 })[feedback.rating] || 0;
  const detailAdjustments = {
    "loved-before": 0.75,
    "liked-before": 0.45,
    "tried-disliked": -0.75,
    "not-interested": -0.5,
    // A bookmark is a save marker on an untried item: it may lightly steer what is recommended next,
    // but it is never taste evidence (tasteDelta ignores every not-tried reaction).
    bookmarked: 0.35
  };

  return score + (detailAdjustments[feedback.detail] || 0);
}

// Notes about the recommendation itself, not about taste. "Surprised me" is recorded (it is only
// offered after the user says they tried and liked something) but does not change ranking yet.
export function recommendationQualityDelta(feedback) {
  return feedback?.quality === "too-obvious" ? -0.5 : 0;
}

// The user said they tried it and liked it: the only time "Surprised me" makes sense.
// Canonical predicates live in evidence.js (#40); these names stay for existing call sites.
export const isPositiveExperience = isExperiencedPositive;

// Items added by the user (or found by search) can have no pattern tags; they simply match nothing.
export function hypothesisMatches(itemHypotheses = [], hypothesisId) {
  const aliases = hypothesisId === "H01/H07" ? ["H01", "H07", "H01/H07"] : [hypothesisId];
  return itemHypotheses.some((id) => aliases.includes(id));
}

// A confirmed blind spot (#20) says which patterns actually failed for a disliked pick. Patterns the user
// says DID hold up are not counted against; "none of these" clears all of them. Without a blind spot,
// behaviour is exactly as before.
export function exonerated(state, feedback, patternId) {
  const spot = state.blindSpots?.[feedback.item.id];
  if (!spot || feedback.rating !== "less" || feedback.detail !== "tried-disliked") return false;
  return !spot.hypotheses.some((id) => hypothesisMatches([patternId], id) || hypothesisMatches([id], patternId));
}

// What the user said about a pattern scales how much it steers ranking (see statements.js):
// "not really me" = 0 (left out), "matters a lot" = 1.5, "matters a little" = 0.5. No statement = 1 (unchanged).
function statementFactor(state, hypothesisId) {
  const s = (state.patternStatements ?? []).find((x) => hypothesisMatches([x.hypothesisId], hypothesisId) || hypothesisMatches([hypothesisId], x.hypothesisId));
  if (!s) return 1;
  if (s.says === "not-me") return 0;
  return s.weight === "lot" ? 1.5 : s.weight === "little" ? 0.5 : 1;
}

// The user said they actually tried it (the only reactions that count as taste evidence).
// Reactions to picks the user has NOT tried (plain More/Less, Not interested, bookmarks). They steer
// what comes next but are not taste evidence, so the Taste Profile shows them as a separate "lean"
// and never as Stronger / Less certain. A lean needs a clear signal (about one plain More or Less).
export function untriedReactionLean(state, hypothesis) {
  const related = Object.values(state.feedbackByRecommendation).filter((feedback) => {
    return !isExperienced(feedback) && hypothesisMatches(feedback.item.hypotheses, hypothesis.id) && recommendationDelta(feedback) !== 0;
  });
  const signal = related.reduce((sum, feedback) => sum + recommendationDelta(feedback), 0);
  const direction = signal >= 1 ? "toward" : signal <= -1 ? "away" : null;
  return { direction, count: related.length, signal };
}

export function modelUpdateFor(state, hypothesis) {
  const related = Object.values(state.feedbackByRecommendation).filter((feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesis.id) && tasteDelta(feedback) !== 0 && !exonerated(state, feedback, hypothesis.id);
  });

  if (!related.length) return { label: hypothesis.strength, status: hypothesis.status, note: null };

  const signal = related.reduce((sum, feedback) => sum + tasteDelta(feedback), 0);
  if (signal >= 1.5) {
    return { label: "Stronger", status: "strengthened", note: "Your reactions gave this pattern more support." };
  }
  if (signal <= -1.5) {
    // One miss is not enough to weaken a pattern (decided Sep 20): it takes at least two picks that did not land.
    const misses = related.filter((feedback) => tasteDelta(feedback) < 0).length;
    if (misses >= 2) {
      return { label: "Less certain", status: "revision", note: "More than one pick you tried didn't land, so this pattern should carry less weight." };
    }
    return { label: "Still learning", status: "conditional", note: "A pick you tried didn't land. It takes more than one to weaken this pattern." };
  }
  return {
    label: "Still learning",
    status: "conditional",
    note: "Your feedback added signal, but not enough to make this pattern much stronger or weaker yet."
  };
}

function shownRecommendations(state) {
  return (state.recommendationSets ?? []).flat();
}

// Areas are settings, not taste evidence. The server-side catalog pipeline uses the same rule.
export const AREAS = visibleDomains().map(({ id, label, about }) => ({ id, label, about }));
export function areaOn(state, item) {
  const areas = state.areas;
  if (!item.domains?.length) return true;
  return item.domains.some((domain) => domainById(domain)?.visible && areas?.[domain] !== false);
}

// With a live catalog there is no hidden hand-written pool to inspect locally. Exhaustion is learned
// only when the recommendation endpoint cannot find another eligible catalog candidate.
export function picksHiddenByAreas() {
  return false;
}

export function activeRecommendations(state) {
  const sets = state.recommendationSets ?? [];
  return sets.length ? sets[sets.length - 1] : [];
}

export function currentRoundRatedCount(state) {
  return activeRecommendations(state).filter((item) => state.feedbackByRecommendation[item.id]).length;
}

export function currentRoundComplete(state) {
  const active = activeRecommendations(state);
  return active.length > 0 && currentRoundRatedCount(state) === active.length;
}

// One explicit reaction is enough to ask the real catalog for another set. The endpoint is responsible
// for deciding whether more eligible candidates exist.
export function canKeepDiscovering(state) {
  return activeRecommendations(state).length > 0
    && currentRoundRatedCount(state) > 0
    && state.recommendationExhausted !== true;
}

export function outOfPicks(state) {
  return state.recommendationExhausted === true;
}

// Bookmarks are untried items the user saved. They are intent, not taste evidence.
export const isBookmarked = isSaved;

export function bookmarkedFeedback(state) {
  return Object.values(state.feedbackByRecommendation).filter(isBookmarked);
}
