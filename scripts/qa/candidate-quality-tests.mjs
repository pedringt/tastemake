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

import { bookGenreFamilies, igdbGenreOverlap, igdbGenreWhereClause, retrieveCatalogCandidates } from "../../src/catalog/related.mjs";
import { plainTitle, wikidataSeriesPositions } from "../../src/catalog/wikidata-series.mjs";
import { isBookCompanion } from "../../src/catalog/book-companions.mjs";
import { firstPublishedYear, searchCatalog } from "../../src/catalog/providers.mjs";
import { correctOldBookYears } from "../../src/catalog/wikidata-years.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("candidate quality tests");

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
  areas: { movies: true, tv: true, read: true, play: true },
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
  // #255: book candidates may also get a bounded editions lookup for their series position; this check
  // is about the subject searches only.
  const subjectUrls = requestedUrls.filter((url) => url.includes("/search.json"));
  check("queries the top 3 meaningful subjects, not just the first", subjectUrls.length === 3, subjectUrls.join(" | "));
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
    customItems: { "tmdb-movie-10": { id: "tmdb-movie-10", provider: "tmdb", providerId: "10", title: "Seed Movie", type: "movie", domains: ["movies"], genres: ["18"] } },
    areas: { movies: true, tv: true, read: true, play: true },
    recommendationFilter: "movies"
  };
  const neighborTitles = ["Amber Harbor", "Glass Orchard", "Night Signal", "Paper Kingdom", "Silent Atlas", "Copper Sky", "Velvet Transit", "Winter Circuit", "Crimson Static", "Moss Cathedral", "Silver Current", "Ivory Motel"];
  const rows = neighborTitles.map((title, i) => ({ id: 200 + i, title, overview: "x", release_date: "2020-01-01", genre_ids: [18] }));
  const related = await retrieveCatalogCandidates(tmdbState, { env, fetchImpl: async (url) => {
    if (String(url).includes("/movie/10/recommendations")) return { ok: true, json: async () => ({ results: rows }) };
    throw new Error(`unexpected tmdb URL: ${url}`);
  } });
  eq("TMDb /recommendations from a single anchor already returns a healthy (12-row) pool", related.length, 12);
}

// ---- All view retries unused anchors when a represented domain is missing -----------------------

{
  const customItems = {};
  const selectedFavorites = new Set();
  for (const [kind, ids] of [["movie", ["101","102","103"]], ["tv", ["201","202","203"]]]) {
    for (const id of ids) {
      const itemId = `tmdb-${kind}-${id}`;
      selectedFavorites.add(itemId);
      customItems[itemId] = {
        id:itemId, provider:"tmdb", providerId:id, title:`${kind} seed ${id}`, type:kind,
        domains:[kind === "movie" ? "movies" : "tv"], genres:["18"], providerMeta:{genreIds:[18]}
      };
    }
  }
  const movieNames = ["Amber Harbor","Glass Orchard","Night Signal","Paper Kingdom","Silent Atlas","Copper Sky","Velvet Transit","Winter Circuit","Crimson Static","Moss Cathedral","Silver Current","Ivory Motel"];
  const tvNames = ["Northbound","Signal House","Quiet City","Afterlight","Second Floor","Blue Hour"];
  const movieRows = movieNames.map((title, i) => ({
    id:400+i, title, overview:"x", release_date:"2020-01-01", genre_ids:[18]
  }));
  const tvRows = tvNames.map((name, i) => ({
    id:500+i, name, overview:"x", first_air_date:"2020-01-01", genre_ids:[18]
  }));
  const requested = [];
  const related = await retrieveCatalogCandidates({
    selectedFavorites, feedbackByRecommendation:{}, recommendationSets:[], customItems,
    areas:{movies:true,tv:true,read:true,play:true}, recommendationFilter:"all"
  }, {
    env,
    fetchImpl:async (url) => {
      const u=String(url);
      requested.push(u);
      if (u.includes("/movie/")) return {ok:true,json:async()=>({results:movieRows})};
      if (u.includes("/tv/201/") || u.includes("/tv/202/")) return {ok:true,json:async()=>({results:[]})};
      if (u.includes("/tv/203/")) return {ok:true,json:async()=>({results:tvRows})};
      throw new Error(`unexpected mixed-domain URL: ${url}`);
    }
  });
  check("All retries a later TV anchor when the first wave has only movie candidates",
    requested.some((u)=>u.includes("/tv/203/")), requested.join(" | "));
  check("All returns both represented domains after that retry",
    related.some((item)=>item.domains?.includes("movies")) && related.some((item)=>item.domains?.includes("tv")),
    related.map((item)=>item.domains?.[0]).join(","));
}

