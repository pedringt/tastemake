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

// ---- Oct 27: tie-ins and editions -------------------------------------------------------------------
// Live GET /api/catalog?domain=all on Oct 27. Fields are copied from the response; editionCount is Open
// Library's edition_count for the same works (search.json, same day). TMDb popularity is not exposed by
// the API, so it replays as unknown.
const { dropWeakTieIns, mergeBookEditions, tieInSuffix } = await import("../../src/catalog/search-ranking.mjs");
const replayItems = async (q, items) => (await searchCatalog(q, { domain: "all", env, fetchImpl: fetchFor(providerRows(items)) })).items;
const ids = (items) => items.map((x) => x.id);
const hailMary = [
  { id: "tmdb-movie-687163", provider: "tmdb", providerId: "687163", type: "movie", title: "Project Hail Mary", year: "2026", artwork: "https://image.tmdb.org/t/p/w780/iOb2fjXLbpJgyQXe46n1WtGCnaa.jpg", genres: ["878", "12"], about: "Science teacher Ryland Grace wakes up on a spaceship light years from home with no recollection of who he is." },
  { id: "openlibrary-book-OL21745884W", provider: "openlibrary", providerId: "OL21745884W", type: "book", title: "Project Hail Mary", by: "Andy Weir", year: "2021", artwork: "https://covers.openlibrary.org/b/id/11200092-L.jpg?default=false", genres: ["hard science-fiction", "Fiction"], editionCount: 32 },
  { id: "tmdb-movie-1729088", provider: "tmdb", providerId: "1729088", type: "movie", title: "Project Hail Mary | Watch Rocky Sleep", year: "2026", artwork: "https://image.tmdb.org/t/p/w780/ubvkhYJdCcOXhiRPMs9vBScxcHn.jpg", genres: ["10402", "878"], about: "Rocky sleep, you watch, question? Settle in and relax to the Project Hail Mary (Original Motion Picture Score) by Daniel Pemberton." },
  { id: "openlibrary-book-OL45858094W", provider: "openlibrary", providerId: "OL45858094W", type: "book", title: "Project Hail Mary: A Novel", by: "", year: "2021", artwork: null, genres: [], editionCount: 1 },
  { id: "openlibrary-book-OL36735881W", provider: "openlibrary", providerId: "OL36735881W", type: "book", title: "Andy Weir's 3-Book Collection Set (Project Hail Mary, Artemis, the Martian)", by: "Andy Weir", year: "2022", artwork: null, genres: ["Fiction, science fiction, general", "Anthology"], editionCount: 1 }
];
const everything = [
  { id: "tmdb-movie-545611", provider: "tmdb", providerId: "545611", type: "movie", title: "Everything Everywhere All at Once", year: "2022", artwork: "https://image.tmdb.org/t/p/w780/u68AjlvlutfEIcpmbYpKcdi09ut.jpg", genres: ["28", "12", "878"], about: "An aging Chinese immigrant is swept up in an insane adventure." },
  { id: "openlibrary-book-OL37888827W", provider: "openlibrary", providerId: "OL37888827W", type: "book", title: "Everything Everywhere All at Once Screenplay Book", by: "Daniel Kwan, Daniel Scheinert", year: "2024", artwork: null, genres: ["Performing arts"], editionCount: 1 },
  { id: "openlibrary-book-OL38652522W", provider: "openlibrary", providerId: "OL38652522W", type: "book", title: "Everything Everywhere All at Once Song Reader", by: "Son Lux", year: "2023", artwork: null, genres: ["Music"], editionCount: 1 },
  { id: "openlibrary-book-OL38652598W", provider: "openlibrary", providerId: "OL38652598W", type: "book", title: "Everything Everywhere All at Once Collector's Edition", by: "A24", year: "2023", artwork: null, genres: ["Performing arts"], editionCount: 1 },
  { id: "tmdb-movie-1258497", provider: "tmdb", providerId: "1258497", type: "movie", title: "Almost Everything You Ever Wanted to Know About Everything Everywhere All at Once", year: "2022", artwork: "https://image.tmdb.org/t/p/w780/A8eqNfQMAEI7GTChsA3XunC59RV.jpg", genres: ["99"], about: "A behind-the-scenes look at Everything Everywhere All at Once, with interviews from the directors/writers, cast and crew." }
];

