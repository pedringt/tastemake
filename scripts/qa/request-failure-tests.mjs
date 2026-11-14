#!/usr/bin/env node
// #350: a failed recommendation request reads as a temporary problem with Try again, never as a verdict on
// the user's favorites; real exhaustion keeps its own reason; an earlier set stays. Free: fetch is a stub.
//
//   node scripts/qa/request-failure-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };
let nextResponse = null;
let requests = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes("/api/recommendations")) requests += 1;
  return nextResponse();
};
const json = (status, body) => () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const { state, resetState } = await import("../../src/state.js");
const { renderRecommendations } = await import("../../src/screens/recommendations.js");
const { retryRecommendations, runInitialRecommendations, requestFailureMessage } = await import("../../src/actions/recommendations.js");
const { createSuite } = await import("./lib/assert.mjs");
const { check, eq, finish } = createSuite("request failure tests");

const ctx = { render: () => {}, updateStepper: () => {}, announce: () => {}, navigate: (screen) => { state.screen = screen; } };
const pick = (n) => ({ id: `tmdb-movie-${n}`, provider: "tmdb", providerId: String(n), title: `Pick ${n}`, type: "movie", domains: ["movies"], year: "2020", genres: ["18"], about: "About.", reason: "A reason." });
const setup = () => {
  resetState();
  state.onboarded = true;
  state.areas = { movies: true, tv: true, read: true, play: true };
  state.screen = "recommendations";
};
const blames = (html) => /trustworthy|Change your favorites/.test(html);

// ---- 1. 503 on the first request: plain copy, Try again, no blame ---------------------------------------
{
  setup();
  nextResponse = json(503, { error: "unavailable" });
  await runInitialRecommendations(ctx);
  const html = renderRecommendations();
  eq("a failed request is recorded as an error", state.aiSource, "error");
  check("the page doesn't blame the evidence or the user", !blames(html), html.match(/recommendation-request-error[\s\S]{0,400}/)?.[0]);
  check("it says recommendations didn't load", html.includes("Recommendations didn’t load") && html.includes("Your favorites and reactions are safe"));
  check("it offers Try again", html.includes('data-action="retry-recommendations"'));

  nextResponse = json(200, { source: "catalog", picks: [pick(1), pick(2)], meta: {} });
  requests = 0;
  await retryRecommendations(ctx);
  eq("Try again sends one new request", requests, 1);
  eq("...and on success the set appears", state.recommendationSets.at(-1)?.length, 2);
  check("...with no error left on screen", !renderRecommendations().includes("recommendation-request-error"));
}

// ---- 2. 429 says to wait, without naming a rate limit ---------------------------------------------------
{
  const message = requestFailureMessage({ status: 429 });
  check("429 says to wait a minute", /Wait a minute/.test(message));
  check("...without mentioning a rate limit", !/rate/i.test(message));
}

// ---- 3. A failure after a set keeps that set ------------------------------------------------------------
{
  setup();
  state.recommendationSets = [[pick(3), pick(4)]];
  nextResponse = json(500, { error: "boom" });
  await retryRecommendations(ctx);
  const html = renderRecommendations();
  eq("the earlier set is still there", state.recommendationSets.length, 1);
  check("...and still on screen", html.includes("Pick 3") && html.includes("Pick 4"));
  check("...and the page says so", html.includes("The set below is the one you already had."));
}

// ---- 4. Real exhaustion keeps its own reason -------------------------------------------------------------
{
  setup();
  nextResponse = json(200, { source: "catalog", picks: [], reason: "You haven't rated any TV yet, so Tastemake has nothing to base TV picks on.", meta: { exhausted: true } });
  await runInitialRecommendations(ctx);
  const html = renderRecommendations();
  check("exhaustion isn't shown as a failed request", !html.includes("recommendation-request-error"));
  eq("exhaustion keeps the server's reason", state.aiMessage, "You haven't rated any TV yet, so Tastemake has nothing to base TV picks on.");
}

finish();
