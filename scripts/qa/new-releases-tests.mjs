#!/usr/bin/env node
// #6: "New this week for you". Release lists are stubbed (no network); matching is the product's own.
// Free, no model call.
//
//   node scripts/qa/new-releases-tests.mjs

import { bestAnchor, newReleasesFor, releaseWindow } from "../../src/catalog/new-releases.mjs";
import { actOnNewRelease, releaseLabel } from "../../src/ai/new-releases.js";
import { evidenceRecords } from "../../src/model/evidence.js";
import { emptyState, react } from "../evals/fixtures.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("new releases tests");

const now = new Date("2026-10-23T15:00:00Z");
const env = { TASTEMAKE_TMDB_TOKEN: "t", IGDB_CLIENT_ID: "id", IGDB_CLIENT_SECRET: "secret" };
const movie = (id, title, genres) => ({ id: `tmdb-movie-${id}`, provider: "tmdb", providerId: String(id), type: "movie", domains: ["movies"], title, genres: genres.map(String) });
const game = (id, title, genres) => ({ id: `igdb-game-${id}`, provider: "igdb", providerId: String(id), type: "game", domains: ["play"], title, genres });

eq("the window is the last 7 and next 7 days", JSON.stringify(releaseWindow(now)), JSON.stringify({ from: "2026-10-16", to: "2026-10-30" }));

function harness({ failTv = false } = {}) {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    asked.push({ url: u, body: init.body ?? "" });
    if (u.includes("id.twitch.tv")) return { ok: true, json: async () => ({ access_token: "tok" }) };
    if (u.includes("/discover/movie")) return { ok: true, json: async () => ({ results: [
      { id: 901, title: "Signal From Vega", genre_ids: [878, 18], release_date: "2026-10-24", overview: "Astronomers hear something.", popularity: 80 },
      { id: 902, title: "Loud Comedy Thing", genre_ids: [35], release_date: "2026-10-20", overview: "Jokes.", popularity: 300 },
      { id: 903, title: "Already Rated", genre_ids: [878], release_date: "2026-10-18", overview: "Seen it.", popularity: 50 },
      { id: 904, title: "Quiet Orbit", genre_ids: [878], release_date: "2026-10-19", overview: "A lonely station.", popularity: 20 },
      { id: 905, title: "Third Sci-fi", genre_ids: [878], release_date: "2026-10-21", overview: "More space.", popularity: 10 }
    ] }) };
    if (u.includes("/discover/tv")) return failTv ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => ({ results: [
      { id: 801, name: "Mystery Office", genre_ids: [9648, 18], first_air_date: "2026-10-22", overview: "Coworkers and secrets.", popularity: 40 }
    ] }) };
    if (u.includes("api.igdb.com")) return { ok: true, json: async () => ([
      { id: 701, name: "Tiny Planets", summary: "Explore small worlds.", first_release_date: Date.parse("2026-10-27T00:00:00Z") / 1000, genres: [{ id: 9, name: "Puzzle" }, { id: 31, name: "Adventure" }], hypes: 40 }
    ]) };
    throw new Error(`unexpected ${u}`);
  };
  return { asked, fetchImpl };
}

function lovedState() {
  const s = emptyState([]);
  s.recommendationSets = [];
  react(s, movie(329865, "Arrival", [878, 18, 9648]), "loved");
  react(s, { id: "tmdb-tv-95396", provider: "tmdb", providerId: "95396", type: "tv", domains: ["tv"], title: "Severance", genres: ["18", "9648"] }, "loved");
  react(s, game(11737, "Outer Wilds", ["Puzzle", "Adventure"]), "loved");
  react(s, movie(903, "Already Rated", [878]), "liked");
  s.feedbackByRecommendation["tmdb-movie-777"] = { item: movie(777, "A Saved One", [878]), rating: "not-tried", detail: "bookmarked" };
  return s;
}

