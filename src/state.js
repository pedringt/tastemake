import { favorites, recommendations } from "./data/catalog.js";

export const state = {
  screen: "favorites",
  selectedFavorites: new Set(favorites.filter((item) => item.selected).map((item) => item.id)),
  feedbackByRecommendation: {},
  // Each "Keep discovering" appends a set; the first is the hand-picked opening set.
  recommendationSets: [recommendations],
  // Loved picks the user starred as Favorites. Only meaningful while the pick is still "Loved it before".
  libraryFavorites: new Set(),
  // Items the user typed in themselves (search > "Add something"), keyed by id. Registered on first action.
  customItems: {},
  favoriteFilter: "all",
  recommendationFilter: "all",
  libraryFilter: "all"
};