// ---- All gives every represented positive medium a retrieval chance -----------------------------

{
  const customItems = {
    "tmdb-movie-701": { id:"tmdb-movie-701", provider:"tmdb", providerId:"701", title:"Movie Seed", type:"movie", domains:["movies"], genres:["18"], providerMeta:{genreIds:[18]} },
    "tmdb-tv-702": { id:"tmdb-tv-702", provider:"tmdb", providerId:"702", title:"TV Seed", type:"tv", domains:["tv"], genres:["18"], providerMeta:{genreIds:[18]} },
    "openlibrary-book-OL703": { id:"openlibrary-book-OL703", provider:"openlibrary", providerId:"OL703", title:"Book Seed", type:"book", domains:["read"], genres:["Fantasy"] },
    "igdb-game-704": { id:"igdb-game-704", provider:"igdb", providerId:"704", title:"Game Seed", type:"game", domains:["play"], providerMeta:{genreIds:[31]} }
  };
  const requested = [];
  const related = await retrieveCatalogCandidates({
    selectedFavorites:new Set(Object.keys(customItems)),
    feedbackByRecommendation:{},
    recommendationSets:[],
    customItems,
    areas:{movies:true,tv:true,read:true,play:true},
    recommendationFilter:"all"
  }, {
    env,
    fetchImpl:async (url, init={}) => {
      const u=String(url);
      requested.push(u);
      if (u.includes("/movie/701/recommendations")) return {ok:true,json:async()=>({results:[
        {id:801,title:"Movie Neighbor",overview:"x",release_date:"2020-01-01",genre_ids:[18]}
      ]})};
      if (u.includes("/tv/702/recommendations")) return {ok:true,json:async()=>({results:[
        {id:802,name:"TV Neighbor",overview:"x",first_air_date:"2020-01-01",genre_ids:[18]}
      ]})};
      if (u.includes("openlibrary.org/search.json")) return {ok:true,json:async()=>({docs:[
        {key:"/works/OL803",title:"Book Neighbor",author_name:["A"],first_publish_year:2020,subject:["Fantasy"]}
      ]})};
      if (u.includes("id.twitch.tv/oauth2/token")) return {ok:true,json:async()=>({access_token:"fake-token"})};
      if (u.includes("api.igdb.com/v4/games")) return {ok:true,json:async()=>[
        {id:804,name:"Game Neighbor",summary:"x",first_release_date:1600000000,genres:[{id:31,name:"Adventure"}]}
      ]};
      throw new Error(`unexpected all-domain URL: ${url} body=${init.body || ""}`);
    }
  });
  check("All queries a movie anchor", requested.some((u)=>u.includes("/movie/701/recommendations")), requested.join(" | "));
  check("All queries a TV anchor", requested.some((u)=>u.includes("/tv/702/recommendations")), requested.join(" | "));
  check("All queries a book anchor", requested.some((u)=>u.includes("openlibrary.org/search.json")), requested.join(" | "));
  check("All queries a game anchor", requested.some((u)=>u.includes("api.igdb.com/v4/games")), requested.join(" | "));
  for (const domain of ["movies","tv","read","play"]) {
    check(`All can preserve ${domain} candidates through novelty filtering`, related.some((item)=>item.domains?.includes(domain)), related.map((item)=>item.domains?.[0]).join(","));
  }
}

// Cross-media title overlap is not a franchise/sequel relationship. A game sharing a title with a
// movie the user liked must not be removed merely because All compares candidates across media.
{
  const customItems = {
    "tmdb-movie-901": { id:"tmdb-movie-901", provider:"tmdb", providerId:"901", title:"Night Signal", type:"movie", domains:["movies"], genres:["18"], providerMeta:{genreIds:[18]} },
    "igdb-game-902": { id:"igdb-game-902", provider:"igdb", providerId:"902", title:"Portal", type:"game", domains:["play"], providerMeta:{genreIds:[31]} }
  };
  const related = await retrieveCatalogCandidates({
    selectedFavorites:new Set(Object.keys(customItems)),
    feedbackByRecommendation:{},
    recommendationSets:[],
    customItems,
    areas:{movies:true,tv:true,read:true,play:true},
    recommendationFilter:"all"
  }, {
    env,
    fetchImpl:async (url) => {
      const u=String(url);
      if (u.includes("/movie/901/recommendations")) return {ok:true,json:async()=>({results:[]})};
      if (u.includes("id.twitch.tv/oauth2/token")) return {ok:true,json:async()=>({access_token:"fake-token"})};
      if (u.includes("api.igdb.com/v4/games")) return {ok:true,json:async()=>[
        {id:903,name:"Night Signal",summary:"x",first_release_date:1600000000,genres:[{id:31,name:"Adventure"}]}
      ]};
      throw new Error(`unexpected cross-media URL: ${url}`);
    }
  });
  check("cross-media same-title game is not suppressed as a movie continuation",
    related.some((item)=>item.id==="igdb-game-903"), related.map((item)=>item.id).join(","));
}

