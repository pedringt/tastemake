import assert from "node:assert/strict";
import { MAX_REFINEMENTS, clearInvalidRefinements, contentOptionsFor, contentThemesFor, directionOptionsFor, normalizedRefinements, refinementOptionsFor, refinementRecords, toggleRefinement } from "../../src/model/refinements.js";
import { reasonChangeSummary, trackReasonChanged, trackReasonsOpened } from "../../src/lib/reason-events.js";
import { evidenceRecords } from "../../src/model/evidence.js";
import { buildContext } from "../../src/ai/context.js";
import { buildPickPrompt, selectPromptEvidence } from "../../api/recommendations.mjs";
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
assert.equal(toggleRefinement(positive, "story"), true);
assert.equal(toggleRefinement(positive, "world-setting"), true);
assert.equal(MAX_REFINEMENTS, 5);
assert.equal(toggleRefinement(positive, "atmosphere-style"), false, "caps refinement at five");
assert.deepEqual(normalizedRefinements(positive), ["characters", "humor", "pacing", "story", "world-setting"]);

assert.equal(toggleRefinement(positive, "humor"), true, "selected refinement can be removed");
assert.deepEqual(normalizedRefinements(positive), ["characters", "pacing", "story", "world-setting"]);
assert.equal(toggleRefinement(positive, "pacing:too-slow"), false, "directions are books only");

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

// ---- #250: directions and content chips (books) -------------------------------------------------
const book = { id: "book-1", title: "Book", type: "book", domains: ["read"], genres: ["Fantasy", "Romance", "Fiction, romance, fantasy", "sexual abuse", "LGBTQ novels"] };
const disliked = { item: book, rating: "less", detail: "tried-disliked", refinements: [] };

assert.deepEqual(directionOptionsFor(book, "pacing", "negative").map((d) => d.id), ["too-slow", "too-rushed", "uneven"]);
assert.deepEqual(directionOptionsFor(book, "pacing", "positive").map((d) => d.id), ["kept-me-reading", "slow-burn"]);
assert.deepEqual(directionOptionsFor(movie, "pacing", "negative"), [], "no directions outside books yet");

assert.equal(toggleRefinement(disliked, "pacing"), true);
assert.equal(toggleRefinement(disliked, "pacing:too-slow"), true, "a direction refines the chosen dimension");
assert.deepEqual(disliked.refinements, ["pacing:too-slow"], "a direction replaces its plain dimension: one entry per dimension");
assert.equal(toggleRefinement(disliked, "pacing:too-rushed"), true);
assert.deepEqual(disliked.refinements, ["pacing:too-rushed"], "one direction per dimension");
assert.equal(toggleRefinement(disliked, "pacing:too-rushed"), true);
assert.deepEqual(disliked.refinements, ["pacing"], "choosing the selected direction again goes back to the plain dimension");
assert.equal(toggleRefinement(disliked, "pacing:kept-me-reading"), false, "a positive direction is not valid on a dislike");
assert.equal(toggleRefinement(disliked, "pacing:too-slow"), true);
assert.equal(toggleRefinement(disliked, "pacing"), true);
assert.deepEqual(disliked.refinements, [], "the plain dimension chip removes the whole entry, direction included");

// A direction never uses up a slot of its own.
disliked.refinements = ["characters", "story", "pacing", "structure", "humor"];
assert.equal(toggleRefinement(disliked, "pacing:uneven"), true, "a direction on a chosen dimension works at the cap");
assert.equal(toggleRefinement(disliked, "world-setting:too-thin"), false, "a direction on a new dimension still needs a free slot");
assert.equal(normalizedRefinements(disliked).length, 5);

// Content chips: strict match against an approved list only.
assert.deepEqual(contentOptionsFor(book, "negative").map((o) => o.id), ["romance:took-over"], "exact 'Romance' subject offers the chip");
assert.deepEqual(contentOptionsFor(book, "positive").map((o) => o.id), ["romance:highlight"]);
assert.deepEqual(contentOptionsFor({ ...book, genres: ["Fiction, romance, fantasy"] }, "negative"), [], "a combined subject is not a clear match");
assert.deepEqual(contentOptionsFor({ ...book, genres: ["genre:romance", "body swap"] }, "negative").map((o) => o.id), ["romance:took-over"], "Open Library's genre:romance form counts (#257)");
assert.deepEqual(contentOptionsFor({ ...book, genres: ["genre:fantasy romance"] }, "negative"), [], "the prefix is dropped, but the match stays exact");
assert.deepEqual(contentOptionsFor({ ...book, genres: ["sexual abuse", "LGBTQ novels", "Christian fiction", "Child abuse"] }, "negative"), [], "sensitive, identity and religious subjects never become chips");
assert.deepEqual(contentOptionsFor({ ...book, genres: ["Romance", "Mystery", "Horror"] }, "negative").length, 2, "at most two content chips");
assert.deepEqual(contentOptionsFor({ ...book, genres: undefined }, "negative"), [], "no subjects, no content chips");
assert.deepEqual(contentOptionsFor(book, null), []);

