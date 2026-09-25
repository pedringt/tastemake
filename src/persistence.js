const KEY = "tastemake:test-state:v1";

const SET_FIELDS = ["selectedFavorites", "libraryFavorites", "blindSpotDismissed", "setupAreas"];
const FIELDS = [
  "selectedFavorites", "feedbackByRecommendation", "recommendationSets", "recommendationExhausted",
  "libraryFavorites", "customItems", "blindSpots", "patternStatements", "blindSpotDismissed",
  "tastebreaks", "hypothesisHistory", "modelHypotheses", "profileView", "mapPattern", "mapItem",
  "mapFilter", "favoriteFilter", "recommendationFilter", "libraryFilter", "expandedFeedback",
  "areas", "curveball", "displayName", "setupAreas", "recommendationStyle", "setupComplete",
  "setupReturn", "onboarded", "libraryView", "look"
];

function storage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadPersistedState() {
  const store = storage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(KEY) || "null");
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) return {};
    const value = parsed.state ?? {};
    for (const field of SET_FIELDS) {
      if (Array.isArray(value[field])) value[field] = new Set(value[field]);
    }
    return value;
  } catch {
    return {};
  }
}

export function persistState(state) {
  const store = storage();
  if (!store) return;
  const out = {};
  for (const field of FIELDS) {
    const value = state[field];
    out[field] = value instanceof Set ? [...value] : value;
  }
  try { store.setItem(KEY, JSON.stringify({ version: 1, state: out })); } catch { /* test state is best effort */ }
}

export function clearPersistedState() {
  try { storage()?.removeItem(KEY); } catch { /* best effort */ }
}