// ---- games audit: genre-only IGDB query from a single anchor -----------------------------------
// Documents the current behavior so a future PR can compare against it if IGDB pool health
// regresses; per #135's "audited, not necessarily rewritten" instruction, no production change was
// made here because a genre-backed query already returns a full 12-row page from one anchor.
// (Oct 10: the query now asks for genre pairs, so these rows share both of the anchor's genres.)
{
  const igdbState = {
    selectedFavorites: new Set(["igdb-game-12"]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: { "igdb-game-12": { id: "igdb-game-12", provider: "igdb", providerId: "12", title: "Seed Game", type: "game", domains: ["play"], providerMeta: { genreIds: [31, 32] } } },
    areas: { movies: true, tv: true, read: true, play: true },
    recommendationFilter: "play"
  };
  const gameTitles = ["Amber Harbor", "Glass Orchard", "Night Signal", "Paper Kingdom", "Silent Atlas", "Copper Sky", "Velvet Transit", "Winter Circuit", "Crimson Static", "Moss Cathedral", "Silver Current", "Ivory Motel"];
  const rows = gameTitles.map((name, i) => ({ id: 300 + i, name, summary: "x", first_release_date: 1600000000, genres: [{ id: 31, name: "Adventure" }, { id: 32, name: "Indie" }] }));
  const related = await retrieveCatalogCandidates(igdbState, { env, fetchImpl: async (url, init = {}) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
    if (String(url).includes("api.igdb.com/v4/games")) {
      check("IGDB genre query asks for the anchor's genre pair", /where \(genres = \[31,32\]\)/.test(init.body || ""), init.body);
      return { ok: true, json: async () => rows };
    }
    throw new Error(`unexpected igdb URL: ${url}`);
  } });
  eq("IGDB genre-only query from a single anchor already returns a healthy (12-row) pool", related.length, 12);
}

