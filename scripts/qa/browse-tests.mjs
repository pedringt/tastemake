#!/usr/bin/env node
// #111: Browse-first onboarding. Free, no network, no browser.

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { browseCatalog, BROWSE_PAGE_SIZE } from "../../src/catalog/browse.mjs";
import { BROWSE_DOMAINS, browseGenreById, browseGenresFor } from "../../src/catalog/browse-genres.js";
import { mergeUniqueBrowseItems, browseReadyForRecommendations } from "../../src/model/browse.js";
import { applySearchAction } from "../../src/model/search.js";
import { evidenceKind, tasteWeight } from "../../src/model/evidence.js";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

eq("Browse exposes Movies / TV / Read / Play", BROWSE_DOMAINS.map((x) => x.id).join(","), "movies,tv,read,play");
check("every Browse domain has genres", BROWSE_DOMAINS.every((domain) => browseGenresFor(domain.id).length >= 8));
eq("Movies Horror maps to the TMDb movie genre", browseGenreById("movies", "horror")?.provider?.movie, 27);
eq("TV Sci-fi uses keyword discovery instead of the combined Sci-Fi & Fantasy genre", browseGenreById("tv", "sci-fi")?.provider?.kind, "keyword");
eq("TV Sci-fi resolves the science fiction keyword", browseGenreById("tv", "sci-fi")?.provider?.value, "science fiction");
eq("TV Fantasy uses its own keyword discovery", browseGenreById("tv", "fantasy")?.provider?.value, "fantasy");
eq("TV Horror uses keyword discovery instead of Mystery", browseGenreById("tv", "horror")?.provider?.kind, "keyword");
eq("TV Horror resolves the horror keyword", browseGenreById("tv", "horror")?.provider?.value, "horror");
eq("TV Thriller uses keyword discovery instead of Mystery", browseGenreById("tv", "thriller")?.provider?.kind, "keyword");
eq("TV Thriller resolves a distinct keyword", browseGenreById("tv", "thriller")?.provider?.value, "thriller");
eq("Play Horror uses structured metadata", browseGenreById("play", "horror")?.provider?.kind, "metadata");
eq("Play Cozy uses structured metadata", browseGenreById("play", "cozy")?.provider?.kind, "metadata");
eq("Play Narrative uses structured metadata instead of title search", browseGenreById("play", "narrative")?.provider?.kind, "metadata");
check("every Games Browse category uses IGDB metadata instead of literal title search", browseGenresFor("play").every((genre) => genre.provider?.kind === "metadata"));

const env = {
  TASTEMAKE_TMDB_TOKEN: "tmdb",
  IGDB_CLIENT_ID: "igdb-id",
  IGDB_CLIENT_SECRET: "igdb-secret"
};

const moviesFetch = async (url) => {
  const u = String(url);
  if (u.includes("/discover/movie")) {
    check("Movies Sci-fi uses the movie genre id", u.includes("with_genres=878"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `Movie ${i + 1}`, release_date: "2020-01-01", genre_ids: [878] })) }) };
  }
  throw new Error(`unexpected movies URL: ${u}`);
};
const movies = await browseCatalog({ domain: "movies", genreId: "sci-fi", page: 1, env, fetchImpl: moviesFetch });
eq("Movies Browse returns the page size", movies.items.length, BROWSE_PAGE_SIZE);
check("Movies Browse returns only movies", movies.items.every((x) => x.type === "movie"));
check("Movies Browse keeps provider identities", movies.items.every((x) => x.provider === "tmdb"));

