#!/usr/bin/env node
// Nov 4 (after #328): "Confirm it still fits" keeps the user's confirmation and claim, but what the remaining
// evidence allows (level, areas, cross-domain reach) is recomputed with the validator's own rules
// (src/model/evidence-rules.js), never higher than before. Also checks the rules moved there are the very
// same functions the validator uses. Free, no browser, no model call.
//
//   node scripts/qa/reconfirm-recompute-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const ST = await import("../../src/model/statements.js");
const rules = await import("../../src/model/evidence-rules.js");
const validate = await import("../../src/ai/validate.js");
const interpretations = await import("../../src/model/interpretations.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { buildBackup } = await import("../../src/model/export.js");
const { state: appState, restoreStateFromBackupText } = await import("../../src/state.js");
const { emptyState } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("reconfirm recompute tests");

const item = (id, domains) => ({ id, title: `Title ${id}`, type: domains[0] === "play" ? "game" : "movie", domains, provider: "custom", custom: true });
const loved = (id, domains) => ({ item: item(id, domains), rating: "more", detail: "loved-before" });

// A confirmed pattern flagged after `removed` was deleted; ratings maps id -> areas.
function flagged(pattern, ratings, removed, statement = {}) {
  const s = emptyState([]);
  for (const [id, domains] of Object.entries(ratings)) s.feedbackByRecommendation[id] = loved(id, domains);
  delete s.feedbackByRecommendation[removed];
  s.modelHypotheses = [{ claim: "A claim about these titles that the user confirmed earlier.", counters: [], context: null, ...pattern, evidenceStatus: ST.NEEDS_REVIEW }];
  s.patternStatements = [{ hypothesisId: pattern.id, label: pattern.title, says: "accurate", weight: "lot", context: null, authority: "user-confirmed", ...statement }];
  return s;
}
const pat = (s, id) => s.modelHypotheses.find((p) => p.id === id);

// ---- 0. the rules moved, not changed: the validator uses the very same functions -----------------------------
eq("validator's allowedLevel is the shared rule", validate.allowedLevel, rules.allowedLevel);
eq("validator's allowedCrossDomain is the shared rule", validate.allowedCrossDomain, rules.allowedCrossDomain);
eq("validator's triedRecords is the shared rule", validate.triedRecords, rules.triedRecords);
eq("interpretations' domainScope is the shared rule", interpretations.domainScope, rules.domainScope);

// ---- 1. a Strong pattern loses one of its three tried ratings ----------------------------------------------------
{
  const s = flagged({ id: "ai-s", title: "Strong", supports: ["ev:a", "ev:b", "ev:c"], domains: ["movies"], strength: "strong", status: "strong", crossDomain: "untested" },
    { a: ["movies"], b: ["movies"], c: ["movies"] }, "c");
  ST.reconfirmPattern(s, "ai-s");
  eq("Strong on 3, one removed: level recomputed to what 2 allow", pat(s, "ai-s").strength, "supported");
  eq("…and the status shown follows it", pat(s, "ai-s").status, "supported");
  check("…flag cleared", !pat(s, "ai-s").evidenceStatus);
}

// ---- 2. a cross-media pattern loses its only rating in one area --------------------------------------------------
{
  const s = flagged({ id: "ai-x", title: "Cross", supports: ["ev:m1", "ev:m2", "ev:g1"], domains: ["movies", "play"], strength: "supported", status: "supported", crossDomain: "tentative" },
    { m1: ["movies"], m2: ["movies"], g1: ["play"] }, "g1");
  ST.reconfirmPattern(s, "ai-x");
  eq("cross-media, the only game rating removed: games no longer an area", pat(s, "ai-x").domains.join(","), "movies");
  eq("…cross-domain reach recomputed", pat(s, "ai-x").crossDomain, "untested");
}

// ---- 3. the normal reconfirmation still works -------------------------------------------------------------------
{
  const s = flagged({ id: "ai-v", title: "Valid", supports: ["ev:a", "ev:b", "ev:c", "ev:d"], domains: ["movies"], strength: "supported", status: "supported", crossDomain: "untested" },
    { a: ["movies"], b: ["movies"], c: ["movies"], d: ["movies"] }, "d");
  const claim = pat(s, "ai-v").claim;
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({}) }; };
  const message = ST.reconfirmPattern(s, "ai-v");
  globalThis.fetch = realFetch;
  check("control: works", Boolean(message));
  eq("control: no request", calls, 0);
  eq("control: the user's confirmation is unchanged", s.patternStatements[0].says, "accurate");
  eq("control: the claim is unchanged", pat(s, "ai-v").claim, claim);
  eq("control: a level the evidence still allows is kept", pat(s, "ai-v").strength, "supported");
  const last = s.hypothesisHistory.at(-1);
  eq("history: recorded as the user's", last?.origin, "user-confirmed");
  eq("history: records the remaining evidence", last?.supports.join(","), "ev:a,ev:b,ev:c");
  eq("history: records the level", last?.level, "supported");
  eq("history: records the areas", last?.domains.join(","), "movies");
}

