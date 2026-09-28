#!/usr/bin/env node
// #92: deterministic novelty/diversity guard. Free, no network. Covers the eval cases named in the
// issue directly against src/catalog/novelty.mjs (the SHARED rule both the deterministic baseline
// and the live-AI path run through, via retrieveCatalogCandidates), plus retrieveCatalogCandidates
// itself so the guard is proven wired into the actual retrieval path both paths call.

import { applyNoveltyGuard, isFranchiseContinuation } from "../../src/catalog/novelty.mjs";
import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };

const fellowship = { id: "tmdb-movie-1", title: "The Lord of the Rings: The Fellowship of the Ring" };
const twoTowers = { id: "tmdb-movie-2", title: "The Lord of the Rings: The Two Towers" };
check("Fellowship of the Ring -> Two Towers is flagged as a continuation", isFranchiseContinuation(twoTowers, fellowship));

const zelda = { id: "igdb-game-1", title: "The Legend of Zelda: Breath of the Wild" };
const korra = { id: "igdb-game-2", title: "The Legend of Korra" };
check("unrelated same-first-word titles are NOT flagged (broader universe stays eligible)", !isFranchiseContinuation(korra, zelda));

const uncharted4 = { id: "igdb-game-3", title: "Uncharted 4: A Thief's End" };
const uncharted2 = { id: "igdb-game-4", title: "Uncharted 2: Among Thieves" };
check("numbered game series entries are flagged", isFranchiseContinuation(uncharted4, uncharted2));

const lionKing1994 = { id: "tmdb-movie-5", title: "The Lion King" };
const lionKing2019 = { id: "tmdb-movie-6", title: "The Lion King" };
check("identical-title remake is flagged", isFranchiseContinuation(lionKing2019, lionKing1994));

const dune = { id: "tmdb-movie-7", title: "Dune" };
const duneMessiah = { id: "openlibrary-book-1", title: "Children of the Underworld" };
check("same creator, unrelated title stays eligible", !isFranchiseContinuation(duneMessiah, dune));

const showS1 = { id: "tmdb-tv-1", title: "The Bear", providerMeta: { collectionId: null } };
const showS2 = { id: "tmdb-tv-2", title: "The Bear: Season 2", providerMeta: { collectionId: null } };
check("season-to-season continuation with an obvious title relationship is flagged", isFranchiseContinuation(showS2, showS1));

const collectionA = { id: "tmdb-movie-10", title: "Alpha", providerMeta: { collectionId: "col-1" } };
const collectionB = { id: "tmdb-movie-11", title: "Something Else Entirely", providerMeta: { collectionId: "col-1" } };
check("provider-collection metadata flags a continuation even with no title overlap", isFranchiseContinuation(collectionB, collectionA));

const unrelatedGenreMatch = { id: "tmdb-movie-12", title: "A Totally Different Movie" };
check("a genuinely unrelated candidate is not flagged", !isFranchiseContinuation(unrelatedGenreMatch, fellowship));

// Suppressed candidates are replaced, not just dropped, so the pool still fills a full set.
const pool = [twoTowers, unrelatedGenreMatch, { ...uncharted4, relatedToId: "evidence-1" }];
const evidence = [{ ...fellowship, id: "evidence-1" }];
const guarded = applyNoveltyGuard(pool.map((c) => ({ ...c, relatedToId: c.relatedToId ?? "evidence-1" })), evidence);
check("the sequel is suppressed", !guarded.primary.some((c) => c.id === twoTowers.id));
check("the unrelated candidate remains available to fill its slot", guarded.primary.some((c) => c.id === unrelatedGenreMatch.id));
check("suppressed candidates are still returned (for a future 'more from this series' treatment)", guarded.suppressed.some((c) => c.id === twoTowers.id));

