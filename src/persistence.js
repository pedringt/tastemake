import { checkStateShape } from "./model/state-shape.js";

const KEY = "tastemake:test-state:v1";

const SET_FIELDS = ["selectedFavorites", "libraryFavorites", "blindSpotDismissed", "setupAreas"];
const FIELDS = [
  "selectedFavorites", "feedbackByRecommendation", "recommendationSets", "recommendationExhausted",
  "libraryFavorites", "customItems", "blindSpots", "patternStatements", "exclusions", "blindSpotDismissed",
  "tastebreaks", "hypothesisHistory", "modelHypotheses", "profileView", "mapPattern", "mapItem",
  "mapFilter", "favoriteFilter", "recommendationFilter", "libraryFilter", "expandedFeedback",
  "areas", "curveball", "displayName", "setupAreas", "recommendationStyle", "setupComplete",
  "setupReturn", "onboarded", "libraryView", "look", "hypothesisAiChecked"
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
    // #348: keep what is usable. A field or entry with the wrong shape is left out (and the next save
    // overwrites it) instead of throwing on every screen that reads it.
    const value = checkStateShape(parsed.state ?? {}).state;
    for (const field of SET_FIELDS) {
      if (Array.isArray(value[field])) value[field] = new Set(value[field]);
    }
    return value;
  } catch {
    return {};
  }
}

export function persistState(state) {
  if (state?.viewingExample) return;   // Paige's Example Profile lives in memory only
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
