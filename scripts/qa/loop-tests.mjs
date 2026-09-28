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

// (2c) real bug (2026-09-28): with more than 6 real experienced items (now realistic since #150
// widened evidence to a user's whole Library), an already-loved item that simply doesn't win one of
// the 6 anchor slots this round must still never resurface as a "new" recommendation -- confirmed
// for real: a user's own already-marked favorite came back as a pick. `alreadyLoved` here is
// deliberately the 7th item, guaranteed to lose the anchor-slot cutoff, and the fake TMDb response
// deliberately "recommends" it back (a real provider plausibly would, if it's genuinely related to
// another anchor) to prove it's still excluded downstream.
{
  // Deliberately a plain favorite-star toggle (selectedFavorites only, like app.js's `data-favorite`
  // handler), never an explicit Loved it/Liked it rating -- so it has NO feedbackByRecommendation
  // entry at all. That's the real shape: it's excluded from candidates only by being recognized as
  // evidence, not by any rating-based path.
  const alreadyLoved = { id: "tmdb-movie-100", provider: "tmdb", providerId: "100", title: "Already Loved", type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] } };
  const fillers = Array.from({ length: 6 }, (_, i) => ({ id: `tmdb-movie-${i}`, provider: "tmdb", providerId: String(i), title: `Anchor ${i}`, type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] } }));
  // Insertion order matters: externalEvidenceItems() preserves it, and the 6-anchor cap takes the
  // first 6 -- fillers first, alreadyLoved last, so alreadyLoved is guaranteed to lose the cutoff.
  const manyEvidenceState = {
    selectedFavorites: new Set([...fillers.map((f) => f.id), alreadyLoved.id]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: Object.fromEntries([...fillers, alreadyLoved].map((item) => [item.id, item])),
    areas: { watch: true, read: true, play: true }
  };
  const manyEvidenceFetch = async (url) => ({
    ok: true,
    json: async () => ({ results: [{ id: 100, title: "Already Loved", overview: "New.", release_date: "2021-01-01", poster_path: "/x.jpg", genre_ids: [18] }] })
  });
  const manyEvidenceResult = await retrieveCatalogCandidates(manyEvidenceState, { env: { TASTEMAKE_TMDB_TOKEN: "tok" }, fetchImpl: manyEvidenceFetch });
  check(
    "an already-loved item never resurfaces as a candidate, even when it loses the 6-anchor-slot cutoff",
    !manyEvidenceResult.some((c) => c.id === alreadyLoved.id)
  );
}

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

// (5) real bug (2026-09-28): "only got 1 [pick]" despite 73 real evidence items logged. Root cause:
// anchor selection sorted deterministically (by metadata completeness, or plain insertion order when
// that lookup times out, which real logs show is common) and always took the top 6 -- with a real
// evidence pool much bigger than 6, the same handful of anchors won every single round, forever, so
// their live-provider pools drained fast while the rest of a user's real evidence (67 of 73 items,
// in the real report) was never explored as anchors at all. Proves real rotation: 20 real evidence
// items, only 6 used as anchors per call, but across many calls, meaningfully more than 6 distinct
// items actually get used.
{
  const words = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango"];
  const bigEvidence = words.map((word, i) => ({
    id: `tmdb-movie-${i}`, provider: "tmdb", providerId: String(i), title: `${word} Evidence`, type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] }
  }));
  const rotationState = {
    selectedFavorites: new Set(bigEvidence.map((item) => item.id)),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: Object.fromEntries(bigEvidence.map((item) => [item.id, item])),
    areas: { watch: true, read: true, play: true }
  };
  const rotationFetch = async (url) => {
    const match = String(url).match(/\/movie\/(\d+)\/recommendations/);
    const word = match ? words[Number(match[1])] : null;
    return { ok: true, json: async () => ({ results: word ? [{ id: 1000 + Number(match[1]), title: `${word} Related Discovery`, overview: "x", release_date: "2021-01-01", poster_path: null, genre_ids: [18] }] : [] }) };
  };
  const usedAnchors = new Set();
  for (let round = 0; round < 15; round += 1) {
    const results = await retrieveCatalogCandidates(rotationState, { env: { TASTEMAKE_TMDB_TOKEN: "tok" }, fetchImpl: rotationFetch });
    for (const candidate of results) if (candidate.relatedToId) usedAnchors.add(candidate.relatedToId);
  }
  check(
    "anchor selection rotates across the real evidence pool instead of always picking the same 6",
    usedAnchors.size > 6,
    `only ever used ${usedAnchors.size} distinct anchors across 15 rounds`
  );
}

