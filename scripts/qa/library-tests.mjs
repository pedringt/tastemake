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

const { saveBookmarkAction } = await import("../../src/actions/library.js");
const { bookmarkedFeedback, isBookmarked, isPositiveExperience } = await import("../../src/model/taste.js");
const { libraryItems } = await import("../../src/model/library.js");
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

// Saved -> Tried transition is explicit (only on an explicit "I tried it" action) and does not
// duplicate or lose the item: it moves, it doesn't copy.
const state2 = fresh();
const item = { id: "tmdb-movie-1", title: "Some Movie", type: "movie", domains: ["watch"] };
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
const savedItem = { id: "tmdb-movie-9", provider: "tmdb", providerId: "9", title: "Saved Movie", type: "movie", domains: ["watch"] };
state3.feedbackByRecommendation[savedItem.id] = { item: savedItem, rating: "not-tried", detail: "bookmarked" };
state3.customItems[savedItem.id] = savedItem;
check("Saved -> Remove action succeeds", saveBookmarkAction(savedItem.id, "remove"));
check("Saved -> Remove deletes the feedback record", !(savedItem.id in state3.feedbackByRecommendation));
check("Saved -> Remove deletes the retained catalog item when nothing else refers to it", !(savedItem.id in state3.customItems));
eq("Saved -> Remove leaves zero bookmarks", bookmarkedFeedback(state3).length, 0);

// #109: duplicate protection must distinguish same-title works across media/provider identity.
const state4 = fresh();
const movie = { id: "tmdb-movie-1", provider: "tmdb", providerId: "1", title: "Piranesi", type: "movie", domains: ["watch"] };
const book = { id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", title: "Piranesi", type: "book", domains: ["read"] };
state4.customItems[movie.id] = movie;
eq("same provider identity finds the existing item", findExisting(state4, { ...movie })?.id, movie.id);
eq("same title in a different medium does not collapse into the movie", findExisting(state4, book), null);
eq("typed item with explicit book type stays distinct from existing movie", findExisting(state4, { title: "Piranesi", type: "book" }), null);

// Nothing is persisted client-side (no localStorage/sessionStorage schema anywhere), so there is no
// migration to write: resetting state cannot duplicate or lose anything that was never stored.
eq("state carries no persistence schema/version field (nothing is persisted)", typeof state2.schemaVersion, "undefined");

console.log(`library tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
