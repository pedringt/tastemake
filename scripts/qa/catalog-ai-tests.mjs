#!/usr/bin/env node
// Free, no-network checks for #83-#86: provider normalization, grounded catalog search,
// live hypothesis gating/validation, and append-only model revision history.

import { searchCatalog } from "../../src/catalog/providers.mjs";
import hypothesesHandler, { buildHypothesisPrompt, produceHypotheses, hypothesisConfig } from "../../api/hypotheses.mjs";
import { retrieveCatalogCandidates } from "../../src/catalog/related.mjs";
import { recordRevisionIfChanged } from "../../src/model/history.js";
import { serializeAiState } from "../../src/ai/live-client.js";
import { bestExactMatch } from "../../api/resolve-item.mjs";
import { applyResolvedCatalogItem, applySearchAction, makeCustomItem } from "../../src/model/search.js";
import { evidenceRecords } from "../../src/model/evidence.js";

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
check("TMDb requests higher-resolution poster art", catalog.items.find((x) => x.provider === "tmdb")?.artwork?.includes("/w780/"));
check("Open Library requests large covers", catalog.items.find((x) => x.provider === "openlibrary")?.artwork?.includes("-L.jpg"));
check("IGDB requests 2x cover art", catalog.items.find((x) => x.provider === "igdb")?.artwork?.includes("/t_cover_big_2x/"));
check("All interleaves domains so games are present without choosing Play", catalog.items.some((x) => x.type === "game"));
eq("domain filtering can request books only", (await searchCatalog("test", { domain: "read", env, fetchImpl: providerFetch })).items.map((x) => x.type).join(), "book");

// #106: rank exact/canonical matches across provider result types instead of preserving provider bucket order.
const rankingFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("api.themoviedb.org/3/search/movie")) return { ok: true, json: async () => ({ results: [
    { id: 1, title: "El Camino: A Breaking Bad Movie", popularity: 80 },
    { id: 2, title: "Breaking Bad Documentary", popularity: 12 }
  ] }) };
  if (u.includes("api.themoviedb.org/3/search/tv")) return { ok: true, json: async () => ({ results: [
    { id: 3, name: "Breaking Bad", first_air_date: "2008-01-20", popularity: 250 }
  ] }) };
  if (u.includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
  if (u.includes("api.igdb.com/v4/games")) {
    check("IGDB search widens the provider pool before local relevance ranking", /limit 20/.test(init.body || ""));
    return { ok: true, json: async () => [
      { id: 20, name: "Star Control I & II", total_rating_count: 1000, genres: [] },
      { id: 21, name: "Control Resonant", total_rating_count: 500, genres: [] },
      { id: 22, name: "Control", total_rating_count: 4000, first_release_date: 1559347200, genres: [] }
    ] };
  }
  throw new Error(`unexpected ranking URL: ${u}`);
};
const rankedWatch = await searchCatalog("Breaking Bad", { domain: "all", env, fetchImpl: rankingFetch });
eq("exact TV match outranks weaker movie matches", rankedWatch.items[0]?.title, "Breaking Bad");
const rankedPlay = await searchCatalog("Control", { domain: "play", env, fetchImpl: rankingFetch });
eq("exact canonical game outranks partial/edition matches", rankedPlay.items[0]?.title, "Control");


