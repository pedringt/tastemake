#!/usr/bin/env node
// #131/#135: deterministic retrieval-quality coverage for the redesigned Open Library book
// retrieval (multi-subject query + graded overlap scoring instead of one brittle subject query
// gated by a single pass/fail filter), the movies/TV and games audit, and the anchor
// metadata-completeness preference. Free, no network for the mocked cases below; run this file
// with TASTEMAKE_LIVE_OPEN_LIBRARY=1 to also exercise one real Open Library network call that
// reproduces the #131 Way-of-Kings-class stress scenario end to end.
//
//   node scripts/qa/candidate-quality-tests.mjs
//   TASTEMAKE_LIVE_OPEN_LIBRARY=1 node scripts/qa/candidate-quality-tests.mjs

import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const env = { TASTEMAKE_TMDB_TOKEN: "tmdb-token", IGDB_CLIENT_ID: "igdb-id", IGDB_CLIENT_SECRET: "igdb-secret" };

const bookState = (genres) => ({
  selectedFavorites: new Set(["openlibrary-book-OL-SEED"]),
  feedbackByRecommendation: {},
  recommendationSets: [],
  customItems: {
    "openlibrary-book-OL-SEED": {
      id: "openlibrary-book-OL-SEED", provider: "openlibrary", providerId: "OL-SEED",
      title: "Way-of-Kings-like Seed", type: "book", domains: ["read"], genres
    }
  },
  areas: { watch: true, read: true, play: true },
  recommendationFilter: "read"
});

// ---- books: strong, weak, contradictory (false-positive) and sparse-metadata cases ------------

// Strong: source has 3 meaningful subjects. Multiple candidates share 2+ -> "strong". One
// candidate shares exactly 1 -> "weak" but still eligible. A bestseller-only overlap and an
// unrelated self-help book share nothing meaningful -> rejected.
{
  const sourceGenres = ["New York Times bestseller", "Epic fantasy fiction", "Magic", "Political intrigue"];
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(String(url));
    const u = decodeURIComponent(String(url));
    if (u.includes('subject:"Epic fantasy fiction"')) {
      return { ok: true, json: async () => ({ docs: [
        { key: "/works/OL-STRONG-1", title: "Strong Neighbor One", author_name: ["A"], first_publish_year: 2015, subject: ["Epic fantasy fiction", "Magic"] },
        { key: "/works/OL-WEAK-1", title: "Weak Neighbor One", author_name: ["B"], first_publish_year: 2016, subject: ["Epic fantasy fiction"] },
        { key: "/works/OL-HABIT", title: "Habit Book", author_name: ["C"], first_publish_year: 2018, subject: ["New York Times bestseller", "Self-help", "Habit"] }
      ] }) };
    }
    if (u.includes('subject:"Magic"')) {
      return { ok: true, json: async () => ({ docs: [
        { key: "/works/OL-STRONG-1", title: "Strong Neighbor One", author_name: ["A"], first_publish_year: 2015, subject: ["Epic fantasy fiction", "Magic"] },
        { key: "/works/OL-STRONG-2", title: "Strong Neighbor Two", author_name: ["D"], first_publish_year: 2017, subject: ["Magic", "Political intrigue"] }
      ] }) };
    }
    if (u.includes('subject:"Political intrigue"')) {
      return { ok: true, json: async () => ({ docs: [
        { key: "/works/OL-STRONG-2", title: "Strong Neighbor Two", author_name: ["D"], first_publish_year: 2017, subject: ["Magic", "Political intrigue"] },
        { key: "/works/OL-DAISY", title: "Accessible Only Match", author_name: ["E"], first_publish_year: 2019, subject: ["Protected DAISY", "Accessible book"] }
      ] }) };
    }
    throw new Error(`unexpected book URL: ${url}`);
  };
  const before = 5; // total distinct rows returned across the three queries (STRONG-1/2, WEAK-1, HABIT, DAISY)
  const related = await retrieveCatalogCandidates(bookState(sourceGenres), { env, fetchImpl });
  const byTitle = Object.fromEntries(related.map((item) => [item.title, item]));
  check("queries the top 3 meaningful subjects, not just the first", requestedUrls.length === 3, requestedUrls.join(" | "));
  check("strong overlap (2+) candidates are retained and ranked strong", byTitle["Strong Neighbor One"]?.relationStrength === "strong" && byTitle["Strong Neighbor Two"]?.relationStrength === "strong");
  check("weak (1 meaningful overlap) candidate stays eligible at lower confidence", byTitle["Weak Neighbor One"]?.relationStrength === "weak");
  check("bestseller-tag-only false positive remains excluded (#131 regression)", !byTitle["Habit Book"]);
  check("generic/noisy-only overlap (Protected DAISY) does not itself grant eligibility", !byTitle["Accessible Only Match"]);
  check("strong candidates rank ahead of weak candidates", related.findIndex((i) => i.title === "Weak Neighbor One") > related.findIndex((i) => i.title === "Strong Neighbor Two"));
  console.log(`  books strong/weak/contradictory case: ${before} rows returned -> ${related.length} eligible after merge+scoring`);
}

