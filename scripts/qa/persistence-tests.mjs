#!/usr/bin/env node

import { createSuite } from "./lib/assert.mjs";

const data = new Map();
globalThis.localStorage = {
  getItem(key) { return data.get(key) ?? null; },
  setItem(key, value) { data.set(key, String(value)); },
  removeItem(key) { data.delete(key); }
};

const { persistState, loadPersistedState, clearPersistedState } = await import("../../src/persistence.js");

const { check, finish } = createSuite("persistence tests");

const state = {
  selectedFavorites: new Set(["a"]),
  feedbackByRecommendation: { a: { rating: "more" } },
  recommendationSets: [[{ id: "r1" }]],
  recommendationExhausted: false,
  libraryFavorites: new Set(["a"]),
  customItems: { a: { id: "a", title: "A" } },
  blindSpots: {},
  patternStatements: [],
  blindSpotDismissed: new Set(["x"]),
  tastebreaks: {},
  hypothesisHistory: [{ id: "h1" }],
  modelHypotheses: [{ id: "ai-one" }],
  profileView: "list",
  mapPattern: null,
  mapItem: null,
  mapFilter: "all",
  favoriteFilter: "all",
  recommendationFilter: "read",
  libraryFilter: "all",
  expandedFeedback: {},
  areas: { movies: true, tv: true, read: true, play: true },
  curveball: true,
  displayName: "Tester",
  setupAreas: new Set(["all"]),
  recommendationStyle: "balanced",
  setupComplete: true,
  setupReturn: "favorites",
  onboarded: true,
  libraryView: "saved",
  look: "graphic",
  aiStatus: "loading",
  aiMessage: "temporary",
  hypothesisAiStatus: "loading",
  hypothesisAiKey: "temporary"
};

persistState(state);
const restored = loadPersistedState();
check("restores set fields as Sets", restored.selectedFavorites instanceof Set && restored.selectedFavorites.has("a"));
check("restores recommendation history", restored.recommendationSets?.[0]?.[0]?.id === "r1");
check("restores testing filters", restored.recommendationFilter === "read");
check("restores look", restored.look === "graphic");
check("does not persist transient request state", !("aiStatus" in restored) && !("hypothesisAiKey" in restored));

clearPersistedState();
check("clear removes persisted test state", Object.keys(loadPersistedState()).length === 0);

finish();
