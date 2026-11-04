#!/usr/bin/env node
// Nov 4 (after #325): a profile refresh sends at most 96 tried reactions. Evidence a stored pattern cites
// must be sent first, and evidence that still exists but didn't fit must never read as removed. Three
// states: validated (sent and checked), not checked (kept, never raises a level, never clears a flag),
// invalid (needsReview, as before). Recommendations' payload is unchanged. Free, no browser, no model call.
//
//   node scripts/qa/evidence-selection-tests.mjs

import { createSuite } from "./lib/assert.mjs";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const { selectExperiencedFeedbackForWire, serializeAiState } = await import("../../src/ai/live-client.js");
const { citedEvidenceRefs, markNeedsReview, mergeHypotheses, normalizeHypothesis } = await import("../../src/ai/hypothesis-profile.js");
const { NEEDS_REVIEW } = await import("../../src/model/statements.js");
const { produceHypotheses } = await import("../../api/hypotheses.mjs");
const { emptyState, react, syntheticItems } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("evidence selection tests");

// 150 tried reactions, oldest first; syn-0..syn-9 are the oldest. Recent ones fill the default selection.
const ITEMS = syntheticItems(150);
function bigState() {
  const s = emptyState([]);
  ITEMS.forEach((item, i) => react(s, item, i % 10 === 9 ? "liked" : "loved"));
  return s;
}
const OLD = ITEMS.slice(0, 10).map((item) => `ev:${item.id}`);
const confirmedPattern = (fields) => ({ id: "ai-old", title: "Old favourites pattern", claim: "Older favourites share a slow, careful sense of place and patience.", supports: OLD.slice(0, 5), counters: [], domains: [...new Set(ITEMS.slice(0, 5).flatMap((i) => i.domains))], strength: "supported", status: "supported", crossDomain: "tentative", context: null, ...fields });
const confirm = (s, ids) => { s.patternStatements = ids.map((id) => ({ hypothesisId: id, label: s.modelHypotheses.find((p) => p.id === id).title, says: "accurate", weight: "lot", context: null, authority: "user-confirmed" })); };

// ---- 1. selection --------------------------------------------------------------------------------------
{
  const s = bigState();
  const plain = selectExperiencedFeedbackForWire(s.feedbackByRecommendation).map(([id]) => id);
  eq("default selection: capped at 96", plain.length, 96);
  check("default selection: the oldest reactions don't fit (the bug's precondition)", OLD.every((ref) => !plain.includes(ref.slice(3))));
  eq("no requiredIds: identical to the default selection", JSON.stringify(selectExperiencedFeedbackForWire(s.feedbackByRecommendation, 96, { requiredIds: [] }).map(([id]) => id)), JSON.stringify(plain));
  const reserved = selectExperiencedFeedbackForWire(s.feedbackByRecommendation, 96, { requiredIds: OLD.map((r) => r.slice(3)) }).map(([id]) => id);
  eq("required: still capped at 96", reserved.length, 96);
  check("required: every cited reaction is sent", OLD.every((ref) => reserved.includes(ref.slice(3))));
  eq("required: no duplicates", new Set(reserved).size, 96);
  const tooMany = selectExperiencedFeedbackForWire(s.feedbackByRecommendation, 96, { requiredIds: ITEMS.slice(0, 120).map((i) => i.id) }).map(([id]) => id);
  eq("more required than the cap: the cap holds", tooMany.length, 96);
  eq("more required than the cap: highest-priority first", tooMany.slice(0, 96).join(","), ITEMS.slice(0, 96).map((i) => i.id).join(","));
  check("unknown or untried required ids are ignored", selectExperiencedFeedbackForWire(s.feedbackByRecommendation, 96, { requiredIds: ["nope"] }).length === 96);
}

