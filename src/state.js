import { favorites, recommendations } from "./data/catalog.js";
import { DEFAULT_LOOK, isLook } from "./data/looks.js";
import { visibleDomains } from "./data/domains.js";

// Everything the user has told Tastemake or configured, in one place so "Start over" can clear it.
// (The look, and where the user is, are not part of this: starting over keeps your look.)
function fresh() {
  return {
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
    // What the user said about a pattern (user-confirmed; outranks inference; not taste evidence). See statements.js.
    patternStatements: [],
    blindSpotDrafts: {},
    blindSpotDismissed: new Set(),
    // Transient live-AI UI state. None of this is taste evidence and none of it is persisted.
    aiStatus: "idle",
    aiSource: null,
    aiMessage: null,
    // Taste Profile view (#21): the list, or the map with an optional selected pattern / evidence pick.
    profileView: "list",
    mapPattern: null,
    mapItem: null,
    mapFilter: "all",
    favoriteFilter: "all",
    recommendationFilter: "all",
    libraryFilter: "all",
    // My Tastemake (#8): settings, not taste. Areas are "show me / don't show me this kind of thing" and say
    // nothing about what the user likes; the curveball setting only changes how new sets are put together.
    areas: Object.fromEntries(visibleDomains().map((domain) => [domain.id, true])),
    curveball: true,
    resetArmed: false
  };
}

export const state = {
  screen: "favorites",
  // Starting look (#25). In memory only, like everything else; ?look=... in the link sets it before first paint.
  look: isLook(document.documentElement.dataset.look) ? document.documentElement.dataset.look : DEFAULT_LOOK,
  lookChosen: false,        // true once the user picked (or accepted) a look
  lookOnboarding: false,    // the look step is being shown before Favorites
  lookReturn: "favorites",  // where "Done" goes when the picker was opened from the header
  mineReturn: "favorites",  // where "Back" goes from My Tastemake
  ...fresh()
};

export function resetState() {
  Object.assign(state, fresh());
}