// ---- 4. never raised -----------------------------------------------------------------------------------------------
{
  const s = flagged({ id: "ai-e", title: "Emerging", supports: ["ev:a", "ev:b", "ev:c", "ev:d"], domains: ["movies"], strength: "emerging", status: "emerging", crossDomain: "untested" },
    { a: ["movies"], b: ["movies"], c: ["movies"], d: ["movies"] }, "d");
  ST.reconfirmPattern(s, "ai-e");
  eq("an Emerging pattern whose remaining evidence would allow more stays Emerging", pat(s, "ai-e").strength, "emerging");
}
{
  const s = flagged({ id: "ai-t", title: "Tentative", supports: ["ev:m1", "ev:m2", "ev:g1", "ev:g2", "ev:g3"], domains: ["movies", "play"], strength: "supported", status: "supported", crossDomain: "untested" },
    { m1: ["movies"], m2: ["movies"], g1: ["play"], g2: ["play"], g3: ["play"] }, "g3");
  ST.reconfirmPattern(s, "ai-t");
  eq("cross-domain reach is never raised above what was stored", pat(s, "ai-t").crossDomain, "untested");
  eq("areas still supported are kept", pat(s, "ai-t").domains.join(","), "movies,play");
}

// ---- 5. Conditional and "only in some contexts" ------------------------------------------------------------------
{
  const s = flagged({ id: "ai-c", title: "Conditional", supports: ["ev:a", "ev:b", "ev:c"], domains: ["movies"], strength: "strong", status: "conditional", crossDomain: "untested" },
    { a: ["movies"], b: ["movies"], c: ["movies"] }, "c");
  ST.reconfirmPattern(s, "ai-c");
  eq("Conditional stays Conditional", pat(s, "ai-c").status, "conditional");
  eq("…while its level is recomputed", pat(s, "ai-c").strength, "supported");
}
{
  const s = flagged({ id: "ai-k", title: "Some contexts", supports: ["ev:a", "ev:b", "ev:c", "ev:d"], domains: ["movies"], strength: "strong", status: "strong", crossDomain: "untested" },
    { a: ["movies"], b: ["movies"], c: ["movies"], d: ["movies"] }, "d", { context: "some" });
  ST.reconfirmPattern(s, "ai-k");
  eq("'only in some contexts' still caps at Supported, as the validator does", pat(s, "ai-k").strength, "supported");
}

// ---- 6. the user's excluded areas are a separate setting -----------------------------------------------------------
{
  const s = flagged({ id: "ai-p", title: "Partly", supports: ["ev:m1", "ev:m2", "ev:t1", "ev:g1"], domains: ["movies", "tv", "play"], strength: "supported", status: "supported", crossDomain: "tentative" },
    { m1: ["movies"], m2: ["movies"], t1: ["tv"], g1: ["play"] }, "g1", { says: "partial", weight: null, excludedDomains: ["tv"] });
  ST.reconfirmPattern(s, "ai-p");
  eq("excluded area: the user's exclusion is untouched", s.patternStatements[0].excludedDomains.join(","), "tv");
  eq("excluded area: the confirmation is untouched", s.patternStatements[0].says, "partial");
  eq("excluded area: still-supported areas stay in its scope, the unsupported one goes", pat(s, "ai-p").domains.join(","), "movies,tv");
  eq("excluded area: shown without the excluded area", interpretations.domainScopeFromDomains(pat(s, "ai-p").domains, ["tv"]).supported.join(","), "movies");
}