// ---- 2. the request payload ---------------------------------------------------------------------------
{
  const s = bigState();
  const recs = serializeAiState(s);
  check("recommendations payload: no presentRefs field", !("presentRefs" in recs));
  eq("recommendations payload: same reactions as the default selection", Object.keys(recs.feedbackByRecommendation).join(","), selectExperiencedFeedbackForWire(s.feedbackByRecommendation).map(([id]) => id).join(","));
  s.modelHypotheses = [confirmedPattern()];
  confirm(s, ["ai-old"]);
  const refs = citedEvidenceRefs(s);
  eq("cited refs: the confirmed pattern's supports", refs.join(","), OLD.slice(0, 5).join(","));
  const profile = serializeAiState(s, { requiredRefs: refs });
  check("profile payload: cited reactions are sent", OLD.slice(0, 5).every((ref) => profile.feedbackByRecommendation[ref.slice(3)]));
  eq("profile payload: nothing left over, so presentRefs is empty", profile.presentRefs.length, 0);
  eq("profile payload: still 96 reactions", Object.keys(profile.feedbackByRecommendation).length, 96);
  const overflow = serializeAiState(s, { requiredRefs: ITEMS.slice(0, 120).map((i) => `ev:${i.id}`) });
  eq("overflow: the 24 that don't fit are listed as present", overflow.presentRefs.length, 24);
  check("overflow: present refs are ids only", overflow.presentRefs.every((ref) => typeof ref === "string" && ref.startsWith("ev:")));
  delete s.feedbackByRecommendation[ITEMS[3].id];
  const removed = serializeAiState(s, { requiredRefs: refs });
  check("a removed reaction is neither sent nor listed as present", !removed.feedbackByRecommendation[ITEMS[3].id] && !removed.presentRefs.includes(`ev:${ITEMS[3].id}`));
}
{
  // Confirmed patterns' evidence comes before unconfirmed patterns', supports before counters.
  const s = bigState();
  s.modelHypotheses = [
    { ...confirmedPattern(), id: "ai-free", title: "Unconfirmed", supports: [OLD[8]], counters: [OLD[9]] },
    { ...confirmedPattern(), counters: [OLD[7]] }
  ];
  confirm(s, ["ai-old"]);
  eq("cited refs: confirmed supports, confirmed counters, then the rest", citedEvidenceRefs(s).join(","), [...OLD.slice(0, 5), OLD[7], OLD[8], OLD[9]].join(","));
}

// ---- 3. the server's three evidence states --------------------------------------------------------------
async function endpoint(rawState, answer = { hypotheses: [], insufficientEvidence: false }) {
  const env = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", VERCEL_ENV: "preview" };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 10, output_tokens: 20 }, model: "claude-test" }) });
  const quiet = [console.log, console.info];
  console.log = () => {}; console.info = () => {};
  try { return await produceHypotheses({ rawState, env, fetchImpl }); }
  finally { [console.log, console.info] = quiet; }
}
const body = (s, opts) => ({ ...serializeAiState(s, opts), modelHypotheses: s.modelHypotheses });