{
  const { asked, fetchImpl } = harness();
  const out = await newReleasesFor(lovedState(), { env, fetchImpl, region: "GB", now });
  const titles = out.items.map((i) => i.title);
  check("a release must share a genre with something loved in the same area", !titles.includes("Loud Comedy Thing"), titles.join(", "));
  check("things already rated never come back", !titles.includes("Already Rated"));
  check("movies, TV and games are interleaved, two per area at most", titles.join("|") === "Signal From Vega|Mystery Office|Tiny Planets|Quiet Orbit", titles.join("|"));
  check("each one says what it shares with which favorite", out.items[0].reason.includes("Arrival") && out.items[1].reason.includes("Severance") && out.items[2].reason.includes("Outer Wilds"), out.items.map((i) => i.reason).join(" / "));
  check("each carries its release date", out.items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.releaseDate)));
  const movieUrl = asked.find((a) => a.url.includes("/discover/movie"))?.url ?? "";
  check("movies use the viewer's country and the window", movieUrl.includes("region=GB") && movieUrl.includes("primary_release_date.gte=2026-10-16") && movieUrl.includes("primary_release_date.lte=2026-10-30"), movieUrl);
  check("TV asks for new series in the window", asked.some((a) => a.url.includes("/discover/tv") && a.url.includes("first_air_date.gte=2026-10-16")));
  const igdb = asked.find((a) => a.url.includes("api.igdb.com"))?.body ?? "";
  check("games ask IGDB for the window by release date", igdb.includes(`first_release_date >= ${Date.parse("2026-10-16T00:00:00Z") / 1000}`) && igdb.includes("themes.name"), igdb);
  check("search-only fields don't leak", out.items.every((i) => !("popularity" in i) && !("_searchPopularity" in i)));
}

{
  const s = lovedState();
  s.areas.play = false;
  const { asked, fetchImpl } = harness({ failTv: true });
  const out = await newReleasesFor(s, { env, fetchImpl, now });
  check("an area that's off is never asked", !asked.some((a) => a.url.includes("api.igdb.com")));
  check("one source failing doesn't empty the others", out.items.length === 2 && out.items.every((i) => i.type === "movie"), out.items.map((i) => i.title).join(", "));
}

{
  const { asked, fetchImpl } = harness();
  const s = emptyState([]);
  s.recommendationSets = [];
  s.feedbackByRecommendation["tmdb-movie-5"] = { item: movie(5, "Only Saved", [878]), rating: "not-tried", detail: "bookmarked" };
  const out = await newReleasesFor(s, { env, fetchImpl, now });
  check("no experienced taste in an area, no request and no picks there", out.items.length === 0 && asked.length === 0);
}

eq("bestAnchor prefers more shared genres", bestAnchor(movie(1, "X", [878, 9648]), [{ item: movie(2, "Two", [878]), weight: 1 }, { item: movie(3, "Three", [878, 9648]), weight: 1 }])?.item.title, "Three");
eq("bestAnchor needs at least one shared genre", bestAnchor(movie(1, "X", [35]), [{ item: movie(2, "Two", [878]), weight: 1 }]), null);

// ---- client --------------------------------------------------------------------------------------------
eq("released already", releaseLabel("2026-10-18", now), "Out now · Oct 18");
eq("coming up", releaseLabel("2026-10-27", now), "Out Oct 27");
eq("bad date, no label", releaseLabel("soon", now), "");
{
  const s = emptyState([]);
  s.recommendationSets = [];
  const release = { ...movie(901, "Signal From Vega", [878]), releaseDate: "2026-10-24", reason: "Shares sci-fi with Arrival." };
  s.newReleases = { status: "ready", items: [release, { ...movie(904, "Quiet Orbit", [878]), releaseDate: "2026-10-19" }] };
  const tasteBefore = evidenceRecords(s).filter((r) => r.countsAsTaste).length;
  const said = actOnNewRelease(s, release.id, "bookmark");
  check("Save puts it in Saved", s.feedbackByRecommendation[release.id]?.detail === "bookmarked" && /saved for later/.test(said ?? ""), said);
  check("and takes it off the strip", s.newReleases.items.length === 1 && s.newReleases.items[0].id !== release.id);
  eq("saving is not taste", evidenceRecords(s).filter((r) => r.countsAsTaste).length, tasteBefore);
  check("Not interested works the same way", /Not interested/.test(actOnNewRelease(s, "tmdb-movie-904", "not-interested") ?? "") && s.newReleases.items.length === 0);
  eq("anything else is ignored", actOnNewRelease(s, "tmdb-movie-904", "loved"), null);
}

finish();