const relatedState = {
  selectedFavorites: new Set(["tmdb-movie-10"]),
  feedbackByRecommendation: {},
  recommendationSets: [],
  customItems: {
    "tmdb-movie-10": {
      id: "tmdb-movie-10", provider: "tmdb", providerId: "10", title: "Seed Movie",
      type: "movie", domains: ["movies"], genres: ["18"], providerMeta: { genreIds: [18] }
    }
  },
  areas: { movies: true, tv: true, read: true, play: true }
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

// #131: Open Library's raw subject arrays include broad/noisy labels. A bestseller tag alone should
// not make a self-help book a meaningful neighbor of an epic-fantasy source.
{
  const fantasyState = {
    selectedFavorites: new Set(["openlibrary-book-OL-WOK"]),
    feedbackByRecommendation: {},
    recommendationSets: [],
    customItems: {
      "openlibrary-book-OL-WOK": {
        id:"openlibrary-book-OL-WOK",provider:"openlibrary",providerId:"OL-WOK",title:"Epic Fantasy Seed",
        type:"book",domains:["read"],genres:["New York Times bestseller","Fantasy","Epic fiction","Magic"]
      }
    },
    areas:{movies:true,tv:true,read:true,play:true},
    recommendationFilter:"read"
  };
  const requestedUrls = [];
  const fantasyFetch = async (url) => {
    requestedUrls.push(String(url));
    return {ok:true,json:async()=>({docs:[
      {key:"/works/OL-ATOMIC",title:"Habit Book",author_name:["Author A"],first_publish_year:2018,subject:["New York Times bestseller","Self-help","Habit"]},
      {key:"/works/OL-GOOD",title:"Good Fantasy Neighbor",author_name:["Author B"],first_publish_year:2019,subject:["Fantasy","Epic fiction","Magic"]}
    ]})};
  };
  const fantasyRelated = await retrieveCatalogCandidates(fantasyState,{env,fetchImpl:fantasyFetch});
  // #131 follow-up: retrieval now queries more than one meaningful subject (top 3), not just the
  // first, so a healthy pool doesn't collapse to an exact-overlap gate on one brittle query.
  check("Open Library related retrieval queries multiple meaningful subjects", ["Fantasy","Epic fiction","Magic"].every((s) => requestedUrls.some((u) => decodeURIComponent(u).includes(`subject:"${s}"`))), requestedUrls.join(" | "));
  check("Open Library related query skips broad bestseller metadata", !requestedUrls.some((u) => decodeURIComponent(u).includes('subject:"New York Times bestseller"')), requestedUrls.join(" | "));
  check("weak one-tag book relation is filtered", !fantasyRelated.some((item)=>item.title==="Habit Book"), fantasyRelated.map((item)=>item.title).join(","));
  check("multi-subject related book remains eligible and marked strong", fantasyRelated.some((item)=>item.title==="Good Fantasy Neighbor" && item.relationStrength==="strong"), fantasyRelated.map((item)=>`${item.title}:${item.relationStrength}`).join(","));
}

// #107: recommendation style must survive serialization and change candidate selection.
eq("recommendation style is serialized for the server", serializeAiState({ selectedFavorites: new Set(), feedbackByRecommendation: {}, recommendationSets: [], libraryFavorites: new Set(), customItems: {}, blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(), patternStatements: [], areas: {}, curveball: true, recommendationStyle: "adventurous" }).recommendationStyle, "adventurous");
const adventurousTitles = [
  "Amber Harbor", "Glass Orchard", "Night Signal", "Paper Kingdom", "Silent Atlas", "Copper Sky",
  "Velvet Transit", "Winter Circuit", "Crimson Static", "Moss Cathedral", "Silver Current", "Ivory Motel"
];
const manyRelatedRows = adventurousTitles.map((title, i) => ({
  id: 100 + i, title, overview: "Related.", release_date: "2024-01-01", genre_ids: [18]
}));
const manyRelatedFetch = async (url) => {
  if (String(url).includes("/movie/10/recommendations")) return { ok: true, json: async () => ({ results: manyRelatedRows }) };
  throw new Error(`unexpected many-related URL: ${url}`);
};
const balancedRelated = await retrieveCatalogCandidates({ ...relatedState, recommendationStyle: "balanced", curveball: true }, { env, fetchImpl: manyRelatedFetch });
const adventurousRelated = await retrieveCatalogCandidates({ ...relatedState, recommendationStyle: "adventurous", curveball: true }, { env, fetchImpl: manyRelatedFetch });
eq("balanced keeps the normal sixth candidate", balancedRelated[5]?.title, "Copper Sky");
eq("adventurous reaches deeper for the exploratory sixth slot", adventurousRelated[5]?.title, "Moss Cathedral");


const mixedState = {
  selectedFavorites: new Set(["tmdb-movie-10", "openlibrary-book-OL123W", "igdb-game-12"]),
  feedbackByRecommendation: {},
  recommendationSets: [],
  customItems: {
    "tmdb-movie-10": relatedState.customItems["tmdb-movie-10"],
    "openlibrary-book-OL123W": {
      id: "openlibrary-book-OL123W", provider: "openlibrary", providerId: "OL123W", title: "Seed Book",
      type: "book", domains: ["read"], genres: ["Fantasy"]
    },
    "igdb-game-12": {
      id: "igdb-game-12", provider: "igdb", providerId: "12", title: "Seed Game",
      type: "game", domains: ["play"], providerMeta: { genreIds: [31] }
    }
  },
  areas: { movies: true, tv: true, read: true, play: true },
  recommendationFilter: "all"
};
const mixedFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/movie/10/recommendations")) return { ok: true, json: async () => ({ results: [{ id: 31, title: "Related Movie", overview: "Movie.", release_date: "2024-01-01", genre_ids: [18] }] }) };
  if (u.includes("openlibrary.org/search.json")) return { ok: true, json: async () => ({ docs: [{ key: "/works/OL999W", title: "Related Book", author_name: ["Author"], first_publish_year: 2021, subject: ["Fantasy"] }] }) };
  if (u.includes("id.twitch.tv/oauth2/token")) return { ok: true, json: async () => ({ access_token: "fake-token" }) };
  if (u.includes("api.igdb.com/v4/games")) return { ok: true, json: async () => [{ id: 32, name: "Related Game", summary: "Game.", first_release_date: 1640995200, genres: [{ id: 31, name: "Adventure" }] }] };
  throw new Error(`unexpected mixed URL: ${u}`);
};
const mixed = await retrieveCatalogCandidates(mixedState, { env, fetchImpl: mixedFetch });
check("All recommendation retrieval represents available domains", ["movies", "read", "play"].every((domain) => mixed.slice(0, 3).some((item) => item.domains?.includes(domain))), mixed.map((x) => x.domains?.[0]).join(","));
const readOnly = await retrieveCatalogCandidates({ ...mixedState, recommendationFilter: "read" }, { env, fetchImpl: mixedFetch });
check("category recommendation retrieval returns only that domain", readOnly.length > 0 && readOnly.every((item) => item.domains?.includes("read")), readOnly.map((x) => x.domains?.[0]).join(","));

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
const profileFavorite = {
  id: "openlibrary-book-OL123W", provider: "openlibrary", providerId: "OL123W",
  title: "Favorite Book", type: "book", domains: ["read"], about: "A real catalog favorite."
};
const rawState = {
  selectedFavorites: [profileFavorite.id],
  feedbackByRecommendation: {},
  recommendationSets: [],
  libraryFavorites: [],
  customItems: { [profileFavorite.id]: profileFavorite },
  blindSpots: {},
  blindSpotDismissed: [],
  patternStatements: [],
  areas: { movies: true, tv: true, read: true, play: true },
  curveball: true,
  modelHypotheses: []
};
const proposal = {
  hypotheses: [{
    id: "ai-mythic-seriousness",
    label: "Mythic material works when it stays serious",
    claim: "Mythic material seems strongest when the treatment stays adult, character-driven, and emotionally serious.",
    evidence: ["ev:openlibrary-book-OL123W"],
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
const promptContract = buildHypothesisPrompt({
  evidence: [{ ref:"ev:x", title:"X", type:"movie", domains:["movies"], kind:"experienced-positive", polarity:1, weight:1.25, facts:{resolved:true,year:2020,creator:null,genres:["Drama"]} }],
  statements: [],
  contexts: []
}, []);
check("Taste Profile prompt names the exact allowed domain ids", promptContract.includes("movies, tv, read, play"));
check("Taste Profile prompt explicitly forbids the production 'watch' alias", promptContract.includes('Never use umbrella labels such as "watch"'));
check("Taste Profile prompt explicitly forbids the production 'established' level", promptContract.includes("Never use established"));
check("Taste Profile prompt refuses to invent facts for unresolved manual evidence", promptContract.includes("facts.resolved is false"));

// Manual-item resolution stays conservative: exact title/type only, with optional creator to break ties.
{
  const matches = [
    { id:"openlibrary-book-1", provider:"openlibrary", providerId:"1", title:"Same Title", type:"book", by:"Author One", domains:["read"], genres:["Fantasy"] },
    { id:"openlibrary-book-2", provider:"openlibrary", providerId:"2", title:"Same Title", type:"book", by:"Author Two", domains:["read"], genres:["Mystery"] },
    { id:"openlibrary-book-3", provider:"openlibrary", providerId:"3", title:"Same Title", type:"book", by:null, domains:["read"], genres:["History"] }
  ];
  eq("manual resolution refuses an ambiguous exact-title match", bestExactMatch(matches, "Same Title", "book").status, "ambiguous");
  eq("manual resolution uses creator to disambiguate", bestExactMatch(matches, "Same Title", "book", "Author Two").item?.providerId, "2");
  eq("missing provider creator never counts as a creator match", bestExactMatch(matches, "Same Title", "book", "No Such Author").status, "ambiguous");
  eq("manual resolution never crosses media types", bestExactMatch(matches, "Same Title", "movie", "Author Two").status, "not_found");
}

// A resolved manual item keeps the user's stable evidence id while gaining provider facts that both
// deterministic retrieval and Taste Profile inference can use.
{
  const manual = makeCustomItem("Obscure Book", "book", "A. Writer");
  const state = {
    selectedFavorites:new Set(), feedbackByRecommendation:{}, recommendationSets:[],
    libraryFavorites:new Set(), customItems:{}, areas:{movies:true,tv:true,read:true,play:true}
  };
  applySearchAction(state, manual, "loved");
  const merged = applyResolvedCatalogItem(state, manual.id, {
    id:"openlibrary-book-OLX", provider:"openlibrary", providerId:"OLX", title:"Obscure Book",
    type:"book", domains:["read"], by:"A. Writer", year:"2019", genres:["Speculative fiction"]
  });
  eq("resolved manual evidence keeps its original stable item id", merged?.id, manual.id);
  eq("resolved manual evidence gains a provider id", state.feedbackByRecommendation[manual.id]?.item?.providerId, "OLX");
  const record = evidenceRecords(state).find((row) => row.itemId === manual.id);
  check("resolved manual evidence exposes structured facts to Taste Profile", record?.facts?.resolved === true && record?.facts?.genres?.includes("Speculative fiction"));
}

const live = await produceHypotheses({ rawState, env: AI_ENV, fetchImpl: anthroFetch });
eq("validated live hypothesis output is accepted", live.source, "model");
eq("Favorite evidence can support a live hypothesis", live.hypotheses[0]?.level, "supported");
check("accepted live hypotheses stay inferred/model authority", live.hypotheses.every((x) => x.authority === "inferred" && x.source === "model"));

const historyState = { hypothesisHistory: [] };
const entry = { hypothesisId: "ai-one", claim: "A specific working claim", supports: ["ev:a"], counters: [], domains: ["movies"], level: "supported", origin: "model", reason: "test" };
recordRevisionIfChanged(historyState, entry);
recordRevisionIfChanged(historyState, { ...entry, reason: "same interpretation, refreshed" });
eq("identical model interpretation does not create duplicate history", historyState.hypothesisHistory.length, 1);
recordRevisionIfChanged(historyState, { ...entry, claim: "A materially revised working claim", reason: "new evidence" });
eq("material model revision is appended", historyState.hypothesisHistory.length, 2);
eq("new revision supersedes the prior revision", historyState.hypothesisHistory[1].supersedes, historyState.hypothesisHistory[0].id);

// QA sweep real bug: this endpoint used to measure body size only after fully parsing it into
// memory, unlike api/recommendations.mjs's pre-parse content-length check (hardened after a real
// production 413 incident). An oversized request should be rejected before it's buffered/parsed.
{
  const res = () => { const r = { code: null, body: null, headers: {} }; r.status = (code) => { r.code = code; return r; }; r.json = (body) => { r.body = body; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const rr = res();
  await hypothesesHandler({ method: "POST", headers: { "content-length": "999999" }, body: {} }, rr);
  eq("oversized body is refused by content-length before parsing", rr.code, 413);
}

console.log(`catalog/AI tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
