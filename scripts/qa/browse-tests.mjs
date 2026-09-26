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

eq("Browse exposes Watch / Read / Play", BROWSE_DOMAINS.map((x) => x.id).join(","), "watch,read,play");
check("every Browse domain has genres", BROWSE_DOMAINS.every((domain) => browseGenresFor(domain.id).length >= 8));
eq("Watch Horror maps to the TMDb movie genre", browseGenreById("watch", "horror")?.provider?.movie, 27);
eq("Watch Sci-fi maps to TMDb's separate TV genre", browseGenreById("watch", "sci-fi")?.provider?.tv, 10765);
eq("Play Horror maps to the provider horror theme", browseGenreById("play", "horror")?.provider?.value, 19);

const env = {
  TASTEMAKE_TMDB_TOKEN: "tmdb",
  IGDB_CLIENT_ID: "igdb-id",
  IGDB_CLIENT_SECRET: "igdb-secret"
};

const watchFetch = async (url) => {
  const u = String(url);
  if (u.includes("/discover/movie")) {
    check("Watch Sci-fi uses the movie genre id", u.includes("with_genres=878"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: `Movie ${i + 1}`, release_date: "2020-01-01", genre_ids: [878] })) }) };
  }
  if (u.includes("/discover/tv")) {
    check("Watch Sci-fi uses the TV genre id", u.includes("with_genres=10765"), u);
    return { ok: true, json: async () => ({ results: Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, name: `Show ${i + 1}`, first_air_date: "2021-01-01", genre_ids: [10765] })) }) };
  }
  throw new Error(`unexpected watch URL: ${u}`);
};
const watch = await browseCatalog({ domain: "watch", genreId: "sci-fi", page: 1, env, fetchImpl: watchFetch });
eq("Watch Browse returns the page size", watch.items.length, BROWSE_PAGE_SIZE);
check("Watch Browse mixes movies and TV", watch.items.some((x) => x.type === "movie") && watch.items.some((x) => x.type === "tv"));
check("Watch Browse keeps provider identities", watch.items.every((x) => x.provider === "tmdb"));

const readFetch = async (url) => {
  const u = String(url);
  check("Read Browse sends the selected subject", u.includes("subject=fantasy"), u);
  check("Read Browse paginates by offset", u.includes("offset=12"), u);
  return { ok: true, json: async () => ({ docs: Array.from({ length: 12 }, (_, i) => ({ key: `/works/OL${i}W`, title: `Book ${i}`, author_name: ["Author"], first_publish_year: 2000 + i })) }) };
};
const read = await browseCatalog({ domain: "read", genreId: "fantasy", page: 2, env, fetchImpl: readFetch });
eq("Read Browse returns books", read.items[0]?.type, "book");
check("Read Browse reports more when the provider fills a page", read.hasMore);

let playBody = "";
const playFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "token" }) };
  if (u.includes("api.igdb.com/v4/games")) {
    playBody = init.body;
    return { ok: true, json: async () => Array.from({ length: 12 }, (_, i) => ({ id: 200 + i, name: `Horror Game ${i}`, first_release_date: 1609459200, genres: [] })) };
  }
  throw new Error(`unexpected play URL: ${u}`);
};
const play = await browseCatalog({ domain: "play", genreId: "horror", page: 2, env, fetchImpl: playFetch });
eq("Play Browse returns games", play.items[0]?.type, "game");
check("Play Horror uses the horror theme filter", /where themes = \(19\)/.test(playBody), playBody);
check("Play Browse paginates without repeats", /offset 12/.test(playBody), playBody);

const invalid = await browseCatalog({ domain: "watch", genreId: "not-real", page: 1, env, fetchImpl: watchFetch });
check("invalid Browse genre fails closed", invalid.degraded && invalid.items.length === 0);

const merged = mergeUniqueBrowseItems(
  [{ id: "a", title: "A" }, { id: "b", title: "B" }],
  [{ id: "b", title: "B again" }, { id: "c", title: "C" }]
);
eq("Show more de-duplicates already shown ids", merged.map((x) => x.id).join(","), "a,b,c");

const item = { id: "tmdb-movie-9", provider: "tmdb", providerId: "9", title: "Known Film", type: "movie", domains: ["watch"] };
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

console.log(`browse tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((failure) => console.log(`  x ${failure}`));
process.exit(failures.length ? 1 : 0);