// Validity comes from the vocabulary, not from today's subjects: a chosen content chip survives a metadata change.
const kept = { item: { ...book, genres: [] }, rating: "less", detail: "tried-disliked", refinements: ["romance:took-over", "pacing:too-slow"] };
assert.deepEqual(normalizedRefinements(kept), ["romance:took-over", "pacing:too-slow"]);
assert.deepEqual(refinementRecords(kept), [
  { id: "romance:took-over", label: "Romance took over the story", dimension: "Romance", direction: "Romance took over the story" },
  { id: "pacing:too-slow", label: "Pacing: too slow", dimension: "Pacing", direction: "Too slow" }
], "records carry the label plus their dimension and direction (#250 PR 2)");
assert.equal(refinementRecords({ ...kept, refinements: ["characters"] })[0].direction, null, "a plain dimension has no direction");
assert.deepEqual(normalizedRefinements({ ...kept, refinements: ["pacing", "pacing:too-slow"] }), ["pacing"], "duplicate dimensions collapse to the first");

// Polarity: liked <-> disliked clears; loved <-> liked keeps positive directions.
const flip = { item: book, rating: "more", detail: "loved-before", refinements: ["pacing:slow-burn", "romance:highlight"] };
flip.detail = "liked-before";
clearInvalidRefinements(flip, "positive");
assert.deepEqual(flip.refinements, ["pacing:slow-burn", "romance:highlight"], "loved -> liked keeps reasons");
flip.rating = "less"; flip.detail = "tried-disliked";
clearInvalidRefinements(flip, "positive");
assert.deepEqual(flip.refinements, [], "liked -> disliked clears directions and content chips");

// Still one evidence record per item, however many reasons.
const bookState = {
  selectedFavorites: new Set(),
  feedbackByRecommendation: { [book.id]: { item: book, rating: "less", detail: "tried-disliked", refinements: ["pacing:too-slow", "romance:took-over", "characters", "structure:hard-to-follow", "humor"] } },
  recommendationSets: [], seenItemIds: [], patternStatements: [], areas: {}, curveball: true, recommendationFilter: "all"
};
const bookEvidence = evidenceRecords(bookState);
assert.equal(bookEvidence.length, 1, "five reasons are still one evidence record");
assert.equal(bookEvidence[0].refinements.length, 5);
const bookFingerprint = evidenceFingerprint(bookState);
const bookKey = hypothesisEvidenceKey(bookState);
bookState.feedbackByRecommendation[book.id].refinements[0] = "pacing:too-rushed";
assert.notEqual(evidenceFingerprint(bookState), bookFingerprint, "changing a direction stales in-flight recommendations");
assert.notEqual(hypothesisEvidenceKey(bookState), bookKey, "changing a direction invalidates the Taste Profile key");
const restoredBook = parseBackupText(JSON.stringify(buildBackup(bookState, "2026-10-20T00:00:00.000Z")));
assert.deepEqual(restoredBook.feedbackByRecommendation[book.id].refinements, bookState.feedbackByRecommendation[book.id].refinements, "backup/restore keeps directions and content chips");
assert(buildHtmlExport(bookState, "2026-10-20T00:00:00.000Z").includes("Pacing: too rushed"), "readable export shows the direction");

// #250: a pattern statement's context and excluded areas reach the prompt, so they must stale a request.
const statementState = { ...bookState, patternStatements: [{ hypothesisId: "ai-x", says: "partial", weight: null, context: null, excludedDomains: [] }] };
const statementFingerprint = evidenceFingerprint(statementState);
statementState.patternStatements[0].context = "some";
assert.notEqual(evidenceFingerprint(statementState), statementFingerprint, "statement context is part of the request fingerprint");
const contextFingerprint = evidenceFingerprint(statementState);
statementState.patternStatements[0].excludedDomains = ["read"];
assert.notEqual(evidenceFingerprint(statementState), contextFingerprint, "excluded areas are part of the request fingerprint");