// ---- Real report (Oct 10): "Surprise me" offered GTA V for an Outer Wilds favorite --------------
// IGDB's `genres = (a,b,c)` matches games sharing ANY one genre, sorted by rating count, so the
// most-rated game sharing only "Adventure" topped the pool every pick (the surprise slot included)
// is drawn from. A related game must now share two of the anchor's genres.
{
  const outerWilds = { id: "igdb-game-11737", provider: "igdb", providerId: "11737", title: "Outer Wilds", type: "game", domains: ["play"],
    genres: ["Puzzle", "Adventure", "Indie"], providerMeta: { genreIds: [9, 31, 32] } };
  const state = {
    selectedFavorites: new Set([outerWilds.id]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: { [outerWilds.id]: outerWilds },
    areas: { movies: true, tv: true, read: true, play: true },
    recommendationFilter: "play",
    curveball: true,
    recommendationStyle: "adventurous"
  };
  let body = "";
  const related = await retrieveCatalogCandidates(state, { env, fetchImpl: async (url, init = {}) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
    if (String(url).includes("api.igdb.com/v4/games")) {
      body = init.body || "";
      // Most-rated first, as IGDB returns them: the AAA games share only "Adventure".
      return { ok: true, json: async () => [
        { id: 1020, name: "Grand Theft Auto V", summary: "x", first_release_date: 1379376000, genres: [{ id: 5, name: "Shooter" }, { id: 10, name: "Racing" }, { id: 31, name: "Adventure" }] },
        { id: 1021, name: "Red Dead Redemption 2", summary: "x", first_release_date: 1540512000, genres: [{ id: 5, name: "Shooter" }, { id: 31, name: "Adventure" }] },
        { id: 1022, name: "Firewatch", summary: "x", first_release_date: 1454976000, genres: [{ id: 31, name: "Adventure" }, { id: 32, name: "Indie" }] },
        { id: 1023, name: "Return of the Obra Dinn", summary: "x", first_release_date: 1539734400, genres: [{ id: 9, name: "Puzzle" }, { id: 31, name: "Adventure" }, { id: 32, name: "Indie" }] },
        { id: 1024, name: "The Witness", summary: "x", first_release_date: 1453766400, genres: [{ id: 9, name: "Puzzle" }, { id: 31, name: "Adventure" }, { id: 32, name: "Indie" }] },
        { id: 1025, name: "Tunic", summary: "x", first_release_date: 1647820800, genres: [{ id: 31, name: "Adventure" }, { id: 32, name: "Indie" }] },
        { id: 1026, name: "Myst", summary: "x", first_release_date: 748224000, genres: [{ id: 9, name: "Puzzle" }, { id: 31, name: "Adventure" }] },
        { id: 1027, name: "Subnautica", summary: "x", first_release_date: 1516838400, genres: [{ id: 31, name: "Adventure" }, { id: 32, name: "Indie" }] }
      ] };
    }
    throw new Error(`unexpected igdb URL: ${url}`);
  } });
  const titles = related.map((item) => item.title);
  check("IGDB related query asks for genre pairs, not any single genre", body.includes("where (genres = [9,31] | genres = [9,32] | genres = [31,32])") && !body.includes("genres = (9,31,32)"), body);
  check("a game sharing only one broad genre (GTA V) is never a related candidate", !titles.includes("Grand Theft Auto V") && !titles.includes("Red Dead Redemption 2"), titles.join(","));
  check("games sharing two or more genres stay in the pool", ["Firewatch", "Return of the Obra Dinn", "The Witness", "Tunic", "Myst", "Subnautica"].every((title) => titles.includes(title)), titles.join(","));
  check("the closest genre matches rank first", titles[0] === "Return of the Obra Dinn" && titles[1] === "The Witness", titles.join(","));
  check("the adventurous surprise slot is still a two-genre match", related.length >= 6 && igdbGenreOverlap(outerWilds, related[5]).overlap >= 2, related[5]?.title);

  // Canonical-store rows carry genre names only, and the store matches on any one name.
  eq("store row sharing only Adventure fails the name overlap", igdbGenreOverlap(outerWilds, { genres: ["Adventure", "Shooter"], providerMeta: { genreIds: [] } }).overlap, 1);
  eq("store row sharing Puzzle and Adventure passes the name overlap", igdbGenreOverlap(outerWilds, { genres: ["puzzle", "Adventure"], providerMeta: { genreIds: [] } }).overlap, 2);
  eq("a one-genre anchor still needs only one shared genre", igdbGenreOverlap({ providerMeta: { genreIds: [31] } }, { providerMeta: { genreIds: [31, 5] } }).required, 1);
  eq("a one-genre anchor keeps the single-genre query", igdbGenreWhereClause([31]), "genres = (31)");
}

