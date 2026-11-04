#!/usr/bin/env node
// Nov 4 (after #325): a Taste Profile refresh answer that no longer describes the user's current profile
// must change nothing. Covers answers and evidence changing while a refresh is in flight, Start over,
// restoring a backup and opening the Example Profile mid-request, overlapping requests, aborted requests,
// the paused budget, and that the user's newer answer is what gets saved. Every request is a stubbed,
// deferred fetch resolved by the test, so the interleaving is deterministic. Free, no browser, no model call.
//
//   node scripts/qa/profile-refresh-race-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { setStatement, toggleDomainExclusion } = await import("../../src/model/statements.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { buildBackup } = await import("../../src/model/export.js");
const { state: appState, resetState, restoreStateFromBackupText } = await import("../../src/state.js");
const { recommendations, followUpPool } = await import("./fixtures/catalog.js");
const { emptyState, react } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("profile refresh race tests");

const byId = (id) => [...recommendations, ...followUpPool].find((item) => item.id === id);
const WORLDS = { id: "ai-worlds", title: "Immersive, atmospheric worlds", claim: "Worlds that feel lived-in and atmospheric hold attention across shows and games.", supports: ["ev:severance", "ev:outerwilds", "ev:controlgame"], counters: ["ev:disco"], domains: ["movies", "play"], strength: "supported", status: "supported", crossDomain: "tentative", context: null };
// What the server would accept on a refresh: a brand-new pattern plus the confirmed one, unchanged.
const ANSWER = {
  source: "model",
  hypotheses: [
    { id: "ai-worlds", label: WORLDS.title, claim: WORLDS.claim, evidence: WORLDS.supports, counter: WORLDS.counters, domains: WORLDS.domains, crossDomain: "tentative", level: "supported", conditional: false, context: null },
    { id: "ai-comedy", label: "Comedy with a dark edge", claim: "Comedy lands when it has real stakes and a dark edge underneath.", evidence: ["ev:eeaao", "ev:barry"], counter: [], domains: ["movies"], crossDomain: "untested", level: "supported", conditional: false, context: null }
  ],
  meta: { rejected: 0, needsReview: [] }
};

function seed(s) {
  ["severance", "outerwilds", "controlgame", "eeaao", "barry"].forEach((id) => react(s, byId(id), "loved"));
  react(s, byId("disco"), "disliked");
  s.modelHypotheses = [{ ...WORLDS }];
  s.patternStatements = [{ hypothesisId: "ai-worlds", label: WORLDS.title, says: "accurate", weight: "lot", context: null, authority: "user-confirmed" }];
  s.hypothesisHistory = [{ id: "rev-1", hypothesisId: "ai-worlds", claim: WORLDS.claim, origin: "model", reason: "earlier refresh" }];
  s.hypothesisAiStatus = "ready";
  s.hypothesisAiMessage = "Your Taste Profile is up to date.";
  return s;
}
const profileState = () => seed(emptyState());

