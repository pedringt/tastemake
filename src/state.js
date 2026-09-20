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
  // Taste Blind Spot (#20): confirmed spots by item id, wizard drafts in progress, and "not now" dismissals.
  blindSpots: {},
  blindSpotDrafts: {},
  blindSpotDismissed: new Set(),
  // Taste Profile view (#21): the list, or the map with an optional selected pattern / evidence pick.
  profileView: "list",
  mapPattern: null,
  mapItem: null,
  mapFilter: "all",
  favoriteFilter: "all",
  recommendationFilter: "all",
  libraryFilter: "all"
};
