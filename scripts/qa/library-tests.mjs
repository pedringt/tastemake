#!/usr/bin/env node
// #94: Library simplified around Saved and Tried, Saved as default. Free, no network, no browser.
//
//   node scripts/qa/library-tests.mjs

import { createSuite } from "./lib/assert.mjs";

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { fresh } = await freshState();
async function freshState() {
  const mod = await import("../../src/state.js");
  return { fresh: () => { mod.resetState(); return mod.state; } };
}

const { saveBookmarkAction, saveLibraryAction } = await import("../../src/actions/library.js");
const { saveQuickFeedback, saveFeedbackDetail, setRecommendationFavorite } = await import("../../src/actions/recommendations.js");
const { bookmarkedFeedback, isBookmarked, isPositiveExperience } = await import("../../src/model/taste.js");
const { libraryItemById, libraryItems, migrateStarterFavorites } = await import("../../src/model/library.js");
const { browseReadyForRecommendations } = await import("../../src/model/browse.js");
const { itemStatus, applySearchAction } = await import("../../src/model/search.js");
const { isStrongPositive } = await import("../../src/model/evidence.js");
const { routes, screenFromPath } = await import("../../src/router.js");
const { findExisting } = await import("../../src/model/search.js");

const { check, eq, finish } = createSuite("library tests");

const { favoritesDestination } = await import("../../src/model/library.js");

