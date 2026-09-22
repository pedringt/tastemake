import { followUpPool } from "../data/catalog.js";
import { domainById, visibleDomains } from "../data/domains.js";
import { tasteWeight } from "./evidence.js";

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
export function isPositiveExperience(feedback) {
  return feedback?.rating === "more" && (feedback.detail === "loved-before" || feedback.detail === "liked-before");
}

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

function hypothesisSignal(state, hypothesisId, feedbacks = Object.values(state.feedbackByRecommendation)) {
  return feedbacks.reduce((sum, feedback) => {
    if (!hypothesisMatches(feedback.item.hypotheses, hypothesisId) || exonerated(state, feedback, hypothesisId)) return sum;
    return sum + recommendationDelta(feedback);
  }, 0);
}

// The user said they actually tried it (the only reactions that count as taste evidence).
function isExperienced(feedback) {
  return feedback?.detail === "loved-before" || feedback?.detail === "liked-before" || feedback?.detail === "tried-disliked";
}

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
  return state.recommendationSets.flat();
}

// Feedback in the order the items were shown. Order matters: scores are floating-point sums,
// and this keeps round two identical to the original two-round behavior.
function feedbackInShownOrder(state) {
  return shownRecommendations(state).map((item) => state.feedbackByRecommendation[item.id]).filter(Boolean);
}

// The next set comes from the follow-up pool minus anything already shown, ranked by everything
// reacted to so far. With five or more left it is four picks plus one exploratory pick; with fewer,
// the remainder is shown as ordinary picks. An empty list means this demo has run out of picks.
// Areas (#8) are a setting, not taste: an item is offered while at least one of its areas is on.
// The area toggles are the visible domains in the registry (src/data/domains.js).
export const AREAS = visibleDomains().map(({ id, label, about }) => ({ id, label, about }));
// Only domains the product shows can be offered (future domains in the registry are never recommended).
export function areaOn(state, item) {
  const areas = state.areas;
  if (!item.domains?.length) return true;
  return item.domains.some((domain) => domainById(domain)?.visible && areas?.[domain] !== false);
}

// True when picks are left but the areas turned off are hiding all of them.
export function picksHiddenByAreas(state) {
  return nextRecommendations(state).length === 0 && nextRecommendations({ ...state, areas: undefined }).length > 0;
}

export function nextRecommendations(state) {
  const shownIds = new Set(shownRecommendations(state).map((item) => item.id));
  // Anything the user already told us about (for example through search) is never recommended again,
  // and explicit reactions to items outside the shown sets still steer what comes next.
  const reactedIds = new Set(Object.keys(state.feedbackByRecommendation));
  const feedbacks = [
    ...feedbackInShownOrder(state),
    ...Object.values(state.feedbackByRecommendation).filter((feedback) => !shownIds.has(feedback.item.id))
  ];
  const scored = followUpPool.filter((item) => !shownIds.has(item.id) && !reactedIds.has(item.id) && areaOn(state, item)).map((item) => {
    const score = item.hypotheses.reduce((sum, id) => sum + hypothesisSignal(state, id, feedbacks), 0);
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const asPick = (item, index) => ({
    ...item,
    rank: index + 1,
    fit: item.score > 1 ? "Stronger after feedback" : item.score < 0 ? "Cautious fit" : "Promising fit",
    prediction: item.score > 1 ? "Likely to fit" : "Worth testing",
    surprise: false
  });

  // With the curveball setting off (#8), a new set is just the five best picks, none of them the exploratory one.
  if (scored.length < 5) return scored.map(asPick);
  if (state.curveball === false) return scored.slice(0, 5).map(asPick);

  const surpriseSource = scored[4];
  const surprise = {
    ...surpriseSource,
    rank: null,
    fit: "Exploratory fit",
    prediction: "Worth testing",
    surprise: true,
    reason: `${surpriseSource.reason} This is the less-obvious option for the next round.`
  };

  return [...scored.slice(0, 4).map(asPick), surprise];
}

export function activeRecommendations(state) {
  return state.recommendationSets[state.recommendationSets.length - 1];
}

export function currentRoundRatedCount(state) {
  return activeRecommendations(state).filter((item) => state.feedbackByRecommendation[item.id]).length;
}

export function currentRoundComplete(state) {
  return currentRoundRatedCount(state) === activeRecommendations(state).length;
}

// Keep discovering needs some signal from the current set (not every card) and something left to show.
export function canKeepDiscovering(state) {
  return currentRoundRatedCount(state) > 0 && nextRecommendations(state).length > 0;
}

export function outOfPicks(state) {
  return nextRecommendations(state).length === 0;
}

// Bookmarks are untried items the user saved. They are intent, not taste evidence.
export function isBookmarked(feedback) {
  return feedback?.rating === "not-tried" && feedback.detail === "bookmarked";
}

export function bookmarkedFeedback(state) {
  return Object.values(state.feedbackByRecommendation).filter(isBookmarked);
}
