#!/usr/bin/env node
// Synopsis safety (public-demo finding): a provider synopsis that trips the shared check must never
// reach a card; a normal synopsis must come through exactly as the provider sent it. Free, no network.
//
//   node scripts/qa/synopsis-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { assessSynopsis, blurbOf, fallbackSummary, safeAbout } from "../../src/catalog/synopsis.mjs";
import { applyTaglineFallback, igdbItem, openLibraryItem, tmdbItem } from "../../src/catalog/providers.mjs";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const FLAGGED = "A woman is brutally raped by an unseen force, and her psychiatrist struggles to explain it.";
const NORMAL = "A single mother and her three children are tormented by a spirit that seems to be drawn to her family home.";

// ---- the shared check -------------------------------------------------------------------------
eq("a normal synopsis passes", assessSynopsis({ about: NORMAL }).ok, true);
eq("a sexual-violence synopsis is flagged by term", assessSynopsis({ about: FLAGGED }).reason, "sensitive-term");
eq("the provider's adult flag flags on its own", assessSynopsis({ about: NORMAL, adult: true }).reason, "adult-flag");
eq("an adults-only rating flags on its own", assessSynopsis({ about: NORMAL, certification: "NC-17" }).reason, "age-rating");
eq("an ordinary R rating does not flag (it would strip too many normal summaries)", assessSynopsis({ about: NORMAL, certification: "R" }).ok, true);
for (const sample of ["He was sexually assaulted as a boy.", "A molester stalks the town.", "A story of incest and shame.", "An ex-pedophile support group."]) {
  eq(`flags: ${sample}`, assessSynopsis({ about: sample }).ok, false);
}
for (const sample of [
  "A grape farmer drapes a scraped canvas over the barn.",
  "A therapist helps a soldier with night terrors.",
  "A brutal war drama about murder, grief and survival.",
  "Rapeseed prices collapse and a village goes hungry."
]) {
  eq(`does not flag: ${sample}`, assessSynopsis({ about: sample }).ok, true);
}

// ---- what a flagged item shows instead --------------------------------------------------------
const entity = { type: "movie", year: "1982", genres: ["27", "18"] };
eq("genre and year replace a flagged synopsis", fallbackSummary(entity), "Horror / Drama · 1982");
eq("a clean tagline is preferred over genre and year", fallbackSummary(entity, { tagline: "Based on a true story." }), "Based on a true story.");
eq("a tagline that fails the same check is not used", fallbackSummary(entity, { tagline: "She was raped by it." }), "Horror / Drama · 1982");
eq("an item with no genre falls back to its media type", fallbackSummary({ type: "game", year: "2012", genres: [] }), "Game · 2012");
eq("string genres (games, books) are used as given", fallbackSummary({ type: "game", year: "2012", genres: ["Adventure", "Indie", "Puzzle"] }), "Adventure / Indie · 2012");

// ---- every provider goes through it at ingestion ----------------------------------------------
const flaggedMovie = tmdbItem({ id: 1, title: "The Entity", overview: FLAGGED, release_date: "1982-02-04", genre_ids: [27, 18], poster_path: "/e.jpg" }, "movie");
eq("TMDb: a flagged synopsis is replaced with genre and year", flaggedMovie.about, "Horror / Drama · 1982");
eq("TMDb: the item records why it was replaced", flaggedMovie.aboutFlag, "sensitive-term");
check("TMDb: the flagged text appears nowhere in the item", !JSON.stringify(flaggedMovie).includes("raped"));
const normalMovie = tmdbItem({ id: 2, title: "Poltergeist", overview: NORMAL, release_date: "1982-06-04", genre_ids: [27] }, "movie");
eq("TMDb: a normal synopsis is unchanged, byte for byte", normalMovie.about, NORMAL);
check("TMDb: a normal item carries no flag at all", !("aboutFlag" in normalMovie));
const adultRow = tmdbItem({ id: 3, name: "After Dark", overview: NORMAL, first_air_date: "2019-01-01", genre_ids: [18], adult: true }, "tv");
eq("TMDb: the adult flag on a row replaces an otherwise clean synopsis", adultRow.about, "Drama · 2019");
const flaggedGame = igdbItem({ id: 9, name: "Dark Cellar", summary: FLAGGED, first_release_date: 1609459200, genres: [{ id: 1, name: "Adventure" }] });
eq("IGDB: a flagged summary is replaced with genre and year", flaggedGame.about, "Adventure · 2021");
const normalGame = igdbItem({ id: 10, name: "Fine Game", summary: "Explore a quiet island and fix its lighthouse.", first_release_date: 1609459200, genres: [] });
eq("IGDB: a normal summary is unchanged", normalGame.about, "Explore a quiet island and fix its lighthouse.");
const book = openLibraryItem({ key: "/works/OL1W", title: "Some Book", author_name: ["A. Writer"], first_publish_year: 1999, subject: ["Fantasy"] });
eq("Open Library: the synthesized blurb is unchanged", book.about, "First published 1999.");