// Sparse-metadata: source has exactly one meaningful subject. That single overlap is the only
// signal available, so it should count as "strong" (matches pre-#131 single-subject behavior for
// the sparsest case) rather than being downgraded to weak or rejected.
{
  const related = await retrieveCatalogCandidates(bookState(["Fantasy"]), {
    env,
    fetchImpl: async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.includes('subject:"Fantasy"')) {
        return { ok: true, json: async () => ({ docs: [
          { key: "/works/OL-ONLY", title: "Only Signal Neighbor", author_name: ["F"], first_publish_year: 2020, subject: ["Fantasy"] }
        ] }) };
      }
      throw new Error(`unexpected sparse URL: ${url}`);
    }
  });
  check("sparse source (one meaningful subject) treats that overlap as strong", related.some((i) => i.title === "Only Signal Neighbor" && i.relationStrength === "strong"));
}

// No meaningful subjects at all -> no query, no candidates, no throw.
{
  const related = await retrieveCatalogCandidates(bookState([]), { env, fetchImpl: async () => { throw new Error("should not be called"); } });
  eq("a source with zero meaningful subjects yields no book candidates and makes no request", related.length, 0);
}

// ---- movies/TV audit: TMDb /recommendations already returns a healthy pool from one anchor -----
// TMDb performs the relevance work server-side, so this file records the audit finding rather than
// changing tmdbRelated(): a single anchor already yields up to 12 results per call, same as before.
{
  const tmdbState = {
    selectedFavorites: new Set(["tmdb-movie-10"]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: { "tmdb-movie-10": { id: "tmdb-movie-10", provider: "tmdb", providerId: "10", title: "Seed Movie", type: "movie", domains: ["watch"], genres: ["18"] } },
    areas: { watch: true, read: true, play: true },
    recommendationFilter: "watch"
  };
  const neighborTitles = ["Amber Harbor", "Glass Orchard", "Night Signal", "Paper Kingdom", "Silent Atlas", "Copper Sky", "Velvet Transit", "Winter Circuit", "Crimson Static", "Moss Cathedral", "Silver Current", "Ivory Motel"];
  const rows = neighborTitles.map((title, i) => ({ id: 200 + i, title, overview: "x", release_date: "2020-01-01", genre_ids: [18] }));
  const related = await retrieveCatalogCandidates(tmdbState, { env, fetchImpl: async (url) => {
    if (String(url).includes("/movie/10/recommendations")) return { ok: true, json: async () => ({ results: rows }) };
    throw new Error(`unexpected tmdb URL: ${url}`);
  } });
  eq("TMDb /recommendations from a single anchor already returns a healthy (12-row) pool", related.length, 12);
}

// ---- games audit: genre-only IGDB query from a single anchor -----------------------------------
// Documents the current behavior so a future PR can compare against it if IGDB pool health
// regresses; per #135's "audited, not necessarily rewritten" instruction, no production change was
// made here because a genre-backed query already returns a full 12-row page from one anchor.
{
  const igdbState = {
    selectedFavorites: new Set(["igdb-game-12"]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: { "igdb-game-12": { id: "igdb-game-12", provider: "igdb", providerId: "12", title: "Seed Game", type: "game", domains: ["play"], providerMeta: { genreIds: [31, 32] } } },
    areas: { watch: true, read: true, play: true },
    recommendationFilter: "play"
  };
  const gameTitles = ["Amber Harbor", "Glass Orchard", "Night Signal", "Paper Kingdom", "Silent Atlas", "Copper Sky", "Velvet Transit", "Winter Circuit", "Crimson Static", "Moss Cathedral", "Silver Current", "Ivory Motel"];
  const rows = gameTitles.map((name, i) => ({ id: 300 + i, name, summary: "x", first_release_date: 1600000000, genres: [{ id: 31, name: "Adventure" }] }));
  const related = await retrieveCatalogCandidates(igdbState, { env, fetchImpl: async (url, init = {}) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
    if (String(url).includes("api.igdb.com/v4/games")) {
      check("IGDB genre-only query still requests up to 3 genre ids from providerMeta", /genres = \(31,32\)/.test(init.body || ""), init.body);
      return { ok: true, json: async () => rows };
    }
    throw new Error(`unexpected igdb URL: ${url}`);
  } });
  eq("IGDB genre-only query from a single anchor already returns a healthy (12-row) pool", related.length, 12);
}

// ---- anchor metadata-completeness preference (best-effort, no-op without a store) ---------------
// Without TASTEMAKE_DATABASE_URL configured, the preference is a pure no-op: retrieval order and
// candidate output are unaffected, and no error surfaces even though the DB is unreachable.
{
  const mixedState = {
    selectedFavorites: new Set(["openlibrary-book-OL-A", "openlibrary-book-OL-B"]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: {
      "openlibrary-book-OL-A": { id: "openlibrary-book-OL-A", provider: "openlibrary", providerId: "OL-A", title: "Seed A", type: "book", domains: ["read"], genres: ["Fantasy"] },
      "openlibrary-book-OL-B": { id: "openlibrary-book-OL-B", provider: "openlibrary", providerId: "OL-B", title: "Seed B", type: "book", domains: ["read"], genres: ["Mystery"] }
    },
    areas: { watch: true, read: true, play: true },
    recommendationFilter: "read"
  };
  const related = await retrieveCatalogCandidates(mixedState, { env, fetchImpl: async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('subject:"Fantasy"')) return { ok: true, json: async () => ({ docs: [{ key: "/works/OL-FA", title: "Fantasy Neighbor", author_name: ["A"], first_publish_year: 2021, subject: ["Fantasy"] }] }) };
    if (u.includes('subject:"Mystery"')) return { ok: true, json: async () => ({ docs: [{ key: "/works/OL-MY", title: "Mystery Neighbor", author_name: ["B"], first_publish_year: 2021, subject: ["Mystery"] }] }) };
    throw new Error(`unexpected anchor-preference URL: ${url}`);
  } });
  check("anchor metadata-completeness lookup degrades to a no-op without a configured store", related.length > 0);
}

// ---- optional: one real Open Library network call reproducing the #131 stress scenario ---------
if (process.env.TASTEMAKE_LIVE_OPEN_LIBRARY === "1") {
  const wayOfKingsLikeGenres = ["New York Times bestseller", "Epic fantasy fiction", "Magic", "Fantasy fiction"];
  const liveRelated = await retrieveCatalogCandidates(bookState(wayOfKingsLikeGenres), { env, fetchImpl: fetch });
  console.log(`  live Open Library: ${liveRelated.length} eligible candidates for a Way-of-Kings-like seed (real network call)`);
  check("live Open Library retrieval does not collapse to ~4 for a richly-tagged fantasy seed", liveRelated.length >= 8, String(liveRelated.length));
  check("live Open Library retrieval keeps false positives out (no bestseller-only match)", !liveRelated.some((i) => (i.genres ?? []).length === 1 && /bestseller/i.test(i.genres[0] ?? "")));
} else {
  console.log("  skipped live Open Library network case (set TASTEMAKE_LIVE_OPEN_LIBRARY=1 to run it)");
}

console.log(`candidate quality tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
