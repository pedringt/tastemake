#!/usr/bin/env node
// #92: deterministic novelty/diversity guard. Free, no network. Covers the eval cases named in the
// issue directly against src/catalog/novelty.mjs (the SHARED rule both the deterministic baseline
// and the live-AI path run through, via retrieveCatalogCandidates), plus retrieveCatalogCandidates
// itself so the guard is proven wired into the actual retrieval path both paths call.

import { readFileSync } from "node:fs";
import { applyNoveltyGuard, isFranchiseContinuation, seriesKey } from "../../src/catalog/novelty.mjs";
import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";
import { openLibraryItem } from "../../src/catalog/providers.mjs";
import { bookSeriesFromRow, normalizeSeriesName, seriesNamesFromEditions, seriesPositionFromEditions, seriesPositionFromValue } from "../../src/catalog/book-series.mjs";
import { withBookSeriesEvidence } from "../../src/catalog/book-series-editions.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, finish } = createSuite("novelty guard tests");

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
      type: "movie", domains: ["movies"], genres: ["18"], providerMeta: { genreIds: [18] }
    }
  },
  areas: { movies: true, tv: true, read: true, play: true }
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
      type: "movie", domains: ["movies"], genres: ["18"], providerMeta: { genreIds: [18] }
    },
    "tmdb-movie-30": {
      id: "tmdb-movie-30", provider: "tmdb", providerId: "30", title: "The Hobbit: An Unexpected Journey",
      type: "movie", domains: ["movies"], genres: ["18"], providerMeta: { genreIds: [18] }
    }
  },
  areas: { movies: true, tv: true, read: true, play: true }
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

