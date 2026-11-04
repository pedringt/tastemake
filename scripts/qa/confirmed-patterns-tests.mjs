#!/usr/bin/env node
// #325: a Taste Profile refresh must never silently drop a pattern the user confirmed, and unrelated
// dislikes must not retire any pattern. Covers the server carry-forward (preserveExistingHypotheses,
// settleConfirmedHypotheses, the endpoint), the client merge and "Needs another look" flag, the profile
// cap, and the flag's save / reload / export / import and display. Free, no browser, no model call;
// synthetic catalog fixtures only.
//
//   node scripts/qa/confirmed-patterns-tests.mjs

import { createSuite } from "./lib/assert.mjs";

const stored = new Map();
globalThis.localStorage = {
  getItem(key) { return stored.get(key) ?? null; },
  setItem(key, value) { stored.set(key, String(value)); },
  removeItem(key) { stored.delete(key); }
};
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { buildContext } = await import("../../src/ai/context.js");
const { MAX_PROFILE_HYPOTHESES, normalizeHypothesisResponse, preserveExistingHypotheses, settleConfirmedHypotheses, validateHypotheses } = await import("../../src/ai/validate.js");
const { markNeedsReview, mergeHypotheses, normalizeHypothesis, refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { ALL_AREAS_EXCLUDED_LABEL, NEEDS_REVIEW, NEEDS_REVIEW_LABEL, NEEDS_REVIEW_TEXT, toggleDomainExclusion } = await import("../../src/model/statements.js");
const { produceHypotheses } = await import("../../api/hypotheses.mjs");
const { domainScopeFromDomains } = await import("../../src/model/interpretations.js");
const { persistState, loadPersistedState } = await import("../../src/persistence.js");
const { buildBackup, buildHtmlExport, parseBackupText } = await import("../../src/model/export.js");
const { recommendations, followUpPool } = await import("./fixtures/catalog.js");
const { emptyState, react } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("confirmed patterns tests");

const byId = (id) => [...recommendations, ...followUpPool].find((item) => item.id === id);
const pattern = (fields) => ({ counter: [], conditional: false, context: null, level: "emerging", crossDomain: "untested", ...fields });

// The structure found in the Nov 4 investigation, on catalog fixtures: a confirmed movies+games pattern
// and a confirmed games pattern, three unrelated game dislikes, and one of them cited against each.
const WORLDS = { id: "ai-worlds", title: "Immersive, atmospheric worlds", claim: "Worlds that feel lived-in and atmospheric hold attention across shows and games.", supports: ["ev:severance", "ev:outerwilds", "ev:controlgame"], counters: ["ev:disco"], domains: ["movies", "play"], strength: "supported", status: "supported", crossDomain: "tentative", context: null };
const PUZZLES = { id: "ai-puzzles", title: "Puzzle-driven story games", claim: "Games land when the story is uncovered by solving its puzzles yourself.", supports: ["ev:golden-idol", "ev:inscryption", "ev:outerwilds"], counters: ["ev:disco"], domains: ["play"], strength: "supported", status: "supported", crossDomain: "untested", context: null };
const NEW_PATTERN = pattern({ id: "ai-comedy", label: "Comedy with a dark edge", claim: "Comedy lands when it has real stakes and a dark edge underneath.", evidence: ["ev:eeaao", "ev:barry"], domains: ["movies"], level: "supported" });

function investigationState({ says = "accurate", extra = {} } = {}) {
  const s = emptyState();
  ["severance", "outerwilds", "controlgame", "golden-idol", "inscryption", "eeaao", "barry"].forEach((id) => react(s, byId(id), "loved"));
  ["disco", "signalis", "forgotten-city"].forEach((id) => react(s, byId(id), "disliked"));
  s.modelHypotheses = [{ ...WORLDS }, { ...PUZZLES }];
  s.patternStatements = says ? s.modelHypotheses.map((h) => ({ hypothesisId: h.id, label: h.title, says, weight: says === "accurate" ? "lot" : null, context: null, authority: "user-confirmed", ...extra })) : [];
  s.hypothesisHistory = [{ id: "rev-1", hypothesisId: "ai-worlds", claim: WORLDS.claim, origin: "model", reason: "earlier refresh" }];
  return s;
}

// What production does with one model answer: the endpoint's server steps, then the client's merge.
function refresh(s, modelAnswer) {
  const ctx = buildContext(s);
  const preserved = preserveExistingHypotheses(normalizeHypothesisResponse(modelAnswer, ctx), ctx, s.modelHypotheses);
  const validated = settleConfirmedHypotheses(validateHypotheses(preserved, ctx), ctx, s.modelHypotheses);
  const next = validated.accepted.map((h, i) => normalizeHypothesis(h, i, s));
  const merged = markNeedsReview(mergeHypotheses(s.modelHypotheses, next, { statements: s.patternStatements, activeLimit: 12, preserveExistingActive: validated.rejected.length > 0 }), validated.needsReview);
  return { preserved, validated, merged };
}

// ---- 1. regression: confirmed patterns survive unrelated same-medium dislikes ---------------------------
for (const says of ["accurate", "partial"]) {
  const s = investigationState({ says });
  const statementsBefore = JSON.stringify(s.patternStatements);
  const historyBefore = JSON.stringify(s.hypothesisHistory);
  const { preserved, validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  check(`${says}: both confirmed patterns survive the server carry-forward`, ["ai-worlds", "ai-puzzles"].every((id) => preserved.hypotheses.some((h) => h.id === id)), preserved.hypotheses.map((h) => h.id).join(","));
  check(`${says}: both are accepted by the check`, ["ai-worlds", "ai-puzzles"].every((id) => validated.accepted.some((h) => h.id === id)));
  eq(`${says}: nothing needs review`, validated.needsReview.length, 0);
  check(`${says}: both survive the client merge`, ["ai-worlds", "ai-puzzles"].every((id) => merged.some((h) => h.id === id)), merged.map((h) => h.id).join(","));
  check(`${says}: the model's new pattern is kept too`, merged.some((h) => h.id === "ai-comedy"));
  eq(`${says}: the cited counter stays attached`, merged.find((h) => h.id === "ai-worlds")?.counters.join(","), "ev:disco");
  check(`${says}: no flag on patterns whose evidence holds`, merged.every((h) => !h.evidenceStatus));
  eq(`${says}: the user's answers are untouched`, JSON.stringify(s.patternStatements), statementsBefore);
  eq(`${says}: the revision history is untouched`, JSON.stringify(s.hypothesisHistory), historyBefore);
}
{
  // A context-qualified answer ("depends on context") keeps the same protection and its level cap.
  const s = investigationState({ says: "accurate", extra: { context: "some" } });
  const { validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  check("context-qualified: both patterns survive", ["ai-worlds", "ai-puzzles"].every((id) => merged.some((h) => h.id === id)));
  check("context-qualified: the level cap still applies", validated.accepted.filter((h) => h.carriedForward).every((h) => h.level !== "strong"));
}

// ---- 2. unconfirmed patterns: dislikes alone never retire them -------------------------------------------
{
  const s = investigationState({ says: null });
  const { merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  check("unconfirmed: same-medium dislikes do not drop either pattern", ["ai-worlds", "ai-puzzles"].every((id) => merged.some((h) => h.id === id)), merged.map((h) => h.id).join(","));
}
{
  // Two cited dislikes against the pattern: citation alone is not proof of contradiction (#278).
  const s = investigationState({ says: null });
  s.modelHypotheses = [{ ...PUZZLES, counters: ["ev:disco", "ev:signalis", "ev:forgotten-city"] }];
  const { validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  const kept = validated.accepted.find((h) => h.id === "ai-puzzles");
  check("unconfirmed: three cited dislikes do not drop it", Boolean(kept) && merged.some((h) => h.id === "ai-puzzles"));
  eq("unconfirmed: the cited dislikes stay attached", kept?.counter.length, 3);
  eq("unconfirmed: the level is still capped by the evidence (3 tried for, 3 against)", kept?.level, "emerging");
}

// ---- 3. confirmed with genuine counter-evidence: kept, evidence attached, level evidence-capped ---------
{
  const s = investigationState();
  s.modelHypotheses = [{ ...PUZZLES, strength: "strong", counters: ["ev:disco", "ev:signalis", "ev:forgotten-city"] }, { ...WORLDS }];
  const statementsBefore = JSON.stringify(s.patternStatements);
  const { validated, merged } = refresh(s, { hypotheses: [] });
  const kept = validated.accepted.find((h) => h.id === "ai-puzzles");
  check("confirmed with counters: kept", Boolean(kept) && merged.some((h) => h.id === "ai-puzzles"));
  eq("confirmed with counters: counters attached", kept?.counter.length, 3);
  eq("confirmed with counters: level re-capped by the evidence", kept?.level, "emerging");
  eq("confirmed with counters: answer unchanged", JSON.stringify(s.patternStatements), statementsBefore);
}

// ---- 4. confirmed with invalid evidence: flagged, never presented as supported --------------------------
function invalidEvidenceState() {
  // ai-puzzles rested only on three reactions the user has since removed.
  const s = investigationState();
  ["golden-idol", "inscryption"].forEach((id) => delete s.feedbackByRecommendation[id]);
  s.modelHypotheses = [{ ...WORLDS }, { ...PUZZLES, supports: ["ev:golden-idol", "ev:inscryption"], counters: [] }];
  return s;
}
{
  const s = invalidEvidenceState();
  const statementsBefore = JSON.stringify(s.patternStatements);
  const { validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  check("invalid evidence: not accepted as a normal pattern", !validated.accepted.some((h) => h.id === "ai-puzzles"));
  eq("invalid evidence: listed in needsReview", validated.needsReview.join(","), "ai-puzzles");
  const flagged = merged.find((h) => h.id === "ai-puzzles");
  eq("invalid evidence: the client keeps it, flagged", flagged?.evidenceStatus, NEEDS_REVIEW);
  eq("invalid evidence: the stored claim is unchanged", flagged?.claim, PUZZLES.claim);
  eq("invalid evidence: the user's answer is unchanged", JSON.stringify(s.patternStatements), statementsBefore);
  check("invalid evidence: the valid confirmed pattern is not flagged", !merged.find((h) => h.id === "ai-worlds")?.evidenceStatus);

  // A later refresh with the evidence still missing keeps the flag.
  s.modelHypotheses = merged;
  const again = refresh(s, { hypotheses: [NEW_PATTERN] });
  eq("still invalid on the next refresh: flag stays", again.merged.find((h) => h.id === "ai-puzzles")?.evidenceStatus, NEEDS_REVIEW);

  // Evidence restored: the carried pattern passes the check, and the flag clears.
  s.modelHypotheses = again.merged;
  ["golden-idol", "inscryption"].forEach((id) => react(s, byId(id), "loved"));
  const restored = refresh(s, { hypotheses: [NEW_PATTERN] });
  const cleared = restored.merged.find((h) => h.id === "ai-puzzles");
  check("evidence restored: accepted again", restored.validated.accepted.some((h) => h.id === "ai-puzzles"));
  check("evidence restored: the flag clears", Boolean(cleared) && !cleared.evidenceStatus, JSON.stringify(cleared));
}
{
  // The model returns its own version of the flagged confirmed pattern, still without valid evidence:
  // it cannot replace the stored interpretation or clear the flag.
  const s = invalidEvidenceState();
  s.modelHypotheses = markNeedsReview(s.modelHypotheses, ["ai-puzzles"]);
  const rewrite = pattern({ id: "ai-puzzles", label: "Puzzle-driven story games", claim: "A rewritten claim the model made up while the evidence is gone.", evidence: ["ev:golden-idol"], domains: ["play"], level: "strong" });
  const { validated, merged } = refresh(s, { hypotheses: [rewrite, NEW_PATTERN] });
  check("invalid model rewrite: rejected", validated.rejected.some((r) => r.proposal.id === "ai-puzzles"));
  eq("invalid model rewrite: still listed for review", validated.needsReview.join(","), "ai-puzzles");
  const kept = merged.find((h) => h.id === "ai-puzzles");
  eq("invalid model rewrite: the stored claim stays", kept?.claim, PUZZLES.claim);
  eq("invalid model rewrite: the flag stays", kept?.evidenceStatus, NEEDS_REVIEW);
}
{
  // The model returns a rewrite of a confirmed pattern that fails the check, while the stored version is
  // still valid: the stored version is kept, not the bad rewrite.
  const s = investigationState();
  const rewrite = pattern({ id: "ai-worlds", label: "Immersive, atmospheric worlds", claim: "Worlds are always atmospheric, no matter what the user tried.", evidence: ["ev:does-not-exist"], domains: ["movies", "play"] });
  const { validated, merged } = refresh(s, { hypotheses: [rewrite, NEW_PATTERN] });
  eq("bad rewrite of a valid confirmed pattern: the stored claim is kept", merged.find((h) => h.id === "ai-worlds")?.claim, WORLDS.claim);
  eq("bad rewrite of a valid confirmed pattern: nothing needs review", validated.needsReview.length, 0);
}
{
  // Evidence restored and the model rewords the flagged confirmed pattern: the confirmed claim stays
  // (a confirmation never transfers to a new wording), the stored evidence passes again, the flag clears.
  const s = invalidEvidenceState();
  s.modelHypotheses = markNeedsReview(s.modelHypotheses, ["ai-puzzles"]);
  react(s, byId("golden-idol"), "loved");
  const revision = pattern({ id: "ai-puzzles", label: "Puzzle-driven story games", claim: "Games land when uncovering the story means solving its puzzles yourself.", evidence: ["ev:golden-idol"], domains: ["play"], level: "supported" });
  const { merged } = refresh(s, { hypotheses: [revision] });
  const kept = merged.find((h) => h.id === "ai-puzzles");
  eq("reworded revision of a flagged confirmed pattern: the confirmed claim stays", kept?.claim, PUZZLES.claim);
  // PR #328 review: Inscryption, which it also cites, is still removed, so the flag stays (a removed
  // supporting reaction always means "Needs another look", even when what remains passes).
  eq("…but while one of its supporting reactions is still removed, the flag stays", kept?.evidenceStatus, NEEDS_REVIEW);
  s.modelHypotheses = merged;
  react(s, byId("inscryption"), "loved");
  const again = refresh(s, { hypotheses: [revision] }).merged.find((h) => h.id === "ai-puzzles");
  check("…and the flag clears once all its evidence passes again", Boolean(again) && !again.evidenceStatus);
}

// ---- 4b. the endpoint reports needsReview, including when nothing else was accepted ----------------------
async function endpoint(s, answer) {
  const rawState = { ...s, selectedFavorites: [...s.selectedFavorites], libraryFavorites: [], blindSpotDismissed: [] };
  const env = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", VERCEL_ENV: "preview" };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 10, output_tokens: 20 }, model: "claude-test" }) });
  const quiet = [console.log, console.info];
  console.log = () => {}; console.info = () => {};
  try { return await produceHypotheses({ rawState, env, fetchImpl }); }
  finally { [console.log, console.info] = quiet; }
}
{
  const payload = await endpoint(invalidEvidenceState(), { hypotheses: [], insufficientEvidence: false });
  eq("endpoint: needsReview lists the unverifiable confirmed pattern", payload.meta?.needsReview?.join(","), "ai-puzzles");
  check("endpoint: the valid confirmed pattern is returned", payload.hypotheses.some((h) => h.id === "ai-worlds"));
  check("endpoint: the unverifiable one is not returned as supported", !payload.hypotheses.some((h) => h.id === "ai-puzzles"));
}
{
  const s = invalidEvidenceState();
  s.modelHypotheses = [s.modelHypotheses[1]];
  s.patternStatements = s.patternStatements.filter((x) => x.hypothesisId === "ai-puzzles");
  const payload = await endpoint(s, { hypotheses: [], insufficientEvidence: false });
  eq("endpoint, nothing accepted: still not a model answer", payload.source, "unavailable");
  eq("endpoint, nothing accepted: needsReview is still reported", payload.meta?.needsReview?.join(","), "ai-puzzles");
}

// ---- 4c. the client refresh sets and clears the flag ----------------------------------------------------
async function clientRefresh(s, payload) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  try { await refreshProfileHypotheses(s, { force: true }); }
  finally { globalThis.fetch = realFetch; }
}
{
  const s = invalidEvidenceState();
  const accepted = { ...validateHypotheses(normalizeHypothesisResponse({ hypotheses: [{ ...NEW_PATTERN }] }, buildContext(s)), buildContext(s)).accepted[0] };
  await clientRefresh(s, { source: "model", hypotheses: [accepted], meta: { rejected: 0, needsReview: ["ai-puzzles"] } });
  eq("client: a refresh with needsReview flags the pattern", s.modelHypotheses.find((h) => h.id === "ai-puzzles")?.evidenceStatus, NEEDS_REVIEW);
  check("client: the confirmed pattern with valid evidence is kept even with nothing rejected", s.modelHypotheses.some((h) => h.id === "ai-worlds"));

  await clientRefresh(s, { source: "unavailable", hypotheses: [], meta: { needsReview: ["ai-puzzles"] } });
  eq("client: a no-accept answer keeps the flag", s.modelHypotheses.find((h) => h.id === "ai-puzzles")?.evidenceStatus, NEEDS_REVIEW);

  const back = normalizeHypothesis(pattern({ id: "ai-puzzles", label: PUZZLES.title, claim: PUZZLES.claim, evidence: ["ev:outerwilds"], domains: ["play"], level: "supported" }), 0, s);
  await clientRefresh(s, { source: "model", hypotheses: [{ id: "ai-puzzles", label: PUZZLES.title, claim: PUZZLES.claim, evidence: back.supports, counter: [], domains: ["play"], level: "supported", crossDomain: "untested", conditional: false, context: null }], meta: { rejected: 0, needsReview: [] } });
  const cleared = s.modelHypotheses.find((h) => h.id === "ai-puzzles");
  check("client: a later accepted refresh clears the flag", Boolean(cleared) && !cleared.evidenceStatus, JSON.stringify(cleared));
}

// ---- 5. scoped exclusions ---------------------------------------------------------------------------------
{
  const s = investigationState({ says: "partial", extra: { excludedDomains: ["movies"] } });
  s.patternStatements = s.patternStatements.filter((x) => x.hypothesisId === "ai-worlds");
  const { validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  const kept = validated.accepted.find((h) => h.id === "ai-worlds");
  check("scoped exclusion: the carried partly pattern survives", Boolean(kept) && merged.some((h) => h.id === "ai-worlds"));
  // Nov 4 (after #325): the pattern keeps its own areas; the exclusion is applied where it is shown.
  eq("scoped exclusion: the stored areas are kept, not narrowed", kept?.domains.join(","), "movies,play");
  eq("scoped exclusion: shown without the excluded area", domainScopeFromDomains(kept?.domains, ["movies"]).supported.join(","), "play");
  eq("scoped exclusion: nothing needs review", validated.needsReview.length, 0);

  const claimsExcluded = pattern({ id: "ai-worlds", label: WORLDS.title, claim: WORLDS.claim, evidence: WORLDS.supports, domains: ["movies", "play"], crossDomain: "tentative", level: "supported" });
  const ctx = buildContext(s);
  const direct = validateHypotheses(normalizeHypothesisResponse({ hypotheses: [claimsExcluded] }, ctx), ctx);
  check("scoped exclusion: a model answer claiming the excluded area is still rejected", direct.rejected.some((r) => r.reasons.some((why) => /not them in: movies/.test(why))));
  const viaRefresh = refresh(s, { hypotheses: [claimsExcluded] });
  eq("scoped exclusion: after that rejection the stored version is kept with its own areas", viaRefresh.validated.accepted.find((h) => h.id === "ai-worlds")?.domains.join(","), "movies,play");
}

// ---- 6. "not me" still removes the pattern -----------------------------------------------------------------
for (const before of ["accurate", null]) {
  const s = investigationState({ says: before });
  s.patternStatements = [{ hypothesisId: "ai-worlds", label: WORLDS.title, says: "not-me", authority: "user-confirmed" }];
  const { validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  check(`not me (${before ?? "unconfirmed"} before): not accepted`, !validated.accepted.some((h) => h.id === "ai-worlds"));
  check(`not me (${before ?? "unconfirmed"} before): not flagged for review`, !validated.needsReview.includes("ai-worlds"));
  const active = merged.filter((h) => h.id !== "ai-worlds" || false);
  check(`not me (${before ?? "unconfirmed"} before): kept only in corrected history, last`, merged[merged.length - 1]?.id === "ai-worlds" && active.length === merged.length - 1);
}

// ---- 7. the profile cap never displaces a confirmed pattern -------------------------------------------------
const filler = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `ai-${prefix}-${i}`, title: `${prefix} pattern ${i}`, claim: `A ${prefix} pattern number ${i} resting on one loved film.`, supports: ["ev:eeaao"], counters: [], domains: ["movies"], strength: "emerging" }));
const confirm = (patterns) => patterns.map((p) => ({ hypothesisId: p.id, label: p.title, says: "accurate" }));
function capState(confirmedCount, earlierUnconfirmed) {
  const s = emptyState();
  react(s, byId("eeaao"), "loved");
  const confirmedPatterns = filler("confirmed", confirmedCount);
  s.modelHypotheses = [...confirmedPatterns, ...filler("earlier", earlierUnconfirmed)];
  s.patternStatements = confirm(confirmedPatterns);
  return s;
}
const newProposals = (n) => ({ hypotheses: Array.from({ length: n }, (_, i) => pattern({ id: `ai-new-${i}`, label: `New pattern ${i}`, claim: `New pattern number ${i} resting on one loved film.`, evidence: ["ev:eeaao"], domains: ["movies"] })) });
{
  const s = capState(12, 0);
  const ctx = buildContext(s);
  const server = preserveExistingHypotheses(normalizeHypothesisResponse(newProposals(3), ctx), ctx, s.modelHypotheses);
  eq("12 confirmed + 3 new: the server keeps all 12 confirmed and no new ones", server.hypotheses.map((h) => h.id).filter((id) => id.startsWith("ai-confirmed")).length, 12);
  eq("12 confirmed + 3 new: new proposals give way", server.hypotheses.length, MAX_PROFILE_HYPOTHESES);
  const client = mergeHypotheses(s.modelHypotheses, newProposals(3).hypotheses.map((h) => ({ id: h.id, title: h.label, claim: h.claim })), { statements: s.patternStatements, preserveExistingActive: false });
  eq("12 confirmed + 3 new: the client keeps all 12 confirmed", client.filter((h) => h.id.startsWith("ai-confirmed")).length, 12);
}
{
  const s = capState(13, 0);
  const ctx = buildContext(s);
  const server = preserveExistingHypotheses(normalizeHypothesisResponse({ hypotheses: [] }, ctx), ctx, s.modelHypotheses);
  eq("13 confirmed: the server keeps all 13", server.hypotheses.length, 13);
  const client = mergeHypotheses(s.modelHypotheses, [], { statements: s.patternStatements, preserveExistingActive: false });
  eq("13 confirmed: the client keeps all 13", client.length, 13);
}
{
  const s = capState(9, 4);
  const ctx = buildContext(s);
  const server = preserveExistingHypotheses(normalizeHypothesisResponse(newProposals(2), ctx), ctx, s.modelHypotheses);
  const ids = server.hypotheses.map((h) => h.id);
  eq("9 confirmed + 4 earlier + 2 new: 12 kept", ids.length, 12);
  eq("…all 9 confirmed", ids.filter((id) => id.startsWith("ai-confirmed")).length, 9);
  eq("…then earlier unconfirmed patterns take the remaining room", ids.filter((id) => id.startsWith("ai-earlier")).length, 3);
  eq("…and new proposals give way first", ids.filter((id) => id.startsWith("ai-new")).length, 0);
  const client = mergeHypotheses(s.modelHypotheses, newProposals(2).hypotheses.map((h) => ({ id: h.id, title: h.label, claim: h.claim })), { statements: s.patternStatements, preserveExistingActive: true });
  eq("client, same mix: confirmed, then earlier, then new", [client.filter((h) => h.id.startsWith("ai-confirmed")).length, client.filter((h) => h.id.startsWith("ai-earlier")).length, client.filter((h) => h.id.startsWith("ai-new")).length].join(","), "9,3,0");
}

// ---- 8. the flag survives save, reload, export and import; older saves still work ---------------------------
{
  const s = invalidEvidenceState();
  s.modelHypotheses = markNeedsReview(s.modelHypotheses, ["ai-puzzles"]);
  persistState(s);
  const reloaded = loadPersistedState();
  eq("reload: the flag is saved with the pattern", reloaded.modelHypotheses.find((h) => h.id === "ai-puzzles")?.evidenceStatus, NEEDS_REVIEW);
  const imported = parseBackupText(JSON.stringify(buildBackup(s)));
  eq("export/import: the flag round-trips", imported.modelHypotheses.find((h) => h.id === "ai-puzzles")?.evidenceStatus, NEEDS_REVIEW);
  check("HTML export: shows Needs another look, not a confidence level", buildHtmlExport(s).includes(`Status: ${NEEDS_REVIEW_LABEL}`));

  // A save from before #325: no evidenceStatus anywhere.
  const old = investigationState();
  persistState(old);
  const oldReloaded = loadPersistedState();
  check("older save: loads with no flag", oldReloaded.modelHypotheses.every((h) => !("evidenceStatus" in h)));
  const oldImported = parseBackupText(JSON.stringify(buildBackup(old)));
  check("older backup: imports with no flag", oldImported.modelHypotheses.every((h) => !("evidenceStatus" in h)));
  const { merged } = refresh({ ...old, modelHypotheses: oldReloaded.modelHypotheses }, { hypotheses: [NEW_PATTERN] });
  check("older save: refreshes normally", ["ai-worlds", "ai-puzzles", "ai-comedy"].every((id) => merged.some((h) => h.id === id)) && merged.every((h) => !h.evidenceStatus));
}

// ---- 9. the flag's display: Taste Profile row and Taste Map ---------------------------------------------------
{
  const { state } = await import("../../src/state.js");
  const { renderProfile } = await import("../../src/screens/profile.js");
  const { renderTasteMap } = await import("../../src/screens/tastemap.js");
  const s = invalidEvidenceState();
  Object.assign(state, { feedbackByRecommendation: s.feedbackByRecommendation, patternStatements: s.patternStatements, modelHypotheses: markNeedsReview(s.modelHypotheses, ["ai-puzzles"]), profileView: "list" });
  const html = renderProfile();
  const row = (id) => html.slice(html.indexOf(`data-profile-pattern="${id}"`), html.indexOf("</article>", html.indexOf(`data-profile-pattern="${id}"`)));
  const flaggedRow = row("ai-puzzles");
  check("profile: the flagged row shows Needs another look", flaggedRow.includes(`<span class="signal-flag">${NEEDS_REVIEW_LABEL}</span>`), flaggedRow.slice(0, 400));
  check("profile: the flagged row explains it", flaggedRow.includes(NEEDS_REVIEW_TEXT.replace("’", "&#39;")) || flaggedRow.includes(NEEDS_REVIEW_TEXT), flaggedRow.slice(0, 1200));
  check("profile: the flagged row shows no confidence level", !/class="signal-status/.test(flaggedRow));
  check("profile: the user's answer is still shown", flaggedRow.includes("You confirmed this"));
  const validRow = row("ai-worlds");
  check("profile: a valid row keeps its level and no flag", /class="signal-status/.test(validRow) && !validRow.includes(NEEDS_REVIEW_LABEL));

  const map = renderTasteMap(state.modelHypotheses);
  check("map: the flagged node shows Needs another look", map.includes(`<span class="map-node-conf">${NEEDS_REVIEW_LABEL}</span>`));
  check("map: the valid node keeps its level", map.includes(`<span class="map-node-conf">supported</span>`) || map.includes(`<span class="map-node-conf">Supported</span>`));

  state.modelHypotheses = state.modelHypotheses.map(({ evidenceStatus, ...rest }) => rest);
  check("profile: once cleared, no flag is shown", !renderProfile().includes(NEEDS_REVIEW_LABEL));
}

// ---- 10. PR #327 review: every area excluded is a scope correction, not an evidence failure -------------
{
  const allExcluded = () => {
    const s = investigationState({ says: "partial", extra: { excludedDomains: ["movies", "play"] } });
    s.patternStatements = s.patternStatements.filter((x) => x.hypothesisId === "ai-worlds");
    return s;
  };
  const s = allExcluded();
  const storedBefore = JSON.stringify(s.modelHypotheses.find((h) => h.id === "ai-worlds"));
  const { preserved, validated, merged } = refresh(s, { hypotheses: [NEW_PATTERN] });
  check("every area excluded: not carried into the refresh", !preserved.hypotheses.some((h) => h.id === "ai-worlds"));
  check("every area excluded: not accepted", !validated.accepted.some((h) => h.id === "ai-worlds"));
  check("every area excluded: not flagged for review", !validated.needsReview.includes("ai-worlds"));
  eq("every area excluded: the client keeps the stored pattern exactly", JSON.stringify(merged.find((h) => h.id === "ai-worlds")), storedBefore);
  eq("every area excluded: the user's correction is untouched", JSON.stringify(s.patternStatements[0].excludedDomains), JSON.stringify(["movies", "play"]));

  // The model can't override the exclusions: its version of the pattern is dropped, whatever it claims.
  for (const [name, domains] of [["claiming the excluded areas", ["movies", "play"]], ["claiming one excluded area", ["play"]]]) {
    const version = pattern({ id: "ai-worlds", label: WORLDS.title, claim: WORLDS.claim, evidence: WORLDS.supports, domains, crossDomain: "untested", level: "supported" });
    const r = refresh(allExcluded(), { hypotheses: [version, NEW_PATTERN] });
    check(`every area excluded, model version ${name}: dropped before the check`, !r.preserved.hypotheses.some((h) => h.id === "ai-worlds"));
    check(`every area excluded, model version ${name}: not accepted or flagged`, !r.validated.accepted.some((h) => h.id === "ai-worlds") && !r.validated.needsReview.length);
    eq(`every area excluded, model version ${name}: stored pattern kept as is`, JSON.stringify(r.merged.find((h) => h.id === "ai-worlds")), storedBefore);
  }

  // The user includes an area again: the pattern is checked normally, in that area only.
  const restored = allExcluded();
  restored.patternStatements[0].excludedDomains = ["movies"];
  const back = refresh(restored, { hypotheses: [NEW_PATTERN] });
  const backAreas = back.validated.accepted.find((h) => h.id === "ai-worlds")?.domains ?? [];
  eq("an area included again: accepted with its own areas", backAreas.join(","), "movies,play");
  eq("an area included again: shown in the included area only", domainScopeFromDomains(backAreas, ["movies"]).supported.join(","), "play");
  check("an area included again: not flagged", !back.merged.find((h) => h.id === "ai-worlds")?.evidenceStatus);
}

// ---- 11. PR #327 review: a completed evidence check is not a failed refresh -------------------------------
{
  const s = invalidEvidenceState();
  const said = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ source: "unavailable", hypotheses: [], meta: { paidCallMade: true, needsReview: ["ai-puzzles"] } }) });
  try { await refreshProfileHypotheses(s, { force: true, announce: (m) => said.push(m) }); }
  finally { globalThis.fetch = realFetch; }
  eq("completed check, nothing accepted: the flag is set", s.modelHypotheses.find((h) => h.id === "ai-puzzles")?.evidenceStatus, NEEDS_REVIEW);
  check("completed check: the message says the check ran and what it found", /checked your profile/i.test(s.hypothesisAiMessage) && /need another look/i.test(s.hypothesisAiMessage), s.hypothesisAiMessage);
  check("completed check: never says nothing changed", !/couldn.t update|still here|unchanged/i.test(s.hypothesisAiMessage));
  check("completed check: recorded, so it isn't repeated until the evidence changes", s.hypothesisAiKey != null);
  eq("completed check: announced once", said.length, 1);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ source: "unavailable", hypotheses: [], meta: {} }) }; };
  try { await refreshProfileHypotheses(s, {}); }
  finally { globalThis.fetch = realFetch; }
  eq("completed check: the next visit with the same evidence makes no call", calls, 0);
}
{
  const accepted = { ...NEW_PATTERN };
  const s = invalidEvidenceState();
  await clientRefresh(s, { source: "model", hypotheses: [accepted], meta: { rejected: 0, needsReview: ["ai-puzzles"] } });
  check("accepted refresh with needsReview: the message says patterns need another look", /need another look/i.test(s.hypothesisAiMessage), s.hypothesisAiMessage);
}
for (const [name, respond] of [
  ["a failed validation with nothing to review", async () => ({ ok: true, json: async () => ({ source: "unavailable", hypotheses: [], meta: { paidCallMade: true, needsReview: [] } }) })],
  ["a paused AI", async () => ({ ok: true, json: async () => ({ source: "unavailable", hypotheses: [], meta: { budgetPaused: true } }) })],
  ["a server error", async () => ({ ok: false, json: async () => ({ error: "boom" }) })],
  ["a network failure", async () => { throw new Error("offline"); }]
]) {
  const s = invalidEvidenceState();
  s.modelHypotheses = markNeedsReview(s.modelHypotheses, ["ai-worlds"]);
  const before = JSON.stringify({ patterns: s.modelHypotheses, statements: s.patternStatements, history: s.hypothesisHistory });
  const realFetch = globalThis.fetch;
  globalThis.fetch = respond;
  try { await refreshProfileHypotheses(s, { force: true }); }
  finally { globalThis.fetch = realFetch; }
  eq(`${name}: the saved profile is unchanged`, JSON.stringify({ patterns: s.modelHypotheses, statements: s.patternStatements, history: s.hypothesisHistory }), before);
  eq(`${name}: not recorded as a completed check`, s.hypothesisAiKey, null);
  check(`${name}: the message says it couldn't update`, /couldn.t update|paused/i.test(s.hypothesisAiMessage), s.hypothesisAiMessage);
}