// ---- QA sweep real bug: IGDB self-exclusion fallback let an anchor recommend itself -------------
// `Number(item.providerId) || 0` silently became "id != 0" when providerId wasn't a valid number --
// real IGDB ids are never 0, so that excluded nothing. Two cases: (1) a malformed providerId omits
// the now-meaningless query-string clause rather than emitting a fake "!= 0" that excludes nothing
// for real; (2) a client-side filter is the actual guarantee regardless of the clause -- proven here
// by having the fake API return the anchor's own id anyway (as if the exclusion clause failed for
// any reason, e.g. provider-side inconsistency) and confirming it still never reaches the output.
{
  const makeState = (providerId) => ({
    selectedFavorites: new Set(["igdb-game-anchor"]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: { "igdb-game-anchor": { id: "igdb-game-anchor", provider: "igdb", providerId, title: "Anchor Game", type: "game", domains: ["play"], providerMeta: { genreIds: [31] } } },
    areas: { movies: true, tv: true, read: true, play: true },
    recommendationFilter: "play"
  });

  const malformedFetch = async (url, init = {}) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
    if (String(url).includes("api.igdb.com/v4/games")) {
      check("a malformed providerId never emits the old meaningless \"id != 0\" clause", !/id != 0/.test(init.body || ""), init.body);
      return { ok: true, json: async () => [{ id: 900, name: "Different Game", summary: "x", first_release_date: 1600000000, genres: [{ id: 31, name: "Adventure" }] }] };
    }
    throw new Error(`unexpected igdb URL: ${url}`);
  };
  await retrieveCatalogCandidates(makeState("not-a-number"), { env, fetchImpl: malformedFetch });

  const defenseInDepthFetch = async (url) => {
    if (String(url).includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
    if (String(url).includes("api.igdb.com/v4/games")) {
      // Simulates the exclusion clause failing to keep the anchor out, for any reason -- the API
      // returns the anchor's own id (777) alongside a real different game.
      return { ok: true, json: async () => [
        { id: 777, name: "Anchor Game", summary: "x", first_release_date: 1600000000, genres: [{ id: 31, name: "Adventure" }] },
        { id: 778, name: "Different Game", summary: "x", first_release_date: 1600000000, genres: [{ id: 31, name: "Adventure" }] }
      ] };
    }
    throw new Error(`unexpected igdb URL: ${url}`);
  };
  const defended = await retrieveCatalogCandidates(makeState("777"), { env, fetchImpl: defenseInDepthFetch });
  check("client-side filter excludes the anchor's own id even if the API returns it anyway", !defended.some((c) => c.providerId === "777"));
  check("client-side filter still keeps the genuinely different game", defended.some((c) => c.providerId === "778"));
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
    areas: { movies: true, tv: true, read: true, play: true },
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


// ---- Oct 20 (production, AI paused): retrieval followed "orphans", not genre ------------------------
// Real Open Library subjects. The Name of the Wind's first three subjects were "orphans", "American
// fantasy fiction" and "Adult books for young adults"; the orphan query returned Emily of New Moon and
// Dear Enemy, which share only "Orphans" plus children's-audience labels.
{
  const nameOfTheWind = ["orphans", "American fantasy fiction", "Adult books for young adults", "epic fiction", "series", "Juvenile audience", "demons", "quests", "loss (psychology)", "fate and fatalism", "voyages and travels", "heroes and heroines"];
  const docs = {
    emily: { key: "/works/OL-EMILY", title: "Emily of New Moon", author_name: ["Lucy Maud Montgomery"], subject: ["Juvenile fiction", "Child authors", "Orphans", "Fiction", "Children's fiction", "Canada, fiction", "Orphans, fiction"] },
    dear: { key: "/works/OL-DEAR", title: "Dear Enemy", author_name: ["Jean Webster"], subject: ["Orphans", "Fiction", "Juvenile fiction", "Child and youth fiction", "Orphans, fiction", "Children's fiction"] },
    keeper: { key: "/works/OL-KEEPER", title: "Keeper of the Lost Cities", author_name: ["Shannon Messenger"], subject: ["Ability", "Fiction", "Fantasy", "Orphans", "Elves", "Children's fiction", "Fantasy fiction"] },
    lies: { key: "/works/OL-LIES", title: "The Lies of Locke Lamora", author_name: ["Scott Lynch"], subject: ["American fantasy fiction", "Orphans", "Swindlers and swindling", "Fiction, fantasy, general"] },
    quest: { key: "/works/OL-QUEST", title: "The Hobbit", author_name: ["J. R. R. Tolkien"], subject: ["Fantasy", "quests", "Dragons", "voyages and travels"] }
  };
  const asked = [];
  const fetchImpl = async (url) => {
    const subject = /subject:"([^"]+)"/.exec(decodeURIComponent(String(url)))?.[1] ?? "";
    asked.push(subject);
    const rows = subject === "orphans" ? [docs.emily, docs.dear, docs.keeper, docs.lies]
      : subject === "American fantasy fiction" ? [docs.lies, docs.keeper]
      : subject === "epic fiction" || subject === "demons" || subject === "quests" ? [docs.quest]
      : [];
    if (!subject) throw new Error(`unexpected URL ${url}`);
    return { ok: true, json: async () => ({ docs: rows }) };
  };
  const related = await retrieveCatalogCandidates(bookState(nameOfTheWind), { env, fetchImpl });
  const titles = related.map((item) => item.title);
  eq("a genre subject is queried first", asked[0], "American fantasy fiction");
  check("audience labels are never queried", !asked.some((subject) => /juvenile|adult books|series/i.test(subject)), asked.join(" | "));
  check("books sharing only 'orphans' and audience labels are rejected", !titles.includes("Emily of New Moon") && !titles.includes("Dear Enemy"), titles.join(", "));
  check("fantasy books that also share a subject are kept", titles.includes("The Lies of Locke Lamora") && titles.includes("Keeper of the Lost Cities"), titles.join(", "));

  check("genre families read real subjects", [...bookGenreFamilies(["American fantasy fiction", "orphans"])].join() === "fantasy");
  check("genre: prefixed subjects count", bookGenreFamilies(["genre:high fantasy"]).has("fantasy"));
  check("orphan and audience subjects carry no genre", bookGenreFamilies(["Orphans", "Juvenile fiction", "Children's fiction"]).size === 0);
  check("magic and dragons point to fantasy", bookGenreFamilies(["Magic"]).has("fantasy") && bookGenreFamilies(["Dragons"]).has("fantasy"));
}


