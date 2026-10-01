#!/usr/bin/env node
// #94: Library simplified around Saved and Tried, Saved as default. Free, no network, no browser.
//
//   node scripts/qa/library-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { fresh } = await freshState();
async function freshState() {
  const mod = await import("../../src/state.js");
  return { fresh: () => { mod.resetState(); return mod.state; } };
}

const { saveBookmarkAction, saveLibraryAction } = await import("../../src/actions/library.js");
const { saveQuickFeedback, saveFeedbackDetail, setRecommendationFavorite } = await import("../../src/actions/recommendations.js");
const { bookmarkedFeedback, isBookmarked, isPositiveExperience } = await import("../../src/model/taste.js");
const { libraryItems, migrateStarterFavorites } = await import("../../src/model/library.js");
const { browseReadyForRecommendations } = await import("../../src/model/browse.js");
const { itemStatus, applySearchAction } = await import("../../src/model/search.js");
const { isStrongPositive } = await import("../../src/model/evidence.js");
const { routes, screenFromPath } = await import("../../src/router.js");
const { findExisting } = await import("../../src/model/search.js");

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// Saved is the default Library view.
const state1 = fresh();
eq("Saved is the default library view on a fresh visit", state1.libraryView, "saved");

// Library has no separate "bookmarks" route any more, but old links still resolve into it.
check("router no longer has a standalone bookmarks route", !("bookmarks" in routes));
eq("/library still maps to the library screen", screenFromPath("/library"), "library");
eq("legacy /try-next link still resolves (into Library, which defaults to Saved)", screenFromPath("/try-next"), "library");
eq("legacy /bookmarks link still resolves", screenFromPath("/bookmarks"), "library");

// #117/#197: a fresh visitor starts at the lightweight setup; a returning visitor lands in
// the ongoing product instead of first-run setup.
eq("fresh visit to \"/\" starts at Setup", screenFromPath("/"), "setup");
eq("returning visit to \"/\" lands on Recommendations, not Setup", screenFromPath("/", { onboarded: true }), "recommendations");
eq("an unrecognized path for a fresh visitor still falls back to Favorites (onboarding)", screenFromPath("/nonsense"), "favorites");
eq("an unrecognized path for a returning visitor falls back to Recommendations, not Favorites", screenFromPath("/nonsense", { onboarded: true }), "recommendations");
eq("a direct link to /favorites still resolves for a returning visitor (still reachable, just not the default)", screenFromPath("/favorites", { onboarded: true }), "favorites");

// Saved -> Tried transition is explicit (only on an explicit "I tried it" action) and does not
// duplicate or lose the item: it moves, it doesn't copy.
const state2 = fresh();
const item = { id: "tmdb-movie-1", title: "Some Movie", type: "movie", domains: ["movies"] };
state2.feedbackByRecommendation[item.id] = { item, rating: "not-tried", detail: "bookmarked" };
eq("starts as exactly one Saved item", bookmarkedFeedback(state2).length, 1);
check("saving alone is not taste evidence", !isPositiveExperience(state2.feedbackByRecommendation[item.id]));

const moved = saveBookmarkAction(item.id, "tried-loved");
check("the explicit 'tried it, loved it' action is accepted", moved);
eq("it is no longer in Saved", bookmarkedFeedback(state2).length, 0);
check("it is now Tried (an experienced positive reaction)", isPositiveExperience(state2.feedbackByRecommendation[item.id]));
check("it appears exactly once in Tried/Favorites, not duplicated", (() => {
  const { favorites, library } = libraryItems(state2);
  return [...favorites, ...library].filter((entry) => entry.id === item.id).length === 1;
})());
check("it no longer registers as Saved (no duplication across tabs)", !isBookmarked(state2.feedbackByRecommendation[item.id]));

// #108: removing from Saved returns the item to unknown instead of leaving a hidden neutral blocker.
const state3 = fresh();
const savedItem = { id: "tmdb-movie-9", provider: "tmdb", providerId: "9", title: "Saved Movie", type: "movie", domains: ["movies"] };
state3.feedbackByRecommendation[savedItem.id] = { item: savedItem, rating: "not-tried", detail: "bookmarked" };
state3.customItems[savedItem.id] = savedItem;
check("Saved -> Remove action succeeds", saveBookmarkAction(savedItem.id, "remove"));
check("Saved -> Remove deletes the feedback record", !(savedItem.id in state3.feedbackByRecommendation));
check("Saved -> Remove deletes the retained catalog item when nothing else refers to it", !(savedItem.id in state3.customItems));
eq("Saved -> Remove leaves zero bookmarks", bookmarkedFeedback(state3).length, 0);

