#!/usr/bin/env node
// #340: a page load must not pay for a Taste Profile refresh of evidence that was already checked. Covers
// reloading with no change, a new rating, a changed answer, a version bump, a profile that's missing or
// broken, a rejected or failed answer, evidence changing mid-request, Start over, restoring a backup and
// manual Refresh. A "reload" is persistState + loadPersistedState into a fresh state, as at boot. Every
// request is a stubbed fetch. Free, no browser, no model call.
//
//   node scripts/qa/profile-refresh-reload-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { PROFILE_REFRESH_VERSION, refreshProfileHypotheses, savedCheckApplies } = await import("../../src/ai/hypothesis-profile.js");
const { setStatement } = await import("../../src/model/statements.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { buildBackup } = await import("../../src/model/export.js");
const { state: appState, resetState, restoreStateFromBackupText } = await import("../../src/state.js");
const { recommendations, followUpPool } = await import("./fixtures/catalog.js");
const { emptyState, react } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("profile refresh reload tests");

const byId = (id) => [...recommendations, ...followUpPool].find((item) => item.id === id);
const ANSWER = {
  source: "model",
  hypotheses: [
    { id: "ai-worlds", label: "Immersive, atmospheric worlds", claim: "Worlds that feel lived-in and atmospheric hold attention across shows and games.", evidence: ["ev:severance", "ev:outerwilds"], counter: [], domains: ["movies", "play"], crossDomain: "tentative", level: "supported", conditional: false, context: null }
  ],
  meta: { rejected: 0, needsReview: [] }
};
const REJECTED = { source: "unavailable", reason: "model hypotheses did not pass validation", hypotheses: [], meta: { rejected: 3, needsReview: [] } };

// The stubbed endpoint: counts calls; `respond` decides the answer, and `during` runs while a request is open.
let calls = 0;
let respond = () => ({ ok: true, body: ANSWER });
let during = null;
globalThis.fetch = async (url) => {
  if (!String(url).includes("/api/hypotheses")) throw new Error(`unexpected fetch ${url}`);
  calls++;
  if (during) { const run = during; during = null; run(); }
  const { ok, body, fail } = respond();
  if (fail) throw new Error("network");
  return { ok, status: ok ? 200 : 500, json: async () => body };
};

function profile() {
  const s = { ...emptyState(), hypothesisAiStatus: "idle", hypothesisAiKey: null, hypothesisAiChecked: null, hypothesisAiMessage: null, screen: "model" };
  ["severance", "outerwilds", "controlgame"].forEach((id) => react(s, byId(id), "loved"));
  return s;
}
// What a page load sees: only the saved fields, plus the transient defaults.
function reload(s) {
  stored.clear();
  persistState(s);
  return { ...emptyState(), hypothesisAiStatus: "idle", hypothesisAiKey: null, hypothesisAiMessage: null, ...loadPersistedState(), screen: "model" };
}
const refresh = (s, opts = {}) => refreshProfileHypotheses(s, opts);

// ---- 1. Paige's check: refresh, close, reopen ---------------------------------------------------------------
{
  respond = () => ({ ok: true, body: ANSWER });
  const s = profile();
  calls = 0;
  await refresh(s);
  eq("first load: one refresh", calls, 1);
  check("a completed refresh saves a short record, not the key", s.hypothesisAiChecked?.hash && JSON.stringify(s.hypothesisAiChecked).length < 100, JSON.stringify(s.hypothesisAiChecked));

  const reopened = reload(s);
  check("the record survives a reload", Boolean(reopened.hypothesisAiChecked));
  calls = 0;
  let updates = 0;
  await refresh(reopened, { onUpdate: () => updates++ });
  eq("reopened with the same profile: zero new calls", calls, 0);
  check("the existing Taste Profile is still there", reopened.modelHypotheses.some((p) => p.id === "ai-worlds"));
  eq("it says it was updated from the latest reactions (so Refresh shows)", reopened.hypothesisAiMessage, "Updated using your latest reactions.");
  eq("status is ready, not loading", reopened.hypothesisAiStatus, "ready");
  eq("the screen is re-rendered once", updates, 1);
  await refresh(reopened);
  eq("navigating back to the profile in the same load: still no call", calls, 0);

  // ---- 2. changes after a reload still refresh through the normal flow ----------------------------------------
  const rated = reload(s);
  react(rated, byId("eeaao"), "loved");
  calls = 0;
  await refresh(rated);
  eq("a new rating after a reload: one refresh", calls, 1);

  const answered = reload(s);
  setStatement(answered, "ai-worlds", "says", "partial");
  calls = 0;
  await refresh(answered);
  eq("a changed pattern answer after a reload: one refresh", calls, 1);

  // ---- 3. manual Refresh always asks ----------------------------------------------------------------------------
  const manual = reload(s);
  calls = 0;
  await refresh(manual, { force: true });
  eq("manual Refresh after a reload: one call", calls, 1);
}

// ---- 4. a version bump refreshes an unchanged profile once ---------------------------------------------------
{
  respond = () => ({ ok: true, body: ANSWER });
  const s = profile();
  await refresh(s);
  const reopened = reload(s);
  reopened.hypothesisAiChecked = { ...reopened.hypothesisAiChecked, version: `${reopened.hypothesisAiChecked.version.split(":")[0]}:${PROFILE_REFRESH_VERSION - 1}` };
  calls = 0;
  await refresh(reopened);
  eq("a record from an older refresh version: one refresh", calls, 1);
  calls = 0;
  await refresh(reload(reopened));
  eq("then none on the next reload", calls, 0);
}

// ---- 5. the record is trusted only with a usable profile -----------------------------------------------------
{
  respond = () => ({ ok: true, body: ANSWER });
  const s = profile();
  await refresh(s);
  for (const [name, mutate] of [
    ["no patterns", (r) => { r.modelHypotheses = []; }],
    ["patterns missing", (r) => { delete r.modelHypotheses; }],
    ["a broken pattern", (r) => { r.modelHypotheses = [{ id: "ai-worlds" }]; }],
    ["a corrupted record", (r) => { r.hypothesisAiChecked = { hash: "nope", version: r.hypothesisAiChecked.version }; }]
  ]) {
    const r = reload(s);
    mutate(r);
    check(`${name}: the saved record isn't trusted`, !savedCheckApplies(r));
    calls = 0;
    await refresh(r);
    eq(`${name}: it refreshes instead`, calls, 1);
  }
}

// ---- 6. an unsuccessful refresh is never recorded as a completed one -----------------------------------------
{
  for (const [name, answer] of [
    ["a rejected answer", () => ({ ok: true, body: REJECTED })],
    ["a server error", () => ({ ok: false, body: { error: "boom" } })],
    ["a network failure", () => ({ fail: true })],
    ["a paused budget", () => ({ ok: true, body: { source: "unavailable", hypotheses: [], meta: { budgetPaused: true } } })]
  ]) {
    respond = () => ({ ok: true, body: ANSWER });
    const s = profile();
    await refresh(s);
    react(s, byId("eeaao"), "loved");   // new evidence, so the next refresh really asks
    respond = answer;
    await refresh(s);
    eq(`${name}: nothing saved as checked`, s.hypothesisAiChecked, null);
    respond = () => ({ ok: true, body: ANSWER });
    calls = 0;
    await refresh(reload(s));
    eq(`${name}: the next load retries`, calls, 1);
  }
}

// ---- 7. evidence that changes while a request is open isn't recorded as checked -------------------------------
{
  respond = () => ({ ok: true, body: ANSWER });
  const s = profile();
  let again = 0;
  during = () => react(s, byId("eeaao"), "loved");
  calls = 0;
  await refresh(s, { onStale: () => again++ });
  eq("the stale answer asks again through the normal path", again, 1);
  eq("and saves no record for the old evidence", s.hypothesisAiChecked, null);
  await refresh(s);
  check("the record saved afterwards matches the new evidence", savedCheckApplies(s));
  eq("two calls in all: the stale one and the new one", calls, 2);
}

// ---- 8. Start over and restoring a backup don't reuse a record ------------------------------------------------
{
  respond = () => ({ ok: true, body: ANSWER });
  const s = profile();
  await refresh(s);
  Object.assign(appState, s);
  const backup = JSON.stringify(buildBackup(appState));
  resetState();
  eq("Start over clears the record", appState.hypothesisAiChecked, null);
  restoreStateFromBackupText(backup);
  eq("a restored backup starts without one (one refresh, then saved again)", appState.hypothesisAiChecked, null);
  check("the backup itself doesn't carry the record", !backup.includes("hypothesisAiChecked"));
}

finish();
