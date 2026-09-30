import assert from "node:assert/strict";
import { clearInvalidRefinements, normalizedRefinements, refinementOptionsFor, toggleRefinement } from "../../src/model/refinements.js";
import { evidenceRecords } from "../../src/model/evidence.js";
import { evidenceFingerprint } from "../../src/ai/requests.js";
import { hypothesisEvidenceKey } from "../../src/ai/hypothesis-profile.js";
import { buildBackup, buildHtmlExport, parseBackupText } from "../../src/model/export.js";
import { pathForFeedback, storedReactionForOutcome } from "../../src/model/reaction-flow.js";

const movie = { id: "movie-1", title: "Movie", type: "movie", domains: ["movies"] };
const game = { id: "game-1", title: "Game", type: "game", domains: ["play"] };

assert.deepEqual(storedReactionForOutcome("loved"), { rating: "more", detail: "loved-before" });
assert.deepEqual(storedReactionForOutcome("liked"), { rating: "more", detail: "liked-before" });
assert.deepEqual(storedReactionForOutcome("disliked"), { rating: "less", detail: "tried-disliked" });
assert.deepEqual(storedReactionForOutcome("save"), { rating: "not-tried", detail: "bookmarked" });
assert.deepEqual(storedReactionForOutcome("not-interested"), { rating: "less", detail: "not-interested" });
assert.equal(storedReactionForOutcome("tried"), null, "choosing the first-step Tried path alone is not evidence");

const positive = { item: movie, rating: "more", detail: "liked-before", refinements: [] };
assert.equal(pathForFeedback(positive), "tried");
assert.equal(toggleRefinement(positive, "characters"), true);
assert.equal(toggleRefinement(positive, "humor"), true);
assert.equal(toggleRefinement(positive, "pacing"), true);
assert.equal(toggleRefinement(positive, "story"), false, "caps refinement at three");
assert.deepEqual(normalizedRefinements(positive), ["characters", "humor", "pacing"]);

assert.equal(toggleRefinement(positive, "humor"), true, "selected refinement can be removed");
assert.deepEqual(normalizedRefinements(positive), ["characters", "pacing"]);

const negative = { item: game, rating: "less", detail: "tried-disliked", refinements: ["gameplay", "difficulty-challenge"] };
assert.deepEqual(normalizedRefinements(negative), ["gameplay", "difficulty-challenge"]);
assert(refinementOptionsFor(game).some((option) => option.id === "exploration"));

const intent = { item: movie, rating: "less", detail: "not-interested", refinements: ["humor"] };
assert.equal(pathForFeedback(intent), "not-tried");
assert.equal(pathForFeedback({ item: movie, rating: "not-tried", detail: null }), null, "first-step choice without outcome does not imply stored intent");
assert.deepEqual(normalizedRefinements(intent), [], "intent-only feedback cannot carry experiential refinement");
assert.equal(toggleRefinement(intent, "humor"), false);

const changed = { ...negative, refinements: ["gameplay"] };
clearInvalidRefinements(changed, "negative");
assert.deepEqual(changed.refinements, ["gameplay"]);
changed.rating = "more";
changed.detail = "liked-before";
clearInvalidRefinements(changed, "negative");
assert.deepEqual(changed.refinements, [], "polarity flip clears old why context");

const state = {
  selectedFavorites: new Set(),
  feedbackByRecommendation: {
    [negative.item.id]: negative
  },
  recommendationSets: [],
  seenItemIds: [],
  patternStatements: [],
  areas: {},
  curveball: true,
  recommendationFilter: "all"
};
const evidence = evidenceRecords(state);
assert.equal(evidence.length, 1, "refinement stays attached to one evidence record");
assert.deepEqual(evidence[0].refinements.map((row) => row.id), ["gameplay", "difficulty-challenge"]);

const beforeFingerprint = evidenceFingerprint(state);
negative.refinements = ["gameplay", "exploration"];
assert.notEqual(evidenceFingerprint(state), beforeFingerprint, "refinement changes stale in-flight recommendations");
const key1 = hypothesisEvidenceKey(state);
negative.refinements = ["gameplay", "difficulty-challenge"];
assert.notEqual(hypothesisEvidenceKey(state), key1, "refinement changes invalidate Taste Profile evidence key");

const backup = buildBackup(state, "2026-09-30T00:00:00.000Z");
const restored = parseBackupText(JSON.stringify(backup));
assert.deepEqual(restored.feedbackByRecommendation[negative.item.id].refinements, ["gameplay", "difficulty-challenge"], "backup/restore preserves refinements");
const html = buildHtmlExport(state, "2026-09-30T00:00:00.000Z");
assert(html.includes("Gameplay") && html.includes("Difficulty / challenge"), "readable export includes refinement labels");

const favoriteState = {
  selectedFavorites: new Set(),
  libraryFavorites: new Set([movie.id]),
  feedbackByRecommendation: { [movie.id]: { item: movie, rating: "more", detail: "loved-before", refinements: [] } },
  recommendationSets: [], seenItemIds: [], patternStatements: [], areas: {}, curveball: true, recommendationFilter: "all"
};
const favoriteEvidence = evidenceRecords(favoriteState)[0];
assert.equal(favoriteEvidence.kind, "experienced-favorite", "post-onboarding Favorite remains distinct from Loved");
assert(favoriteEvidence.weight > 2, "Favorite evidence weighs more than Loved");

console.log("refinement tests passed");
