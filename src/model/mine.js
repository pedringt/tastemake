import { favorites } from "../data/catalog.js";
import { isPositiveExperience } from "./taste.js";
import { countsAsTaste, isExperienced, isExperiencedNegative, isExperiencedPositive, isSaved, isStrongPositive, isDeclined } from "./evidence.js";
import { activeBlindSpots } from "./blindspots.js";

// My Tastemake (#8): "What have I told Tastemake?" Everything here is derived from what the app already
// knows, never stored separately, so it cannot disagree with the Library, Bookmarks, Taste Profile or Map.
// Two groups, because they mean different things:
//   counts as taste   starter favorites, Loved it, Liked it, Tried it and disliked
//   only steers       plain More / Less on untried picks, Not interested, Bookmarks
// Where an item came from is provenance: shown, never rewritten.

function sourceOf(feedback) {
  if (feedback.item.custom) return "Added by you in search";
  if (feedback.wasBookmarked) return "Bookmarked, then tried";
  if (feedback.source === "search") return "Told through search";
  return "From Recommendations";
}

function statusOf(feedback) {
  if (isStrongPositive(feedback)) return "Loved it before";
  if (isExperiencedPositive(feedback)) return "Liked it before";
  if (isExperiencedNegative(feedback)) return "Tried it and disliked it";
  if (isSaved(feedback)) return "Bookmarked (haven't tried)";
  if (isDeclined(feedback)) return "Not interested";
  if (feedback.rating === "more") return "Wanted more like this (haven't tried)";
  if (feedback.rating === "less") return "Wanted less like this (haven't tried)";
  return "Haven't tried it";
}

export function toldItems(state) {
  const starters = favorites
    .filter((item) => state.selectedFavorites.has(item.id))
    .map((item) => ({ id: item.id, item, starter: true, status: "Starter favorite", source: "Picked on Favorites", counts: true }));

  const reacted = Object.values(state.feedbackByRecommendation)
    // a starter favorite is already listed above; never show the same item twice
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
