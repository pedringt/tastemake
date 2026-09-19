import { favorites } from "./data/catalog.js";

export const state = {
  screen: "favorites",
  selectedFavorites: new Set(favorites.filter((item) => item.selected).map((item) => item.id)),
  feedbackByRecommendation: {},
  recommendationRound: 1,
  favoriteFilter: "all",
  recommendationFilter: "all"
};
