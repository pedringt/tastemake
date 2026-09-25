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
console.log(`novelty guard tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
