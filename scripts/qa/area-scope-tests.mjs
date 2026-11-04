#!/usr/bin/env node
// Nov 4 (after #325): excluding an area from a pattern must be reversible. The pattern keeps its own areas
// through refreshes, save / reload and export / import; the exclusion is applied only where the pattern is
// used. Profiles an earlier refresh already narrowed get the area back only when their history shows it
// unambiguously (src/model/area-scope.js), and running that again changes nothing. Free, no browser, no
// model call; synthetic catalog fixtures only.
//
//   node scripts/qa/area-scope-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { buildContext } = await import("../../src/ai/context.js");
const { normalizeHypothesisResponse, preserveExistingHypotheses, settleConfirmedHypotheses, validateHypotheses } = await import("../../src/ai/validate.js");
const { markNeedsReview, mergeHypotheses, normalizeHypothesis } = await import("../../src/ai/hypothesis-profile.js");
const { setStatement, toggleDomainExclusion } = await import("../../src/model/statements.js");
const { domainScopeFromDomains } = await import("../../src/model/interpretations.js");
const { restoreNarrowedAreas } = await import("../../src/model/area-scope.js");
const { renderTasteMap } = await import("../../src/screens/tastemap.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { buildBackup } = await import("../../src/model/export.js");
const { state: appState, resetState, restoreStateFromBackupText } = await import("../../src/state.js");
const { recommendations, followUpPool } = await import("./fixtures/catalog.js");
const { emptyState, react } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("area scope tests");

const byId = (id) => [...recommendations, ...followUpPool].find((item) => item.id === id);
const CLAIM = "Places that feel lived-in hold attention, in films and in games alike.";
const PLACES = { id: "ai-places", title: "Lived-in places", claim: CLAIM, supports: ["ev:eeaao", "ev:severance", "ev:outerwilds"], counters: [], domains: ["movies", "play"], strength: "supported", status: "supported", crossDomain: "tentative", context: null };

function baseState(s = emptyState()) {
  ["eeaao", "severance", "outerwilds", "barry"].forEach((id) => react(s, byId(id), "loved"));
  s.modelHypotheses = [{ ...PLACES }];
  s.hypothesisHistory = [{ id: "rev-0", hypothesisId: "ai-places", claim: CLAIM, supports: PLACES.supports, counters: [], domains: ["movies", "play"], level: "supported", origin: "model", reason: "Live Taste Profile refresh" }];
  s.patternStatements = [];
  setStatement(s, "ai-places", "says", "partial");
  return s;
}
const areasOf = (s) => (s.modelHypotheses.find((p) => p.id === "ai-places")?.domains ?? []).join(",");
const shownOf = (s) => domainScopeFromDomains(s.modelHypotheses.find((p) => p.id === "ai-places")?.domains, s.patternStatements.find((x) => x.hypothesisId === "ai-places")?.excludedDomains ?? []).supported.join(",");

// One production refresh: the endpoint's server steps, then the client's merge.
function refresh(s, modelAnswer) {
  const ctx = buildContext(s);
  const preserved = preserveExistingHypotheses(normalizeHypothesisResponse(modelAnswer, ctx), ctx, s.modelHypotheses);
  const validated = settleConfirmedHypotheses(validateHypotheses(preserved, ctx), ctx, s.modelHypotheses);
  const next = validated.accepted.map((h, i) => normalizeHypothesis(h, i, s));
  s.modelHypotheses = markNeedsReview(mergeHypotheses(s.modelHypotheses, next, { statements: s.patternStatements, activeLimit: 12, preserveExistingActive: validated.rejected.length > 0 }), validated.needsReview);
  return validated;
}
const copyWithout = (domains) => ({ hypotheses: [{ id: "ai-places", label: PLACES.title, claim: CLAIM, evidence: PLACES.supports, counter: [], domains, crossDomain: "untested", level: "supported", conditional: false, context: null }] });

// ---- 1. the round trip: exclude, refresh twice, save, reload, export, import, include again --------------------
{
  const s = baseState();
  toggleDomainExclusion(s, "ai-places", "movies");
  refresh(s, { hypotheses: [] });                 // the model leaves the pattern out
  eq("excluded, refresh 1 (omitted): the pattern keeps its own areas", areasOf(s), "movies,play");
  eq("excluded, refresh 1: shown without the excluded area", shownOf(s), "play");
  refresh(s, copyWithout(["play"]));              // the model returns it word for word, minus the excluded area
  eq("excluded, refresh 2 (copy without it): still keeps its own areas", areasOf(s), "movies,play");
  eq("excluded, refresh 2: still shown without it", shownOf(s), "play");
  check("excluded: the Taste Map leaves the excluded area out", !/Movies/.test(renderTasteMap(s.modelHypotheses, s.patternStatements).match(/map-node-notes">([^<]*)/)?.[1] ?? "Movies"));

  stored.clear();
  persistState(s);
  const reloaded = loadPersistedState();
  eq("saved and reloaded: areas intact", (reloaded.modelHypotheses.find((p) => p.id === "ai-places")?.domains ?? []).join(","), "movies,play");
  eq("saved and reloaded: the exclusion intact", reloaded.patternStatements.find((x) => x.hypothesisId === "ai-places")?.excludedDomains.join(","), "movies");

  appState.viewingExample = false;
  restoreStateFromBackupText(JSON.stringify(buildBackup(s)));
  eq("exported and imported: areas intact", areasOf(appState), "movies,play");
  eq("exported and imported: the exclusion intact", appState.patternStatements.find((x) => x.hypothesisId === "ai-places")?.excludedDomains.join(","), "movies");

  toggleDomainExclusion(s, "ai-places", "movies");
  refresh(s, copyWithout(["movies", "play"]));
  eq("included again, after a refresh: its areas", areasOf(s), "movies,play");
  eq("included again: shown as supported in the area again, not untested", shownOf(s), "movies,play");
}
{
  // A brand-new model claim still can't claim an excluded area.
  const s = baseState();
  toggleDomainExclusion(s, "ai-places", "movies");
  const ctx = buildContext(s);
  const fresh = { hypotheses: [{ id: "ai-places", label: PLACES.title, claim: "A brand new claim about lived-in places that the user never confirmed.", evidence: PLACES.supports, counter: [], domains: ["movies", "play"], crossDomain: "tentative", level: "supported", conditional: false, context: null }] };
  const direct = validateHypotheses(normalizeHypothesisResponse(fresh, ctx), ctx);
  check("a new model claim in an excluded area is still rejected", direct.rejected.some((r) => r.reasons.some((why) => /not them in: movies/.test(why))));
  const forged = { hypotheses: [{ ...fresh.hypotheses[0], carriedForward: true }] };
  const { expandProfileRefs } = await import("../../src/ai/profile-context.js");
  const viaModel = validateHypotheses(normalizeHypothesisResponse(expandProfileRefs(forged, new Map()), ctx), ctx);
  check("a model answer can't mark itself carried forward to skip that check", viaModel.rejected.some((r) => r.reasons.some((why) => /not them in: movies/.test(why))));
}

// ---- 1b. PR #328 review: the Taste Map when every area is excluded ---------------------------------------------
{
  const pats = [
    { id: "ai-all", title: "All excluded", claim: "x", supports: [], counters: [], domains: ["movies", "play"], strength: "supported", status: "supported" },
    { id: "ai-other", title: "Other pattern", claim: "y", supports: [], counters: [], domains: ["movies"], strength: "supported", status: "supported" },
    { id: "ai-some", title: "Some excluded", claim: "z", supports: [], counters: [], domains: ["movies", "tv"], strength: "supported", status: "supported" }
  ];
  const statements = [
    { hypothesisId: "ai-all", says: "partial", excludedDomains: ["movies", "play"] },
    { hypothesisId: "ai-some", says: "partial", excludedDomains: ["movies"] }
  ];
  const html = renderTasteMap(pats, statements);
  const node = (title) => html.match(new RegExp(`<b>${title}</b>[\\s\\S]*?map-node-conf">([^<]*)</span>[\\s\\S]*?map-node-notes">([^<]*)</span>`));
  eq("every area excluded, map: status says so", node("All excluded")?.[1], "Excluded from all areas");
  eq("every area excluded, map: no areas listed on the node", node("All excluded")?.[2], "");
  eq("partly excluded, map: only the included area is listed", node("Some excluded")?.[2], "TV");
  eq("excluded areas never connect patterns (only the other pattern's own area is left)", (html.match(/<line /g) ?? []).length, 0);
  const panels = [...html.matchAll(/<h3>([^<]*)<\/h3>\s*<p>([^<]*)<\/p>/g)].map((m) => `${m[1]}=${m[2]}`);
  check("every area excluded, map: not in any area panel", !panels.some((p) => p.includes("All excluded")), panels.join(" | "));
  check("partly excluded, map: not in the excluded area's panel", !panels.some((p) => p.startsWith("Movies=") && p.includes("Some excluded")), panels.join(" | "));
  check("partly excluded, map: in the included area's panel", panels.some((p) => p.startsWith("TV=") && p.includes("Some excluded")), panels.join(" | "));
}

// ---- 2. the migration -------------------------------------------------------------------------------------------
// A profile narrowed by the old behavior: model revision with both areas, the user's exclusion, then a refresh
// that wrote the narrowed list.
function narrowed(overrides = {}) {
  const s = baseState();
  toggleDomainExclusion(s, "ai-places", "movies");
  s.hypothesisHistory.push({ id: "rev-narrowed", hypothesisId: "ai-places", claim: CLAIM, supports: PLACES.supports, counters: [], domains: ["play"], level: "supported", origin: "model", reason: "Live Taste Profile refresh" });
  s.modelHypotheses = [{ ...PLACES, domains: ["play"] }];
  overrides.edit?.(s);
  return s;
}
{
  const s = narrowed();
  const before = s.hypothesisHistory.length;
  const restored = restoreNarrowedAreas(s);
  eq("unambiguous history: the area is restored", areasOf(s), "play,movies");
  eq("unambiguous history: reported", restored.map((r) => `${r.hypothesisId}:${r.domainId}`).join(","), "ai-places:movies");
  eq("unambiguous history: recorded in the pattern's history", s.hypothesisHistory.length, before + 1);
  eq("unambiguous history: recorded as a system revision", s.hypothesisHistory.at(-1).origin, "system");
  eq("still excluded: not shown in that area", shownOf(s), "play");
  const again = restoreNarrowedAreas(s);
  eq("run again: nothing changes", again.length, 0);
  eq("run again: no extra history", s.hypothesisHistory.length, before + 1);
  eq("run again: areas the same", areasOf(s), "play,movies");
  toggleDomainExclusion(s, "ai-places", "movies");
  eq("included again after the restore: shown in that area", shownOf(s), "play,movies");
}
{
  // The area was included again before the migration ever ran: still restored (the record is unambiguous).
  const s = narrowed({ edit: (x) => toggleDomainExclusion(x, "ai-places", "movies") });
  restoreNarrowedAreas(s);
  eq("already included again: the area comes back", areasOf(s), "play,movies");
  eq("already included again: shown as supported there", shownOf(s), "play,movies");
}
for (const [name, edit] of [
  ["no history at all", (s) => { s.hypothesisHistory = []; }],
  ["no recorded exclusion", (s) => { s.hypothesisHistory = s.hypothesisHistory.filter((r) => !/not applying to/.test(r.reason ?? "")); }],
  ["the model revision before the exclusion didn't list the area", (s) => { s.hypothesisHistory[0] = { ...s.hypothesisHistory[0], domains: ["play"] }; }],
  ["the model revision before the exclusion had a different claim", (s) => { s.hypothesisHistory[0] = { ...s.hypothesisHistory[0], claim: "An older, different claim." }; }],
  ["a later model revision changed the claim", (s) => { s.hypothesisHistory.push({ id: "rev-later", hypothesisId: "ai-places", claim: "A reworded claim from a later refresh.", domains: ["play"], origin: "model", reason: "Live Taste Profile refresh" }); }],
  ["no current evidence in the area", (s) => { s.modelHypotheses = [{ ...s.modelHypotheses[0], supports: ["ev:outerwilds"] }]; }],
  ["the pattern was reworded since (claim differs from the record)", (s) => { s.modelHypotheses = [{ ...s.modelHypotheses[0], claim: "A claim the history never recorded." }]; }]
]) {
  const s = narrowed({ edit });
  const patternsBefore = JSON.stringify(s.modelHypotheses);
  const historyBefore = s.hypothesisHistory.length;
  const restored = restoreNarrowedAreas(s);
  eq(`${name}: left exactly as it is`, JSON.stringify(s.modelHypotheses), patternsBefore);
  eq(`${name}: nothing reported`, restored.length, 0);
  eq(`${name}: no history added`, s.hypothesisHistory.length, historyBefore);
}
{
  // A pattern the old behavior never narrowed is untouched.
  const s = baseState();
  toggleDomainExclusion(s, "ai-places", "movies");
  const before = JSON.stringify(s.modelHypotheses);
  restoreNarrowedAreas(s);
  eq("not narrowed: untouched", JSON.stringify(s.modelHypotheses), before);
}
{
  // An older backup with a narrowed pattern is migrated when it's restored, the same way.
  appState.viewingExample = false;
  restoreStateFromBackupText(JSON.stringify(buildBackup(narrowed())));
  eq("older backup restored: the area comes back", areasOf(appState), "play,movies");
  const historyAfter = appState.hypothesisHistory.length;
  restoreStateFromBackupText(JSON.stringify(buildBackup(appState)));
  eq("restored twice: still the same", areasOf(appState), "play,movies");
  eq("restored twice: no extra history", appState.hypothesisHistory.length, historyAfter);
  resetState();
}

finish();
