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

// (3) Saved (bookmarked/untried) intent is a weaker, non-taste signal compared to an experienced reaction.
const saved = { item: itemA, rating: "not-tried", detail: "bookmarked" };
const experienced = { item: itemA, rating: "more", detail: "liked-before" };
eq("saving an untried item is never taste evidence", tasteDelta(saved), 0);
check("an experienced reaction IS taste evidence", tasteDelta(experienced) !== 0);
check("saved intent still lightly steers what comes next (a weaker signal, not zero)", recommendationDelta(saved) > 0 && recommendationDelta(saved) < recommendationDelta(experienced));
check("isBookmarked recognizes the saved-but-untried state", isBookmarked(saved));
check("isBookmarked does not call an experienced reaction 'saved'", !isBookmarked(experienced));

console.log(`recommendation-loop tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
