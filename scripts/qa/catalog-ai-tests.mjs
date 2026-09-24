#!/usr/bin/env node
// Free, no-network checks for #83-#86: provider normalization, grounded catalog search,
// live hypothesis gating/validation, and append-only model revision history.

import { searchCatalog } from "../../src/catalog/providers.mjs";
import { produceHypotheses, hypothesisConfig } from "../../api/hypotheses.mjs";
import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";
import { recordRevisionIfChanged } from "../../src/model/history.js";
import { favorites } from "../../src/data/catalog.js";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const providerFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("api.themoviedb.org/3/search/movie")) return { ok: true, json: async () => ({ results: [{ id: 10, title: "Movie Result", overview: "Movie about something.", release_date: "2022-01-02", poster_path: "/movie.jpg", genre_ids: [18] }] }) };
  if (u.includes("api.themoviedb.org/3/search/tv")) return { ok: true, json: async () => ({ results: [{ id: 11, name: "Show Result", overview: "Show about something.", first_air_date: "2023-02-03", poster_path: "/show.jpg", genre_ids: [9648] }] }) };
  if (u.includes("openlibrary.org/search.json")) return { ok: true, json: async () => ({ docs: [{ key: "/works/OL123W", title: "Book Result", author_name: ["Author"], first_publish_year: 2020, cover_i: 99, subject: ["Fantasy"] }] }) };
  if (u.includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
  if (u.includes("api.igdb.com/v4/games")) {
    check("IGDB request stays server-side with client-id auth", init.headers?.["client-id"] === "igdb-id" && /Bearer fake-token/.test(init.headers?.authorization || ""));
    return { ok: true, json: async () => [{ id: 12, name: "Game Result", summary: "Game about something.", first_release_date: 1609459200, url: "https://example.invalid/game", cover: { image_id: "abc" }, genres: [{ id: 31, name: "Adventure" }] }] };
  }
  throw new Error(`unexpected provider URL: ${u}`);
};

const env = { TASTEMAKE_TMDB_TOKEN: "tmdb-token", IGDB_CLIENT_ID: "igdb-id", IGDB_CLIENT_SECRET: "igdb-secret" };
const catalog = await searchCatalog("test", { env, fetchImpl: providerFetch });
eq("external catalog returns movie, show, book and game", catalog.items.length, 4);
check("external ids are provider-stable and unique", new Set(catalog.items.map((x) => x.id)).size === 4 && catalog.items.every((x) => /^(tmdb|openlibrary|igdb)-/.test(x.id)));
check("every provider item keeps source provenance", catalog.items.every((x) => x.provider && x.providerId));
check("available artwork is normalized to a URL", catalog.items.every((x) => x.artwork?.startsWith("http")));
eq("domain filtering can request books only", (await searchCatalog("test", { domain: "read", env, fetchImpl: providerFetch })).items.map((x) => x.type).join(), "book");


const relatedState = {
  selectedFavorites: new Set(["tmdb-movie-10"]),
  feedbackByRecommendation: {},
  recommendationSets: [],
  customItems: {
    "tmdb-movie-10": {
      id: "tmdb-movie-10", provider: "tmdb", providerId: "10", title: "Seed Movie",
      type: "movie", domains: ["watch"], genres: ["18"], providerMeta: { genreIds: [18] }
    }
  },
  areas: { watch: true, read: true, play: true }
};
const relatedFetch = async (url) => {
  if (String(url).includes("/movie/10/recommendations")) {
    return { ok: true, json: async () => ({ results: [{ id: 22, title: "Grounded Candidate", overview: "A related film.", release_date: "2024-03-03", poster_path: "/related.jpg", genre_ids: [18] }] }) };
  }
  throw new Error(`unexpected related URL: ${url}`);
};
const related = await retrieveCatalogCandidates(relatedState, { env, fetchImpl: relatedFetch });
eq("grounded retrieval returns a real provider candidate", related[0]?.id, "tmdb-movie-22");
check("grounded retrieval excludes the evidence item itself", !related.some((x) => x.id === "tmdb-movie-10"));

const OFF = hypothesisConfig({});
check("live hypotheses are fail-closed by default", !OFF.enabled && OFF.reasons.includes("hypotheses-off-switch"));

const AI_ENV = {
  TASTEMAKE_AI_ENABLED: "1",
  ANTHROPIC_API_KEY: "fake-key",
  TASTEMAKE_AI_MODEL: "claude-test",
  TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
  TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1",
  TASTEMAKE_AI_HYPOTHESES_ENABLED: "1",
  VERCEL_ENV: "preview"
};
const rawState = {
  selectedFavorites: favorites.slice(0, 4).map((x) => x.id),
  feedbackByRecommendation: {},
  recommendationSets: [],
  libraryFavorites: [],
  customItems: {},
  blindSpots: {},
  blindSpotDismissed: [],
  patternStatements: [],
  areas: { watch: true, read: true, play: true },
  curveball: true,
  modelHypotheses: []
};
const proposal = {
  hypotheses: [{
    id: "ai-mythic-seriousness",
    label: "Mythic material works when it stays serious",
    claim: "Mythic material seems strongest when the treatment stays adult, character-driven, and emotionally serious.",
    evidence: ["ev:circe"],
    counter: [],
    domains: ["read"],
    crossDomain: "untested",
    level: "supported",
    conditional: false,
    context: null
  }],
  insufficientEvidence: false
};
const anthroFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    content: [{ type: "text", text: JSON.stringify(proposal) }],
    usage: { input_tokens: 10, output_tokens: 20 },
    model: "claude-test"
  })
});
const live = await produceHypotheses({ rawState, env: AI_ENV, fetchImpl: anthroFetch });
eq("validated live hypothesis output is accepted", live.source, "model");
eq("Favorite evidence can support a live hypothesis", live.hypotheses[0]?.level, "supported");
check("accepted live hypotheses stay inferred/model authority", live.hypotheses.every((x) => x.authority === "inferred" && x.source === "model"));

const historyState = { hypothesisHistory: [] };
const entry = { hypothesisId: "ai-one", claim: "A specific working claim", supports: ["ev:a"], counters: [], domains: ["watch"], level: "supported", origin: "model", reason: "test" };
recordRevisionIfChanged(historyState, entry);
recordRevisionIfChanged(historyState, { ...entry, reason: "same interpretation, refreshed" });
eq("identical model interpretation does not create duplicate history", historyState.hypothesisHistory.length, 1);
recordRevisionIfChanged(historyState, { ...entry, claim: "A materially revised working claim", reason: "new evidence" });
eq("material model revision is appended", historyState.hypothesisHistory.length, 2);
eq("new revision supersedes the prior revision", historyState.hypothesisHistory[1].supersedes, historyState.hypothesisHistory[0].id);

console.log(`catalog/AI tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