{
  const phm = await replayItems("Project Hail Mary", hailMary);
  check("Project Hail Mary: the score listing (TMDb Music, '| Watch Rocky Sleep') is dropped", !ids(phm).includes("tmdb-movie-1729088"), ids(phm).join(", "));
  check("Project Hail Mary: the authorless 1-edition ': A Novel' work is dropped", !ids(phm).includes("openlibrary-book-OL45858094W"), ids(phm).join(", "));
  check("Project Hail Mary: the movie and the book stay", ids(phm).includes("tmdb-movie-687163") && ids(phm).includes("openlibrary-book-OL21745884W"));
  check("Project Hail Mary: the 3-book collection set stays, below the book",
    rankOf(phm, "openlibrary-book-OL36735881W") > rankOf(phm, "openlibrary-book-OL21745884W") && rankOf(phm, "openlibrary-book-OL36735881W") !== Infinity);
  check("Project Hail Mary: the response carries no transient fields", phm.every((x) => !("_searchPopularity" in x)));
  const rocky = await replayItems("project hail mary rocky sleep", hailMary);
  check("asking for 'rocky sleep' keeps the score listing", ids(rocky).includes("tmdb-movie-1729088"));

  const ee = await replayItems("Everything Everywhere All at Once", everything);
  check("Everything Everywhere: the coverless 1-edition screenplay, song reader and collector's edition are dropped",
    ["openlibrary-book-OL37888827W", "openlibrary-book-OL38652522W", "openlibrary-book-OL38652598W"].every((id) => !ids(ee).includes(id)), ids(ee).join(", "));
  eq("Everything Everywhere: the film is #1", ee[0]?.id, "tmdb-movie-545611");
  // Its title is not the film's title plus a suffix, so it is only ranked down, as before.
  eq("Everything Everywhere: the documentary stays, last", ee.at(-1)?.id, "tmdb-movie-1258497");
  const screenplay = await replayItems("everything everywhere screenplay", everything);
  check("an explicit 'screenplay' query keeps the screenplay", ids(screenplay).includes("openlibrary-book-OL37888827W"));
}

{
  const book = (title, extra = {}) => ({ provider: "openlibrary", type: "book", title, by: "Andy Weir", artwork: "c.jpg", genres: ["Fiction"], year: "2021", _searchPopularity: 1, ...extra });
  eq("tieInSuffix: '| ...' after the exact title", tieInSuffix("Project Hail Mary | Watch Rocky Sleep", "Project Hail Mary"), "Watch Rocky Sleep");
  eq("tieInSuffix: '(Original Motion Picture Score)'", tieInSuffix("Project Hail Mary (Original Motion Picture Score)", "Project Hail Mary"), "original motion picture score");
  eq("tieInSuffix: a sequel is not a tie-in", tieInSuffix("Dune Messiah", "Dune"), null);
  eq("tieInSuffix: a subtitle is not a tie-in", tieInSuffix("Dune: Part Two", "Dune"), null);

  const screenplayWithMeta = book("Everything Everywhere All at Once Screenplay Book", { by: "Daniel Kwan", _searchPopularity: 4 });
  const film = { ...item("Everything Everywhere All at Once"), id: "film" };
  check("a screenplay with a cover and several editions is kept", dropWeakTieIns([film, screenplayWithMeta], "everything everywhere all at once").length === 2);
  check("and ranks below the film", scoreSearchResult(screenplayWithMeta, "everything everywhere all at once") < scoreSearchResult(film, "everything everywhere all at once"));
  const googleTieIn = { ...book("Project Hail Mary: A Novel", { provider: "googlebooks", artwork: null }), id: "g" };
  check("a coverless Google Books tie-in is dropped", dropWeakTieIns([book("Project Hail Mary"), googleTieIn], "project hail mary").length === 1);
  const musicExact = { ...item("Project Hail Mary | Watch Rocky Sleep"), providerMeta: { genreIds: [10402] } };
  check("a music listing that is the query's exact title is kept",
    dropWeakTieIns([item("Project Hail Mary"), musicExact], "Project Hail Mary | Watch Rocky Sleep").length === 2);

  // Box sets: a popular one used to outrank the first book in the series on editions alone.
  const boxSet = book("The Stormlight Archive Box Set", { by: "Brandon Sanderson", _searchPopularity: 40 });
  const wayOfKings = book("The Stormlight Archive: The Way of Kings", { by: "Brandon Sanderson", _searchPopularity: 25 });
  check("a box set ranks below the work itself", scoreSearchResult(boxSet, "stormlight archive") < scoreSearchResult(wayOfKings, "stormlight archive"));
  check("asking for the box set still ranks it first", scoreSearchResult(boxSet, "stormlight archive box set") > scoreSearchResult(wayOfKings, "stormlight archive box set"));

  const novel = book("Project Hail Mary: A Novel", { by: "", artwork: null, id: "novel" });
  const real = book("Project Hail Mary", { _searchPopularity: 32, id: "real" });
  eq("editions merge into the one with more editions, at the first edition's place",
    ids(mergeBookEditions([novel, item("Project Hail Mary", { id: "movie" }), real], "project hail mary")).join(","), "real,movie");
  eq("a deluxe edition by the same author merges", mergeBookEditions([real, book("Project Hail Mary (Deluxe Edition)", { id: "deluxe" })], "project hail mary").length, 1);
  eq("asking for the deluxe edition keeps it apart", mergeBookEditions([real, book("Project Hail Mary (Deluxe Edition)", { id: "deluxe" })], "project hail mary deluxe edition").length, 2);
  const hunger = [book("The Hunger", { by: "Alma Katsu", id: "katsu" }), book("The Hunger", { by: "Whitley Strieber", id: "strieber" })];
  eq("two books with the same title by different authors are both kept", ids(mergeBookEditions(hunger, "the hunger")).join(","), "katsu,strieber");
  eq("and neither is dropped as a tie-in", dropWeakTieIns(hunger, "the hunger").length, 2);
}

finish();
