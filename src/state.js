import { DEFAULT_LOOK, isLook } from "./data/looks.js";
import { visibleDomains } from "./data/domains.js";
import { clearPersistedState, loadPersistedState } from "./persistence.js";
import { parseBackupText } from "./model/export.js";

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
    // #48: "never recommend" boundaries. Not taste evidence (src/model/exclusions.js).
    exclusions: [],
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
    aiPaused: false,
    // Taste Profile view (#21): the list, or the map with an optional selected pattern / evidence pick.
    profileView: "list",
    mapPattern: null,
    mapItem: null,
    mapFilter: "all",
    favoriteFilter: "all",
    recommendationFilter: "all",
    recommendationMediumFilter: "all",
    // Per-card progressive disclosure for Recommendations. Choosing Tried / Not tried here is
    // presentation state only; it becomes evidence only after the user chooses a concrete outcome.
    recommendationExperienceChoice: {},
    // Which recommendation currently has its anchored feedback editor open. Presentation only.
    recommendationFeedbackItemId: null,
    libraryFilter: "all",
    libraryReactionFilter: "all",
    // Browse is a presentation/discovery surface. Browsing alone is never evidence and these fields
    // are intentionally transient rather than persisted.
    browseDomain: "movies",
    browseGenre: "drama",
    browseItems: [],
    browsePage: 0,
    browseHasMore: true,
    browseLoading: false,
    browseError: false,
    // #94: Library has two views, Saved (untried, actionable) and Tried (already experienced).
    // Saved is the default because it's the actionable one. This is presentation state, not
    // evidence, and — like the rest of state — lives only in memory; there is no persisted schema
    // to migrate, so there is nothing that can duplicate or lose data across a reload.
    libraryView: "saved",
    // Oct 27: things just rated from Saved stay on that list, with "What worked for you?" open, until Done
    // or leaving Library. In memory only; never saved, never evidence.
    savedJustTried: [],
    // Oct 27: things rated on Browse since arriving there, for its "rated this visit" count. In memory only.
    browseRatedThisVisit: [],
    // Oct 27: Browse showing "More like <item>" instead of a genre: { id, title, type }. In memory only.
    browseSimilar: null,
    // Unused since the "This pick was" line was removed (Oct 27); kept so saved data loads unchanged.
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

function normalizePersistedPatternStatements(statements = []) {
  return (Array.isArray(statements) ? statements : []).map((entry) => {
    const next = { ...entry };
    if (next.says === "not-me" || next.says === "unsure") {
      next.weight = null;
      next.context = null;
      next.excludedDomains = [];
    } else if (next.says === "partial") {
      next.weight = null;
      if (next.context === "broad") next.context = null;
    }
    return next;
  });
}

const persisted = loadPersistedState();
const initial = fresh();

export const state = {
  screen: "favorites",
  look: isLook(persisted.look) ? persisted.look : (isLook(document.documentElement.dataset.look) ? document.documentElement.dataset.look : DEFAULT_LOOK),
  lookReturn: "favorites",
  mineReturn: "favorites",
  ...initial,
  ...persisted,
  patternStatements: normalizePersistedPatternStatements(persisted.patternStatements ?? initial.patternStatements),
  exclusions: Array.isArray(persisted.exclusions) ? persisted.exclusions : initial.exclusions,
  selectedFavorites: persisted.selectedFavorites instanceof Set ? persisted.selectedFavorites : initial.selectedFavorites,
  libraryFavorites: persisted.libraryFavorites instanceof Set ? persisted.libraryFavorites : initial.libraryFavorites,
  blindSpotDismissed: persisted.blindSpotDismissed instanceof Set ? persisted.blindSpotDismissed : initial.blindSpotDismissed,
  setupAreas: persisted.setupAreas instanceof Set ? persisted.setupAreas : initial.setupAreas,
  aiRequest: null,
  aiStatus: "idle",
  aiSource: null,
  aiMessage: null,
    aiPaused: false,
  hypothesisAiStatus: "idle",
  hypothesisAiMessage: null,
  recommendationMediumFilter: "all",
  recommendationFeedbackItemId: null,
  browseItems: [],
  browsePage: 0,
  browseHasMore: true,
  browseLoading: false,
  browseError: false,
  starterReplaceId: null,
  resetArmed: false
};

document.documentElement.dataset.look = state.look;

export function resetState() {
  const look = state.look;
  // Oct 27: "Start over" inside Paige's Example Profile clears the example in memory, never the visitor's saved profile.
  if (!state.viewingExample) clearPersistedState();
  Object.assign(state, fresh(), { look });
}


export function restoreStateFromBackupText(text) {
  const restored = parseBackupText(text);
  const look = isLook(restored.look) ? restored.look : state.look;
  Object.assign(state, fresh(), restored, {
    look,
    patternStatements: normalizePersistedPatternStatements(restored.patternStatements ?? []),
    exclusions: Array.isArray(restored.exclusions) ? restored.exclusions : [],
    selectedFavorites: restored.selectedFavorites instanceof Set ? restored.selectedFavorites : new Set(restored.selectedFavorites ?? []),
    libraryFavorites: restored.libraryFavorites instanceof Set ? restored.libraryFavorites : new Set(restored.libraryFavorites ?? []),
    blindSpotDismissed: restored.blindSpotDismissed instanceof Set ? restored.blindSpotDismissed : new Set(restored.blindSpotDismissed ?? []),
    setupAreas: restored.setupAreas instanceof Set ? restored.setupAreas : new Set(restored.setupAreas ?? ["all"]),
    aiRequest: null,
    aiStatus: "idle",
    aiSource: null,
    aiMessage: null,
    aiPaused: false,
    hypothesisAiStatus: "idle",
    hypothesisAiMessage: null,
    recommendationMediumFilter: "all",
    recommendationFeedbackItemId: null,
    browseItems: [],
    browsePage: 0,
    browseHasMore: true,
    browseLoading: false,
    browseError: false,
    starterReplaceId: null,
    resetArmed: false
  });
  document.documentElement.dataset.look = state.look;
  return state;
}