// ---- #255 follow-up: books near the top of the final list get their own series check -----------------
// Real case (Oct 20): Lord of Chaos (Wheel of Time #6) was offered because the 10 position lookups were
// spent further up the pool. Here the first ten candidates are later entries too (all looked up and
// dropped), which pushes an unchecked Lord of Chaos into the top; the final check must catch it.
{
  const doc = (id, title, author) => ({ key: `/works/${id}`, title, author_name: [author], subject: ["Fantasy fiction", "Magic"] });
  const sequelTitles = ["Ashfall", "Brightwater", "Cinder Road", "Duskmere", "Embertide", "Frostgate", "Gloamhollow", "Hollowmark", "Ironvale", "Jadecrest"];
  const sequels = sequelTitles.map((title, n) => doc(`OL-SEQ${n}W`, title, `Author ${n}`));
  const lord = doc("OL-LORDW", "Lord of Chaos", "Robert Jordan");
  const freshTitles = ["Kestrel", "Lanternfall", "Moonwright", "Nettlebrook", "Owlsong", "Pinecrown"];
  const fresh = freshTitles.map((title, n) => doc(`OL-NEW${n}W`, title, `Writer ${n}`));
  const lookedUp = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(String(url));
    const work = /works\/(OL-[A-Z0-9]+W)\/editions/.exec(u)?.[1];
    if (work) {
      lookedUp.push(work);
      const series = work.startsWith("OL-SEQ") ? [`The ${work} Cycle, Book 2`, `The ${work} Cycle, Book 2`] : work === "OL-LORDW" ? ["Wheel of Time (6)", "Wheel of Time (6)"] : [];
      return { ok: true, json: async () => ({ entries: series.map((name) => ({ series: [name] })) }) };
    }
    return { ok: true, json: async () => ({ docs: [...sequels, lord, ...fresh] }) };
  };
  const related = await retrieveCatalogCandidates(bookState(["Fantasy fiction", "Magic"]), { env, fetchImpl });
  const titles = related.map((item) => item.title);
  check("later entries found by the first lookups are dropped", !titles.some((t) => sequelTitles.includes(t)), titles.join(", "));
  check("a later entry that reached the top unchecked is caught by the final check", !titles.includes("Lord of Chaos") && lookedUp.includes("OL-LORDW"), `${titles.join(", ")} | looked up: ${lookedUp.length}`);
  check("fresh books fill the set", titles.filter((t) => freshTitles.includes(t)).length >= 5, titles.join(", "));
}

