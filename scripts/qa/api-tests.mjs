#!/usr/bin/env node
// Tests for the live recommendation endpoint (api/recommendations.mjs). No network and no paid call:
// every model response is a fake injected through `fetchImpl`.
//
//   node scripts/qa/api-tests.mjs
//
// Covers: the gate (every reason it stays off), the deterministic fallback being the product's own picks,
// model answers that pass and answers that must be refused, transport failures, and the HTTP handler.

import handler, { liveConfig, produceRecommendations } from "../../api/recommendations.mjs";
import { favorites, recommendations, followUpPool } from "../../src/data/catalog.js";
import { nextRecommendations } from "../../src/model/taste.js";
import { buildContext } from "../../src/ai/context.js";

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => { if (ok) passed += 1; else failures.push(`${name}${detail ? ` (${detail})` : ""}`); };
const eq = (name, got, want) => check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

// ---- fixtures -------------------------------------------------------------------------------------
const ON = {
  TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "test-key-not-real", TASTEMAKE_AI_MODEL: "claude-test",
  TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", VERCEL_ENV: "preview"
};
const rawState = (extra = {}) => ({
  selectedFavorites: favorites.filter((f) => f.selected).map((f) => f.id),
  feedbackByRecommendation: {
    [recommendations[0].id]: { item: recommendations[0], rating: "more", detail: "loved-before" },
    [recommendations[1].id]: { item: recommendations[1], rating: "more", detail: "liked-before" },
    [recommendations[2].id]: { item: recommendations[2], rating: "not-tried", detail: "bookmarked" }
  },
  recommendationSets: [recommendations], libraryFavorites: [], customItems: {}, blindSpots: {},
  blindSpotDrafts: {}, blindSpotDismissed: [], patternStatements: [],
  areas: { watch: true, read: true, play: true }, curveball: true, ...extra
});
const liveState = () => {
  const raw = rawState();
  return {
    ...raw, selectedFavorites: new Set(raw.selectedFavorites), libraryFavorites: new Set(), blindSpotDismissed: new Set()
  };
};
const fakeFetch = (payload, { status = 200, fail = null } = {}) => async () => {
  if (fail === "abort") { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  if (fail) throw new Error(fail);
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
};
const modelSays = (picks) => ({ content: [{ type: "text", text: JSON.stringify({ picks }) }], usage: { input_tokens: 10, output_tokens: 20 }, model: "claude-test" });
const goodPicks = () => {
  const state = liveState();
  const ctx = buildContext(state);
  const cite = ctx.evidence.find((r) => r.class === "experienced" && r.polarity > 0 && r.kind !== "starter-favorite").ref;
  return nextRecommendations(state).map((item, i) => ({
    itemId: ctx.candidates[i]?.id ?? item.id,
    why: `Tests whether ${["structure", "tonal collision", "moral messiness", "discovery", "dry comedy"][i % 5]} still lands for you.`,
    cites: [cite], tests: null, kind: "pick"
  }));
};

// ---- the gate -------------------------------------------------------------------------------------
eq("gate: all set (non-production) is enabled", liveConfig(ON).enabled, true);
for (const [key, reason] of [["TASTEMAKE_AI_ENABLED", "off-switch"], ["ANTHROPIC_API_KEY", "missing-key"], ["TASTEMAKE_AI_MODEL", "missing-model"],
  ["TASTEMAKE_AI_RATE_LIMIT_CONFIRMED", "rate-limit-not-confirmed"], ["TASTEMAKE_AI_SPEND_CAP_CONFIRMED", "spend-cap-not-confirmed"]]) {
  const env = { ...ON }; delete env[key];
  const config = liveConfig(env);
  check(`gate: without ${key} it is off (${reason})`, !config.enabled && config.reasons.includes(reason), config.reasons.join(","));
}
const prod = liveConfig({ ...ON, VERCEL_ENV: "production" });
check("gate: production needs its own approval even with everything else set", !prod.enabled && prod.reasons.includes("production-live-not-approved"), prod.reasons.join(","));
eq("gate: production with the approval is enabled", liveConfig({ ...ON, VERCEL_ENV: "production", TASTEMAKE_AI_PRODUCTION_APPROVED: "1" }).enabled, true);

// ---- deterministic fallback ----------------------------------------------------------------------
const expectedIds = nextRecommendations(liveState()).map((item) => item.id).join();
let out = await produceRecommendations({ rawState: rawState(), env: {}, fetchImpl: fakeFetch(null, { fail: "should not be called" }) });
eq("gate off: deterministic", out.source, "deterministic");
eq("gate off: no paid call", out.meta.paidCallMade, false);
eq("gate off: the fallback is exactly the app's own picks", out.picks.map((p) => p.id).join(), expectedIds);
check("gate off: the fallback is not filtered by the model's grounding rules", out.picks.length === nextRecommendations(liveState()).length, `${out.picks.length}`);
const cold = await produceRecommendations({ rawState: rawState({ feedbackByRecommendation: {}, recommendationSets: [] }), env: {} });
eq("cold start: still the full deterministic set (nothing dropped for having no citation)", cold.picks.length, 5);

// ---- model answers that pass ------------------------------------------------------------------------
out = await produceRecommendations({ rawState: rawState(), env: ON, fetchImpl: fakeFetch(modelSays(goodPicks())) });
eq("a valid model answer is used", out.source, "model");
eq("...and reports the paid call", out.meta.paidCallMade, true);
check("...and every pick carries its citations", out.picks.every((p) => p.ai?.cites?.length), JSON.stringify(out.picks[0]?.ai));
check("...and the reason text comes from the model", out.picks.every((p) => /Tests whether/.test(p.reason)), out.picks[0]?.reason);

// ---- model answers that must be refused -------------------------------------------------------------
const cases = [
  ["invented itemId", goodPicks().map((p, i) => (i === 0 ? { ...p, itemId: "not-a-real-item" } : p))],
  ["citation that does not exist", goodPicks().map((p, i) => (i === 0 ? { ...p, cites: ["ev:nope"] } : p))],
  ["intent cited as taste", goodPicks().map((p, i) => (i === 0 ? { ...p, cites: [`ev:${recommendations[2].id}`] } : p))],
  ["no citation", goodPicks().map((p, i) => (i === 0 ? { ...p, cites: [] } : p))],
  ["circular reason", goodPicks().map((p, i) => (i === 0 ? { ...p, why: "You'll like this because it matches your taste." } : p))],
  ["identity claim", goodPicks().map((p, i) => (i === 0 ? { ...p, why: "Your aesthetic is dark academia, so this fits." } : p))],
  ["duplicate picks", goodPicks().map((p) => ({ ...p, itemId: goodPicks()[0].itemId }))],
  ["too few picks", goodPicks().slice(0, 1)],
  ["not JSON at all", null]
];
for (const [name, picks] of cases) {
  const payload = picks === null ? { content: [{ type: "text", text: "sorry, I can't do that" }] } : modelSays(picks);
  const result = await produceRecommendations({ rawState: rawState(), env: ON, fetchImpl: fakeFetch(payload) });
  check(`refused and fell back: ${name}`, result.source === "deterministic" && result.picks.map((p) => p.id).join() === expectedIds, `${result.source} / ${result.reason}`);
  check(`...and the paid call is still reported: ${name}`, result.meta.paidCallMade === true, JSON.stringify(result.meta));
}
const notMe = rawState({ patternStatements: [{ hypothesisId: "H04", label: "Comedy works better when it has teeth", says: "not-me", weight: null, authority: "user-confirmed" }] });
const notMeState = { ...notMe, selectedFavorites: new Set(notMe.selectedFavorites), libraryFavorites: new Set(), blindSpotDismissed: new Set() };
const notMePicks = nextRecommendations(notMeState).map((item, i) => ({ ...goodPicks()[0], itemId: buildContext(notMeState).candidates[i]?.id ?? item.id, tests: "H04" }));
out = await produceRecommendations({ rawState: notMe, env: ON, fetchImpl: fakeFetch(modelSays(notMePicks)) });
eq("a pick that tests a pattern the user rejected falls back", out.source, "deterministic");

// ---- transport failures ------------------------------------------------------------------------------
for (const [name, opts] of [["timeout", { fail: "abort" }], ["network error", { fail: "boom" }], ["non-200", { status: 500 }]]) {
  const result = await produceRecommendations({ rawState: rawState(), env: ON, fetchImpl: fakeFetch(modelSays(goodPicks()), opts) });
  check(`transport ${name}: falls back to the app's picks`, result.source === "deterministic" && result.picks.map((p) => p.id).join() === expectedIds, `${result.source} / ${result.reason}`);
}

// ---- the prompt carries only product-owned context ----------------------------------------------------
let seenBody = null;
await produceRecommendations({ rawState: rawState(), env: ON, fetchImpl: async (_url, init) => { seenBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => modelSays(goodPicks()) }; } });
const prompt = seenBody.messages[0].content;
check("prompt: no API key or env values", !prompt.includes(ON.ANTHROPIC_API_KEY) && !/process\.env/.test(prompt));
check("prompt: candidates are sent as ids and public fields only", /"candidates":/.test(prompt) && !/"reason":/.test(prompt.split('"candidates":')[1].slice(0, 2000)), "candidate fields");
check("prompt: no temperature is sent (newer models reject it)", seenBody.temperature === undefined, String(seenBody.temperature));

// ---- the HTTP handler --------------------------------------------------------------------------------
const res = () => { const r = { code: null, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
let r = res(); await handler({ method: "GET", headers: {} }, r); eq("GET is refused", r.code, 405);
r = res(); await handler({ method: "POST", headers: {}, body: {} }, r); eq("POST with no state is refused", r.code, 400);
r = res(); await handler({ method: "POST", headers: { "content-length": "999999" }, body: {} }, r); eq("an oversized body is refused", r.code, 413);
r = res(); await handler({ method: "POST", headers: { "x-forwarded-for": "5.5.5.5" }, body: { state: rawState() } }, r);
eq("a good POST answers 200", r.code, 200);
eq("...deterministic while the gate is off in this process", r.body.source, "deterministic");
eq("...and is never cached", r.headers["cache-control"], "no-store");
let limited = null;
for (let i = 0; i < 12; i += 1) { const rr = res(); await handler({ method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: { state: rawState() } }, rr); if (rr.code === 429) { limited = i; break; } }
check("a burst from one visitor is rate limited (best effort, per instance)", limited !== null, `no 429 in 12 requests`);

console.log(`api tests: ${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log(`  x ${f}`));
process.exit(failures.length ? 1 : 0);