// #103 item 7 / #117: "Change favorites" must not send a returning user to the onboarding screen,
// which after migration reads "0 of 4". It opens Library > Tried > Favorites instead.
{
  const s = fresh();
  eq("before onboarding, Change favorites opens the Favorites setup screen", favoritesDestination(s).screen, "favorites");
  const item = { id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", title: "A Book", type: "book", domains: ["read"] };
  s.customItems[item.id] = item;
  s.selectedFavorites.add(item.id);
  s.onboarded = true;
  migrateStarterFavorites(s);
  eq("after onboarding the setup screen's selection is empty (why it cannot be the destination)", s.selectedFavorites.size, 0);
  const dest = favoritesDestination(s);
  eq("a returning user's Change favorites opens Library", dest.screen, "library");
  eq("on the Tried view", dest.libraryView, "tried");
  eq("filtered to Favorites", dest.libraryReactionFilter, "favorites");
  check("where the migrated favorite is listed", libraryItems(s).favorites.some((entry) => entry.id === item.id));
}


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

const promotedSavedItem = { id: "tmdb-movie-saved", title: "Saved Thing", type: "movie", domains: ["movies"] };
state5.feedbackByRecommendation[promotedSavedItem.id] = { item: promotedSavedItem, rating: "not-tried", detail: "bookmarked" };
check("favoriting a Saved item succeeds", saveLibraryAction(promotedSavedItem.id, "favorite"));
check("favoriting Saved records Loved", isStrongPositive(state5.feedbackByRecommendation[promotedSavedItem.id]));
check("favoriting Saved remembers that it was bookmarked", state5.feedbackByRecommendation[promotedSavedItem.id].wasBookmarked === true);
check("favoriting Saved adds durable Favorite flag", state5.libraryFavorites.has(promotedSavedItem.id));

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

// #103 items 1/2: an expanded Library card fetches detail for its item. Items reacted to from
// Recommendations are only in feedbackByRecommendation, never customItems, so the lookup must find
// them there (before this, director/cast never loaded for the main way items reach the Library).
{
  const s = fresh();
  const recItem = { id: "tmdb-movie-2137", provider: "tmdb", providerId: "2137", title: "The Storm Riders", type: "movie", domains: ["movies"] };
  s.feedbackByRecommendation[recItem.id] = { item: recItem, rating: "more", detail: "loved-before" };
  check("a recommendation-sourced Library item is found for detail loading", libraryItemById(s, recItem.id) === recItem);
  check("that item is not in customItems (the old lookup's only source)", !s.customItems[recItem.id]);
  const added = { id: "custom-1", custom: true, title: "Hand added", type: "book", domains: ["read"] };
  s.customItems[added.id] = added;
  check("an added item with no reaction is still found", libraryItemById(s, added.id) === added);
  check("an unknown id is null", libraryItemById(s, "nope") === null);
}

// ---- #29 growth check: long sections stop at 30; only the open tab renders --------------------------------
{
  const { renderLibrary, LIBRARY_SHOW_LIMIT } = await import("../../src/screens/library.js");
  const state = fresh();
  state.onboarded = true;
  const item = (i, type = "movie") => ({ id: `tmdb-${type}-${5000 + i}`, provider: "tmdb", providerId: String(5000 + i), title: `Long List ${i}`, type, domains: [type === "tv" ? "tv" : "movies"] });
  for (let i = 0; i < 45; i++) state.feedbackByRecommendation[item(i).id] = { item: item(i), rating: "more", detail: "liked-before" };
  for (let i = 100; i < 135; i++) state.feedbackByRecommendation[item(i, "tv").id] = { item: item(i, "tv"), rating: "not-tried", detail: "bookmarked" };
  const count = (html, attr) => (html.match(new RegExp(`${attr}="`, "g")) ?? []).length;

  state.libraryView = "tried";
  let html = renderLibrary();
  eq("Tried shows the first 30 of 45", count(html, "data-library-id"), LIBRARY_SHOW_LIMIT);
  check("with a Show all button that says how many", /data-library-show-all="tried-tried">Show all 45/.test(html) && /Showing 30 of 45/.test(html));
  eq("the closed Saved tab is not rendered", count(html, "data-bookmark-id"), 0);
  check("but its panel stays for the tab's aria-controls", /id="library-panel-saved"[^>]*hidden/.test(html));

  state.libraryExpanded = new Set(["tried-tried"]);
  html = renderLibrary();
  eq("Show all opens the whole section", count(html, "data-library-id"), 45);
  check("and the button goes away", !/data-library-show-all="tried-tried"/.test(html));

  state.libraryView = "saved";
  html = renderLibrary();
  eq("Saved is capped the same way", count(html, "data-bookmark-id"), LIBRARY_SHOW_LIMIT);
  check("with its own Show all", /data-library-show-all="saved">Show all 35/.test(html));
  eq("the closed Tried tab is not rendered", count(html, "data-library-id"), 0);

  state.libraryExpanded = new Set();
  for (const id of Object.keys(state.feedbackByRecommendation).slice(10)) delete state.feedbackByRecommendation[id];
  state.libraryView = "tried";
  check("a short section has no button", !/data-library-show-all/.test(renderLibrary()));
  const persisted = (await import("node:fs")).readFileSync(new URL("../../src/persistence.js", import.meta.url), "utf8");
  check("the open state is never saved", /const FIELDS = \[/.test(persisted) && !persisted.includes("libraryExpanded"));
}

// ---- Oct 27: rating in Saved asks what worked before the item moves to Tried; Saved wording ----------------
{
  const { renderLibrary } = await import("../../src/screens/library.js");
  const { finishSavedTried } = await import("../../src/actions/library.js");
  const state = fresh();
  state.onboarded = true;
  state.libraryView = "saved";
  const book = { id: "openlibrary-book-OLSAVEDW", provider: "openlibrary", providerId: "OLSAVEDW", title: "Saved Then Read", type: "book", domains: ["read"], genres: ["Fantasy"] };
  const other = { id: "tmdb-movie-7001", provider: "tmdb", providerId: "7001", title: "Still Saved", type: "movie", domains: ["movies"] };
  state.feedbackByRecommendation[book.id] = { item: book, rating: "not-tried", detail: "bookmarked" };
  state.feedbackByRecommendation[other.id] = { item: other, rating: "not-tried", detail: "bookmarked" };

  let html = renderLibrary();
  check("Saved cards no longer repeat a \"Saved\" label", !/library-compact-status">Saved</.test(html));
  check("the star's note is plain", html.includes("Starring it also marks it as loved.") && !html.includes("Tried · Loved automatically"));
  check("the tried section asks how it was", html.includes("Tried it? How was it?"));
  check("the intro is the short one", html.includes("Saving doesn't change your taste profile; rating it once you've tried it does."));

  check("rating it from Saved works", saveBookmarkAction(book.id, "tried-loved"));
  check("it counts as tried and loved", isStrongPositive(state.feedbackByRecommendation[book.id]) && !isBookmarked(state.feedbackByRecommendation[book.id]));
  html = renderLibrary();
  check("but it stays on the Saved list", html.includes(`data-bookmark-id="${book.id}"`), html.slice(0, 200));
  check("with \"What worked for you?\" already open", /<details class="experience-refinement[^"]*" open data-refinement-item="openlibrary-book-OLSAVEDW"/.test(html));
  check("its rating shown and a Done button", html.includes('library-compact-status">Loved it<') && html.includes(`data-saved-done="${book.id}"`));
  check("it keeps its place in the list (first, as before)", html.indexOf(book.id) < html.indexOf(other.id));
  check("the Saved count no longer includes it", /Saved <span class="library-tab-count">1</.test(html));

  finishSavedTried(book.id);
  html = renderLibrary();
  check("Done moves it off Saved", !html.includes(`data-bookmark-id="${book.id}"`));
  state.libraryView = "tried";
  check("and it is in Tried", renderLibrary().includes(`data-library-id="${book.id}"`));

  state.libraryView = "saved";
  delete state.feedbackByRecommendation[other.id];
  html = renderLibrary();
  check("the empty Saved list names the real buttons", html.includes('On a recommendation, tap "Not tried", then "Save".') && !html.includes("Save to Saved"));

  const disliked = { ...other, id: "tmdb-movie-7002", providerId: "7002", title: "Saved Then Disliked" };
  state.feedbackByRecommendation[disliked.id] = { item: disliked, rating: "not-tried", detail: "bookmarked" };
  saveBookmarkAction(disliked.id, "tried-disliked");
  html = renderLibrary();
  check("a dislike from Saved asks what didn't work", html.includes("Didn't like it") && html.includes("What didn’t work for you?"));
}

// ---- Oct 27: the "This pick was: Too obvious / A great discovery" line is gone everywhere ------------------
{
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const sources = ["../../src/screens/recommendations.js", "../../src/screens/library.js", "../../src/app.js", "../../src/actions/recommendations.js", "../../src/model/taste.js", "../../styles/refinement.css"].map(read).join("\n");
  check("no pick-quality line, handler or styles remain", !/A great discovery|Too obvious|data-feedback-quality|saveFeedbackQuality|quality-line|recommendationQualityDelta/.test(sources));
  check("Recommendations drops the extra save hint", !read("../../src/screens/recommendations.js").includes("Save it for later, or skip it."));
}

// ---- Oct 27: Browse is the place to rate; it stays in the nav after setup ----------------------------------
{
  const fs = await import("node:fs");
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../../styles/base.css", import.meta.url), "utf8");
  const order = [...html.matchAll(/data-step-jump="([a-z]+)"/g)].map((m) => m[1]);
  eq("nav order puts Browse right after Recommendations", order.join(","), "favorites,recommendations,browse,model,library");
  // Oct 27: Library used to be faded as a "secondary" link (#81); all four nav links now look the same.
  check("every nav link is a plain step, none styled secondary", [...html.matchAll(/<a class="([^"]+)"[^>]*data-step-jump=/g)].every((m) => m[1] === "step") && !/step-secondary/.test(html + css));
  check("Browse is not hidden after setup (Favorites still is)", !/:not\(\.is-onboarding\) \.step\[data-step-jump="browse"\]/.test(css) && /:not\(\.is-onboarding\) \.step\[data-step-jump="favorites"\] \{ display:none; \}/.test(css));

  const { renderBrowse } = await import("../../src/screens/browse.js");
  const state = fresh();
  state.onboarded = true;
  const film = { id: "tmdb-movie-8001", provider: "tmdb", providerId: "8001", title: "Browse Film", type: "movie", domains: ["movies"], genres: ["Drama"] };
  state.browseItems = [film];
  let out = renderBrowse();
  check("after setup, Browse says it's for rating", out.includes("Rate what") && out.includes("Every rating sharpens your recommendations") && !out.includes("inspiration"));
  check("and starts at 0 rated this visit, with no link yet", out.includes("0 rated this visit") && !out.includes("See recommendations →"));

  state.feedbackByRecommendation[film.id] = { item: film, rating: "more", detail: "loved-before", refinements: [] };
  state.recommendationExperienceChoice[film.id] = "tried";
  state.recommendationFeedbackItemId = film.id;
  state.browseRatedThisVisit = [film.id];
  out = renderBrowse();
  check("after a rating it counts it and links to recommendations", out.includes("1 rated this visit") && out.includes('data-action="show-recs">See recommendations →'));
  check("and asks what worked, already open", /<details class="experience-refinement is-compact" open data-refinement-item="tmdb-movie-8001"/.test(out));

  // Oct 27 smoke test: the count lagged one render because it was updated after the re-render.
  const app = fs.readFileSync(new URL("../../src/app.js", import.meta.url), "utf8");
  const handler = app.slice(app.indexOf('closest("[data-experience-outcome][data-feedback-item]")'));
  check("a Browse rating is counted before the screen re-renders", handler.indexOf("browseRatedThisVisit.push") > 0 && handler.indexOf("browseRatedThisVisit.push") < handler.indexOf("renderPreservingCardPosition"));

  const before = fresh();
  before.browseItems = [film];
  check("before setup, Browse keeps its favorites framing", renderBrowse().includes("inspiration") && renderBrowse().includes("of 4 favorites"));
}

finish();
