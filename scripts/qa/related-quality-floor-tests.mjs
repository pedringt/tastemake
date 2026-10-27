#!/usr/bin/env node
// Oct 27: the quality floor on TMDb "related" rows (src/catalog/related.mjs). Provider and database calls
// are stubbed (no network); no model call.
//
//   node scripts/qa/related-quality-floor-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("related quality floor tests");
const { retrieveCatalogCandidates, similarToItem } = await import("../../src/catalog/related.mjs");
const { produceRecommendations } = await import("../../api/recommendations.mjs");

const env = { TASTEMAKE_TMDB_TOKEN: "t" };
const eeaao = { id: "tmdb-movie-545611", provider: "tmdb", providerId: "545611", type: "movie", title: "Everything Everywhere All at Once", domains: ["movies"], genres: ["28", "12", "878"] };
const row = (id, title, voteAverage, voteCount) => ({ id, title, genre_ids: [28, 878], release_date: "2020-01-01", overview: `${title} overview.`, vote_average: voteAverage, vote_count: voteCount });
const fetchFor = (rows) => async (url) => {
  if (String(url).includes("/movie/545611/recommendations")) return { ok: true, json: async () => ({ results: rows }) };
  throw new Error(`unexpected ${url}`);
};
const hasVotes = (item) => "_voteAverage" in item || "_voteCount" in item;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const mixed = [
  row(2001, "Afterburn", 4.9, 900),
  row(2002, "Tiny Festival Film", 5.2, 12),
  row(2003, "Spider-Man: Into the Spider-Verse", 7.4, 3000),
  row(2004, "The Matrix", 8.2, 26000),
  row(2005, "Swiss Army Man", 6.8, 2600),
  row(2006, "Sorry to Bother You", 6.9, 1800),
  row(2007, "Paprika", 7.8, 2400),
  row(2008, "Rebel Moon - Part One", 5.5, 2900)
];

// ---- the floor ----------------------------------------------------------------------------------------
{
  const titles = (await similarToItem(eeaao, { env, fetchImpl: fetchFor(mixed) })).map((i) => i.title);
  check("a 4.9 average with 900 votes is dropped", !titles.includes("Afterburn"), titles.join(", "));
  check("a 5.5 average with 2900 votes is dropped", !titles.includes("Rebel Moon - Part One"), titles.join(", "));
  check("a 5.2 average with 12 votes is kept (too few votes to judge)", titles.includes("Tiny Festival Film"), titles.join(", "));
  check("a 7.4 average with 3000 votes is kept", titles.includes("Spider-Man: Into the Spider-Verse"), titles.join(", "));
  eq("the rest keep TMDb's order", titles.join(" | "), "Tiny Festival Film | Spider-Man: Into the Spider-Verse | The Matrix | Swiss Army Man | Sorry to Bother You | Paprika");
}

// ---- backfill: a niche anchor never goes empty --------------------------------------------------------
{
  const thin = [
    row(3001, "Low One", 4.1, 500),
    row(3002, "Good One", 7.0, 800),
    row(3003, "Low Two", 5.0, 300),
    row(3004, "Low Three", 5.6, 120),
    row(3005, "Good Two", 6.5, 40),
    row(3006, "Low Four", 3.9, 70),
    row(3007, "Low Five", 5.7, 90)
  ];
  const titles = (await similarToItem(eeaao, { env, fetchImpl: fetchFor(thin) })).map((i) => i.title);
  eq("fewer than 6 left: dropped rows backfill to 6, in TMDb's order, after the kept ones", titles.join(" | "), "Good One | Good Two | Low One | Low Two | Low Three | Low Four");
  const few = (await similarToItem(eeaao, { env, fetchImpl: fetchFor([row(3101, "Only Low", 4.0, 400), row(3102, "Only Good", 7.0, 400)]) })).map((i) => i.title);
  eq("a tiny result list keeps every row", few.join(" | "), "Only Good | Only Low");
}

// ---- the vote fields stay on the server ---------------------------------------------------------------
{
  const similar = await similarToItem(eeaao, { env, fetchImpl: fetchFor(mixed) });
  check("See similar results carry no vote fields", similar.length > 0 && !similar.some(hasVotes));

  const calls = [];
  const query = async (text, params) => { calls.push({ text, params }); return []; };
  const state = {
    selectedFavorites: [eeaao.id],
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: { [eeaao.id]: eeaao },
    areas: { movies: true, tv: true, read: true, play: true },
    recommendationFilter: "movies"
  };
  const candidates = await retrieveCatalogCandidates(state, { env, fetchImpl: fetchFor(mixed), query });
  await settle();
  check("recommendation candidates carry no vote fields", candidates.length > 0 && !candidates.some(hasVotes));
  check("low-rated rows never become candidates", !candidates.some((i) => ["Afterburn", "Rebel Moon - Part One"].includes(i.title)), candidates.map((i) => i.title).join(", "));
  const writes = calls.filter((c) => /insert into items|update items/.test(c.text));
  check("related rows are written to the canonical store", writes.length > 0);
  check("...and no write carries vote data", !JSON.stringify(writes.map((c) => c.params)).match(/vote/i));

  // What the client receives: the fallback picks from /api/recommendations (live AI is off in this env).
  const rawState = JSON.parse(JSON.stringify({ ...state, selectedFavorites: [eeaao.id], blindSpots: {}, patternStatements: [], curveball: true }));
  const out = await produceRecommendations({ rawState, env, fetchImpl: fetchFor(mixed) });
  check("the response has picks", out.picks.length > 0, out.reason);
  check("client-facing picks carry no vote fields", !out.picks.some(hasVotes));
  check("...and no pick is a low-rated row", !out.picks.some((p) => ["Afterburn", "Rebel Moon - Part One"].includes(p.title)), out.picks.map((p) => p.title).join(", "));
  check("the serialized response never mentions the vote fields", !/_vote/.test(JSON.stringify(out)));
}

// ---- the eval fixture (scripts/evals/quality-floor-profiles.json) still reads as four real profiles ----
{
  const { readFileSync } = await import("node:fs");
  const { hydrateState } = await import("../../src/server/request-state.mjs");
  const { buildContext } = await import("../../src/ai/context.js");
  const { profiles } = JSON.parse(readFileSync(new URL("../evals/quality-floor-profiles.json", import.meta.url)));
  eq("four eval profiles", profiles.length, 4);
  for (const profile of profiles) {
    const taste = buildContext(hydrateState(profile.state), []).evidence.filter((r) => r.countsAsTaste && r.polarity > 0);
    check(`${profile.id}: 4 favorites and 2 ratings count as taste`, taste.length === 6, String(taste.length));
  }
}

finish();