// ---- 6b. PR #329 review: reconfirming never adds an area ------------------------------------------------------
{
  // A Games-only pattern that also cites movie ratings loses its only game rating.
  const s = flagged({ id: "ai-g", title: "Games only", supports: ["ev:g1", "ev:m1", "ev:m2"], domains: ["play"], strength: "supported", status: "supported", crossDomain: "untested" },
    { g1: ["play"], m1: ["movies"], m2: ["movies"] }, "g1");
  check("games-only, game rating removed: reconfirm still offered (movie ratings remain)", ST.canReconfirm(s, "ai-g"));
  ST.reconfirmPattern(s, "ai-g");
  eq("games-only, game rating removed: no area is invented (scope not changed to Movies)", pat(s, "ai-g").domains.join(","), "");
  eq("…history records the empty scope too", s.hypothesisHistory.at(-1)?.domains.join(","), "");
  const { renderTasteMap } = await import("../../src/screens/tastemap.js");
  const map = renderTasteMap(s.modelHypotheses, s.patternStatements);
  const notes = map.match(/<b>Games only<\/b>[\s\S]*?map-node-notes">([^<]*)</)?.[1];
  eq("Taste Map: an empty scope reads as still finding where it shows up", notes, "Still finding where this shows up");
  check("Taste Map: in no area panel", ![...map.matchAll(/<h3>([^<]*)<\/h3>\s*<p>([^<]*)<\/p>/g)].some((m) => m[2].includes("Games only")));
  appState.viewingExample = false;
  restoreStateFromBackupText(JSON.stringify(buildBackup(s)));
  appState.profileView = "list";
  const { renderProfile } = await import("../../src/screens/profile.js");
  const html = renderProfile();
  const row = html.slice(html.indexOf('data-profile-pattern="ai-g"'), html.indexOf("</article>", html.indexOf('data-profile-pattern="ai-g"')));
  check("Profile: the row renders", row.includes("Games only"), row.slice(0, 300));
  const rowText = row.replace(/<[^>]+>/g, " ").replaceAll("Games only", "");
  check("Profile: no area named for it", !/Movies|Games/.test(rowText), rowText.slice(0, 600));
}

// ---- 7. save / reload and backup / restore keep the recomputed values ----------------------------------------------
{
  const s = flagged({ id: "ai-s", title: "Strong", supports: ["ev:a", "ev:b", "ev:c", "ev:g1"], domains: ["movies", "play"], strength: "strong", status: "strong", crossDomain: "tentative" },
    { a: ["movies"], b: ["movies"], c: ["movies"], g1: ["play"] }, "g1");
  ST.reconfirmPattern(s, "ai-s");
  const expected = JSON.stringify({ strength: "strong", domains: ["movies"], crossDomain: "untested", flag: null });
  const shape = (p) => JSON.stringify({ strength: p?.strength, domains: p?.domains, crossDomain: p?.crossDomain, flag: p?.evidenceStatus ?? null });
  eq("recomputed: Strong kept (3 tried movie ratings remain), games dropped", shape(pat(s, "ai-s")), expected);
  stored.clear();
  persistState(s);
  eq("saved and reloaded: the recomputed values", shape(loadPersistedState().modelHypotheses.find((p) => p.id === "ai-s")), expected);
  appState.viewingExample = false;
  restoreStateFromBackupText(JSON.stringify(buildBackup(s)));
  eq("backup restored: the recomputed values", shape(pat(appState, "ai-s")), expected);
}

finish();
