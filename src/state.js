import { DEFAULT_LOOK, isLook } from "./data/looks.js";
import { visibleDomains } from "./data/domains.js";

// Everything the user has told Tastemake or configured, in one place so "Start over" can clear it.
// (The look, and where the user is, are not part of this: starting over keeps your look.)
function fresh() {
  return {
    // A real visitor starts with nothing selected. Favorites are persisted only after the user
    // chooses real catalog items (or explicitly adds one by hand).
    selectedFavorites: new Set(),
    feedbackByRecommendation: {},
    // Recommendation sets are populated only from the real catalog pipeline.
    recommendationSets: [],
    recommendationExhausted: false,
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
    // Tastebreak (#19 v1): confirmed/rejected patterns and a free-text note per item, wizard drafts in
    // progress. Deterministic, not taste evidence on its own; confirmed patterns are recorded below as
    // user-confirmed revisions.
    tastebreaks: {},
    tastebreakDrafts: {},
    // Append-only revision history for taste hypotheses (#37). See src/model/history.js.
    hypothesisHistory: [],
    // #86: validated live interpretations for the Taste Profile. These are inferred state, never evidence.
    modelHypotheses: [],
    hypothesisAiStatus: "idle",
    hypothesisAiKey: null,
    hypothesisAiMessage: null,
    // Transient live-AI UI state (#42). None of this is taste evidence and none of it is persisted.
    // aiRequest is the in-flight request: its id, the evidence fingerprint it was computed from, and its
    // AbortController, so a stale or cancelled answer is never shown.
    aiRequest: null,
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
    // #94: Library has two views, Saved (untried, actionable) and Tried (already experienced).
    // Saved is the default because it's the actionable one. This is presentation state, not
    // evidence, and — like the rest of state — lives only in memory; there is no persisted schema
    // to migrate, so there is nothing that can duplicate or lose data across a reload.
    libraryView: "saved",
    // #52: per-item explicit open/closed override for the discovery-quality note, keyed by item id.
    // Purely a display preference, not evidence. Without an override it defaults to open once there is
    // already an answer in it (see qualityExpanded in screens/recommendations.js) and closed otherwise,
    // but an explicit click always wins over that default in either direction.
    expandedFeedback: {},
    // My Tastemake (#8): settings, not taste. Areas are "show me / don't show me this kind of thing" and say
    // nothing about what the user likes; the curveball setting only changes how new sets are put together.
    areas: Object.fromEntries(visibleDomains().map((domain) => [domain.id, true])),
    curveball: true,
    // First-run setup: configuration only, never taste evidence.
    displayName: "",
    setupAreas: new Set(["all"]),
    recommendationStyle: "balanced",
    setupComplete: false,
    setupReturn: "favorites",
    starterReplaceId: null,
    resetArmed: false,
    // #59: true once a first-time visitor has reached Recommendations at least once. Before that, Favorites
    // shows one continuation CTA instead of two peer choices (Recommendations vs. Taste Profile aren't a
    // meaningful fork yet). A returning visitor who deliberately reopens Favorites (e.g. "Change favorites")
    // sees the full two-CTA choice again, since by then Taste Profile is a real destination.
    onboarded: false
  };
}

export const state = {
  screen: "favorites",
  // Starting look (#25). In memory only, like everything else; ?look=... in the link sets it before first paint.
  look: isLook(document.documentElement.dataset.look) ? document.documentElement.dataset.look : DEFAULT_LOOK,
  lookReturn: "favorites",  // where "Done" goes when the picker was opened from the header
  mineReturn: "favorites",  // where "Back" goes from My Tastemake
  ...fresh()
};

export function resetState() {
  Object.assign(state, fresh());
}
