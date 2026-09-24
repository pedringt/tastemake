import { starterItems } from "./starters.js";
import { isPositiveExperience } from "./taste.js";
import { countsAsTaste, isExperienced, isExperiencedNegative, isExperiencedPositive, isSaved, isStrongPositive, isDeclined } from "./evidence.js";
import { activeBlindSpots } from "./blindspots.js";

// My Tastemake (#8): "What have I told Tastemake?" Everything here is derived from what the app already
// knows, never stored separately, so it cannot disagree with the Library, Try Next, Taste Profile or Map.
// Two groups, because they mean different things:
//   counts as taste   Favorites, Loved it, Liked it, Tried it and disliked
//   only steers       plain More / Less on untried picks, Not interested, Try Next saves
// Where an item came from is provenance: shown, never rewritten.

function sourceOf(feedback) {
  if (feedback.item.custom) return "Added by you in search";
  if (feedback.wasBookmarked) return "Try Next, then tried";
  if (feedback.source === "search") return "Told through search";
  return "From Recommendations";
}

function statusOf(feedback) {
  if (isStrongPositive(feedback)) return "Loved it before";
  if (isExperiencedPositive(feedback)) return "Liked it before";
  if (isExperiencedNegative(feedback)) return "Tried it and disliked it";
  if (isSaved(feedback)) return "Try Next (haven't tried)";
  if (isDeclined(feedback)) return "Not interested";
  if (feedback.rating === "more") return "Wanted more like this (haven't tried)";
  if (feedback.rating === "less") return "Wanted less like this (haven't tried)";
  return "Haven't tried it";
}

export function toldItems(state) {
  const starters = starterItems(state)
    .map((item) => ({ id: item.id, item, starter: true, status: "Favorite", source: "Added to Favorites", counts: true }));

  const reacted = Object.values(state.feedbackByRecommendation)
    // a Favorite is already listed above; never show the same item twice
    .filter((feedback) => !state.selectedFavorites.has(feedback.item.id))
    .map((feedback) => ({
      id: feedback.item.id,
      item: feedback.item,
      starter: false,
      status: statusOf(feedback),
      source: sourceOf(feedback),
      counts: countsAsTaste(feedback),
      positive: isPositiveExperience(feedback),
      experienced: isExperienced(feedback),
      loved: isStrongPositive(feedback),
      liked: isExperiencedPositive(feedback) && !isStrongPositive(feedback),
      disliked: isExperiencedNegative(feedback)
    }));

  const all = [...starters, ...reacted];
  return {
    counts: all.filter((entry) => entry.counts),
    steers: all.filter((entry) => !entry.counts),
    blindSpots: activeBlindSpots(state),
    total: all.length
  };
}
