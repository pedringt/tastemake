// #382: background appeal profiles (src/ai/appeal-profile.mjs, src/server/appeal-store.mjs). The prompt is
// the research version byte for byte; the output check; the switch and every gate; caps; and the
// recommendations payload is the same with the switch on or off. Free: no network, no model, no database
// (fake fetch and fake query throughout).
import { createSuite } from "./lib/assert.mjs";
import {
  APPEAL_PROMPT_VERSION, PROFILE_SCHEMA, buildAppealPrompt, canProfile, validateAppealProfile
} from "../../src/ai/appeal-profile.mjs";
import { countRecentCalls, getCachedIds, queueAppealProfiles, saveProfile } from "../../src/server/appeal-store.mjs";
import { KNOWN_OPERATIONS, aggregateAiMetrics } from "../../src/server/ai-metrics.mjs";
import { produceRecommendations } from "../../api/recommendations.mjs";
import { serializeAiState } from "../../src/ai/live-client.js";

const { check, eq, finish } = createSuite("appeal-profile");

const quietly = async (fn) => {
  const { info, warn, error } = console;
  console.info = console.warn = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { info, warn, error }); }
};

// ---- the prompt is the research prompt -------------------------------------------------------------------
const RESEARCH_INSTRUCTIONS = "You write appeal profiles for a recommendation system. Describe what experiencing this title is actually like and why people enjoy it, in short specific phrases (at most 8 words each, at most 5 per list; summary at most 35 words): tone and mood, the main pleasures it offers, setting, format and structure, who tends to love it, and who tends not to. Be concrete and distinguishing: say what sets it apart from other titles in its genre, not what every title in the genre has. Use the information given and your own knowledge of the title; if you don't recognize the title, rely only on the given information and set confidence to low. Never invent plot facts.";

const film = {
  id: "tmdb-movie-609681", provider: "tmdb", providerId: "609681", title: "The Marvels", type: "movie", domains: ["movies"],
  by: null, year: "2023", genres: ["878", "12", "28"],
  about: "When her duties send her to an anomalous wormhole linked to a Kree revolutionary, Carol's powers become entangled with that of Jersey City super-fan Kamala Khan."
};
const book = {
  id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", title: "Piranesi", type: "book", domains: ["read"],
  by: "Susanna Clarke", year: "2020", about: "First published 2020.",
  genres: ["Fiction", "Fantasy fiction", "Labyrinths", "fiction", "Magic", "Memory", "Identity", "Statues", "Tides", "Diaries", "Prisoners", "Isolation", "Birds"]
};

eq("film prompt is the research prompt, byte for byte", buildAppealPrompt(film),
  `${RESEARCH_INSTRUCTIONS}\n\nCONTEXT\n{"title":"The Marvels","medium":"film","year":"2023","creator":null,"genres":["878","12","28"],"description":"Synopsis: When her duties send her to an anomalous wormhole linked to a Kree revolutionary, Carol's powers become entangled with that of Jersey City super-fan Kamala Khan."}`);
eq("book prompt is the research prompt, byte for byte", buildAppealPrompt(book),
  `${RESEARCH_INSTRUCTIONS}\n\nCONTEXT\n{"title":"Piranesi","medium":"book","year":"2020","creator":"Susanna Clarke","genres":[],"description":"Subjects: Fantasy fiction; Labyrinths; Magic; Memory; Identity; Statues; Tides; Diaries; Prisoners; Isolation"}`);
eq("TV is a 'TV series'", JSON.parse(buildAppealPrompt({ ...film, type: "tv", domains: ["tv"] }).split("\nCONTEXT\n")[1]).medium, "TV series");
eq("a game is a 'video game'", JSON.parse(buildAppealPrompt({ ...film, type: "game", domains: ["play"] }).split("\nCONTEXT\n")[1]).medium, "video game");
check("a flagged synopsis is replaced before it reaches the prompt", !buildAppealPrompt({ ...film, about: "A story of incest and revenge." }).includes("incest"));
eq("the schema is the research schema", JSON.stringify(PROFILE_SCHEMA),
  '{"type":"object","properties":{"summary":{"type":"string"},"tone":{"type":"array","items":{"type":"string"}},"pleasures":{"type":"array","items":{"type":"string"}},"setting":{"type":"array","items":{"type":"string"}},"format":{"type":"array","items":{"type":"string"}},"audience":{"type":"string"},"notFor":{"type":"string"},"confidence":{"type":"string","enum":["high","medium","low"]}},"required":["summary","tone","pleasures","setting","format","audience","notFor","confidence"],"additionalProperties":false}');