const tvFetch = async (url) => {
  const u = String(url);
  if (u.includes("/search/keyword")) {
    check("TV Sci-fi searches science fiction rather than sharing the Fantasy genre", u.includes("query=science%20fiction"), u);
    return { ok: true, json: async () => ({ results: [{ id: 111, name: "science fiction" }] }) };
  }
  if (u.includes("/discover/tv")) {
    check("TV Sci-fi discovers by its own keyword", u.includes("with_keywords=111"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, name: `Show ${i + 1}`, first_air_date: "2021-01-01", genre_ids: [] })) }) };
  }
  throw new Error(`unexpected tv URL: ${u}`);
};
const tv = await browseCatalog({ domain: "tv", genreId: "sci-fi", page: 1, env, fetchImpl: tvFetch });
eq("TV Browse returns the page size", tv.items.length, BROWSE_PAGE_SIZE);
check("TV Browse returns only TV shows", tv.items.every((x) => x.type === "tv"));
check("TV Browse keeps provider identities", tv.items.every((x) => x.provider === "tmdb"));

const tvFantasyFetch = async (url) => {
  const u = String(url);
  if (u.includes("/search/keyword")) {
    check("TV Fantasy searches its own keyword", u.includes("query=fantasy"), u);
    return { ok: true, json: async () => ({ results: [{ id: 222, name: "fantasy" }] }) };
  }
  if (u.includes("/discover/tv")) {
    check("TV Fantasy stays distinct from Sci-fi", u.includes("with_keywords=222") && !u.includes("with_keywords=111"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 12 }, (_, i) => ({ id: 700 + i, name: `Fantasy Show ${i + 1}`, first_air_date: "2021-01-01", genre_ids: [] })) }) };
  }
  throw new Error(`unexpected fantasy URL: ${u}`);
};
const tvFantasy = await browseCatalog({ domain: "tv", genreId: "fantasy", page: 1, env, fetchImpl: tvFantasyFetch });
eq("TV Fantasy Browse returns shows", tvFantasy.items[0]?.type, "tv");

const tvHorrorFetch = async (url) => {
  const u = String(url);
  if (u.includes("/search/keyword")) {
    check("TV Horror searches the horror keyword", u.includes("query=horror"), u);
    return { ok: true, json: async () => ({ results: [{ id: 8087, name: "horror" }] }) };
  }
  if (u.includes("/discover/tv")) {
    check("TV Horror discovers by keyword", u.includes("with_keywords=8087"), u);
    check("TV Horror no longer aliases Mystery", !u.includes("with_genres=9648"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 12 }, (_, i) => ({ id: 300 + i, name: `Horror Show ${i + 1}`, first_air_date: "2022-01-01", genre_ids: [] })) }) };
  }
  throw new Error(`unexpected tv horror URL: ${u}`);
};
const tvHorror = await browseCatalog({ domain: "tv", genreId: "horror", page: 1, env, fetchImpl: tvHorrorFetch });
eq("TV Horror Browse returns shows", tvHorror.items[0]?.type, "tv");

const tvThrillerFetch = async (url) => {
  const u = String(url);
  if (u.includes("/search/keyword")) {
    check("TV Thriller searches a different keyword", u.includes("query=thriller"), u);
    return { ok: true, json: async () => ({ results: [{ id: 9937, name: "thriller" }] }) };
  }
  if (u.includes("/discover/tv")) {
    check("TV Thriller discovers by its own keyword", u.includes("with_keywords=9937"), u);
    check("TV Thriller stays distinct from Horror", !u.includes("with_keywords=8087"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 12 }, (_, i) => ({ id: 500 + i, name: `Thriller Show ${i + 1}`, first_air_date: "2023-01-01", genre_ids: [] })) }) };
  }
  throw new Error(`unexpected tv thriller URL: ${u}`);
};
const tvThriller = await browseCatalog({ domain: "tv", genreId: "thriller", page: 1, env, fetchImpl: tvThrillerFetch });
eq("TV Thriller Browse returns shows", tvThriller.items[0]?.type, "tv");

const readFetch = async (url) => {
  const u = String(url);
  check("Read Browse sends the selected subject", u.includes("subject=fantasy"), u);
  check("Read Browse paginates by offset", u.includes("offset=12"), u);
  return { ok: true, json: async () => ({ docs: Array.from({ length: 12 }, (_, i) => ({ key: `/works/OL${i}W`, title: `Book ${i}`, author_name: ["Author"], first_publish_year: 2000 + i })) }) };
};
const read = await browseCatalog({ domain: "read", genreId: "fantasy", page: 2, env, fetchImpl: readFetch });
eq("Read Browse returns books", read.items[0]?.type, "book");
check("Read Browse reports more when the provider fills a page", read.hasMore);

