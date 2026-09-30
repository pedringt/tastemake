import { isDeclined, isExperienced, isSaved } from "./evidence.js";

export const EXPERIENCE_OUTCOMES = {
  loved: ["more", "loved-before"],
  liked: ["more", "liked-before"],
  disliked: ["less", "tried-disliked"],
  save: ["not-tried", "bookmarked"],
  "not-interested": ["less", "not-interested"]
};

export function storedReactionForOutcome(outcome) {
  const pair = EXPERIENCE_OUTCOMES[outcome];
  return pair ? { rating: pair[0], detail: pair[1] } : null;
}

export function pathForFeedback(feedback) {
  if (isExperienced(feedback)) return "tried";
  if (isSaved(feedback) || isDeclined(feedback)) return "not-tried";
  return null;
}