eq("prompt version", APPEAL_PROMPT_VERSION, "ap-v1-2026-11-04");

check("a catalog film with a synopsis can be profiled", canProfile(film));
check("a catalog book can be profiled without a synopsis", canProfile({ ...book, about: undefined }));
check("a film without a synopsis is not (the research input always had one)", !canProfile({ ...film, about: undefined }));
check("an item the person added by hand is not", !canProfile({ ...film, custom: true }));
check("an item without a provider identity is not", !canProfile({ ...film, provider: null }));

// ---- the output check ---------------------------------------------------------------------------------------
const good = {
  summary: "  A breezy cosmic team-up with three heroines.  ",
  tone: ["playful and breezy", "upbeat"],
  pleasures: ["bickering chemistry", "colourful cosmic action"],
  setting: ["space and alien worlds"],
  format: ["brisk superhero film"],
  audience: "MCU fans who like light, female-led space action.",
  notFor: "Viewers wanting grounded drama.",
  confidence: "high"
};
const cleaned = validateAppealProfile({ ...good, extra: "dropped" });
check("a good profile passes", cleaned !== null);
eq("…trimmed", cleaned?.summary, "A breezy cosmic team-up with three heroines.");
check("…with only the schema's fields", cleaned && !("extra" in cleaned) && Object.keys(cleaned).length === 8);
const bad = {
  "not an object": null,
  "an array": [good],
  "missing summary": { ...good, summary: undefined },
  "missing notFor": { ...good, notFor: undefined },
  "tone not a list": { ...good, tone: "playful" },
  "empty list": { ...good, setting: [] },
  "six in a list": { ...good, pleasures: ["a", "b", "c", "d", "e", "f"] },
  "list entry not a string": { ...good, format: [3] },
  "blank list entry": { ...good, tone: ["  "] },
  "list entry over 80 characters": { ...good, tone: ["x".repeat(81)] },
  "summary over 400 characters": { ...good, summary: "x".repeat(401) },
  "blank summary": { ...good, summary: "   " },
  "audience over 200 characters": { ...good, audience: "x".repeat(201) },
  "notFor over 200 characters": { ...good, notFor: "x".repeat(201) },
  "a link": { ...good, summary: "See https://example.com for more." },
  "a www link": { ...good, pleasures: ["visit www.example.com"] },
  "markup": { ...good, audience: "Fans of <b>action</b>." },
  "a brace": { ...good, notFor: "Anyone who wants {instructions}." },
  "unknown confidence": { ...good, confidence: "certain" },
  "missing confidence": { ...good, confidence: undefined }
};
for (const [name, value] of Object.entries(bad)) eq(`rejected: ${name}`, validateAppealProfile(value), null);

// ---- fakes --------------------------------------------------------------------------------------------------
const AI_ENV = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", VERCEL_ENV: "preview" };
const ON = { ...AI_ENV, TASTEMAKE_APPEAL_PROFILES: "1" };

function fakeDb({ cached = [], recentCalls = 0, failCount = false } = {}) {
  const db = { statements: [], profiles: new Map(cached.map((id) => [id, { profile: {}, prompt_version: "old", model: "old" }])), metrics: [], recentCalls };
  db.query = async (text, params = []) => {
    db.statements.push(text);
    if (/create table if not exists appeal_profiles/i.test(text)) return [];
    if (/select item_id from appeal_profiles/i.test(text)) return params[0].filter((id) => db.profiles.has(id)).map((item_id) => ({ item_id }));
    if (/insert into appeal_profiles/i.test(text)) { db.profiles.set(params[0], { profile: JSON.parse(params[1]), prompt_version: params[2], model: params[3] }); return []; }
    if (/from ai_call_metrics/i.test(text) && /appeal_profile/.test(text)) {
      if (failCount) throw new Error("relation does not exist");
      return [{ count: db.recentCalls + db.metrics.length }];
    }
    if (/insert into ai_call_metrics/i.test(text)) { db.metrics.push({ operation: params[0], outcome: params[1], model: params[2] }); return []; }
    if (/ai_call_metrics/i.test(text)) return [];   // its own schema setup
    throw new Error(`unexpected query: ${text}`);
  };
  return db;
}