// ---- render side: anything already saved in a browser is covered too --------------------------
eq("safeAbout replaces a persisted flagged synopsis", safeAbout({ ...entity, about: FLAGGED }), "Horror / Drama · 1982");
eq("safeAbout leaves a normal synopsis alone", safeAbout({ ...entity, about: NORMAL }), NORMAL);
eq("blurbOf keeps the user's own note when there is no synopsis", blurbOf({ note: "Our family favorite" }), "Our family favorite");
eq("blurbOf checks the synopsis before the note", blurbOf({ ...entity, about: FLAGGED, note: "x" }), "Horror / Drama · 1982");

const { state, resetState } = await import("../../src/state.js");
const { renderRecommendations } = await import("../../src/screens/recommendations.js");
resetState();
state.recommendationSets = [[{ id: "tmdb-movie-1", provider: "tmdb", providerId: "1", title: "The Entity", type: "movie", domains: ["movies"], year: "1982", genres: ["27"], about: FLAGGED, reason: "Because you liked slow-burn horror." }]];
const html = renderRecommendations();
check("the recommendation card never renders a flagged synopsis", !html.includes("raped"));
check("...and shows genre and year in its place, keeping the why-this-fits line", html.includes("Horror · 1982") && html.includes("Because you liked slow-burn horror."));
resetState();
state.recommendationSets = [[{ id: "tmdb-movie-2", provider: "tmdb", providerId: "2", title: "Poltergeist", type: "movie", domains: ["movies"], year: "1982", genres: ["27"], about: NORMAL, reason: "Because you liked ghost stories." }]];
check("the recommendation card still shows a normal synopsis", renderRecommendations().includes("tormented by a spirit"));

// ---- tagline step (flagged TMDb items only) ---------------------------------------------------
const env = { TASTEMAKE_TMDB_TOKEN: "tok" };
let calls = 0;
const taglineFetch = (tagline, ok = true) => async (url) => {
  calls += 1;
  check("the tagline lookup asks TMDb for that exact title", String(url).includes("/movie/1?"));
  return { ok, status: ok ? 200 : 500, json: async () => ({ tagline }) };
};
let out = await applyTaglineFallback([flaggedMovie, normalMovie], { env, fetchImpl: taglineFetch("Based on a true story.") });
eq("a flagged item gets TMDb's tagline when it is clean", out[0].about, "Based on a true story.");
eq("a normal item is untouched", out[1].about, NORMAL);
eq("only the flagged item caused a lookup", calls, 1);
out = await applyTaglineFallback([flaggedMovie], { env, fetchImpl: taglineFetch("She was raped by it.") });
eq("a tagline that fails the check is ignored", out[0].about, "Horror / Drama · 1982");
out = await applyTaglineFallback([flaggedMovie], { env, fetchImpl: taglineFetch("", true) });
eq("an empty tagline keeps genre and year", out[0].about, "Horror / Drama · 1982");
out = await applyTaglineFallback([flaggedMovie], { env, fetchImpl: taglineFetch(null, false) });
eq("a failed lookup keeps genre and year", out[0].about, "Horror / Drama · 1982");
out = await applyTaglineFallback([flaggedMovie], { env, fetchImpl: async () => { throw new Error("boom"); } });
eq("a thrown lookup keeps genre and year", out[0].about, "Horror / Drama · 1982");
calls = 0;
await applyTaglineFallback([normalMovie, normalGame], { env, fetchImpl: taglineFetch("x") });
eq("no lookup at all when nothing is flagged", calls, 0);

console.log(`synopsis tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