const igdbGenres = [
  { id: 31, name: "Adventure" }, { id: 12, name: "Role-playing (RPG)" }, { id: 9, name: "Puzzle" },
  { id: 34, name: "Visual Novel" }, { id: 2, name: "Point-and-click" }, { id: 15, name: "Strategy" },
  { id: 11, name: "Real Time Strategy (RTS)" }, { id: 16, name: "Turn-based strategy (TBS)" },
  { id: 24, name: "Tactical" }, { id: 13, name: "Simulator" }, { id: 32, name: "Indie" }
];
const igdbThemes = [
  { id: 1, name: "Action" }, { id: 19, name: "Horror" }, { id: 31, name: "Drama" },
  { id: 43, name: "Mystery" }, { id: 44, name: "Romance" }, { id: 35, name: "Kids" },
  { id: 33, name: "Sandbox" }, { id: 27, name: "Comedy" }, { id: 20, name: "Thriller" },
  { id: 21, name: "Survival" }, { id: 39, name: "Warfare" }
];

function makePlayFetch({ games = [], batches = null } = {}) {
  const bodies = [];
  let gameRequest = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "token" }) };
    if (u.includes("api.igdb.com/v4/genres")) return { ok: true, json: async () => igdbGenres };
    if (u.includes("api.igdb.com/v4/themes")) return { ok: true, json: async () => igdbThemes };
    if (u.includes("api.igdb.com/v4/games")) {
      bodies.push(init.body);
      const rows = batches ? (batches[gameRequest] ?? []) : games;
      gameRequest += 1;
      return { ok: true, json: async () => rows };
    }
    throw new Error(`unexpected play URL: ${u}`);
  };
  return { fetchImpl, bodies };
}

function taxonomyRows(rows, names = []) {
  const wanted = new Set(names.map((name) => String(name).toLowerCase()));
  return rows.filter((row) => wanted.has(String(row.name).toLowerCase()));
}

