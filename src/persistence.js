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

// #348 follow-up: when loading leaves anything out, the original saved text is copied here first, because
// the next save overwrites KEY. The app never loads this key; My Tastemake offers it as a download until
// the user discards it. One copy at a time: an existing copy is never replaced, so the first damage seen
// is the one kept.
const SET_ASIDE_KEY = "tastemake:set-aside:v1";
let setAsideThisLoad = false;

function setAside(store, raw, dropped) {
  if (!raw) return;
  setAsideThisLoad = true;
  try {
    if (store.getItem(SET_ASIDE_KEY)) return;
    store.setItem(SET_ASIDE_KEY, JSON.stringify({ setAsideAt: new Date().toISOString(), dropped: dropped.slice(0, 50), raw }));
  } catch { /* best effort, like every save here */ }
}

// True when the most recent load left something out (the app shows a one-time notice for it).
export function loadSetAsideData() {
  return setAsideThisLoad;
}

export function readSetAsideCopy() {
  try {
    const parsed = JSON.parse(storage()?.getItem(SET_ASIDE_KEY) || "null");
    return parsed && typeof parsed.raw === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function discardSetAsideCopy() {
  try { storage()?.removeItem(SET_ASIDE_KEY); } catch { /* best effort */ }
}

export function loadPersistedState() {
  const store = storage();
  if (!store) return {};
  setAsideThisLoad = false;
  let raw = null;
  try {
    raw = store.getItem(KEY);
    const parsed = JSON.parse(raw || "null");
    if (!parsed) return {};
    if (typeof parsed !== "object" || parsed.version !== 1) {
      setAside(store, raw, ["unreadable save"]);
      return {};
    }
    // #348: keep what is usable. A field or entry with the wrong shape is left out instead of throwing on
    // every screen that reads it; the original is set aside first, since the next save overwrites it.
    const { state: value, dropped } = checkStateShape(parsed.state ?? {});
    if (dropped.length) setAside(store, raw, dropped);
    for (const field of SET_FIELDS) {
      if (Array.isArray(value[field])) value[field] = new Set(value[field]);
    }
    return value;
  } catch {
    setAside(store, raw, ["unreadable save"]);
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
