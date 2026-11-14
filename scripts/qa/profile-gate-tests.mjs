#!/usr/bin/env node
// #349: /api/hypotheses never pays for a profile with nothing tried, and has the same best-effort
// per-visitor limit as /api/recommendations, in its own bucket. Free: every model call here is a fake
// fetch that only counts.
//
//   node scripts/qa/profile-gate-tests.mjs

const { default: handler, produceHypotheses } = await import("../../api/hypotheses.mjs");
const { createSuite } = await import("./lib/assert.mjs");
const { check, eq, finish } = createSuite("profile gate tests");

const AI_ENV = { TASTEMAKE_AI_ENABLED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", ANTHROPIC_API_KEY: "test-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1" };
let modelCalls = 0;
const countingFetch = async () => { modelCalls += 1; return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"hypotheses":[],"insufficientEvidence":true}' }], usage: { input_tokens: 1, output_tokens: 1 }, model: "claude-test" }) }; };
const book = { id: "openlibrary-book-OL1W", provider: "openlibrary", providerId: "OL1W", title: "A Book", type: "book", domains: ["read"], year: "2020", genres: ["Fiction"] };

// ---- 1. Nothing tried: no paid call ----------------------------------------------------------------------
{
  modelCalls = 0;
  const empty = await produceHypotheses({ rawState: {}, env: AI_ENV, fetchImpl: countingFetch });
  eq("an empty state makes no model call", modelCalls, 0);
  check("...and says why, without claiming a paid call", empty.meta?.insufficientEvidence === true && empty.meta?.paidCallMade === false && empty.hypotheses.length === 0);

  const savedOnly = { feedbackByRecommendation: { [book.id]: { item: book, rating: "not-tried", detail: "bookmarked" } } };
  modelCalls = 0;
  await produceHypotheses({ rawState: savedOnly, env: AI_ENV, fetchImpl: countingFetch });
  eq("saves alone (nothing tried) make no model call", modelCalls, 0);
}

// ---- 2. One tried item still reaches the model ----------------------------------------------------------
{
  modelCalls = 0;
  const one = { selectedFavorites: [book.id], customItems: { [book.id]: book } };
  const result = await produceHypotheses({ rawState: one, env: AI_ENV, fetchImpl: countingFetch });
  eq("one tried item still asks the model", modelCalls, 1);
  check("...and isn't marked insufficient", !result.meta?.insufficientEvidence);
}

// ---- 3. Per-visitor limit, in its own bucket ------------------------------------------------------------
{
  const res = () => { const r = { code: null, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const headers = { "x-forwarded-for": "203.0.113.149" };
  const codes = [];
  for (let i = 0; i < 7; i += 1) {
    const r = res();
    await handler({ method: "POST", headers, body: { state: {} } }, r);
    codes.push(r.code);
  }
  eq("six profile requests a minute are allowed, the seventh is 429", codes.join(","), "200,200,200,200,200,200,429");

  const bad = res();
  await handler({ method: "POST", headers: { "x-forwarded-for": "203.0.113.150" }, body: {} }, bad);
  eq("a request missing its state is still a 400", bad.code, 400);
  const after = res();
  await handler({ method: "POST", headers: { "x-forwarded-for": "203.0.113.150" }, body: { state: {} } }, after);
  eq("...and doesn't use up that visitor's allowance", after.code, 200);

  const { default: recommendationsHandler } = await import("../../api/recommendations.mjs");
  const recs = res();
  await recommendationsHandler({ method: "POST", headers, body: { state: { selectedFavorites: [], feedbackByRecommendation: {}, recommendationSets: [], customItems: {} } } }, recs);
  eq("profile requests don't use up the recommendations allowance", recs.code, 200);
}

// ---- 4. A provider error logs Anthropic's own message (Nov 12) --------------------------------------------
{
  const res = () => { const r = { code: null, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const saved = { env: { ...process.env }, fetch: globalThis.fetch, error: console.error };
  const logged = [];
  Object.assign(process.env, AI_ENV);
  console.error = (...args) => logged.push(args.join(" "));
  const run = async (message, ip) => {
    globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { type: "invalid_request_error", message } }) });
    const r = res();
    await handler({ method: "POST", headers: { "x-forwarded-for": ip }, body: { state: { selectedFavorites: [book.id], customItems: { [book.id]: book } } } }, r);
    return r;
  };
  try {
    const low = await run("Your credit balance is too low to access the Anthropic API.", "203.0.113.151");
    check("a low credit balance pauses the profile", low.body?.meta?.budgetPaused === true);
    const lowLine = logged.find((line) => line.startsWith("[tastemake-profile-ai]")) ?? "";
    check("...and the log says so, with Anthropic's message", lowLine.includes("budget paused") && lowLine.includes("credit balance is too low"), lowLine);
    logged.length = 0;
    const other = await run("messages: field required", "203.0.113.152");
    check("another 400 isn't a pause", !other.body?.meta?.budgetPaused);
    const otherLine = logged.find((line) => line.startsWith("[tastemake-profile-ai]")) ?? "";
    check("...and its log names the real problem", otherLine.includes("unavailable") && otherLine.includes("field required"), otherLine);
  } finally {
    for (const key of Object.keys(AI_ENV)) if (!(key in saved.env)) delete process.env[key];
    Object.assign(process.env, saved.env);
    globalThis.fetch = saved.fetch;
    console.error = saved.error;
  }
}

finish();
