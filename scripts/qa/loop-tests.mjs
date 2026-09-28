#!/usr/bin/env node
// #93: the ongoing recommendation loop. Free, no network, no browser.
//
//   node scripts/qa/loop-tests.mjs
//
// Proves: (1) a second "More recommendations" request is possible without rating every current
// card, (2) round-two candidate retrieval actually carries round-one feedback (reactions, and the
// items already shown), and (3) Saved (untried) intent is weighted differently from an experienced
// reaction when steering what comes next — it never counts as taste evidence.

import { canKeepDiscovering, currentRoundComplete, isBookmarked, recommendationDelta, tasteDelta } from "../../src/model/taste.js";
import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";
import { serializeAiState } from "../../src/ai/live-client.js";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const itemA = { id: "tmdb-movie-1", title: "First Pick", type: "movie", domains: ["watch"] };
const itemB = { id: "tmdb-movie-2", title: "Second Pick", type: "movie", domains: ["watch"] };

const mk = () => ({
  selectedFavorites: new Set(),
  recommendationSets: [[itemA, itemB]],
  feedbackByRecommendation: {},
  recommendationExhausted: false
});

// (1) a partially-rated round can still request more.
const partial = mk();
partial.feedbackByRecommendation[itemA.id] = { item: itemA, rating: "more", detail: "liked-before" };
eq("only one of two cards rated", currentRoundComplete(partial), false);
check("another batch can still be requested without finishing the current one", canKeepDiscovering(partial));

// (1b) 2026-09-28: a set with zero reactions can also request more -- a user should not have to
// react to anything before asking for another batch (previously required one reaction, #93).
const unrated = mk();
eq("zero cards rated in the current set", currentRoundComplete(unrated), false);
check("another batch can be requested with zero reactions to the current set", canKeepDiscovering(unrated));

// (2) round two's retrieval carries round-one feedback: the reacted-to item is excluded, and its
// provider evidence (once experienced) is what the next request is grounded in.
const state = {
  selectedFavorites: new Set(),
  feedbackByRecommendation: {
    [itemA.id]: { item: itemA, rating: "more", detail: "liked-before" }
  },
  recommendationSets: [[itemA, itemB]],
  customItems: {
    [itemA.id]: { id: itemA.id, provider: "tmdb", providerId: "1", title: itemA.title, type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] } }
  },
  areas: { watch: true, read: true, play: true }
};
const fetchImpl = async (url) => {
  if (String(url).includes("/movie/1/recommendations")) {
    return {
      ok: true,
      json: async () => ({ results: [{ id: 3, title: "Round Two Candidate", overview: "New.", release_date: "2021-01-01", poster_path: "/r2.jpg", genre_ids: [18] }] })
    };
  }
  throw new Error(`unexpected URL: ${url}`);
};
const roundTwo = await retrieveCatalogCandidates(state, { env: { TASTEMAKE_TMDB_TOKEN: "tok" }, fetchImpl });
check("round-two retrieval is grounded in the round-one reaction (liked item A)", roundTwo.some((c) => c.relatedTo === itemA.title));
check("round-one's shown items are excluded from round two", !roundTwo.some((c) => c.id === itemA.id) && !roundTwo.some((c) => c.id === itemB.id));

// (2b) 2026-09-28 real bug: reacting Loved it/Liked it directly on a recommendation card only ever
// wrote the item into feedbackByRecommendation[id].item (saveQuickFeedback), never into
// state.customItems (only search-added favorites/browse picks populate that). Item B here is
// deliberately absent from customItems -- exactly the real-usage shape -- to prove it still becomes
// a retrieval anchor instead of silently being invisible to future candidate retrieval.
const feedbackOnlyState = {
  selectedFavorites: new Set(),
  feedbackByRecommendation: {
    [itemB.id]: {
      item: { id: itemB.id, provider: "tmdb", providerId: "2", title: itemB.title, type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] } },
      rating: "more",
      detail: "loved-before"
    }
  },
  recommendationSets: [[itemA, itemB]],
  customItems: {}, // deliberately empty -- item B was never search-added, only reacted to
  areas: { watch: true, read: true, play: true }
};
const feedbackOnlyFetch = async (url) => {
  if (String(url).includes("/movie/2/recommendations")) {
    return {
      ok: true,
      json: async () => ({ results: [{ id: 4, title: "Grounded In A Reacted-Only Pick", overview: "New.", release_date: "2021-01-01", poster_path: "/r4.jpg", genre_ids: [18] }] })
    };
  }
  throw new Error(`unexpected URL: ${url}`);
};
const feedbackOnlyResult = await retrieveCatalogCandidates(feedbackOnlyState, { env: { TASTEMAKE_TMDB_TOKEN: "tok" }, fetchImpl: feedbackOnlyFetch });
check(
  "an item loved/liked directly on a card (never added to customItems) still becomes a retrieval anchor",
  feedbackOnlyResult.some((c) => c.relatedTo === itemB.title)
);

// (3) Saved (bookmarked/untried) intent is a weaker, non-taste signal compared to an experienced reaction.
const saved = { item: itemA, rating: "not-tried", detail: "bookmarked" };
const experienced = { item: itemA, rating: "more", detail: "liked-before" };
eq("saving an untried item is never taste evidence", tasteDelta(saved), 0);
check("an experienced reaction IS taste evidence", tasteDelta(experienced) !== 0);
check("saved intent still lightly steers what comes next (a weaker signal, not zero)", recommendationDelta(saved) > 0 && recommendationDelta(saved) < recommendationDelta(experienced));
check("isBookmarked recognizes the saved-but-untried state", isBookmarked(saved));
check("isBookmarked does not call an experienced reaction 'saved'", !isBookmarked(experienced));

// (4) real bug (2026-09-28): recommendationSets grows by one full-object array every single
// "More recommendations" click, forever, and the client resent the whole thing on every future
// request -- server-side, only .id was ever read from it (see the blocked-set fix above). With real
// usage this payload eventually exceeded the server's MAX_BODY_BYTES cap and every subsequent
// request started silently failing with a 413, which read to a user as "stuck on the same
// recommendations forever" since the client just keeps showing the last successfully rendered set.
{
  const bigItem = { id: "tmdb-movie-99", title: "X".repeat(2000), about: "Y".repeat(2000), artwork: "https://example.test/" + "z".repeat(500) };
  const heavyState = {
    selectedFavorites: new Set(),
    feedbackByRecommendation: {},
    recommendationSets: Array.from({ length: 40 }, () => [bigItem, bigItem, bigItem, bigItem, bigItem, bigItem])
  };
  const serialized = serializeAiState(heavyState);
  const wireBytes = Buffer.byteLength(JSON.stringify(serialized), "utf8");
  check(
    "40 real rounds of full-size picks stay well under the server's 160KB cap once serialized",
    wireBytes < 160_000,
    `got ${wireBytes} bytes`
  );
  check(
    "recommendationSets is sent as ids only, not full item objects",
    serialized.recommendationSets.every((set) => set.every((entry) => typeof entry === "string"))
  );
}

console.log(`recommendation-loop tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