{
  // Validated: the fix sends the cited reactions, so the pattern is checked and passes.
  const s = bigState();
  s.modelHypotheses = [confirmedPattern()];
  confirm(s, ["ai-old"]);
  const payload = await endpoint(body(s, { requiredRefs: citedEvidenceRefs(s) }));
  check("validated: the confirmed pattern is accepted", payload.hypotheses.some((h) => h.id === "ai-old"));
  eq("validated: not flagged", (payload.meta?.needsReview ?? []).length, 0);
  eq("validated: nothing reported as not checked", (payload.meta?.notChecked ?? []).length, 0);
}
{
  // Before this fix: the same profile, sent the old way, flags a pattern whose evidence still exists.
  const s = bigState();
  s.modelHypotheses = [confirmedPattern()];
  confirm(s, ["ai-old"]);
  const payload = await endpoint(body(s));
  eq("old client (no presentRefs): behaves as before, flagged", payload.meta?.needsReview?.join(","), "ai-old");
}
{
  // Not checked: the evidence exists but wasn't sent (simulated by sending it as present only).
  const s = bigState();
  s.modelHypotheses = [confirmedPattern()];
  confirm(s, ["ai-old"]);
  const raw = body(s, { requiredRefs: citedEvidenceRefs(s) });
  for (const ref of OLD.slice(0, 5)) delete raw.feedbackByRecommendation[ref.slice(3)];
  raw.presentRefs = OLD.slice(0, 5);
  const payload = await endpoint(raw);
  eq("not checked: listed as not checked", payload.meta?.notChecked?.join(","), "ai-old");
  eq("not checked: no false 'evidence no longer available'", (payload.meta?.needsReview ?? []).length, 0);
  check("not checked: not returned as freshly validated", !payload.hypotheses.some((h) => h.id === "ai-old"));
}
{
  // Partly sent: enough validated evidence to pass; the unsent refs stay on it but don't raise the level.
  const s = bigState();
  s.modelHypotheses = [confirmedPattern({ supports: [...OLD.slice(0, 5)], strength: "emerging", status: "emerging" })];
  confirm(s, ["ai-old"]);
  const raw = body(s, { requiredRefs: citedEvidenceRefs(s) });
  for (const ref of OLD.slice(3, 5)) delete raw.feedbackByRecommendation[ref.slice(3)];
  raw.presentRefs = OLD.slice(3, 5);
  const payload = await endpoint(raw);
  const kept = payload.hypotheses.find((h) => h.id === "ai-old");
  check("partly sent: accepted on its validated evidence", Boolean(kept));
  eq("partly sent: the not-checked refs are kept on it", OLD.slice(0, 5).every((ref) => kept?.evidence.includes(ref)), true);
  eq("partly sent: the level is not raised above the stored one", kept?.level, "emerging");
}
{
  // Invalid: a cited reaction was removed (absent from both lists). Still flagged.
  const s = bigState();
  s.modelHypotheses = [confirmedPattern()];
  confirm(s, ["ai-old"]);
  const raw = body(s, { requiredRefs: citedEvidenceRefs(s) });
  for (const ref of OLD.slice(0, 5)) delete raw.feedbackByRecommendation[ref.slice(3)];
  raw.presentRefs = OLD.slice(0, 4);   // OLD[4] is genuinely gone
  const payload = await endpoint(raw);
  eq("invalid: a removed reaction still means needs another look", payload.meta?.needsReview?.join(","), "ai-old");
  eq("invalid: not reported as merely not checked", (payload.meta?.notChecked ?? []).length, 0);
}
{
  // presentRefs from the request is untrusted shape: non-strings are dropped.
  const s = bigState();
  s.modelHypotheses = [confirmedPattern()];
  confirm(s, ["ai-old"]);
  const raw = body(s, { requiredRefs: citedEvidenceRefs(s) });
  for (const ref of OLD.slice(0, 5)) delete raw.feedbackByRecommendation[ref.slice(3)];
  raw.presentRefs = [{ ref: OLD[0] }, 42, null];
  const payload = await endpoint(raw);
  eq("malformed presentRefs: ignored, so the pattern is flagged as before", payload.meta?.needsReview?.join(","), "ai-old");
}

// ---- 4. client: "not checked" never clears an earlier flag ----------------------------------------------
{
  const s = bigState();
  s.modelHypotheses = markNeedsReview([confirmedPattern()], ["ai-old"]);
  confirm(s, ["ai-old"]);
  const merged = markNeedsReview(mergeHypotheses(s.modelHypotheses, [], { statements: s.patternStatements, activeLimit: 12, preserveExistingActive: false }), []);
  eq("not checked, nothing accepted: the earlier flag stays", merged.find((p) => p.id === "ai-old")?.evidenceStatus, NEEDS_REVIEW);
  const accepted = normalizeHypothesis({ id: "ai-old", label: "Old favourites pattern", claim: confirmedPattern().claim, evidence: OLD.slice(0, 5), counter: [], domains: confirmedPattern().domains, level: "supported" }, 0, s);
  const cleared = mergeHypotheses(s.modelHypotheses, [accepted], { statements: s.patternStatements, activeLimit: 12, preserveExistingActive: false });
  check("validated again: the flag clears", !cleared.find((p) => p.id === "ai-old")?.evidenceStatus);
}

finish();