const isAppealCall = (body) => String(body?.system?.[0]?.text ?? "").startsWith("You write appeal profiles");

function fakeAnthropic({ answer = () => good, fail = null, onPick = null } = {}) {
  const calls = { appeal: [], other: [], inFlight: 0, maxInFlight: 0 };
  calls.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!isAppealCall(body)) {
      calls.other.push(body);
      if (!onPick) throw new Error("no network");
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(onPick(body)) }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-test" }) };
    }
    calls.appeal.push(body);
    calls.inFlight += 1;
    calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    calls.inFlight -= 1;
    if (fail) return fail(calls.appeal.length);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer(calls.appeal.length)) }], usage: { input_tokens: 400, output_tokens: 150 }, model: "claude-haiku-5-5" }) };
  };
  return calls;
}

const films = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ ...film, id: `tmdb-movie-${from + i}`, providerId: String(from + i), title: `Film ${from + i}` }));

// ---- gates: switch off, live AI off, no database ------------------------------------------------------------
{
  const db = fakeDb();
  const api = fakeAnthropic();
  eq("switch off: nothing queued", queueAppealProfiles(films(3), { env: AI_ENV, fetchImpl: api.fetch, query: db.query }), null);
  eq("switch off: switch set to something other than 1", queueAppealProfiles(films(3), { env: { ...AI_ENV, TASTEMAKE_APPEAL_PROFILES: "true" }, fetchImpl: api.fetch, query: db.query }), null);
  eq("live AI off: nothing queued", queueAppealProfiles(films(3), { env: { ...ON, TASTEMAKE_AI_ENABLED: "0" }, fetchImpl: api.fetch, query: db.query }), null);
  eq("production without its approval: nothing queued", queueAppealProfiles(films(3), { env: { ...ON, VERCEL_ENV: "production" }, fetchImpl: api.fetch, query: db.query }), null);
  eq("no database: nothing queued", queueAppealProfiles(films(3), { env: ON, fetchImpl: api.fetch }), null);
  eq("nothing it can describe: nothing queued", queueAppealProfiles([{ ...film, custom: true }], { env: ON, fetchImpl: api.fetch, query: db.query }), null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  eq("gates: zero model calls", api.appeal.length + api.other.length, 0);
  eq("gates: zero queries", db.statements.length, 0);
  eq("store without a database: no cached ids", (await getCachedIds(["a"], { env: {} })).size, 0);
  eq("store without a database: nothing saved", await saveProfile("a", good, { model: "m", env: {} }), false);
  eq("store without a database: no count", await countRecentCalls({ env: {} }), null);
}

// ---- switch on ----------------------------------------------------------------------------------------------
{
  const db = fakeDb({ cached: ["tmdb-movie-1"] });
  const api = fakeAnthropic();
  const items = [...films(6), films(1)[0], { ...film, custom: true, id: "custom-1" }];
  const result = queueAppealProfiles(items, { env: ON, fetchImpl: api.fetch, query: db.query });
  check("switch on: returns the background task at once", typeof result?.then === "function" && api.appeal.length === 0);
  const counts = await quietly(() => result);
  eq("cached title skipped; at most 4 calls by default", api.appeal.length, 4);
  check("…the cached one is never asked for", !api.appeal.some((body) => JSON.stringify(body).includes('"title\\":\\"Film 1\\"')));
  eq("…in priority order", api.appeal.map((body) => JSON.parse(body.messages[0].content.replace(/^CONTEXT\n/, "")).title).join(","), "Film 2,Film 3,Film 4,Film 5");
  eq("…one at a time", api.maxInFlight, 1);
  eq("four profiles saved", db.profiles.size, 5);
  const row = db.profiles.get("tmdb-movie-2");
  eq("saved row has the prompt version", row?.prompt_version, APPEAL_PROMPT_VERSION);
  eq("saved row has the model", row?.model, "claude-haiku-5-5");
  eq("saved profile is the cleaned one", row?.profile?.summary, "A breezy cosmic team-up with three heroines.");
  eq("each call is recorded as appeal_profile success", db.metrics.map((m) => `${m.operation}:${m.outcome}`).join(","), Array(4).fill("appeal_profile:success").join(","));
  eq("counts", JSON.stringify(counts), JSON.stringify({ offered: 6, cached: 1, attempted: 4, saved: 4, invalid: 0, failed: 0, capped: 0, paused: false }));
  check("the table is created on first use", db.statements.some((t) => /create table if not exists appeal_profiles/i.test(t)));

  const body = api.appeal[0];
  eq("call: model defaults to Haiku 5.5", body.model, "claude-haiku-5-5");
  eq("call: max tokens 900", body.max_tokens, 900);
  eq("call: effort low", body.output_config?.effort, "low");
  eq("call: structured output with the profile schema", JSON.stringify(body.output_config?.format?.schema), JSON.stringify(PROFILE_SCHEMA));
  eq("call: no thinking on Haiku", body.thinking?.type, "disabled");
  eq("call: the system text is the instructions alone", body.system[0].text, RESEARCH_INSTRUCTIONS);
}
{
  const db = fakeDb();
  const api = fakeAnthropic();
  await quietly(() => queueAppealProfiles(films(6), { env: { ...ON, TASTEMAKE_APPEAL_MAX_PER_REQUEST: "2", TASTEMAKE_APPEAL_MODEL: "claude-haiku-5-5-test" }, fetchImpl: api.fetch, query: db.query }));
  eq("TASTEMAKE_APPEAL_MAX_PER_REQUEST=2: two calls", api.appeal.length, 2);
  eq("TASTEMAKE_APPEAL_MODEL is used", api.appeal[0].model, "claude-haiku-5-5-test");
}
for (const [label, recentCalls, cap, want] of [["148 of 150 used today", 148, undefined, 2], ["150 of 150 used today", 150, undefined, 0], ["cap 10, 3 used", 3, "10", 4], ["cap 0", 0, "0", 0]]) {
  const db = fakeDb({ recentCalls });
  const api = fakeAnthropic();
  const counts = await quietly(() => queueAppealProfiles(films(6), { env: { ...ON, ...(cap ? { TASTEMAKE_APPEAL_DAILY_CAP: cap } : {}) }, fetchImpl: api.fetch, query: db.query }));
  eq(`daily cap, ${label}: ${want} calls`, api.appeal.length, want);
  eq(`daily cap, ${label}: the rest counted as capped`, counts.capped, 4 - want);
}
{
  const db = fakeDb({ failCount: true });
  const api = fakeAnthropic();
  const counts = await quietly(() => queueAppealProfiles(films(3), { env: ON, fetchImpl: api.fetch, query: db.query }));
  eq("the day's count can't be read: no calls (fails closed)", api.appeal.length, 0);
  eq("…and the task settles quietly", counts, null);
}
{
  const db = fakeDb();
  const api = fakeAnthropic({ answer: (n) => (n === 1 ? { ...good, summary: "Read more at www.example.com" } : good) });
  const counts = await quietly(() => queueAppealProfiles(films(2), { env: ON, fetchImpl: api.fetch, query: db.query }));
  check("an invalid profile is not saved", !db.profiles.has("tmdb-movie-1"));
  check("…the valid one is", db.profiles.has("tmdb-movie-2"));
  eq("…recorded as validation_fallback, then success", db.metrics.map((m) => m.outcome).join(","), "validation_fallback,success");
  eq("…counted", counts.invalid, 1);
}
{
  const db = fakeDb();
  const api = fakeAnthropic({ fail: () => ({ ok: false, status: 400, json: async () => ({ error: { type: "invalid_request_error", message: "You have reached your specified API usage limits." } }) }) });
  const counts = await quietly(() => queueAppealProfiles(films(4), { env: ON, fetchImpl: api.fetch, query: db.query }));
  eq("spend limit reached: stops after the first call", api.appeal.length, 1);
  eq("…recorded as budget_paused", db.metrics.map((m) => m.outcome).join(","), "budget_paused");
  check("…and counted", counts.paused === true && db.profiles.size === 0);
}
{
  const db = fakeDb();
  const api = fakeAnthropic({ fail: (n) => (n === 1 ? { ok: false, status: 529, json: async () => ({ error: { type: "overloaded_error" } }) } : { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(good) }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-haiku-5-5" }) }) });
  await quietly(() => queueAppealProfiles(films(2), { env: ON, fetchImpl: api.fetch, query: db.query }));
  eq("a provider error is recorded and the next title still runs", db.metrics.map((m) => m.outcome).join(","), "provider_error,success");
}
{
  let threw = false;
  const api = fakeAnthropic();
  try {
    const task = await quietly(() => queueAppealProfiles(films(2), { env: ON, fetchImpl: api.fetch, query: async () => { throw new Error("db down"); } }));
    await task;
  } catch { threw = true; }
  check("a database failure never reaches the caller", !threw);
  eq("…and makes no model call", api.appeal.length, 0);
}

// ---- the recommendations payload is unchanged ---------------------------------------------------------------
{
  const HORROR = 27;
  const movie = (n, title) => ({ id: `tmdb-movie-${n}`, provider: "tmdb", providerId: String(n), type: "movie", domains: ["movies"], title, year: "2020", genres: [HORROR], about: `${title} is a slow-burn horror film.` });
  const ratedBook = { ...book, id: "openlibrary-book-R1", providerId: "R1", title: "Rated Book", genres: [] };
  const rated = [movie(1, "Ash"), movie(2, "Birch"), movie(3, "Cedar"), ratedBook];
  const disliked = movie(4, "Dune");
  const pool = ["Elm", "Fern", "Glen", "Hazel", "Iris", "Juniper", "Kestrel", "Larch"].map((name, i) => movie(101 + i, name));
  const feedbackByRecommendation = Object.fromEntries([
    ...rated.map((item) => [item.id, { item, rating: "more", detail: "loved-before" }]),
    [disliked.id, { item: disliked, rating: "less", detail: "disliked-before" }]
  ]);
  const state = {
    selectedFavorites: new Set(), libraryFavorites: new Set(), customItems: {}, feedbackByRecommendation,
    recommendationSets: [], seenItemIds: [], blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(),
    areas: { movies: true, tv: true, read: true, play: true }, curveball: true, recommendationFilter: "all",
    modelHypotheses: [], patternStatements: []
  };
  const wire = () => JSON.parse(JSON.stringify(serializeAiState(state)));
  const answer = (body) => {
    const ids = [...JSON.stringify(body.messages).matchAll(/tmdb-movie-1\d\d/g)].map((m) => m[0]).filter((id, i, all) => all.indexOf(id) === i);
    return { picks: ids.map((itemId) => ({ itemId, why: `Shares the slow dread of ${rated[0].title}.`, cites: [`ev:${rated[0].id}`] })), curveballItemId: null };
  };

  const run = async (env, { model = true, items = pool } = {}) => {
    const db = fakeDb();
    const api = fakeAnthropic({ onPick: model ? answer : null });
    const tasks = [];
    const payload = await quietly(() => produceRecommendations({ rawState: wire(), env, fetchImpl: api.fetch, retrieve: async () => items, appeal: { query: db.query, onTask: (task) => tasks.push(task) } }));
    const serialized = JSON.stringify(payload);
    await quietly(() => Promise.all(tasks.filter(Boolean)));
    return { serialized, payload, db, api, tasks };
  };

  const ONE_RUN = { TASTEMAKE_APPEAL_MAX_PER_REQUEST: "20" };
  const liveOff = await run({ ...AI_ENV, ...ONE_RUN });
  const liveOn = await run({ ...ON, ...ONE_RUN });
  eq("live AI: the model's picks are accepted (so the comparison means something)", liveOn.payload.source, "model");
  eq("live AI: payload identical with the switch on and off", liveOn.serialized, liveOff.serialized);
  eq("live AI, switch off: no appeal calls, no queries", liveOff.api.appeal.length + liveOff.db.statements.length, 0);
  eq("live AI, switch off: the queue returned nothing", liveOff.tasks.join(","), "");
  eq("live AI, switch on: one recommendations call either way", liveOn.api.other.length, liveOff.api.other.length);
  const order = liveOn.api.appeal.map((body) => JSON.parse(body.messages[0].content.replace(/^CONTEXT\n/, "")).title);
  const offeredTitles = liveOn.payload.picks.map((pick) => pick.title);
  eq("live AI, switch on: the offered titles are profiled first", order.slice(0, offeredTitles.length).sort().join(","), [...offeredTitles].sort().join(","));
  eq("…then the rated book (rated films arrive without a synopsis, so they wait)", order.slice(offeredTitles.length).join(","), "Rated Book");
  check("…and nothing about the person is sent: no rating words in any profile prompt", !JSON.stringify(liveOn.api.appeal).match(/loved|disliked|rating|feedback/i));

  const fallbackOff = await run({ ...AI_ENV, ...ONE_RUN }, { model: false });
  const fallbackOn = await run({ ...ON, ...ONE_RUN }, { model: false });
  eq("fallback: the catalog picks stand in (so the comparison means something)", fallbackOn.payload.source, "catalog");
  eq("fallback: payload identical with the switch on and off", fallbackOn.serialized, fallbackOff.serialized);
  check("fallback, switch on: profiles were still made", fallbackOn.api.appeal.length > 0);

  const exhausted = await run({ ...ON }, { items: [] });
  check("exhausted: nothing is queued", exhausted.tasks.length === 0 && exhausted.api.appeal.length === 0 && exhausted.payload.meta?.exhausted === true);
}

// ---- metrics ------------------------------------------------------------------------------------------------
check("appeal_profile is a known operation", KNOWN_OPERATIONS.has("appeal_profile"));
{
  const query = async (text) => {
    if (/information_schema\.columns/i.test(text)) return ["operation", "outcome", "cache_write_tokens", "error_type"].map((column_name) => ({ column_name }));
    if (/group by coalesce\(outcome/i.test(text)) return [{ outcome: "success", count: 3 }];
    if (/error_status, error_type/i.test(text)) return [];
    if (/group by coalesce\(operation/i.test(text) && /model/i.test(text)) return [
      { operation: "appeal_profile", model: "claude-haiku-5-5", input_tokens: 800, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0 },
      { operation: "recommendations", model: "claude-sonnet-5-5", input_tokens: 1000, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0 }
    ];
    if (/group by coalesce\(operation/i.test(text)) return [
      { operation: "appeal_profile", attempts: 2, successes: 2, fallbacks: 0, failures: 0, paused: 0, p50_ms: 2000, p95_ms: 2500, input_tokens: 800, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0, last_call_at: "2026-11-17T12:00:00Z" },
      { operation: "recommendations", attempts: 1, successes: 1, fallbacks: 0, failures: 0, paused: 0, p50_ms: 8000, p95_ms: 8000, input_tokens: 1000, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0, last_call_at: "2026-11-17T11:00:00Z" }
    ];
    if (/count\(\*\)::int as attempts/i.test(text)) return [{ attempts: 3, successes: 3, fallbacks: 0, failures: 0, paused: 0, p50_ms: 2500, p95_ms: 7500, input_tokens: 1800, output_tokens: 600, cache_read_tokens: 0, cache_write_tokens: 0, last_call_at: "2026-11-17T12:00:00Z" }];
    throw new Error(`unexpected aggregate query: ${text}`);
  };
  const aggregate = await aggregateAiMetrics({ query });
  eq("/api/ai-metrics top-level fields unchanged", Object.keys(aggregate).join(","),
    "configured,available,period_days,sample_count,latency_ms,tokens,estimated_cost_usd,last_call_at,attempts,successes,fallbacks,failures,budget_paused,success_rate,fallback_rate,latency_scope,operations,outcomes,failure_reasons,pricing_as_of,scope,privacy");
  eq("appeal_profile appears under operations with the same fields as recommendations", Object.keys(aggregate.operations.appeal_profile ?? {}).join(","), Object.keys(aggregate.operations.recommendations).join(","));
  eq("scope text unchanged", aggregate.scope, "live model calls for recommendations and taste profile");
  eq("totals include appeal_profile calls", aggregate.attempts, 3);
}

finish();