for (const genre of browseGenresFor("play")) {
  const provider = genre.provider ?? {};
  const positiveGenres = taxonomyRows(igdbGenres, provider.requireGenres?.length ? provider.requireGenres : provider.genres).slice(0, 1);
  const positiveThemes = taxonomyRows(igdbThemes, provider.requireThemes?.length ? provider.requireThemes : provider.themes).slice(0, 1);
  const { fetchImpl, bodies } = makePlayFetch({ games: [{ id: 900, name: "Metadata Match", first_release_date: 1609459200, genres: positiveGenres, themes: positiveThemes }] });
  const result = await browseCatalog({ domain: "play", genreId: genre.id, page: 1, env, fetchImpl });
  eq(`Play ${genre.label} returns games from a structured provider query`, result.items[0]?.type, "game");
  check(`Play ${genre.label} never sends a literal title search`, !/search\s+"/i.test(bodies[0] ?? ""), bodies[0] ?? "");
  check(`Play ${genre.label} sends a metadata where clause`, /where\s+(genres|themes)/i.test(bodies[0] ?? ""), bodies[0] ?? "");
}

const narrativeHarness = makePlayFetch({ games: [
  { id: 910, name: "Story Game", first_release_date: 1609459200, genres: [{ id: 34, name: "Visual Novel" }], themes: [{ id: 31, name: "Drama" }] }
] });
const narrative = await browseCatalog({ domain: "play", genreId: "narrative", page: 1, env, fetchImpl: narrativeHarness.fetchImpl });
eq("Play Narrative returns metadata-matched story games", narrative.items[0]?.title, "Story Game");
check("Play Narrative query uses story-relevant genre/theme ids", /genres = \([^)]*34/.test(narrativeHarness.bodies[0]) && /themes = \([^)]*31/.test(narrativeHarness.bodies[0]), narrativeHarness.bodies[0]);

const cozyHarness = makePlayFetch({ games: [
  { id: 920, name: "Stardew-like", first_release_date: 1609459200, genres: [{ id: 13, name: "Simulator" }], themes: [{ id: 33, name: "Sandbox" }] },
  { id: 921, name: "Obvious Shooter", first_release_date: 1609459200, genres: [{ id: 31, name: "Adventure" }], themes: [{ id: 1, name: "Action" }, { id: 39, name: "Warfare" }] },
  { id: 922, name: "Dark Survival", first_release_date: 1609459200, genres: [{ id: 13, name: "Simulator" }], themes: [{ id: 19, name: "Horror" }, { id: 21, name: "Survival" }] },
  { id: 923, name: "Romance RPG", first_release_date: 1609459200, genres: [{ id: 12, name: "Role-playing (RPG)" }], themes: [{ id: 44, name: "Romance" }] },
  { id: 924, name: "Sandbox Strategy", first_release_date: 1609459200, genres: [{ id: 15, name: "Strategy" }], themes: [{ id: 33, name: "Sandbox" }] }
] });
const cozy = await browseCatalog({ domain: "play", genreId: "cozy", page: 1, env, fetchImpl: cozyHarness.fetchImpl });
check("Play Cozy keeps a positive cozy-style metadata match", cozy.items.some((item) => item.title === "Stardew-like"));
check("Play Cozy excludes obvious Action/Warfare false positives", !cozy.items.some((item) => item.title === "Obvious Shooter"));
check("Play Cozy excludes Horror/Survival false positives", !cozy.items.some((item) => item.title === "Dark Survival"));
check("Play Cozy requires a cozy theme plus Simulator instead of accepting Romance alone", !cozy.items.some((item) => item.title === "Romance RPG"));
check("Play Cozy does not accept Sandbox alone without Simulator", !cozy.items.some((item) => item.title === "Sandbox Strategy"));
check("Play Cozy avoids literal title search", !/search\s+"cozy"/i.test(cozyHarness.bodies[0] ?? ""), cozyHarness.bodies[0] ?? "");

const filler = (start, count, { qualifying = false } = {}) => Array.from({ length: count }, (_, index) => ({
  id: start + index,
  name: `Game ${start + index}`,
  first_release_date: 1609459200,
  genres: qualifying ? [{ id: 13, name: "Simulator" }] : [{ id: 31, name: "Adventure" }],
  themes: qualifying ? [{ id: 33, name: "Sandbox" }] : [{ id: 1, name: "Action" }]
}));
const sparseCozyCandidates = [
  ...filler(1000, 35),
  ...filler(1035, 1, { qualifying: true }),
  ...filler(2000, 30),
  ...filler(2030, 6, { qualifying: true }),
  ...filler(3000, 31),
  ...filler(3031, 5, { qualifying: true })
];
const sparseCozyHarness = makePlayFetch({ games: sparseCozyCandidates });
const filledCozy = await browseCatalog({ domain: "play", genreId: "cozy", page: 1, env, fetchImpl: sparseCozyHarness.fetchImpl });
eq("Play Cozy fills the first page from a sparse curated candidate set", filledCozy.items.length, BROWSE_PAGE_SIZE);
eq("Play Cozy uses one bounded provider request instead of burst-fetching batches", sparseCozyHarness.bodies.length, 1);
check("Play Cozy requests a larger curated candidate pool", /limit 500;/.test(sparseCozyHarness.bodies[0] ?? ""), sparseCozyHarness.bodies[0] ?? "");
const filledCozyPage2 = await browseCatalog({ domain: "play", genreId: "cozy", page: 2, env, fetchImpl: makePlayFetch({ games: [...sparseCozyCandidates, ...filler(4000, 12, { qualifying: true })] }).fetchImpl });
check("Play Cozy paginates qualifying results rather than raw candidates", filledCozyPage2.items.length > 0 && filledCozyPage2.items[0]?.title !== filledCozy.items[0]?.title);

const strategyHarness = makePlayFetch({ games: [
  { id: 930, name: "True Strategy", first_release_date: 1609459200, genres: [{ id: 15, name: "Strategy" }], themes: [] },
  { id: 931, name: "Tactical Shooter", first_release_date: 1609459200, genres: [{ id: 24, name: "Tactical" }, { id: 5, name: "Shooter" }], themes: [] },
  { id: 932, name: "Strategy Shooter", first_release_date: 1609459200, genres: [{ id: 15, name: "Strategy" }, { id: 5, name: "Shooter" }], themes: [] }
] });
const strategy = await browseCatalog({ domain: "play", genreId: "strategy", page: 1, env, fetchImpl: strategyHarness.fetchImpl });
check("Play Strategy keeps a true strategy match", strategy.items.some((item) => item.title === "True Strategy"));
check("Play Strategy excludes tactical-shooter false positives", !strategy.items.some((item) => item.title === "Tactical Shooter"));
check("Play Strategy favors category precision when a shooter also carries a Strategy tag", !strategy.items.some((item) => item.title === "Strategy Shooter"));

const invalid = await browseCatalog({ domain: "movies", genreId: "not-real", page: 1, env, fetchImpl: moviesFetch });
check("invalid Browse genre fails closed", invalid.degraded && invalid.items.length === 0);

const merged = mergeUniqueBrowseItems(
  [{ id: "a", title: "A" }, { id: "b", title: "B" }],
  [{ id: "b", title: "B again" }, { id: "c", title: "C" }]
);
eq("Show more de-duplicates already shown ids", merged.map((x) => x.id).join(","), "a,b,c");

const item = { id: "tmdb-movie-9", provider: "tmdb", providerId: "9", title: "Known Film", type: "movie", domains: ["movies"] };
const makeState = () => ({
  selectedFavorites: new Set(),
  feedbackByRecommendation: {},
  libraryFavorites: new Set(),
  customItems: {}
});

const lovedState = makeState();
check("Loved from Browse uses the canonical action path", Boolean(applySearchAction(lovedState, item, "loved", { source: "browse" })));
eq("Loved from Browse is strong experienced evidence", evidenceKind(lovedState.feedbackByRecommendation[item.id]), "experienced-strong-positive");
eq("Browse provenance is preserved", lovedState.feedbackByRecommendation[item.id].source, "browse");
check("Loved from Browse has taste weight", tasteWeight(lovedState.feedbackByRecommendation[item.id]) > 0);

const savedState = makeState();
applySearchAction(savedState, item, "bookmark", { source: "browse" });
eq("Save from Browse is intent only", evidenceKind(savedState.feedbackByRecommendation[item.id]), "saved");
eq("Save from Browse has zero taste weight", tasteWeight(savedState.feedbackByRecommendation[item.id]), 0);

const declinedState = makeState();
applySearchAction(declinedState, item, "not-interested", { source: "browse" });
eq("Not interested from Browse remains intent", evidenceKind(declinedState.feedbackByRecommendation[item.id]), "intent-declined");
eq("Not interested from Browse has zero taste weight", tasteWeight(declinedState.feedbackByRecommendation[item.id]), 0);

const untouched = makeState();
eq("merely browsing creates no evidence", Object.keys(untouched.feedbackByRecommendation).length, 0);

for (const id of ["1", "2", "3", "4"]) untouched.selectedFavorites.add(id);
check("four Favorites unlock the Browse recommendation CTA condition", browseReadyForRecommendations(untouched));

const onboarded = makeState();
onboarded.onboarded = true;
check("onboarded Browse stays recommendation-ready after starter migration", browseReadyForRecommendations(onboarded));

console.log(`browse tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((failure) => console.log(`  x ${failure}`));
process.exit(failures.length ? 1 : 0);
