import { starterItems } from "./starters.js";
import { isPositiveExperience } from "./taste.js";
import { isExperiencedNegative, isStrongPositive } from "./evidence.js";

// The Library is derived from what the app already knows, never stored on its own, so it cannot
// disagree with the Taste Profile and every correction (Loved -> Liked -> Didn't like) fixes it for free.
//   Favorites = your starter favorites + anything you loved and chose to star
//   Library   = everything else you have tried and liked or loved
// Only things the user has actually tried live here. Untried saves are Bookmarks.
export function libraryItems(state) {
  const starters = starterItems(state)
    .map((item) => ({ id: item.id, item, source: "starter", isFavorite: true, blurb: item.note ?? item.about ?? "One of your starter favorites." }));

  const reacted = Object.values(state.feedbackByRecommendation)
    .filter(isPositiveExperience)
    // a starter favorite is already listed above; do not show the same pick twice
    .filter((feedback) => !state.selectedFavorites.has(feedback.item.id))
    .map((feedback) => ({
      id: feedback.item.id,
      item: feedback.item,
      source: isStrongPositive(feedback) ? "loved" : "liked",
      isFavorite: isStrongPositive(feedback) && state.libraryFavorites.has(feedback.item.id),
      blurb: feedback.item.about ?? feedback.item.note ?? "",
      wasBookmarked: Boolean(feedback.wasBookmarked)
    }));

  return {
    favorites: [...starters, ...reacted.filter((entry) => entry.isFavorite)],
    library: reacted.filter((entry) => !entry.isFavorite)
  };
}

// Tried and disliked stays out of the Library but is kept (as background evidence) and correctable.
export function dislikedItems(state) {
  return Object.values(state.feedbackByRecommendation)
    .filter(isExperiencedNegative)
    .map((feedback) => ({ id: feedback.item.id, item: feedback.item }));
}