// ---- 12. PR #327 review: a confirmation never transfers to a different interpretation ---------------------
const REWORDED = "Low-stakes comfort viewing matters more than any sense of place or atmosphere.";
{
  // Same id, different name and claim, structurally valid: the confirmed pattern stays as it was.
  const s = investigationState();
  const rewrite = pattern({ id: "ai-worlds", label: "Cozy comfort viewing", claim: REWORDED, evidence: ["ev:severance", "ev:outerwilds"], domains: ["movies", "play"], crossDomain: "tentative", level: "supported" });
  const { validated, merged } = refresh(s, { hypotheses: [rewrite] });
  const kept = merged.find((h) => h.id === "ai-worlds");
  eq("same-id rewrite: the confirmed name stays", kept?.title, WORLDS.title);
  eq("same-id rewrite: the confirmed claim stays", kept?.claim, WORLDS.claim);
  eq("same-id rewrite: the stored evidence stays, not the rewrite's", kept?.supports.join(","), WORLDS.supports.join(","));
  check("same-id rewrite: the rewrite itself is not accepted", !validated.accepted.some((h) => h.claim === REWORDED));
}
{
  // Same claim, only a wording-neutral change in the evidence, as the prompt asks: the evidence update is used.
  const s = investigationState();
  const update = pattern({ id: "ai-puzzles", label: PUZZLES.title, claim: PUZZLES.claim, evidence: [...PUZZLES.supports, "ev:controlgame"], counter: ["ev:disco"], domains: ["play"], level: "supported" });
  const { merged } = refresh(s, { hypotheses: [update] });
  const kept = merged.find((h) => h.id === "ai-puzzles");
  eq("same pattern returned with more evidence: the new evidence is used", kept?.supports.length, 4);
  eq("same pattern returned with more evidence: claim unchanged", kept?.claim, PUZZLES.claim);
}
{
  // Same name under a new id: one pattern, under the confirmed id, with the confirmed claim.
  const s = investigationState();
  const relabel = pattern({ id: "ai-worlds-2", label: WORLDS.title, claim: "A different claim about lived-in worlds that the user never confirmed at all.", evidence: ["ev:severance", "ev:outerwilds"], domains: ["movies", "play"], crossDomain: "tentative", level: "supported" });
  const { merged } = refresh(s, { hypotheses: [relabel] });
  const named = merged.filter((h) => h.title === WORLDS.title);
  eq("same name, new id: no duplicate", named.length, 1);
  eq("same name, new id: the confirmed id is kept", named[0]?.id, "ai-worlds");
  eq("same name, new id: the confirmed claim is kept", named[0]?.claim, WORLDS.claim);
}
{
  // Unconfirmed patterns can still evolve.
  const s = investigationState({ says: null });
  const rewrite = pattern({ id: "ai-worlds", label: "Lived-in worlds", claim: REWORDED, evidence: ["ev:severance", "ev:outerwilds"], domains: ["movies", "play"], crossDomain: "tentative", level: "supported" });
  const { merged } = refresh(s, { hypotheses: [rewrite] });
  eq("unconfirmed: a same-id rewrite is used", merged.find((h) => h.id === "ai-worlds")?.claim, REWORDED);
}
for (const [name, change] of [["cleared", (s) => { s.patternStatements = []; }], ["changed to Not sure", (s) => { s.patternStatements[0].says = "unsure"; s.patternStatements[0].weight = null; }]]) {
  // Clearing or changing the confirmation lets the model revise the pattern again.
  const s = investigationState();
  change(s);
  const rewrite = pattern({ id: "ai-worlds", label: "Lived-in worlds", claim: REWORDED, evidence: ["ev:severance", "ev:outerwilds"], domains: ["movies", "play"], crossDomain: "tentative", level: "supported" });
  const { merged } = refresh(s, { hypotheses: [rewrite] });
  eq(`confirmation ${name}: the model may revise the pattern again`, merged.find((h) => h.id === "ai-worlds")?.claim, REWORDED);
}
{
  const s = investigationState();
  s.patternStatements[0].says = "not-me";
  const rewrite = pattern({ id: "ai-worlds", label: WORLDS.title, claim: WORLDS.claim, evidence: WORLDS.supports, domains: ["movies", "play"], crossDomain: "tentative", level: "supported" });
  const { validated } = refresh(s, { hypotheses: [rewrite] });
  check("confirmation changed to Not me: the pattern is removed", !validated.accepted.some((h) => h.id === "ai-worlds"));
}