// Each fetch call waits until the test answers it; aborting it rejects like a real fetch does.
function deferredFetch() {
  const calls = [];
  globalThis.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const call = { url, init, aborted: false, answer: (payload) => resolve({ ok: true, json: async () => payload }), fail: (error) => reject(error) };
    init.signal?.addEventListener?.("abort", () => { call.aborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
    calls.push(call);
  });
  return calls;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const snapshot = (s) => JSON.stringify({
  patterns: s.modelHypotheses, history: s.hypothesisHistory, statements: s.patternStatements, key: s.hypothesisAiKey ?? null,
  message: s.hypothesisAiMessage ?? null, status: s.hypothesisAiStatus, aiPaused: Boolean(s.aiPaused), aiLive: Boolean(s.aiLive),
  feedback: Object.keys(s.feedbackByRecommendation).sort()
});

// Starts a refresh, makes `change` while it is in flight, then delivers `payload`. Returns what happened.
async function raceWith(change, { payload = ANSWER, s = profileState() } = {}) {
  const calls = deferredFetch();
  let stale = 0;
  let updates = 0;
  const announced = [];
  const running = refreshProfileHypotheses(s, { force: true, onStale: () => { stale += 1; }, onUpdate: () => { updates += 1; }, announce: (m) => announced.push(m) });
  await tick();
  change(s);
  const before = snapshot(s);
  calls[0].answer(payload);
  await running;
  return { s, calls, stale, updates, announced, before, after: snapshot(s) };
}

// ---- 1. control: nothing changed, so the answer applies exactly as before ---------------------------------
{
  const { s, stale, announced } = await raceWith(() => {});
  check("unchanged profile: the new pattern is applied", s.modelHypotheses.some((p) => p.id === "ai-comedy"));
  check("unchanged profile: history records the new pattern", s.hypothesisHistory.some((r) => r.hypothesisId === "ai-comedy"));
  check("unchanged profile: recorded as a completed check", typeof s.hypothesisAiKey === "string" && s.hypothesisAiKey.length > 0);
  eq("unchanged profile: says it is up to date", s.hypothesisAiMessage, "Your Taste Profile is up to date.");
  eq("unchanged profile: status is ready", s.hypothesisAiStatus, "ready");
  eq("unchanged profile: no second request", stale, 0);
  eq("unchanged profile: announced once", announced.length, 1);
  eq("unchanged profile: request handle cleared", s.hypothesisRequest ?? null, null);
}

// ---- 2. the user changes something while the refresh is in flight ---------------------------------------
for (const [name, change] of [
  ["confirmation changed to not me", (s) => setStatement(s, "ai-worlds", "says", "not-me")],
  ["confirmation changed to partly, with an excluded area", (s) => { setStatement(s, "ai-worlds", "says", "partial"); toggleDomainExclusion(s, "ai-worlds", "play"); }],
  ["importance answer changed", (s) => setStatement(s, "ai-worlds", "weight", "lot")],
  ["a rating added", (s) => react(s, byId("inscryption"), "loved")],
  ["a supporting rating removed", (s) => { delete s.feedbackByRecommendation.severance; }],
  ["a reason added to a rating", (s) => { s.feedbackByRecommendation.outerwilds.refinements = ["pacing"]; }]
]) {
  const { s, stale, announced, before, after, calls } = await raceWith(change);
  eq(`${name}: the stale answer changes nothing (patterns, history, answers, key, flags, message)`, after, before.replace(/"status":"loading"/, '"status":"ready"').replace(/"message":"Refreshing your Taste Profile…"/, '"message":"Your Taste Profile is up to date."'));
  check(`${name}: the new pattern from the stale answer is not added`, !s.modelHypotheses.some((p) => p.id === "ai-comedy"));
  check(`${name}: no history entry from the stale answer`, !s.hypothesisHistory.some((r) => r.hypothesisId === "ai-comedy"));
  eq(`${name}: the status goes back to what it was`, s.hypothesisAiStatus, "ready");
  eq(`${name}: the message goes back to what it was`, s.hypothesisAiMessage, "Your Taste Profile is up to date.");
  eq(`${name}: asks again once, through the normal path`, stale, 1);
  eq(`${name}: nothing announced`, announced.length, 0);
  eq(`${name}: only the one request was sent by the refresh itself`, calls.length, 1);
}
{
  // The weight case above only changes something if the answer differs; make sure a no-op answer isn't stale.
  const s = profileState();
  const calls = deferredFetch();
  let stale = 0;
  const running = refreshProfileHypotheses(s, { force: true, onStale: () => { stale += 1; } });
  await tick();
  setStatement(s, "ai-worlds", "weight", "lot");   // already "lot": toggles it off, which is a real change
  setStatement(s, "ai-worlds", "weight", "lot");   // and back on: the profile is what it was
  calls[0].answer(ANSWER);
  await running;
  eq("a change undone before the answer lands: the answer applies", s.modelHypotheses.some((p) => p.id === "ai-comedy"), true);
  eq("a change undone before the answer lands: no second request", stale, 0);
}

// ---- 3. the asked-again request uses the user's newest answers, and applies --------------------------------
{
  const s = profileState();
  const calls = deferredFetch();
  const refresh = () => refreshProfileHypotheses(s, { onStale: () => { second = refresh(); } });
  let second = null;
  const first = refreshProfileHypotheses(s, { force: true, onStale: () => { second = refresh(); } });
  await tick();
  setStatement(s, "ai-worlds", "says", "partial");
  calls[0].answer(ANSWER);
  await first;
  await tick();
  eq("asked again: a second request was sent", calls.length, 2);
  const sentStatements = calls[1] ? JSON.parse(calls[1].init.body).state.patternStatements : [];
  eq("asked again: it carries the newer answer", sentStatements.find((x) => x.hypothesisId === "ai-worlds")?.says, "partial");
  calls[1]?.answer(ANSWER);
  await second;
  check("asked again: its answer applies", s.modelHypotheses.some((p) => p.id === "ai-comedy"));
  eq("asked again: the user's partly answer is kept", s.patternStatements.find((x) => x.hypothesisId === "ai-worlds")?.says, "partial");
}

// ---- 4. a paused budget never asks again ------------------------------------------------------------------
{
  const paused = { source: "unavailable", hypotheses: [], meta: { budgetPaused: true } };
  const { s, stale } = await raceWith((x) => setStatement(x, "ai-worlds", "says", "not-me"), { payload: paused });
  eq("stale answer while the budget is paused: no second request", stale, 0);
  eq("stale answer while the budget is paused: the paused flag isn't set from a stale answer", Boolean(s.aiPaused), false);
}
{
  const s = profileState();
  s.aiPaused = true;
  const { stale } = await raceWith((x) => setStatement(x, "ai-worlds", "says", "not-me"), { s });
  eq("stale answer after AI was already paused: no second request", stale, 0);
}

// ---- 5. a failed request for a changed profile is stale too -----------------------------------------------
{
  const s = profileState();
  const calls = deferredFetch();
  let stale = 0;
  const running = refreshProfileHypotheses(s, { force: true, onStale: () => { stale += 1; } });
  await tick();
  setStatement(s, "ai-worlds", "says", "not-me");
  calls[0].fail(new Error("offline"));
  await running;
  eq("failure after a change: no 'couldn't update' message", s.hypothesisAiMessage, "Your Taste Profile is up to date.");
  eq("failure after a change: asks again with the new answer", stale, 1);
}
{
  // An error after an answer was accepted is an ordinary failure, never treated as stale (no loop).
  const s = profileState();
  const calls = deferredFetch();
  let stale = 0;
  const running = refreshProfileHypotheses(s, { force: true, onStale: () => { stale += 1; }, announce: () => { throw new Error("render failed"); } });
  await tick();
  calls[0].answer(ANSWER);
  await running;
  eq("error after the answer was applied: not treated as stale", stale, 0);
  check("error after the answer was applied: says it couldn't update", /couldn.t update/i.test(s.hypothesisAiMessage), s.hypothesisAiMessage);
}

// ---- 6. Start over, a restored backup or the Example Profile while a refresh is in flight -------------------
function seedApp() {
  appState.viewingExample = false;   // leaving the example reloads the page in the app
  resetState();
  seed(appState);
}
for (const [name, replace] of [
  ["Start over", () => resetState()],
  ["restoring a backup", () => {
    const other = seed(emptyState());
    other.modelHypotheses = [{ ...WORLDS, id: "ai-restored", title: "Restored pattern", claim: "A pattern that only exists in the restored backup file." }];
    other.patternStatements = [];
    other.hypothesisHistory = [{ id: "rev-restored", hypothesisId: "ai-restored", claim: "A pattern that only exists in the restored backup file.", origin: "model", reason: "backup" }];
    restoreStateFromBackupText(JSON.stringify(buildBackup(other)));
  }],
  ["opening the Example Profile", () => {
    restoreStateFromBackupText(JSON.stringify(buildBackup(seed(emptyState()))));
    appState.viewingExample = true;
  }]
]) {
  seedApp();
  const calls = deferredFetch();
  let stale = 0;
  let updates = 0;
  const announced = [];
  const running = refreshProfileHypotheses(appState, { force: true, onStale: () => { stale += 1; }, onUpdate: () => { updates += 1; }, announce: (m) => announced.push(m) });
  await tick();
  const updatesBefore = updates;
  replace();
  const after = snapshot(appState);
  eq(`${name}: the in-flight request is cancelled`, calls[0].aborted, true);
  calls[0].answer(ANSWER);   // a late answer that ignores the abort must not land either
  await running;
  eq(`${name}: nothing from the old answer reaches the new profile`, snapshot(appState), after);
  check(`${name}: the old pattern set is not written into the new profile`, !appState.modelHypotheses.some((p) => p.id === "ai-comedy"));
  eq(`${name}: no request for the replaced profile`, stale, 0);
  eq(`${name}: no render or save on behalf of the old profile`, updates, updatesBefore);
  eq(`${name}: nothing announced`, announced.length, 0);
  eq(`${name}: only one request was ever sent`, calls.length, 1);
}
{
  // The aborted request's rejection lands in the error path: it must not write "ready" or an error message.
  seedApp();
  const calls = deferredFetch();
  const running = refreshProfileHypotheses(appState, { force: true });
  await tick();
  resetState();
  const after = snapshot(appState);
  if (!calls[0].aborted) calls[0].fail(new Error("offline"));
  await running;
  eq("Start over: the reset profile stays empty", snapshot(appState), after);
  eq("Start over: status is idle, not 'ready' from the old request", appState.hypothesisAiStatus, "idle");
  eq("Start over: no message from the old request", appState.hypothesisAiMessage, null);
}

// ---- 7. overlapping requests: a refresh started after Start over isn't clobbered by the first ---------------
{
  seedApp();
  const calls = deferredFetch();
  const first = refreshProfileHypotheses(appState, { force: true });
  await tick();
  resetState();
  seed(appState);
  appState.modelHypotheses = [{ ...WORLDS, id: "ai-second", title: "Second profile pattern", claim: "Only the second profile, after Start over, has this pattern in it." }];
  appState.patternStatements = [];
  const second = refreshProfileHypotheses(appState, { force: true });
  await tick();
  const secondAnswer = { source: "model", hypotheses: [{ id: "ai-second", label: "Second profile pattern", claim: "Only the second profile, after Start over, has this pattern in it.", evidence: ["ev:eeaao", "ev:barry"], counter: [], domains: ["movies"], crossDomain: "untested", level: "supported", conditional: false, context: null }], meta: { rejected: 0, needsReview: [] } };
  calls[1].answer(secondAnswer);
  await second;
  const afterSecond = snapshot(appState);
  calls[0].answer(ANSWER);
  await first;
  eq("overlap: the first request's late answer changes nothing", snapshot(appState), afterSecond);
  check("overlap: the second profile keeps its own pattern", appState.modelHypotheses.some((p) => p.id === "ai-second"));
  check("overlap: the first profile's new pattern never lands", !appState.modelHypotheses.some((p) => p.id === "ai-comedy"));
}

// ---- 8. the user's newer answer is what gets saved and comes back after a reload ---------------------------
{
  stored.clear();
  const { s } = await raceWith((x) => setStatement(x, "ai-worlds", "says", "not-me"));
  persistState(s);
  const reloaded = loadPersistedState();
  eq("saved after a stale answer: the newer 'not me' answer is saved", reloaded.patternStatements?.find((x) => x.hypothesisId === "ai-worlds")?.says, "not-me");
  check("saved after a stale answer: the stale answer's pattern is not saved", !(reloaded.modelHypotheses ?? []).some((p) => p.id === "ai-comedy"));
  check("saved after a stale answer: no stale history saved", !(reloaded.hypothesisHistory ?? []).some((r) => r.hypothesisId === "ai-comedy"));
  check("saved after a stale answer: the request handle and generation are never saved", !("hypothesisRequest" in reloaded) && !("profileGeneration" in reloaded));
}

finish();