// ---- Wikidata series order, for books Open Library has no position for ------------------------------
// Real case (Oct 20): King of the Murgos (The Malloreon #2) was offered; Open Library has no position for it
// in any edition, and Wikidata has it only by title (no Open Library id link). Krew elfów is the opposite:
// Open Library says #1, Wikidata says 3 (it counts the story collections), and Open Library must win.
{
  const doc = (id, title, author) => ({ key: `/works/${id}`, title, author_name: [author], subject: ["Fantasy fiction", "Magic"] });
  const murgos = doc("OL-MURGOSW", "King of the Murgos (Malloreon)", "David Eddings");
  const impostor = doc("OL-OTHERW", "The Hero of Ages", "Someone Else");
  const krew = doc("OL-KREWW", "Krew elfów", "Andrzej Sapkowski");
  const byId = doc("OL-IDW", "Shadow Linked", "Linked Author");
  const freshTitles = ["Kestrel", "Lanternfall", "Moonwright", "Nettlebrook", "Owlsong", "Pinecrown"];
  const fresh = freshTitles.map((title, n) => doc(`OL-NEW${n}W`, title, `Writer ${n}`));
  const binding = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: String(v) }]));
  const run = async ({ wikidataDown = false } = {}) => {
    const wikidataQueries = [];
    const fetchImpl = async (url) => {
      const u = decodeURIComponent(String(url));
      if (u.startsWith("https://query.wikidata.org/")) {
        wikidataQueries.push(u);
        if (wikidataDown) throw new Error("timeout");
        const rows = u.includes("P648")
          ? (u.includes('"OL-IDW"') ? [binding({ olid: "OL-IDW", ordinal: 4 })] : []).concat(u.includes('"OL-KREWW"') ? [binding({ olid: "OL-KREWW", ordinal: 3 })] : [])
          : [binding({ title: "King of the Murgos", authorLabel: "David Eddings", ordinal: 2 }), binding({ title: "The Hero of Ages", authorLabel: "Brandon Sanderson", ordinal: 3 })];
        return { ok: true, json: async () => ({ results: { bindings: rows } }) };
      }
      const work = /works\/(OL-[A-Z0-9]+W)\/editions/.exec(u)?.[1];
      if (work) {
        const series = work === "OL-KREWW" ? ["Wiedźmin, 1", "Wiedźmin, 1"] : [];
        return { ok: true, json: async () => ({ entries: series.map((name) => ({ series: [name] })) }) };
      }
      return { ok: true, json: async () => ({ docs: [murgos, impostor, krew, byId, ...fresh] }) };
    };
    const related = await retrieveCatalogCandidates(bookState(["Fantasy fiction", "Magic"]), { env, fetchImpl });
    return { titles: related.map((item) => item.title), wikidataQueries };
  };

  const { titles, wikidataQueries } = await run();
  check("a later entry found only by title + author on Wikidata is dropped", !titles.includes("King of the Murgos (Malloreon)"), titles.join(", "));
  check("a later entry found by Open Library id on Wikidata is dropped", !titles.includes("Shadow Linked"), titles.join(", "));
  check("a title match with a different author is ignored", titles.includes("The Hero of Ages"), titles.join(", "));
  check("Open Library's position wins: Krew elfów (#1 there) is kept", titles.includes("Krew elfów"), titles.join(", "));
  check("Wikidata is never asked about a book Open Library already placed", !wikidataQueries.some((q) => q.includes('"OL-KREWW"')), wikidataQueries.length);
  check("at most two Wikidata requests per round", wikidataQueries.length > 0 && wikidataQueries.length <= 2, wikidataQueries.length);

  const down = await run({ wikidataDown: true });
  check("Wikidata down: nothing extra is dropped (fail open)", down.titles.includes("King of the Murgos (Malloreon)") && down.titles.includes("Shadow Linked"), down.titles.join(", "));

  let called = false;
  const none = await wikidataSeriesPositions([{ id: "tmdb-movie-1", provider: "tmdb", providerId: "1", title: "Dune: Part Two" }], { fetchImpl: async () => { called = true; } });
  check("non-books never reach Wikidata", !called && none.size === 0);
  const bad = await wikidataSeriesPositions([{ id: "b", provider: "openlibrary", providerId: "OL-BW", title: "Novella", by: "A B" }], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: { bindings: [binding({ olid: "OL-BW", ordinal: "0.5" })] } }) })
  });
  eq("a non-integer ordinal (a 0.5 novella) is not a position", bad.get("b"), null);
  eq("titles are matched without the series suffix or subtitle", plainTitle("King of the Murgos (Malloreon): Book Two of the Malloreon"), "King of the Murgos");
}

// ---- Oct 20 smoke test: study guides and government documents are not books to search for or recommend ----
// Real Open Library rows from a "The Name of the Wind" search; both outranked real books on edition count.
{
  const guide = { title: "Study Guide -- The Other Wes Moore by Wes Moore", author_name: ["SuperSummary"] };
  const bill = { title: "Bill", author_name: ["Canada. Legislature. Legislative Assembly."] };
  check("a SuperSummary study guide is dropped", isBookCompanion(guide, "The Name of the Wind"));
  check("a study guide by any publisher is dropped by its title", isBookCompanion({ title: "Summary and Analysis of Circe", author_name: ["Worthy Reads"] }, "Circe"));
  check("a guide-maker's book is dropped even without guide words in the title", isBookCompanion({ title: "The Night Circus", author_name: ["BookRags"] }, "night circus"));
  check("a legislature's bill is dropped", isBookCompanion(bill, "The Name of the Wind"));
  check("a search that asks for a study guide still gets one", !isBookCompanion(guide, "wes moore study guide"));
  check("real books stay", ![
    { title: "The Name of the Wind", author_name: ["Patrick Rothfuss", "Marc Simonetti"] },
    { title: "The Hunger Games", author_name: ["Kate Egan"] },
    { title: "A Slow Regard of Silent Things", author_name: ["Patrick Rothfuss"] },
    { title: "Circe", author_name: ["Anne De Courcy"] }
  ].some((row) => isBookCompanion(row, "anything")));
}