// ---- 13. one status everywhere: "Excluded from all areas", then "Needs another look", then the level ---------
{
  const { state } = await import("../../src/state.js");
  const { renderProfile } = await import("../../src/screens/profile.js");
  const { renderTasteMap } = await import("../../src/screens/tastemap.js");
  // Two confirmed "partly" patterns across movies+play: one flagged by an earlier check, one not.
  const s = investigationState({ says: "partial" });
  s.modelHypotheses = markNeedsReview([{ ...WORLDS }, { ...WORLDS, id: "ai-plain", title: "Lived-in places", claim: "Places that feel lived-in keep attention in shows and games alike." }], ["ai-worlds"]);
  s.patternStatements = s.modelHypotheses.map((h) => ({ hypothesisId: h.id, label: h.title, says: "partial", weight: null, context: null, authority: "user-confirmed" }));
  const views = (st) => {
    Object.assign(state, { feedbackByRecommendation: st.feedbackByRecommendation, patternStatements: st.patternStatements, modelHypotheses: st.modelHypotheses });
    const row = (html, id) => { const at = html.indexOf(`data-profile-pattern="${id}"`); return at < 0 ? "" : html.slice(at, html.indexOf("</article>", at)); };
    const node = (html, title) => { const at = html.indexOf(`<b>${title}</b>`); return at < 0 ? "" : html.slice(at, html.indexOf("</div>", at)); };
    const out = {};
    for (const view of ["list", "full"]) { state.profileView = view; const html = renderProfile(); out[view] = { worlds: row(html, "ai-worlds"), plain: row(html, "ai-plain") }; }
    state.profileView = "map";
    const mapHtml = renderProfile();
    out.map = { worlds: node(mapHtml, WORLDS.title), plain: node(mapHtml, "Lived-in places") };
    const exportHtml = buildHtmlExport(st);
    const card = (title) => { const at = exportHtml.indexOf(`<h3>${title}</h3>`); return exportHtml.slice(at, exportHtml.indexOf("</article>", at)); };
    out.export = { worlds: card(WORLDS.title), plain: card("Lived-in places") };
    state.profileView = "list";
    return out;
  };
  const level = /class="signal-status|map-node-conf">supported<|Status: supported/i;

  // 1 + 2: every area excluded, flagged and unflagged.
  const stored = JSON.stringify(s.modelHypotheses);
  const history = s.hypothesisHistory.length;
  for (const id of ["ai-worlds", "ai-plain"]) { toggleDomainExclusion(s, id, "movies"); toggleDomainExclusion(s, id, "play"); }
  const historyAfterToggles = s.hypothesisHistory.length;
  const excludedJson = JSON.stringify(s.patternStatements.map((x) => x.excludedDomains));
  const all = views(s);
  for (const surface of ["list", "full", "map", "export"]) {
    for (const [which, label] of [["worlds", "flagged"], ["plain", "unflagged"]]) {
      const html = all[surface][which];
      check(`every area excluded (${label}), ${surface}: shows Excluded from all areas`, html.includes(ALL_AREAS_EXCLUDED_LABEL), html.slice(0, 300));
      check(`every area excluded (${label}), ${surface}: no Needs another look`, !html.includes(NEEDS_REVIEW_LABEL));
      check(`every area excluded (${label}), ${surface}: no confidence level`, !level.test(html), html.slice(0, 300));
    }
  }
  check("every area excluded (flagged), profile: no evidence warning line", !all.list.worlds.includes("no longer available") && !all.full.worlds.includes("no longer available"));

  // 3: nothing stored changes.
  eq("display only: the saved patterns and evidence flag are unchanged", JSON.stringify(s.modelHypotheses), stored);
  eq("display only: the corrections are unchanged", JSON.stringify(s.patternStatements.map((x) => x.excludedDomains)), excludedJson);
  eq("display only: rendering adds no history", s.hypothesisHistory.length, historyAfterToggles);
  check("the toggles themselves were recorded in history as before", historyAfterToggles > history);

  // 4: one area included again.
  for (const id of ["ai-worlds", "ai-plain"]) toggleDomainExclusion(s, id, "play");
  const back = views(s);
  for (const surface of ["list", "full", "map", "export"]) {
    check(`one area back (flagged), ${surface}: Needs another look again`, back[surface].worlds.includes(NEEDS_REVIEW_LABEL) && !back[surface].worlds.includes(ALL_AREAS_EXCLUDED_LABEL));
    check(`one area back (unflagged), ${surface}: its level again`, level.test(back[surface].plain) && !back[surface].plain.includes(ALL_AREAS_EXCLUDED_LABEL), back[surface].plain.slice(0, 300));
  }
  check("one area back (flagged), profile: the evidence line returns", back.list.worlds.includes("no longer available"));

  // 5: only some areas excluded changes nothing (same as the state above, checked from a fresh partial exclusion).
  const some = investigationState({ says: "partial", extra: { excludedDomains: ["movies"] } });
  some.modelHypotheses = s.modelHypotheses;
  some.patternStatements = s.modelHypotheses.map((h) => ({ hypothesisId: h.id, label: h.title, says: "partial", excludedDomains: ["movies"] }));
  const partial = views(some);
  check("some areas excluded: flagged still shows Needs another look", ["list", "map", "export"].every((v) => partial[v].worlds.includes(NEEDS_REVIEW_LABEL)));
  check("some areas excluded: unflagged still shows its level", ["list", "map", "export"].every((v) => level.test(partial[v].plain)));
  check("some areas excluded: never Excluded from all areas", ["list", "full", "map", "export"].every((v) => !partial[v].worlds.includes(ALL_AREAS_EXCLUDED_LABEL) && !partial[v].plain.includes(ALL_AREAS_EXCLUDED_LABEL)));
  check("renderTasteMap without statements keeps working", renderTasteMap(s.modelHypotheses).includes(NEEDS_REVIEW_LABEL));
}

finish();