// Usage events: numbers and low-cardinality labels only.
const sent = [];
const va = (kind, payload) => sent.push({ kind, payload });
const after = { item: book, rating: "less", detail: "tried-disliked", refinements: ["pacing", "romance:took-over", "characters"] };
assert.deepEqual(reasonChangeSummary(["pacing", "romance:took-over"], after), { action: "added", count: 3, specific: 1, plainWithDirections: 1 });
assert.deepEqual(reasonChangeSummary(["pacing", "romance:took-over", "characters", "story"], after).action, "removed");
assert.deepEqual(reasonChangeSummary(["pacing:too-slow", "romance:took-over", "characters"], after).action, "changed");
trackReasonsOpened("recommendations", { va });
trackReasonChanged("library", ["pacing"], after, { va });
trackReasonChanged("somewhere-else", [], after, { va });
assert.deepEqual(sent.map((e) => e.payload.name), ["Reasons opened", "Reason changed", "Reason changed"]);
assert.equal(sent[2].payload.data.surface, "other", "unknown surfaces are bucketed");
const wire = JSON.stringify(sent);
for (const leak of ["book-1", "Book", "pacing", "romance", "characters", "tried-disliked"]) {
  assert(!wire.includes(leak), `usage events never carry ${leak}`);
}
assert.equal(trackReasonsOpened("library", { va: undefined }), null, "nothing is sent without Web Analytics");

// ---- #250 PR 2: what the picks prompt sees ---------------------------------------------------------------
{
  const b = (id, title, genres) => ({ id, title, type: "book", domains: ["read"], provider: "openlibrary", providerId: id, genres });
  eq2("themes come from the approved list, strictly", contentThemesFor(b("c1", "A", ["Romance", "Mystery fiction", "Magic"])).join(), "romance,mystery");
  eq2("a compound subject is not a theme", contentThemesFor(b("c2", "B", ["Fiction, romance, fantasy"])).join(), "");
  eq2("non-books get no themes", contentThemesFor({ type: "movie", genres: ["romance"] }).join(), "");

  const loved = b("ol-a", "Loved A", ["Fantasy"]), disliked = b("ol-b", "Disliked B", ["Romance", "Fantasy"]);
  const state = { selectedFavorites: new Set(), libraryFavorites: new Set(), feedbackByRecommendation: {
    [loved.id]: { item: loved, rating: "more", detail: "loved-before", refinements: ["pacing:slow-burn"] },
    [disliked.id]: { item: disliked, rating: "less", detail: "tried-disliked", refinements: ["romance:took-over", "pacing:too-slow"] }
  }, recommendationSets: [], customItems: {}, patternStatements: [], areas: { read: true }, curveball: true };
  const ctx = buildContext(state, [b("ol-c", "Candidate Romance", ["Romance", "Fantasy"]), b("ol-d", "Candidate Plain", ["Fantasy"])]);
  const prompt = buildPickPrompt(ctx, 2);
  assert(prompt.includes('"refinements":["Romance took over the story","Pacing: too slow"]'), "reasons reach the model as their labels, direction included");
  assert(!/"refinements":\[\{/.test(prompt), "no reason objects (ids stay server-side)");
  assert(prompt.includes('"themes":["romance"]'), "a candidate with a clear theme carries it");
  eq2("only that one candidate carries themes", (prompt.match(/"themes":/g) ?? []).length, 1);
  assert(/opposite directions are opposite signals/.test(prompt) && /must not rule out every candidate with that theme/.test(prompt), "the prompt says what directions and themes mean");

  // Tie-break: same kind and weight, the one with reasons goes first and no extra row is added.
  const rec = (ref, refinements) => ({ ref, itemId: ref, class: "experienced", kind: "experienced-positive", polarity: 1, weight: 1, domains: ["read"], refinements });
  const picked = selectPromptEvidence({ evidence: [rec("ev:plain1", []), rec("ev:plain2", []), rec("ev:reasoned", [{ id: "pacing", label: "Pacing" }])], candidates: [{ domains: ["read"] }] }, 1);
  eq2("among equals, the item with reasons wins the slot", picked.map((r) => r.ref).join(), "ev:reasoned");
  eq2("...and the count does not grow", selectPromptEvidence({ evidence: [rec("ev:a", [{ id: "x", label: "X" }]), rec("ev:b", [])], candidates: [{ domains: ["read"] }] }, 1).length, 1);
}
function eq2(name, actual, expected) { assert.deepEqual(actual, expected, name); }

console.log("refinement tests passed");