// End-to-end through the shared retrieval path both the deterministic and live-AI paths call.
const relatedState = {
  selectedFavorites: new Set(["tmdb-movie-1"]),
  feedbackByRecommendation: {},
  recommendationSets: [],
  customItems: {
    "tmdb-movie-1": {
      id: "tmdb-movie-1", provider: "tmdb", providerId: "1", title: "The Lord of the Rings: The Fellowship of the Ring",
      type: "movie", domains: ["watch"], genres: ["18"], providerMeta: { genreIds: [18] }
    }
  },
  areas: { watch: true, read: true, play: true }
};
const relatedFetch = async (url) => {
  if (String(url).includes("/movie/1/recommendations")) {
    return {
      ok: true,
      json: async () => ({
        results: [
          { id: 2, title: "The Lord of the Rings: The Two Towers", overview: "Sequel.", release_date: "2002-12-18", poster_path: "/tt.jpg", genre_ids: [18] },
          { id: 3, title: "A Wholly Unrelated Discovery", overview: "Not a sequel.", release_date: "2019-06-01", poster_path: "/other.jpg", genre_ids: [18] }
        ]
      })
    };
  }
  throw new Error(`unexpected related URL: ${url}`);
};
const env = { TASTEMAKE_TMDB_TOKEN: "tmdb-token" };
const related = await retrieveCatalogCandidates(relatedState, { env, fetchImpl: relatedFetch });
check("the shared retrieval path excludes the sequel from primary candidates", !related.some((x) => x.id === "tmdb-movie-2"));
check("...and keeps the genuinely distinct candidate", related.some((x) => x.id === "tmdb-movie-3"));


// Batch diversity + explicit series coverage.
const hobbit1 = { id: "tmdb-movie-20", title: "The Hobbit: An Unexpected Journey" };
const hobbit2 = { id: "tmdb-movie-21", title: "The Hobbit: The Desolation of Smaug" };
check("same-series subtitle siblings are flagged", isFranchiseContinuation(hobbit2, hobbit1));
const hobbitBatch = applyNoveltyGuard([hobbit1, hobbit2, unrelatedGenreMatch], []);
check("only one obvious franchise sibling occupies a recommendation batch", hobbitBatch.primary.filter((x) => x.title.startsWith("The Hobbit:")).length === 1);
check("a distinct candidate still fills the batch", hobbitBatch.primary.some((x) => x.id === unrelatedGenreMatch.id));
const coveredSeries = applyNoveltyGuard([hobbit2, unrelatedGenreMatch], [{ ...hobbit1, seriesExperience: "loved-most" }]);
check("explicit whole-series experience suppresses sibling installments", !coveredSeries.primary.some((x) => x.id === hobbit2.id));

// #92 regression: repeated-round suppression must not depend on which specific evidence item
// generated a candidate via `relatedToId`. A candidate fetched as "related to" one evidence item
// (e.g. "The Hobbit", reacted to positively in an earlier round) can still be an obvious sequel of
// a DIFFERENT evidence item (Fellowship, the original starter Favorite) -- the guard must check
// the full evidence set, not just the one item that happened to produce the candidate.
const repeatedRoundCandidate = { ...twoTowers, relatedToId: "evidence-hobbit" };
const repeatedRoundEvidence = [
  { ...fellowship, id: "evidence-fellowship" }, // original starter Favorite, round 1
  { id: "evidence-hobbit", title: "The Hobbit: An Unexpected Journey" } // reacted-to in round 1, generated this round-2 candidate
];
const repeatedRoundGuard = applyNoveltyGuard([repeatedRoundCandidate, unrelatedGenreMatch], repeatedRoundEvidence);
check(
  "a repeated-round candidate is suppressed against the FULL evidence set, not only the item that generated it via relatedToId",
  !repeatedRoundGuard.primary.some((x) => x.id === twoTowers.id)
);
check("...and a genuinely distinct candidate still fills that slot", repeatedRoundGuard.primary.some((x) => x.id === unrelatedGenreMatch.id));