// With no author and no Open Library series data at all, nothing ties these two titles together, and
// the guard does not invent a relationship. (The real records do carry data: see the fixture tests
// below, where "Words of Radiance" is linked through its edition series "The Stormlight Archive, 2".)
const sparseMetadataSequel = { id: "openlibrary-book-4", title: "Words of Radiance", provider: "openlibrary" };
check(
  "a sequel with no author, no series data and no title overlap is NOT flagged (no invented relationship)",
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

// ---- #142 follow-up: book series from real Open Library data ------------------------------------
// scripts/qa/fixtures/openlibrary-series-142.json holds real search.json rows and real edition
// lists captured from openlibrary.org (Oct 2026). Items are built with the production
// openLibraryItem(), and edition lookups are served from the fixture, so these run offline.
const olFixture = JSON.parse(readFileSync(new URL("./fixtures/openlibrary-series-142.json", import.meta.url), "utf8"));
const olBook = (workId) => openLibraryItem(olFixture.search[workId]);
const olTitle = (workId) => olFixture.search[workId].title;
const fixtureEditionCalls = [];
const fixtureEditionsFetch = async (url) => {
  fixtureEditionCalls.push(String(url));
  const match = String(url).match(/\/works\/(OL\d+W)\/editions\.json/);
  if (!match || !olFixture.editions[match[1]]) throw new Error(`unexpected fixture URL: ${url}`);
  return { ok: true, json: async () => olFixture.editions[match[1]] };
};
async function guardBooks(candidates, evidence, fetchImpl = fixtureEditionsFetch) {
  const enriched = await withBookSeriesEvidence(candidates, evidence, { env: {}, fetchImpl });
  return applyNoveltyGuard(enriched.candidates, enriched.evidenceItems);
}

check("Open Library series_key arrives as an array and is stored as a string", olBook("OL893414W").providerMeta.seriesKey === "OL331367L");
check("a 'Serie:The_Hunger_Games' subject deep in the list (index 90) becomes a series name",
  olBook("OL5735363W").providerMeta.seriesNames.includes("hunger games"));
check("series names normalize sequence markers and generic words",
  ["The Mistborn Saga #2", "Mistborn, Book Two", "Mistborn -- [bk. 3]", "The Mistborn trilogy -- bk. 3"].every((name) => normalizeSeriesName(name) === "mistborn"));
check("edition series need two editions and skip publisher lines",
  seriesNamesFromEditions([{ series: ["Penguin Modern Classics"] }, { series: ["Penguin Modern Classics"] }, { series: ["One-off Line No. 4"] }]).length === 0);

const seriesGroups = Object.entries(olFixture.groups).filter(([group]) => !group.startsWith("control"));
for (const [group, [firstId, ...sequelIds]] of seriesGroups) {
  for (const sequelId of sequelIds) {
    const result = await guardBooks([olBook(sequelId)], [olBook(firstId)]);
    check(`real fixture (${group}): loved "${olTitle(firstId)}" suppresses "${olTitle(sequelId)}"`, result.suppressed.length === 1 && result.primary.length === 0);
  }
}

// The reported case (#142): "The Way of Kings" -> "Words of Radiance", alongside an unrelated book that
// must still fill the slot.
const stormlight = await guardBooks([olBook("OL16813053W"), olBook("OL17091839W")], [olBook("OL15358691W")]);
check("the reported case: Words of Radiance is suppressed after loving The Way of Kings", stormlight.suppressed.some((x) => x.title === "Words of Radiance"));
check("...and a different author's book stays in the primary pool", stormlight.primary.some((x) => x.title === "The Martian"));

// Same author, not a series (or a different series): must stay eligible, even after edition lookups.
const sameAuthorControls = [
  ["OL17091839W", "OL21745884W"], ["OL17091839W", "OL17837968W"], ["OL21745884W", "OL17837968W"], // Weir standalones
  ["OL59038W", "OL59048W"], ["OL59038W", "OL20883297W"], // Ishiguro standalones
  ["OL1168083W", "OL1168007W"], // Orwell: Nineteen Eighty-Four / Animal Farm
  ["OL5738147W", "OL5738149W"], // Sanderson standalones: Elantris / Warbreaker
  ["OL15358691W", "OL5738148W"], ["OL5738148W", "OL15358691W"], ["OL15358691W", "OL5738147W"], // Sanderson, different series
  ["OL5735363W", "OL5735348W"], // Collins: The Hunger Games / Gregor the Overlander (another series)
  ["OL82563W", "OL16796166W"] // Rowling: Harry Potter / The Casual Vacancy
];
for (const [lovedId, candidateId] of sameAuthorControls) {
  const result = await guardBooks([olBook(candidateId)], [olBook(lovedId)]);
  check(`real fixture control: loved "${olTitle(lovedId)}" keeps same-author "${olTitle(candidateId)}" eligible`, result.primary.length === 1);
}

// Items saved before this fix kept series_key as an array, no series names, and only the first 12
// subjects (which drops The Hunger Games' series subject at index 90). They still work: the array id
// matches, and the nameless anchor's own editions are read.
const legacy = (workId) => {
  const item = olBook(workId);
  return { ...item, providerMeta: { seriesKey: olFixture.search[workId].series_key ?? null, isbns: [] } };
};
check("a legacy anchor with an array series_key still suppresses its sequel",
  (await guardBooks([olBook("OL893461W")], [legacy("OL893414W")])).suppressed.length === 1);
check("a legacy nameless anchor (The Hunger Games) is resolved from its editions",
  (await guardBooks([olBook("OL5735360W")], [legacy("OL5735363W")])).suppressed.length === 1);

// Lookups are bounded, skipped when nothing needs them, memoized, and fail open.
fixtureEditionCalls.length = 0;
await withBookSeriesEvidence([olBook("OL17091839W"), olBook("OL82537W")], [olBook("OL5738148W")], { env: {}, fetchImpl: fixtureEditionsFetch, maxPositionLookups: 0 });
check("no edition lookup when no candidate shares an author with a loved book", fixtureEditionCalls.length === 0);
fixtureEditionCalls.length = 0;
await withBookSeriesEvidence([olBook("OL82537W")], [olBook("OL82563W")], { env: {}, fetchImpl: fixtureEditionsFetch });
check("no edition lookup when cheaper signals already link the pair", fixtureEditionCalls.length === 0);
const manySanderson = Array.from({ length: 10 }, (_, index) => ({ ...olBook("OL5738149W"), id: `openlibrary-book-s${index}`, providerId: `OL${900 + index}W` }));
const countingFetch = async (url) => { fixtureEditionCalls.push(String(url)); return { ok: true, json: async () => ({ entries: [] }) }; };
fixtureEditionCalls.length = 0;
const lookupMemo = new Map();
await withBookSeriesEvidence(manySanderson, [olBook("OL5738147W")], { env: {}, fetchImpl: countingFetch, memo: lookupMemo, maxPositionLookups: 0 });
check("edition lookups are capped at 6 per request", fixtureEditionCalls.length === 6);
await withBookSeriesEvidence(manySanderson, [olBook("OL5738147W")], { env: {}, fetchImpl: countingFetch, memo: lookupMemo, maxPositionLookups: 0 });
check("a second guard pass in the same request does not refetch", fixtureEditionCalls.length === 6);
const failing = await guardBooks([olBook("OL16813053W")], [olBook("OL15358691W")], async () => { throw new Error("network down"); });
check("a failed edition lookup fails open (the guard behaves as without it)", failing.primary.length === 1);

// Batch diversity and declared series experience use the same book rule.
const batch = await guardBooks([olBook("OL5735363W"), olBook("OL5735360W"), olBook("OL14908941W"), olBook("OL17091839W")], []);
check("only one Hunger Games book makes a batch, and it is book 1", batch.primary.filter((x) => x.by === "Suzanne Collins").map((x) => x.title).join() === "The Hunger Games");

// #255: a later entry in a series is not a fresh recommendation, even with no evidence in that series.
check("series_position from search is kept", olBook("OL893461W").providerMeta.seriesPosition === 2);
check("a title suffix gives a position", bookSeriesFromRow({ title: "The Well of Ascension (Mistborn, Book 2)" }).seriesPosition === 2);
check("a mid-title marker gives a position (Twelve Kingdoms, Book Three: …)", bookSeriesFromRow({ title: "The Twelve Kingdoms, Book Three: Sea of Wind, Shore of the Labyrinth" }).seriesPosition === 3);
check("'The Book of Three' is not read as a position", bookSeriesFromRow({ title: "The Book of Three" }).seriesPosition === null);
check("only whole positive positions count", bookSeriesFromRow({ series_position: ["0.5"] }).seriesPosition === null);
for (const [value, want] of [["The Mistborn Saga #3", 3], ["Mistborn -- bk. 3", 3], ["The Kingkiller Chronicle, Day 2", 2], ["The Stormlight Archive, 2", 2], ["Wheel of Time (6)", 6], ["Book Two", 2], ["Penguin Classics", null], ["Choice -- 251", null]]) {
  check(`position from "${value}"`, seriesPositionFromValue(value) === want, seriesPositionFromValue(value));
}
check("editions that agree give a position (The Hero of Ages -> 3)", seriesPositionFromEditions(olFixture.editions.OL5738154W.entries) === 3);
check("conflicting editions give no position", seriesPositionFromEditions([{ series: ["The Witcher, part 3"] }, { series: ["The Witcher 1"] }, { series: ["The Witcher"] }]) === null);
check("numbered publisher lines never give a position", ["OL17091839W", "OL59038W", "OL59048W", "OL20883297W", "OL16796166W"].every((id) => seriesPositionFromEditions(olFixture.editions[id].entries) === null));
const noEvidence = await guardBooks([olBook("OL893414W"), olBook("OL893461W"), olBook("OL16117275W"), olBook("OL17091839W")], []);
check("with no evidence in the series, book 2s are held back", noEvidence.suppressed.map((x) => x.title).sort().join() === "Caliban's war,Dune Messiah", noEvidence.suppressed.map((x) => x.title).join());
check("book 1 and standalone books stay", noEvidence.primary.map((x) => x.title).sort().join() === "Dune,The Martian", noEvidence.primary.map((x) => x.title).join());
const heroOfAges = await guardBooks([olBook("OL5738154W")], []);
check("a later entry with no search series data is found from its editions (The Hero of Ages)", heroOfAges.suppressed.length === 1 && heroOfAges.suppressed[0].providerMeta.seriesPosition === 3);
const unknown = await guardBooks([olBook("OL16813053W")], [], async () => { throw new Error("network down"); });
check("an unknown position fails open", unknown.primary.length === 1);
fixtureEditionCalls.length = 0;
const positionMemo = new Map();
const manyBooks = Array.from({ length: 14 }, (_, index) => ({ ...olBook("OL17091839W"), id: `openlibrary-book-p${index}`, providerId: `OL${800 + index}W` }));
await withBookSeriesEvidence(manyBooks, [], { env: {}, fetchImpl: countingFetch, memo: positionMemo });
check("position lookups are capped at 10 per request", fixtureEditionCalls.length === 10, fixtureEditionCalls.length);
await withBookSeriesEvidence(manyBooks, [], { env: {}, fetchImpl: countingFetch, memo: positionMemo });
check("position lookups are memoized within a request", fixtureEditionCalls.length === 10, fixtureEditionCalls.length);
check("a named book series gives the series-experience prompt a key", seriesKey(olBook("OL5738148W")) === "series:mistborn");

// End to end through retrieveCatalogCandidates: a subject search for a loved "The Way of Kings" returns
// "Words of Radiance" (real rows), which must not reach the candidates.
const wokRow = olFixture.search.OL15358691W;
const bookState = {
  selectedFavorites: new Set(["openlibrary-anchor"]),
  feedbackByRecommendation: {},
  recommendationSets: [],
  recommendationFilter: "read",
  customItems: { "openlibrary-anchor": { ...openLibraryItem(wokRow), id: "openlibrary-anchor" } },
  areas: { movies: true, tv: true, read: true, play: true }
};
const subjectRows = ["OL16813053W", "OL17091839W", "OL59038W"].map((id) => ({ ...olFixture.search[id], subject: [...(olFixture.search[id].subject ?? []), ...wokRow.subject.slice(0, 3)] }));
const bookFetch = async (url) => {
  if (String(url).includes("/search.json")) return { ok: true, json: async () => ({ docs: subjectRows }) };
  return fixtureEditionsFetch(url);
};
const bookCandidates = await retrieveCatalogCandidates(bookState, { env: {}, fetchImpl: bookFetch });
check("end to end: Words of Radiance is not a candidate after loving The Way of Kings", !bookCandidates.some((x) => x.title === "Words of Radiance"));
const noEditionsFetch = async (url) => {
  if (String(url).includes("/search.json")) return { ok: true, json: async () => ({ docs: subjectRows }) };
  throw new Error("editions unavailable");
};
const withoutEditions = await retrieveCatalogCandidates(bookState, { env: {}, fetchImpl: noEditionsFetch });
check("(control: without the edition data, Words of Radiance would have been a candidate)", withoutEditions.some((x) => x.title === "Words of Radiance"));
check("...while other-author books still are", bookCandidates.some((x) => x.title === "The Martian") && bookCandidates.some((x) => x.title === "Never Let Me Go"));

// Films and games keep their behaviour: the book rules never apply to them, even with a shared `by`.
const filmA = { id: "tmdb-movie-40", title: "Dune", type: "movie", provider: "tmdb", by: "Denis Villeneuve", providerMeta: { collectionId: null } };
const filmB = { id: "tmdb-movie-41", title: "Children of Dune", type: "movie", provider: "tmdb", by: "Denis Villeneuve", providerMeta: { collectionId: null } };
check("film titles extending each other by the same director are not caught by the book rule", !isFranchiseContinuation(filmB, filmA));
check("...while the same pair as books is", isFranchiseContinuation({ ...filmB, type: "book", provider: "openlibrary" }, { ...filmA, type: "book", provider: "openlibrary" }));
const gameA = { id: "igdb-game-40", title: "Halo", type: "game", provider: "igdb", providerMeta: { franchiseId: 7 } };
const gameB = { id: "igdb-game-41", title: "Something Else", type: "game", provider: "igdb", providerMeta: { franchiseId: 7 } };
check("IGDB franchise ids still link games", isFranchiseContinuation(gameB, gameA));
check("TMDb collection ids still need the same provider", !isFranchiseContinuation({ ...gameB, provider: "tmdb", providerMeta: { collectionId: 7 } }, gameA));

finish();
