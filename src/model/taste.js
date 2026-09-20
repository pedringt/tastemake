import { followUpPool } from "../data/catalog.js";

export function tasteDelta(feedback) {
  if (!feedback || feedback.rating === "not-tried") return 0;

  if (feedback.rating === "more") {
    if (feedback.detail === "loved-before") return 2;
    if (feedback.detail === "liked-before") return 1.25;
    if (feedback.detail === "surprising-fit") return 1.25;
    if (feedback.detail === "exactly-my-taste") return 1.75;
    return 0.75;
  }

  if (feedback.rating === "less") {
    if (feedback.detail === "tried-disliked") return -2;
    if (feedback.detail === "not-interested") return 0;
    if (feedback.detail === "wrong-vibe") return -1.5;
    if (feedback.detail === "too-obvious") return 0;
    return -0.75;
  }

  return 0;
}

export function recommendationDelta(feedback) {
  if (!feedback) return 0;
  if (feedback.detail === "too-obvious") return 0;

  let score = ({ more: 1, less: -1, "not-tried": 0 })[feedback.rating] || 0;
  const detailAdjustments = {
    "loved-before": 0.75,
    "liked-before": 0.45,
    "surprising-fit": 0.5,
    "exactly-my-taste": 0.75,
    "tried-disliked": -0.75,
    "not-interested": -0.5,
    "wrong-vibe": -0.75,
    // A bookmark is a save marker on an untried item: it may lightly steer what is recommended next,
    // but it is never taste evidence (tasteDelta ignores every not-tried reaction).
    bookmarked: 0.35
  };

  return score + (detailAdjustments[feedback.detail] || 0);
}

export function recommendationQualityDelta(feedback) {
  return feedback?.quality === "too-obvious" ? -0.5 : 0;
}

export function hypothesisMatches(itemHypotheses, hypothesisId) {
  const aliases = hypothesisId === "H01/H07" ? ["H01", "H07", "H01/H07"] : [hypothesisId];
  return itemHypotheses.some((id) => aliases.includes(id));
}

function hypothesisSignal(state, hypothesisId, feedbacks = Object.values(state.feedbackByRecommendation)) {
  return feedbacks.reduce((sum, feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesisId) ? sum + recommendationDelta(feedback) : sum;
  }, 0);
}

export function modelUpdateFor(state, hypothesis) {
  const related = Object.values(state.feedbackByRecommendation).filter((feedback) => {
    return hypothesisMatches(feedback.item.hypotheses, hypothesis.id) && tasteDelta(feedback) !== 0;
  });

  if (!related.length) return { label: hypothesis.strength, status: hypothesis.status, note: null };

  const signal = related.reduce((sum, feedback) => sum + tasteDelta(feedback), 0);
  if (signal >= 1.5) {
    return { label: "Stronger", status: "strengthened", note: "Your reactions gave this pattern more support." };
  }
  if (signal <= -1.5) {
    return { label: "Less certain", status: "revision", note: "Your reactions suggest this pattern should carry less weight." };
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
export function nextRecommendations(state) {
  const shownIds = new Set(shownRecommendations(state).map((item) => item.id));
  const feedbacks = feedbackInShownOrder(state);
  const scored = followUpPool.filter((item) => !shownIds.has(item.id)).map((item) => {
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

  if (scored.length < 5) return scored.map(asPick);

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