// Same scenario end-to-end through the shared retrieval path: round 1 the user favorited
// Fellowship AND reacted positively to the Hobbit (from an earlier recommendation set). Round 2's
// "More recommendations" re-fetches TMDb related candidates for ALL evidence, including the
// Hobbit, whose recommendations happen to surface the Two Towers -- exactly the cross-anchor case
// that slipped through before the fix.
const repeatedRoundState = {
  selectedFavorites: new Set(["tmdb-movie-1"]),
  feedbackByRecommendation: { "tmdb-movie-30": { reaction: "loved" } },
  recommendationSets: [],
  customItems: {
    "tmdb-movie-1": {
      id: "tmdb-movie-1", provider: "tmdb", providerId: "1", title: "The Lord of the Rings: The Fellowship of the Ring",
      type: "movie", domains: ["watch"], genres: ["18"], providerMeta: { genreIds: [18] }
    },
    "tmdb-movie-30": {
      id: "tmdb-movie-30", provider: "tmdb", providerId: "30", title: "The Hobbit: An Unexpected Journey",
      type: "movie", domains: ["watch"], genres: ["18"], providerMeta: { genreIds: [18] }
    }
  },
  areas: { watch: true, read: true, play: true }
};
const repeatedRoundFetch = async (url) => {
  if (String(url).includes("/movie/1/recommendations")) {
    return { ok: true, json: async () => ({ results: [
      { id: 3, title: "A Wholly Unrelated Discovery", overview: "Not a sequel.", release_date: "2019-06-01", poster_path: "/other.jpg", genre_ids: [18] }
    ] }) };
  }
  if (String(url).includes("/movie/30/recommendations")) {
    return { ok: true, json: async () => ({ results: [
      { id: 2, title: "The Lord of the Rings: The Two Towers", overview: "Sequel.", release_date: "2002-12-18", poster_path: "/tt.jpg", genre_ids: [18] }
    ] }) };
  }
  throw new Error(`unexpected related URL: ${url}`);
};
const repeatedRoundResult = await retrieveCatalogCandidates(repeatedRoundState, { env, fetchImpl: repeatedRoundFetch });
check(
  "end-to-end repeated-round retrieval also excludes the sequel surfaced via a different evidence item's relatedToId",
  !repeatedRoundResult.some((x) => x.id === "tmdb-movie-2")
);
check("...and still fills the slot with the genuinely distinct candidate", repeatedRoundResult.some((x) => x.id === "tmdb-movie-3"));

// #142: real production verification of #131's fix surfaced that a book's direct sequel could
// still occupy a primary slot -- Open Library items never carried a providerMeta relationship
// signal at all, unlike movies/TV/games. series_key (when Open Library actually has it) now closes
// that gap the same way collectionId/franchiseId already work for other media types.
const wayOfKings = { id: "openlibrary-book-1", title: "The Way of Kings", provider: "openlibrary", providerMeta: { seriesKey: "/works/OL123456S" } };
const wordsOfRadiance = { id: "openlibrary-book-2", title: "Words of Radiance", provider: "openlibrary", providerMeta: { seriesKey: "/works/OL123456S" } };
check(
  "a book sequel with no title overlap is flagged when Open Library's own series_key links them",
  isFranchiseContinuation(wordsOfRadiance, wayOfKings)
);

const unrelatedSeriesBook = { id: "openlibrary-book-3", title: "A Completely Different Story", provider: "openlibrary", providerMeta: { seriesKey: "/works/OL999999S" } };
check(
  "a different book with its own distinct series_key stays eligible",
  !isFranchiseContinuation(unrelatedSeriesBook, wayOfKings)
);

// Honest documentation of the real, accepted residual gap from #142: when Open Library itself has
// no series data for a book (confirmed true for real popular series against the live API), this
// guard genuinely cannot catch it via provider metadata, and title heuristics don't help when the
// titles share no common words. This is expected, not a bug to "fix" by inventing a relationship.
const sparseMetadataSequel = { id: "openlibrary-book-4", title: "Words of Radiance", provider: "openlibrary" };
check(
  "known/accepted gap: a real sequel with no series_key and no title overlap is NOT flagged (residual limitation, not silently claimed as fixed)",
  !isFranchiseContinuation(sparseMetadataSequel, wayOfKings)
);

// A numeric TMDb collectionId must never accidentally match an Open Library series_key string
// (or vice versa) just because they happen to stringify the same -- provider namespacing prevents
// a cross-media false positive.
const tmdbWithNumericId = { id: "tmdb-movie-20", title: "Some Movie", provider: "tmdb", providerMeta: { collectionId: "/works/OL123456S" } };
check(
  "a coincidentally-matching id string across different providers is NOT flagged (namespaced by provider)",
  !isFranchiseContinuation(tmdbWithNumericId, wayOfKings)
);

console.log(`novelty guard tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