// ---- Oct 23 smoke test: one mis-dated edition made several books read "First published 2001" ----------
// Real Open Library rows (first_publish_year and the start of publish_year).
{
  const row = (first, years) => ({ first_publish_year: first, publish_year: years });
  eq("The Blade Itself: a lone 2001 reprint record is ignored", firstPublishedYear(row(2001, [2001, 2006, 2007, 2009])), 2006);
  eq("The Alloy of Law", firstPublishedYear(row(2001, [2001, 2011, 2012, 2013])), 2011);
  eq("Dune keeps 1965", firstPublishedYear(row(1965, [1965, 1966, 1967])), 1965);
  eq("The Hobbit keeps 1937 (older books often waited years for a reprint)", firstPublishedYear(row(1937, [1937, 1938, 1946])), 1937);
  eq("Piranesi keeps 2020", firstPublishedYear(row(2020, [2020, 2021, 2022])), 2020);
  eq("too few editions to judge: Open Library's year stands", firstPublishedYear(row(2001, [2001, 2010])), 2001);
  eq("no year at all", firstPublishedYear({}), null);
}

// ---- Oct 23 review: search dropped junk after cutting to 8, so a page with junk showed fewer books ------
{
  let asked = "";
  const docs = [
    { key: "/works/OLG1W", title: "Study Guide -- Something", author_name: ["SuperSummary"] },
    { key: "/works/OLG2W", title: "Bill", author_name: ["Canada. Legislature. Legislative Assembly."] },
    { key: "/works/OLG3W", title: "Summary of Something", author_name: ["Instaread"] },
    ...Array.from({ length: 9 }, (_, n) => ({ key: `/works/OLB${n}W`, title: `Real Book ${n}`, author_name: ["Author"], first_publish_year: 2000 + n }))
  ];
  const result = await searchCatalog("real book", { domain: "read", env: {}, fetchImpl: async (url) => { if (/openlibrary/.test(url)) asked = String(url); return { ok: true, json: async () => ({ docs }) }; } });
  const books = (result.items ?? result).filter((item) => item.provider === "openlibrary");
  check("search asks Open Library for extra results", /limit=12/.test(asked), asked);
  eq("three junk results still leave a full 8 real books", books.length, 8);
}

// ---- Oct 24: older books' years from Wikidata (Open Library says The Great Gatsby is 1920; it's 1925) ------
{
  const ol = (id, title, year, about = `First published ${year}.`) => ({ id: `openlibrary-book-${id}`, provider: "openlibrary", providerId: id, type: "book", domains: ["read"], title, year: String(year), about });
  const asked = [];
  const wikidata = (rows) => async (url) => { asked.push(decodeURIComponent(String(url))); return { ok: true, json: async () => ({ results: { bindings: rows.map(([olid, year]) => ({ olid: { value: olid }, year: { value: String(year) } })) } }) }; };
  const items = [ol("OL468431W", "The Great Gatsby", 1920), ol("OL27448W", "The Lord of the Rings", 1954), ol("OL893415W", "Dune", 1965), ol("OL8400950W", "The Blade Itself", 2006), { id: "tmdb-movie-1", provider: "tmdb", title: "A Film", year: "1925" }];
  const out = await correctOldBookYears(items, { env: {}, fetchImpl: wikidata([["OL468431W", 1925], ["OL27448W", 1954]]) });
  eq("Gatsby gets Wikidata's year", out[0].year, "1925");
  eq("...and the placeholder line follows it", out[0].about, "First published 1925.");
  eq("an agreeing year is unchanged", out[1].year, "1954");
  eq("no Wikidata date: Open Library's year stays", out[2].year, "1965");
  check("only pre-1980 Open Library books are asked about, in one request", asked.length === 1 && asked[0].includes('"OL468431W"') && !asked[0].includes("OL8400950W") && !asked[0].includes("tmdb"), asked.join(" | "));
  check("matched by Open Library id (P648) only, no titles", /wdt:P648/.test(asked[0]) && !/rdfs:label/.test(asked[0]));
  check("everything else passes through untouched", out[3] === items[3] && out[4] === items[4]);
  const real = await correctOldBookYears([ol("OL1W", "Old Book", 1950, "A real synopsis.")], { env: {}, fetchImpl: wikidata([["OL1W", 1948]]) });
  eq("a real synopsis is never replaced", real[0].about, "A real synopsis.");
  const down = await correctOldBookYears(items.slice(0, 1), { env: {}, fetchImpl: async () => { throw new Error("timeout"); } });
  eq("Wikidata down: Open Library's year stays", down[0].year, "1920");
  let called = false;
  await correctOldBookYears([ol("OL2W", "New Book", 2015)], { env: {}, fetchImpl: async () => { called = true; } });
  check("no old books, no request", !called);
  const odd = await correctOldBookYears(items.slice(0, 1), { env: {}, fetchImpl: wikidata([["OL468431W", 3020]]) });
  eq("an impossible year is ignored", odd[0].year, "1920");
}

finish();

