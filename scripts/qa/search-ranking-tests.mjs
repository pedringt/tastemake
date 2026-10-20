#!/usr/bin/env node
// #115: catalog search ranking. An exact title must not bury the well-known work whose official title
// is longer than the query, while #106's "exact beats fuzzy when comparably known" still holds.
// Free, no network: real production search responses are replayed through searchCatalog().
import { readFileSync } from "node:fs";
import { createSuite } from "./lib/assert.mjs";
import { searchCatalog, searchRelevance } from "../../src/catalog/providers.mjs";

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };
const { lookAlikeHints } = await import("../../src/model/search.js");

const { check, eq, finish } = createSuite("search-ranking tests");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/search-ranking-115.json", import.meta.url)));
const env = { TASTEMAKE_TMDB_TOKEN: "test", IGDB_CLIENT_ID: "test", IGDB_CLIENT_SECRET: "test" };

// Turn captured catalog items back into the provider rows the server parses. `popularity` lets a
// test state a provider popularity explicitly; the captured rows carry none for TMDb/IGDB (see the
// fixture's _note), so by default they replay as "nothing known about popularity".
function providerRows(items, popularity = {}) {
  const tmdbMovie = [];
  const tmdbTv = [];
  const ol = [];
  const igdb = [];
  for (const x of items) {
    const pop = popularity[x.id];
    if (x.provider === "tmdb") {
      const base = {
        id: Number(x.providerId),
        overview: x.about,
        poster_path: x.artwork ? `/${x.artwork.split("/").pop()}` : null,
        genre_ids: x.genreIds ?? x.genres.map(Number),
        ...(pop !== undefined ? { popularity: pop } : {})
      };
      const date = x.year ? `${x.year}-01-01` : "";
      if (x.type === "tv") tmdbTv.push({ ...base, name: x.title, first_air_date: date });
      else tmdbMovie.push({ ...base, title: x.title, release_date: date });
    } else if (x.provider === "openlibrary") {
      ol.push({
        key: `/works/${x.providerId}`,
        title: x.title,
        author_name: x.by ? x.by.split(", ") : [],
        first_publish_year: x.year ? Number(x.year) : undefined,
        cover_i: x.artwork ? Number(x.artwork.match(/\/id\/(\d+)/)?.[1]) : undefined,
        subject: x.genres,
        edition_count: pop ?? x.editionCount
      });
    } else if (x.provider === "igdb") {
      igdb.push({
        id: Number(x.providerId),
        name: x.title,
        summary: x.about,
        first_release_date: x.year ? Date.UTC(Number(x.year), 0, 1) / 1000 : undefined,
        cover: x.artwork ? { image_id: x.artwork.split("/").pop().replace(/\.jpg$/, "") } : undefined,
        genres: x.genres.map((name, i) => ({ id: i + 1, name })),
        ...(pop !== undefined ? { total_rating_count: pop } : {})
      });
    }
  }
  return { tmdbMovie, tmdbTv, ol, igdb };
}

function fetchFor(rows) {
  return async (url) => {
    const u = String(url);
    if (u.includes("api.themoviedb.org/3/search/movie")) return { ok: true, json: async () => ({ results: rows.tmdbMovie }) };
    if (u.includes("api.themoviedb.org/3/search/tv")) return { ok: true, json: async () => ({ results: rows.tmdbTv }) };
    if (u.includes("openlibrary.org/search.json")) return { ok: true, json: async () => ({ docs: rows.ol }) };
    if (u.includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "t" }) };
    if (u.includes("api.igdb.com/v4/games")) return { ok: true, json: async () => rows.igdb };
    throw new Error(`unexpected URL ${u}`);
  };
}

async function replay(key, { popularity, domain } = {}) {
  const { q, domain: capturedDomain, items } = fixture.queries[key];
  const result = await searchCatalog(q, { domain: domain ?? capturedDomain, env, fetchImpl: fetchFor(providerRows(items, popularity)) });
  return result.items;
}
const rankOf = (items, id) => items.findIndex((x) => x.id === id) + 1 || Infinity;

// ---- Real captures (production, 2026-10-11) --------------------------------------------------------

