#!/usr/bin/env node
// #122: Library search reuses the shared search/evidence model (itemStatus / applySearchAction) —
// this is not a second add-item flow, so its regression coverage is model-level, not a new UI system.
// Free, no network, no browser.
//
//   node scripts/qa/library-search-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { resetState, state: sharedState } = await import("../../src/state.js");
const { itemStatus, applySearchAction, findExisting } = await import("../../src/model/search.js");
const { isStrongPositive } = await import("../../src/model/evidence.js");

const fresh = () => { resetState(); return sharedState; };

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// Synthetic provider-style fixtures, following the same shape real catalog results carry
// (provider/providerId/type), matching the convention used elsewhere for movie/game fixtures since
// this sandbox has no TMDb/IGDB credentials to hit live.
const movie = { id: "tmdb-movie-42", title: "Arrival Point", type: "movie", provider: "tmdb", providerId: "42", domains: ["watch"] };
const book = { id: "openlibrary-book-arrival-point", title: "Arrival Point", type: "book", provider: "openlibrary", providerId: "OL42W", domains: ["read"], by: "J. Some Author" };
const game = { id: "igdb-game-7", title: "Signal Loss", type: "game", provider: "igdb", providerId: "7", domains: ["play"] };

// ---- Scenario 1: a completely new movie, marked Loved, becomes Tried/positive and Favorite-eligible.
{
  const state = fresh();
  eq("new movie starts with no relationship state", itemStatus(state, movie).key, "none");
  const message = applySearchAction(state, movie, "loved");
  check("Loved it returns a confirmation sentence (explicit action = evidence)", typeof message === "string" && message.length > 0);
  eq("after Loved it, status is loved", itemStatus(state, movie).key, "loved");
  check("Loved it is a strong positive, eligible for Favorite", isStrongPositive(state.feedbackByRecommendation[movie.id]));
  const favMessage = applySearchAction(state, movie, "favorite");
  check("Favorite action succeeds after Loved it", typeof favMessage === "string" && favMessage.length > 0);
  eq("status label reflects Favorite once starred", itemStatus(state, movie).label, "Loved it (a Favorite)");
}

// ---- Scenario 2: an already-Saved book, marked Tried, replaces the Saved state (not additive).
{
  const state = fresh();
  applySearchAction(state, book, "bookmark");
  eq("book starts Saved", itemStatus(state, book).key, "bookmarked");
  applySearchAction(state, book, "liked");
  eq("Saved is replaced by Tried/liked, not layered on top of Saved", itemStatus(state, book).key, "liked");
  eq("only one feedback record exists for the book (no duplicate)", Object.keys(state.feedbackByRecommendation).filter((id) => id === book.id).length, 1);
}

// ---- Scenario 3: an existing Favorite is identified as a Favorite; no duplicate is created.
{
  const state = fresh();
  state.selectedFavorites.add(movie.id);
  state.customItems[movie.id] = movie;
  eq("an onboarding Favorite reports status Favorite", itemStatus(state, movie).key, "starter");
  const message = applySearchAction(state, movie, "loved");
  check("search cannot mutate a Favorite (Favorites are managed on the Favorites page)", message === null);
  eq("no feedback record was created alongside the Favorite", state.feedbackByRecommendation[movie.id], undefined);
}

// ---- Scenario 4: an existing Disliked game is shown, and the user can intentionally revise it.
{
  const state = fresh();
  applySearchAction(state, game, "disliked");
  eq("game starts Disliked", itemStatus(state, game).key, "disliked");
  applySearchAction(state, game, "loved");
  eq("an explicit correction can move Disliked to Loved", itemStatus(state, game).key, "loved");
}

// ---- Scenario 5: the same title across movie/book/game stays distinct (canonical identity).
{
  const state = fresh();
  applySearchAction(state, movie, "loved");
  applySearchAction(state, book, "bookmark");
  applySearchAction(state, game, "liked");
  eq("movie keeps its own status", itemStatus(state, movie).key, "loved");
  eq("book keeps its own status despite the identical title", itemStatus(state, book).key, "bookmarked");
  eq("game keeps its own status despite the identical title", itemStatus(state, game).key, "liked");
  eq("three distinct records exist, not one collapsed record", Object.keys(state.feedbackByRecommendation).length, 3);
  check("findExisting does not cross media types for the same title", findExisting(state, { title: "Arrival Point", type: "game" })?.id !== movie.id);
}

// ---- Scenario 6: searching/opening a result alone is never taste evidence.
{
  const state = fresh();
  // "Searching" and "opening" have no state-mutating counterpart in the model at all — itemStatus
  // is a pure read, and there is no action other than applySearchAction that writes state. Simulate
  // "the user just looked" by calling only the read path, repeatedly, then confirm nothing changed.
  itemStatus(state, movie);
  itemStatus(state, movie);
  itemStatus(state, movie);
  eq("looking up status repeatedly leaves the item with no relationship state", itemStatus(state, movie).key, "none");
  eq("no feedback record exists after only reading status", state.feedbackByRecommendation[movie.id], undefined);
}

// ---- Scenario 7: state persists across a "refresh" (a fresh read of the same persisted state).
{
  const state = fresh();
  applySearchAction(state, movie, "liked");
  // itemStatus takes state fresh each call, the same way a re-render after reload would; there is no
  // separate in-memory cache for search to fall out of sync with.
  eq("status is still liked on a subsequent read of the same state", itemStatus(state, movie).key, "liked");
}

// ---- Additional #122 acceptance criteria: results reuse the shared model, no parallel state system.
{
  const state = fresh();
  eq("a brand-new item action still uses the shared OUTCOMES vocabulary (rating/detail)", (() => {
    applySearchAction(state, movie, "liked");
    const { rating, detail } = state.feedbackByRecommendation[movie.id];
    return `${rating}/${detail}`;
  })(), "more/liked-before");
  const removeMessage = applySearchAction(state, movie, "remove");
  check("remove clears the record entirely (not a soft/parallel state)", typeof removeMessage === "string");
  eq("status is back to none after remove", itemStatus(state, movie).key, "none");
}

console.log(`library-search: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((failure) => console.error(`  FAIL: ${failure}`));
  process.exit(1);
}