// #109: duplicate protection must distinguish same-title works across media/provider identity.
const state4 = fresh();
const movie = { id: "tmdb-movie-1", provider: "tmdb", providerId: "1", title: "Piranesi", type: "movie", domains: ["movies"] };
const book = { id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", title: "Piranesi", type: "book", domains: ["read"] };
state4.customItems[movie.id] = movie;
eq("same provider identity finds the existing item", findExisting(state4, { ...movie })?.id, movie.id);
eq("same title in a different medium does not collapse into the movie", findExisting(state4, book), null);
eq("typed item with explicit book type stays distinct from existing movie", findExisting(state4, { title: "Piranesi", type: "book" }), null);

// Nothing is persisted client-side (no localStorage/sessionStorage schema anywhere), so there is no
// migration to write: resetting state cannot duplicate or lose anything that was never stored.
eq("state carries no persistence schema/version field (nothing is persisted)", typeof state2.schemaVersion, "undefined");

// #103 item 6: Tried -> Favorite (and back), and Favorite/Disliked must never be simultaneously
// true. Favorite is a flag layered onto an experienced-positive reaction, not a separate collection,
// so correcting a reaction to "disliked" automatically clears any Favorite flag on it.
const state5 = fresh();
const lovedItem = { id: "tmdb-movie-2", title: "Loved Thing", type: "movie", domains: ["movies"] };
state5.feedbackByRecommendation[lovedItem.id] = { item: lovedItem, rating: "more", detail: "loved-before" };

check("favoriting a Loved item succeeds", saveLibraryAction(lovedItem.id, "favorite"));
check("it is now a Favorite", state5.libraryFavorites.has(lovedItem.id));
check("it appears in the Favorites bucket, not the plain Tried bucket", (() => {
  const { favorites, library } = libraryItems(state5);
  return favorites.some((e) => e.id === lovedItem.id) && !library.some((e) => e.id === lovedItem.id);
})());

check("un-favoriting it succeeds and keeps it in Tried", (() => {
  const ok = saveLibraryAction(lovedItem.id, "unfavorite");
  const { library } = libraryItems(state5);
  return ok && !state5.libraryFavorites.has(lovedItem.id) && library.some((e) => e.id === lovedItem.id);
})());

// Re-favorite, then correct the reaction to disliked: Favorite must not survive the contradiction.
saveLibraryAction(lovedItem.id, "favorite");
check("re-favorited before the contradiction check", state5.libraryFavorites.has(lovedItem.id));
saveLibraryAction(lovedItem.id, "disliked");
check("correcting to 'disliked' clears Favorite (no Disliked+Favorite state)", !state5.libraryFavorites.has(lovedItem.id));
check("it no longer counts as a positive experience", !isPositiveExperience(state5.feedbackByRecommendation[lovedItem.id]));

// Favorite is a deliberate shortcut for “I tried this and loved it,” even when correcting
// a weaker prior reaction or promoting something that was only Saved.
const likedItem = { id: "tmdb-movie-3", title: "Liked Thing", type: "movie", domains: ["movies"] };
state5.feedbackByRecommendation[likedItem.id] = { item: likedItem, rating: "more", detail: "liked-before" };
check("favoriting a merely-liked item succeeds", saveLibraryAction(likedItem.id, "favorite"));
check("favoriting promotes merely-liked to Loved", isStrongPositive(state5.feedbackByRecommendation[likedItem.id]));
check("favoriting adds durable Favorite flag", state5.libraryFavorites.has(likedItem.id));

const savedItem = { id: "tmdb-movie-saved", title: "Saved Thing", type: "movie", domains: ["movies"] };
state5.feedbackByRecommendation[savedItem.id] = { item: savedItem, rating: "not-tried", detail: "bookmarked" };
check("favoriting a Saved item succeeds", saveLibraryAction(savedItem.id, "favorite"));
check("favoriting Saved records Loved", isStrongPositive(state5.feedbackByRecommendation[savedItem.id]));
check("favoriting Saved remembers that it was bookmarked", state5.feedbackByRecommendation[savedItem.id].wasBookmarked === true);
check("favoriting Saved adds durable Favorite flag", state5.libraryFavorites.has(savedItem.id));

// Recommendation-card Favorite is shorthand for “I know this and love it.”
{
  const stateFavorite = fresh();
  const rec = { id: "tmdb-movie-4", title: "Instant Favorite", type: "movie", domains: ["movies"] };
  stateFavorite.recommendationSets = [[rec]];

  check("recommendation Favorite works before any Tried reaction", setRecommendationFavorite(rec.id, true));
  check("recommendation Favorite records Loved", isStrongPositive(stateFavorite.feedbackByRecommendation[rec.id]));
  check("recommendation Favorite adds durable Favorite flag", stateFavorite.libraryFavorites.has(rec.id));
  eq("recommendation Favorite records tried path", stateFavorite.recommendationExperienceChoice[rec.id], "tried");

  check("un-favoriting from recommendation succeeds", setRecommendationFavorite(rec.id, false));
  check("un-favoriting removes only Favorite flag", !stateFavorite.libraryFavorites.has(rec.id));
  check("un-favoriting preserves Loved reaction", isStrongPositive(stateFavorite.feedbackByRecommendation[rec.id]));
}

// #117 follow-up: migrateStarterFavorites is the one moment starter Favorites move from
// selectedFavorites into the ongoing Library model (feedbackByRecommendation + libraryFavorites).
// Library is the durable source of truth after onboarding; selectedFavorites is onboarding-only.
const state6 = fresh();
const starter1 = { id: "tmdb-movie-10", title: "Starter One", type: "movie", domains: ["movies"] };
const starter2 = { id: "tmdb-movie-11", title: "Starter Two", type: "movie", domains: ["movies"] };
state6.customItems[starter1.id] = starter1;
state6.customItems[starter2.id] = starter2;
state6.selectedFavorites.add(starter1.id);
state6.selectedFavorites.add(starter2.id);

eq("before migration, itemStatus reports a starter Favorite", itemStatus(state6, starter1).key, "starter");
check("before migration, reacting to a starter favorite through Search is blocked", applySearchAction(state6, starter1, "loved") === null);

migrateStarterFavorites(state6);

check("migration clears selectedFavorites", state6.selectedFavorites.size === 0);
check("browseReadyForRecommendations stays true after the Set that used to back it is cleared", browseReadyForRecommendations({ ...state6, onboarded: true }));
check("each starter becomes a real Loved-it reaction", isStrongPositive(state6.feedbackByRecommendation[starter1.id]));
check("each starter is flagged as a Library Favorite", state6.libraryFavorites.has(starter1.id) && state6.libraryFavorites.has(starter2.id));
eq("post-migration, itemStatus reports it through the normal Loved+Favorite path, not \"starter\"", itemStatus(state6, starter1).key, "loved");
eq("post-migration label distinguishes a Favorite from a plain Loved reaction", itemStatus(state6, starter1).label, "Loved it (a Favorite)");

const { favorites: favoritesAfter } = libraryItems(state6);
check("migrated starters still appear in Library's Favorites bucket", favoritesAfter.some((e) => e.id === starter1.id) && favoritesAfter.some((e) => e.id === starter2.id));

// Once migrated, a starter favorite is a normal correctable Library item like any other: it can be
// un-favorited (keeping the Loved reaction) through the exact same saveLibraryAction path already
// covered above, and it is no longer exempt from Search's normal reaction-correction flow.
check("post-migration, Search can now correct the reaction on a former starter (no longer exempt)", applySearchAction(state6, starter1, "liked") !== null);
check("correcting it away from Loved clears its Favorite flag (no Disliked/Liked + Favorite state)", !state6.libraryFavorites.has(starter1.id));

// QA sweep real bug: saveLibraryAction (Library screen) and applySearchAction (Search) both clear
// libraryFavorites when a reaction moves away from strong-positive, but the Recommendations-screen
// reaction editors (saveQuickFeedback/saveFeedbackDetail) never did -- a card reacted to on
// Recommendations, favorited over in Library, then re-reacted to on the still-active Recommendations
// card, could leave a stale Favorite flag that silently resurrects if the reaction moves back to
// Loved, with no explicit favorite action.
{
  const state7 = fresh();
  const pick = { id: "tmdb-movie-77", title: "Recommendation Screen Pick", type: "movie", domains: ["watch"] };
  state7.recommendationSets = [[pick]];

  saveQuickFeedback(pick.id, "more");
  saveFeedbackDetail(pick.id, "loved-before");
  check("reacting Loved it before makes the reaction strong-positive", isStrongPositive(state7.feedbackByRecommendation[pick.id]));
  state7.libraryFavorites.add(pick.id);
  check("favoriting it (as Library/Search would) is reflected", state7.libraryFavorites.has(pick.id));

  saveQuickFeedback(pick.id, "less");
  check("switching the primary rating away from strong-positive clears the stale Favorite flag", !state7.libraryFavorites.has(pick.id));

  saveQuickFeedback(pick.id, "more");
  saveFeedbackDetail(pick.id, "loved-before");
  check("flipping back to Loved it before does not silently resurrect the old Favorite (no explicit favorite action happened)", !state7.libraryFavorites.has(pick.id));

  state7.libraryFavorites.add(pick.id);
  saveFeedbackDetail(pick.id, "liked-before");
  check("changing the detail chip from Loved to Liked also clears a stale Favorite flag", !state7.libraryFavorites.has(pick.id));
}

console.log(`library tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