{
  // The issue's own example. TMDb's movie+TV merge: the 5-episode companion web series is an exact title
  // but a stub (no artwork, no genres); the 2000 Ang Lee film is complete. Even with no popularity
  // known for either, the film must not sit under the stub.
  const film = "tmdb-movie-146";
  const stub = "tmdb-tv-80610";
  const all = await replay("Crouching Tiger|all");
  check("Crouching Tiger (All): the 2000 film ranks above the stub web series",
    rankOf(all, film) < rankOf(all, stub), `film #${rankOf(all, film)}, stub #${rankOf(all, stub)}`);
  const movies = await replay("Crouching Tiger|movies");
  eq("Crouching Tiger (Movies): the 2000 film is #1", movies[0]?.id, film);
  check("Crouching Tiger (Movies): the retrospective documentary ranks below the sequel film",
    rankOf(movies, "tmdb-movie-673160") > rankOf(movies, "tmdb-movie-263341"));

  // With TMDb's popularity present (as on the server), the film also beats the obscure same-titled
  // books. Popularity values here are illustrative, not captured: a well-known film vs a stub series.
  const withPop = await replay("Crouching Tiger|all", { popularity: { [film]: 12, [stub]: 0.6 } });
  check("Crouching Tiger (All) with popularity: the film is in the top 2", rankOf(withPop, film) <= 2, `film #${rankOf(withPop, film)}`);
}

{
  // #106 regressions on real captures: exact flagship works keep winning.
  const bb = await replay("Breaking Bad|all");
  eq("Breaking Bad (All): the 2008 series is #1", bb[0]?.id, "tmdb-tv-1396");
  const control = await replay("Control|play");
  eq("Control (Games): the 2019 game is #1", control[0]?.title, "Control");
  check("Control (Games): editions/DLC rank below the base game",
    control.slice(1).every((x) => x.title !== "Control"));
  // Open Library's edition counts are real in the capture but TMDb's popularity is not, so give the
  // 2016 film an illustrative well-known value; otherwise only the books would carry popularity.
  const arrival = await replay("Arrival|all", { popularity: { "tmdb-movie-329865": 20 } });
  eq("Arrival (All): the 2016 film is #1", arrival[0]?.id, "tmdb-movie-329865");
  // #230: same-title hints still apply to the re-ranked list.
  const hints = lookAlikeHints(arrival);
  check("Arrival (All): the two 2016 'Arrival' films still both get look-alike hints",
    hints.has("tmdb-movie-329865") && hints.has("tmdb-movie-472349"));
}

{
  // Resident Evil 7 (the issue's second example): a 1-edition, coverless book called exactly
  // "Resident Evil 7" sat above the game. IGDB's rating count was not captured, so this applies an
  // illustrative well-known count for the game; the book's 1 edition is real.
  const game = "igdb-game-19562";
  const book = "openlibrary-book-OL22001605W";
  const re7 = await replay("Resident Evil 7|all", { popularity: { [game]: 900 } });
  eq("Resident Evil 7 (All): Resident Evil 7: Biohazard is #1", re7[0]?.id, game);
  check("Resident Evil 7 (All): the coverless 1-edition book is below the game", rankOf(re7, book) > rankOf(re7, game));
}

{
  // Breath of the Wild: the famous game's title is "The Legend of Zelda: Breath of the Wild". A
  // subtitle that is exactly the query counts as a title-family match, so a well-known game can pass
  // a fan mod named "Breath of the Wild Multiplayer". Counts are illustrative.
  const botw = "igdb-game-7346";
  const mod = "igdb-game-243459";
  const play = await replay("Breath of the Wild|play", { popularity: { [botw]: 2500, [mod]: 3 } });
  eq("Breath of the Wild (Games): the Zelda game is #1", play[0]?.id, botw);
}