// (6) QA sweep real bug: a bookmark or "Not interested" reaction (intent, never taste evidence)
// could become a live-provider anchor. Anchor A is a real Loved reaction (must be usable); anchor B
// is only bookmarked (must never be queried as an anchor at all).
{
  const lovedAnchor = { id: "tmdb-movie-loved", provider: "tmdb", providerId: "500", title: "Loved Anchor", type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] } };
  const bookmarkedOnly = { id: "tmdb-movie-bookmarked", provider: "tmdb", providerId: "501", title: "Bookmarked Only", type: "movie", domains: ["watch"], providerMeta: { genreIds: [18] } };
  const intentState = {
    selectedFavorites: new Set(),
    feedbackByRecommendation: {
      [lovedAnchor.id]: { item: lovedAnchor, rating: "more", detail: "loved-before" },
      [bookmarkedOnly.id]: { item: bookmarkedOnly, rating: "not-tried", detail: "bookmarked" }
    },
    recommendationSets: [],
    customItems: {},
    areas: { watch: true, read: true, play: true }
  };
  const queriedProviderIds = new Set();
  const intentFetch = async (url) => {
    const match = String(url).match(/\/movie\/(\d+)\/recommendations/);
    if (match) queriedProviderIds.add(match[1]);
    return { ok: true, json: async () => ({ results: [] }) };
  };
  await retrieveCatalogCandidates(intentState, { env: { TASTEMAKE_TMDB_TOKEN: "tok" }, fetchImpl: intentFetch });
  check("a real Loved reaction is used as a retrieval anchor", queriedProviderIds.has("500"));
  check("a bookmark-only (intent, not experience) reaction is never used as a retrieval anchor", !queriedProviderIds.has("501"));
}

// (7) QA sweep real bug: feedbackByRecommendation and customItems have the same unbounded-growth
// shape as recommendationSets did (#151) -- full item objects (about/artwork are the biggest fields)
// stored forever, resent on every request. Unlike recommendationSets, real item data is genuinely
// needed server-side, so the fix trims the display-only fields rather than going all the way to ids.
{
  const heavyItem = { id: "tmdb-movie-98", provider: "tmdb", providerId: "98", title: "Heavy Item", type: "movie", domains: ["watch"], about: "Y".repeat(2000), artwork: "https://example.test/" + "z".repeat(500), sourceUrl: "https://example.test/movie/98", providerMeta: { genreIds: [18] } };
  const heavyState = {
    selectedFavorites: new Set(),
    feedbackByRecommendation: { [heavyItem.id]: { item: heavyItem, rating: "more", detail: "loved-before" } },
    customItems: { [heavyItem.id]: heavyItem },
    recommendationSets: []
  };
  const serialized = serializeAiState(heavyState);
  check("about/artwork/sourceUrl are dropped from feedbackByRecommendation items", !("about" in serialized.feedbackByRecommendation[heavyItem.id].item) && !("artwork" in serialized.feedbackByRecommendation[heavyItem.id].item) && !("sourceUrl" in serialized.feedbackByRecommendation[heavyItem.id].item));
  check("about/artwork/sourceUrl are dropped from customItems", !("about" in serialized.customItems[heavyItem.id]) && !("artwork" in serialized.customItems[heavyItem.id]) && !("sourceUrl" in serialized.customItems[heavyItem.id]));
  check("functionally-needed fields survive the trim", serialized.customItems[heavyItem.id].provider === "tmdb" && serialized.customItems[heavyItem.id].providerId === "98" && serialized.customItems[heavyItem.id].title === "Heavy Item" && JSON.stringify(serialized.customItems[heavyItem.id].providerMeta) === JSON.stringify({ genreIds: [18] }));
  check("the rating/detail on the feedback entry itself survives the trim", serialized.feedbackByRecommendation[heavyItem.id].rating === "more" && serialized.feedbackByRecommendation[heavyItem.id].detail === "loved-before");
}

console.log(`recommendation-loop tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
