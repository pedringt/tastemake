import { recommendations, followUpPool } from "../data/catalog.js";

export function tasteDelta(feedback) {
  if (!feedback || feedback.rating === "not-tried") return 0;

  if (feedback.rating === "more") {
    if (feedback.detail === "loved-before") return 2;
    if (feedback.detail === "want-to-try") return 0;
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

  let score = ({ more: 1, less: -1, "not-tried": 0 })[feedback.rating] || 0;
  const detailAdjustments = {
    "loved-before": 0.75,
    "want-to-try": 0.5,
    "surprising-fit": 0.5,
    "exactly-my-taste": 0.75,
    "tried-disliked": -0.75,
    "not-interested": -0.5,
    "wrong-vibe": -0.75,
    "too-obvious": -0.5,
    interested: 0.35,
    "maybe-interested": 0.1,
    "not-interested-untried": -0.35
  };

  return score + (detailAdjustments[feedback.detail] || 0);
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

function roundOneFeedback(state) {
  return recommendations.map((item) => state.feedbackByRecommendation[item.id]).filter(Boolean);
}

export function followUpRecommendations(state) {
  const scored = followUpPool.map((item) => {
    const score = item.hypotheses.reduce((sum, id) => sum + hypothesisSignal(state, id, roundOneFeedback(state)), 0);
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 4).map((item, index) => ({
    ...item,
    rank: index + 1,
    fit: item.score > 1 ? "Stronger after feedback" : item.score < 0 ? "Cautious fit" : "Promising fit",
    prediction: item.score > 1 ? "Likely to fit" : "Worth testing",
    surprise: false
  }));

  const surpriseSource = scored.slice(4)[0] || scored[scored.length - 1];
  const surprise = {
    ...surpriseSource,
    rank: null,
    fit: "Exploratory fit",
    prediction: "Worth testing",
    surprise: true,
    reason: `${surpriseSource.reason} This is the less-obvious option for the next round.`
  };

  return [...top, surprise];
}

export function activeRecommendations(state) {
  return state.recommendationRound === 1 ? recommendations : followUpRecommendations(state);
}

export function currentRoundRatedCount(state) {
  return activeRecommendations(state).filter((item) => state.feedbackByRecommendation[item.id]).length;
}

export function currentRoundComplete(state) {
  return currentRoundRatedCount(state) === activeRecommendations(state).length;
}