{
  // Eternal Sunshine: four obscure films titled exactly "Eternal Sunshine" sat above the 2004 film.
  // Popularity values are illustrative (TMDb's are not in the capture): well known vs obscure.
  const film = "tmdb-movie-38";
  const pops = { [film]: 15, "tmdb-movie-1483576": 0.8, "tmdb-movie-779549": 0.2, "tmdb-movie-745908": 0.6, "tmdb-movie-1578432": 0.1 };
  const es = await replay("Eternal Sunshine|all", { popularity: pops });
  eq("Eternal Sunshine (All): Eternal Sunshine of the Spotless Mind is #1", es[0]?.id, film);
  const esUnknown = await replay("Eternal Sunshine|all");
  check("Eternal Sunshine (All) with no popularity known: exact titles still lead (#106)",
    normalizeTitle(esUnknown[0]?.title) === "eternal sunshine");
}

function normalizeTitle(value) { return String(value ?? "").toLowerCase().trim(); }

// ---- Scoring rules ----------------------------------------------------------------------------------

const item = (title, extra = {}) => ({ title, provider: "tmdb", artwork: "x.jpg", genres: ["18"], year: "2000", about: "A real synopsis.", ...extra });
const { scoreSearchResult } = await import("../../src/catalog/search-ranking.mjs");

check("#106: exact beats a title-family match when they are comparably known",
  scoreSearchResult(item("Dune", { _searchPopularity: 20 }), "dune") > scoreSearchResult(item("Dune: Part Two", { _searchPopularity: 35 }), "dune"));
check("#115: a clearly better-known title-family match beats an obscure exact match",
  scoreSearchResult(item("Crouching Tiger, Hidden Dragon", { _searchPopularity: 12 }), "crouching tiger")
    > scoreSearchResult(item("Crouching Tiger", { _searchPopularity: 0.6, artwork: null, genres: [] }), "crouching tiger"));
check("a complete, well-known exact match is never passed by a title that merely contains the query",
  scoreSearchResult(item("Control", { _searchPopularity: 1.5 }), "control")
    > scoreSearchResult(item("Star Control I & II", { _searchPopularity: 5000 }), "control"));
check("provider popularity is compared on one scale: a 1-edition book does not beat a well-known game",
  scoreSearchResult({ ...item("Resident Evil 7: Biohazard", { _searchPopularity: 900 }), provider: "igdb" }, "resident evil 7")
    > scoreSearchResult({ title: "Resident Evil 7", provider: "openlibrary", genres: ["x"], year: "2020", _searchPopularity: 1 }, "resident evil 7"));
check("a documentary about the work ranks below the work's title family when equally known",
  scoreSearchResult(item("Breaking Bad: The Movie"), "breaking bad")
    > scoreSearchResult(item("Breaking Bad: The Doc", { providerMeta: { genreIds: [99] } }), "breaking bad"));
check("asking for a documentary does not penalise documentaries",
  scoreSearchResult(item("Breaking Bad Documentary", { providerMeta: { genreIds: [99] } }), "breaking bad documentary")
    === scoreSearchResult(item("Breaking Bad Documentary"), "breaking bad documentary"));
check("searchRelevance keeps working for bare titles",
  searchRelevance("The Lord of the Rings", "lord of the rings") > searchRelevance("Lord of the Rings Fan Documentary", "lord of the rings"));


// #243: "The Making of …" matched the query in its subtitle and ranked above the game's own DLC.
{
  const q = "Breath of the Wild";
  const makingOf = searchRelevance("The Making of The Legend of Zelda: Breath of the Wild", q);
  const dlc = searchRelevance("The Legend of Zelda: Breath of the Wild - The Champions' Ballad", q);
  const game = searchRelevance("The Legend of Zelda: Breath of the Wild", q);
  check("a making-of documentary ranks below the game's DLC", makingOf < dlc, `${makingOf} vs ${dlc}`);
  check("and below the game itself", makingOf < game);
  check("asking for it still finds it first", searchRelevance("The Making of The Legend of Zelda: Breath of the Wild", "making of breath of the wild") > searchRelevance("The Legend of Zelda: Breath of the Wild - The Champions' Ballad", "making of breath of the wild"));
  check("other derivative words are capped too", searchRelevance("Breath of the Wild: Behind the Scenes", q) < searchRelevance("Breath of the Wild Expansion Pass", q));
}

finish();
