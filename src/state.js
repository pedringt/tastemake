import { favorites, recommendations } from "./data/catalog.js";

export const state = {
  screen: "favorites",
  selectedFavorites: new Set(favorites.filter((item) => item.selected).map((item) => item.id)),
  feedbackByRecommendation: {},
  // Each "Keep discovering" appends a set; the first is the hand-picked opening set.
  recommendationSets: [recommendations],
  favoriteFilter: "all",
  recommendationFilter: "all"
};
