import { favorites } from "../data/catalog.js";
import { isPositiveExperience } from "./taste.js";

// The Library is derived from what the app already knows, never stored on its own, so it cannot
// disagree with the Taste Profile and every correction (Loved -> Liked -> Didn't like) fixes it for free.
//   Favorites = your starter favorites + anything you loved and chose to star
//   Library   = everything else you have tried and liked or loved
// Only things the user has actually tried live here. Untried saves are Bookmarks.
export function libraryItems(state) {
  const starters = favorites
    .filter((item) => state.selectedFavorites.has(item.id))
    .map((item) => ({ id: item.id, item, source: "starter", isFavorite: true, blurb: item.note }));

  const reacted = Object.values(state.feedbackByRecommendation)
    .filter(isPositiveExperience)
    .map((feedback) => ({
      id: feedback.item.id,
      item: feedback.item,
      source: feedback.detail === "loved-before" ? "loved" : "liked",
      isFavorite: feedback.detail === "loved-before" && state.libraryFavorites.has(feedback.item.id),
      blurb: feedback.item.about,
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
    .filter((feedback) => feedback.rating === "less" && feedback.detail === "tried-disliked")
    .map((feedback) => ({ id: feedback.item.id, item: feedback.item }));
}
