import { favorites } from "../data/catalog.js";
import { isPositiveExperience, tasteDelta } from "./taste.js";
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
  if (feedback.detail === "loved-before") return "Loved it before";
  if (feedback.detail === "liked-before") return "Liked it before";
  if (feedback.detail === "tried-disliked") return "Tried it and disliked it";
  if (feedback.detail === "bookmarked") return "Bookmarked (haven't tried)";
  if (feedback.detail === "not-interested") return "Not interested";
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
      counts: tasteDelta(feedback) !== 0,
      positive: isPositiveExperience(feedback),
      experienced: feedback.rating !== "not-tried" && (feedback.detail === "loved-before" || feedback.detail === "liked-before" || feedback.detail === "tried-disliked"),
      loved: feedback.detail === "loved-before",
      liked: feedback.detail === "liked-before",
      disliked: feedback.detail === "tried-disliked"
    }));

  const all = [...starters, ...reacted];
  return {
    counts: all.filter((entry) => entry.counts),
    steers: all.filter((entry) => !entry.counts),
    blindSpots: activeBlindSpots(state),
    total: all.length
  };
}
