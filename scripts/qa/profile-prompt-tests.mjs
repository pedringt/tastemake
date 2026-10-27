#!/usr/bin/env node
// #236: the Taste Profile prompt was ~13.4K input tokens on average (p95 20.6s on Haiku 5.5) against
// ~2.3K for recommendations. Its CONTEXT block is now compacted (src/ai/profile-context.js) the way #130
// compacted the recommendations prompt. These checks pin three things, without a model call:
//   1. a size budget on the built prompt for every eval fixture, against what main sent before (430270b);
//   2. every field the evidence contract depends on survives the trim (tried vs starter favorites,
//      likes/dislikes, refinements, resolved facts, "not me"/partial statements, earlier patterns with
//      their evidence and counters, cross-domain areas), and intent never gets in;
//   3. the model's short ids map back to the right evidence refs before the normalizer and validator.
// Free, no browser, no model call.
//
//   node scripts/qa/profile-prompt-tests.mjs

import { buildContext } from "../../src/ai/context.js";
import { normalizeHypothesisResponse, preserveExistingHypotheses, validateHypotheses } from "../../src/ai/validate.js";
import { buildHypothesisPrompt, buildHypothesisRequest, produceHypotheses } from "../../api/hypotheses.mjs";
import { compactProfileContext, expandProfileRefs, MAX_PROMPT_TITLE } from "../../src/ai/profile-context.js";
import { FIXTURES, productionShapedState } from "../evals/fixtures.mjs";
import { createSuite } from "./lib/assert.mjs";

const { check, eq, finish } = createSuite("profile prompt tests");

const estTokens = (text) => Math.ceil(String(text).length / 4);   // same estimate as scripts/evals/run.mjs
const contextOf = (prompt) => JSON.parse(prompt.slice(prompt.indexOf("CONTEXT\n") + 8));
const rowsOf = (context) => Object.entries(context.evidence).flatMap(([kind, byDomain]) => Object.entries(byDomain).flatMap(([domainKey, rows]) => rows.map((row) => ({ ...row, kind, domainKey }))));
const allFixtures = [...FIXTURES.map((f) => ({ id: f.id, state: f.build() })), { id: "production-shaped", state: productionShapedState() }];

// ---- 1. size budget -------------------------------------------------------------------------------------
// Characters of the full prompt that main (430270b) built for each fixture, measured offline. The eval
// fixtures carry no earlier profile; production-shaped carries a full 12-pattern one, as a long-running
// production profile does.
// user-said-also-true (added Oct 27) was measured the same way, on a checkout of 430270b.
const BEFORE_CHARS = {
  "cold-4": 4475, "starter-6": 4902, "about-10": 5797, "intent-heavy": 4902, "single-miss": 5585,
  "recurring-miss": 5576, "cross-domain": 5365, "user-said-not-me": 5676, "user-said-also-true": 5703, "scale-50": 12862,
  "scale-100": 20585, "production-shaped": 43773
};
// Small fixtures are mostly the fixed instructions; the larger the evidence, the more the trim must save.
const MAX_RATIO = { "scale-50": 0.55, "scale-100": 0.45, "production-shaped": 0.6 };
for (const { id, state } of allFixtures) {
  const prompt = buildHypothesisPrompt(buildContext(state), state.modelHypotheses);
  check(`${id}: every fixture has a recorded before size`, BEFORE_CHARS[id] > 0);
  check(`${id}: prompt is smaller than before`, prompt.length < BEFORE_CHARS[id], `${prompt.length} vs ${BEFORE_CHARS[id]}`);
  if (MAX_RATIO[id]) check(`${id}: prompt is at most ${MAX_RATIO[id] * 100}% of before`, prompt.length <= BEFORE_CHARS[id] * MAX_RATIO[id], `${prompt.length} vs ${BEFORE_CHARS[id]}`);
}
{
  const s = productionShapedState();
  const prompt = buildHypothesisPrompt(buildContext(s), s.modelHypotheses);
  check("production-shaped prompt stays under ~6.5K estimated tokens", estTokens(prompt) <= 6500, `${estTokens(prompt)}`);
  check("the prompt sends no full evidence refs", !/ev:/.test(prompt.slice(prompt.indexOf("CONTEXT\n"))));
  check("the prompt drops derivable fields (polarity, weight, kind per row, refinement labels)", !/"polarity"|"weight":|"kind":|"label":"Gameplay"/.test(prompt.slice(prompt.indexOf("CONTEXT\n"))));
}

// ---- 2. contract-relevant fields survive -----------------------------------------------------------------
for (const { id, state } of allFixtures) {
  const ctx = buildContext(state);
  const { prompt, refs } = buildHypothesisRequest(ctx, state.modelHypotheses);
  const context = contextOf(prompt);
  const rows = rowsOf(context);
  const experienced = ctx.evidence.filter((r) => r.class === "experienced");
  const byRef = new Map(experienced.map((r) => [r.ref, r]));

  eq(`${id}: one row per experienced record`, rows.length, new Set(experienced.map((r) => r.ref)).size);
  eq(`${id}: one short id per row`, refs.size, rows.length);
  check(`${id}: no intent or neutral evidence in the prompt`, rows.every((row) => byRef.get(refs.get(row.id))?.class === "experienced"));
  check(`${id}: every row sits under its own kind (starter vs tried, loved/liked/disliked)`, rows.every((row) => byRef.get(refs.get(row.id)).kind === row.kind));
  check(`${id}: every row sits under its own domains (cross-domain areas)`, rows.every((row) => byRef.get(refs.get(row.id)).domains.join("+") === row.domainKey));
  check(`${id}: titles survive`, rows.every((row) => {
    const title = byRef.get(refs.get(row.id)).title;
    return row.t === title || (title.length > MAX_PROMPT_TITLE && row.t.length === MAX_PROMPT_TITLE);
  }));
  check(`${id}: unresolved rows are marked u:1 and resolved ones are not`, rows.every((row) => (byRef.get(refs.get(row.id)).facts?.resolved === true) === (row.u === undefined)));
  check(`${id}: resolved facts survive (year, creator, genres)`, rows.every((row) => {
    const facts = byRef.get(refs.get(row.id)).facts ?? {};
    return (row.y ?? null) === (facts.year || null) && (row.by ?? null) === (facts.creator || null)
      && JSON.stringify(row.g ?? []) === JSON.stringify([...new Set((facts.genres ?? []).map((g) => g))].slice(0, 8));
  }));
  check(`${id}: refinements survive`, rows.every((row) => JSON.stringify(row.r ?? []) === JSON.stringify((byRef.get(refs.get(row.id)).refinements ?? []).map((r) => r.id))));
  check(`${id}: statements survive`, JSON.stringify(context.statements.map((s) => [s.hypothesisId, s.label, s.says ?? null, s.context ?? null, s.excludedDomains ?? []]))
    === JSON.stringify((ctx.statements ?? []).map((s) => [s.hypothesisId, s.label, s.says ?? null, s.context ?? null, s.excludedDomains?.length ? s.excludedDomains : []])));
  const existing = state.modelHypotheses ?? [];
  eq(`${id}: every earlier pattern is sent`, context.existing.length, existing.length);
  check(`${id}: earlier patterns keep id, label, claim, level and domains`, existing.every((h, i) => {
    const sent = context.existing[i];
    return sent.id === h.id && sent.label === h.title && sent.claim === h.claim && sent.level === h.strength && JSON.stringify(sent.domains) === JSON.stringify(h.domains);
  }));
  check(`${id}: earlier patterns' evidence and counters map back to the same refs`, existing.every((h, i) => {
    const sent = context.existing[i];
    return JSON.stringify(sent.evidence.map((s) => refs.get(s))) === JSON.stringify([...new Set(h.supports)].filter((ref) => byRef.has(ref)))
      && JSON.stringify(sent.counter.map((s) => refs.get(s))) === JSON.stringify([...new Set(h.counters)].filter((ref) => byRef.has(ref)));
  }));
}
{
  // The fixtures above have no "starter vs tried" mix in one prompt with refinements, a "not me" and a
  // partial statement with excluded domains; production-shaped has all of them. Check they are present.
  const s = productionShapedState();
  const context = contextOf(buildHypothesisPrompt(buildContext(s), s.modelHypotheses));
  for (const kind of ["starter-favorite", "experienced-favorite", "experienced-strong-positive", "experienced-positive", "experienced-negative"]) check(`production-shaped prompt has ${kind} rows`, Boolean(context.evidence[kind]));
  check("production-shaped prompt carries refinements", rowsOf(context).some((row) => row.r?.length));
  check("production-shaped prompt carries a not-me statement", context.statements.some((st) => st.says === "not-me" && st.hypothesisId === "ai-production-shaped-pattern-2"));
  check("production-shaped prompt carries a partial statement with its context and excluded domain", context.statements.some((st) => st.says === "partial" && st.context === "some" && st.excludedDomains?.includes("play")));
  check("production-shaped prompt carries earlier counter-evidence", context.existing.some((h) => h.counter.length));
  check("the prompt still explains starter favorites do not test a pattern", buildHypothesisPrompt(buildContext(s), s.modelHypotheses).includes("rows with kind starter-favorite never do"));
}
{
  // Multi-domain item, implied vs explicit type, title cap, duplicate rows.
  const ctx = { evidence: [
    { ref: "ev:lotr", title: "The Lord of the Rings", type: "book", domains: ["read", "movies"], kind: "starter-favorite", class: "experienced", polarity: 1, facts: { resolved: false, genres: [] }, refinements: [] },
    { ref: "ev:lotr", title: "The Lord of the Rings", type: "book", domains: ["read", "movies"], kind: "starter-favorite", class: "experienced", polarity: 1, facts: { resolved: false, genres: [] }, refinements: [] },
    { ref: "ev:long", title: "x".repeat(200), type: "movie", domains: ["movies"], kind: "experienced-positive", class: "experienced", polarity: 1, facts: { resolved: true, year: 2001, creator: "A", genres: ["Drama", "drama", "Comedy"] }, refinements: [{ id: "story", label: "Story" }] },
    { ref: "ev:saved", title: "Saved", type: "movie", domains: ["movies"], kind: "saved", class: "intent", polarity: 1, facts: { resolved: true }, refinements: [] }
  ], statements: [], contexts: [] };
  const { context, refs } = compactProfileContext(ctx, []);
  const rows = rowsOf(context);
  eq("a duplicated record is sent once", rows.filter((row) => refs.get(row.id) === "ev:lotr").length, 1);
  eq("a book that is also a film keeps its type and both domains", JSON.stringify(context.evidence["starter-favorite"]["read+movies"][0].type), '"book"');
  eq("a type implied by the domain is dropped", rows.find((row) => refs.get(row.id) === "ev:long").type, undefined);
  eq("long titles are capped", rows.find((row) => refs.get(row.id) === "ev:long").t.length, MAX_PROMPT_TITLE);
  eq("genres are de-duplicated case-insensitively", JSON.stringify(rows.find((row) => refs.get(row.id) === "ev:long").g), '["Drama","Comedy"]');
  check("intent rows are never sent", ![...refs.values()].includes("ev:saved"));
}

// ---- 3. the model's short ids map back to the right items -------------------------------------------------
{
  const s = productionShapedState();
  const ctx = buildContext(s);
  const { prompt, refs } = buildHypothesisRequest(ctx, s.modelHypotheses);
  const rows = rowsOf(contextOf(prompt));
  const loved = rows.filter((row) => row.kind === "experienced-strong-positive" && row.domainKey === "movies").slice(0, 3);
  const disliked = rows.find((row) => row.kind === "experienced-negative" && row.domainKey === "movies");
  const answer = { hypotheses: [{
    id: "ai-new-pattern", label: "Deliberate pacing in films", claim: "Films land when the pacing is deliberate and the point of view is specific.",
    evidence: [...loved.map((row) => row.id), "e9999", "ev:not-a-real-ref"], counter: [disliked.id],
    domains: ["movies"], crossDomain: "untested", level: "strong", conditional: false, context: null
  }], insufficientEvidence: false };
  const expanded = expandProfileRefs(answer, refs);
  eq("short support ids expand to their full refs", JSON.stringify(expanded.hypotheses[0].evidence.slice(0, 3)), JSON.stringify(loved.map((row) => refs.get(row.id))));
  eq("a short counter id expands to its full ref", expanded.hypotheses[0].counter[0], refs.get(disliked.id));
  check("expanded refs name the cited titles", loved.every((row, i) => ctx.evidence.find((r) => r.ref === expanded.hypotheses[0].evidence[i])?.title === row.t));
  eq("an id the prompt never issued is left for the normalizer", expanded.hypotheses[0].evidence[3], "e9999");
  const normalized = normalizeHypothesisResponse(expanded, ctx);
  eq("the normalizer keeps only the real refs", JSON.stringify(normalized.hypotheses[0].evidence), JSON.stringify(loved.map((row) => refs.get(row.id))));
  eq("the normalizer keeps the counter", JSON.stringify(normalized.hypotheses[0].counter), JSON.stringify([refs.get(disliked.id)]));
  const validated = validateHypotheses(normalized, ctx);
  check("the validator accepts the mapped pattern", validated.accepted.some((h) => h.id === "ai-new-pattern"), JSON.stringify(validated.rejected.map((r) => r.reasons)));
  // Without the mapping the same answer cites nothing real, so it would be rejected: the mapping is load-bearing.
  const unmapped = validateHypotheses(normalizeHypothesisResponse(answer, ctx), ctx);
  check("unmapped short ids never pass as evidence", !unmapped.accepted.some((h) => h.id === "ai-new-pattern"));
  // A full ref (an older habit) still passes straight through.
  eq("a full ev: ref passes through unchanged", expandProfileRefs({ hypotheses: [{ evidence: [refs.get("e1")], counter: [] }] }, refs).hypotheses[0].evidence[0], refs.get("e1"));
}
{
  // A carried-forward earlier pattern (#228) still resolves against the full refs in state. Few reactions,
  // so no pattern has two misses in its areas.
  const s = productionShapedState({ reactions: 8 });
  const ctx = buildContext(s);
  const kept = preserveExistingHypotheses(normalizeHypothesisResponse({ hypotheses: [], insufficientEvidence: false }, ctx), ctx, s.modelHypotheses);
  check("earlier patterns are still carried forward with their full refs", kept.hypotheses.length > 0 && kept.hypotheses.every((h) => h.carriedForward && h.evidence.length && h.evidence.every((ref) => ref.startsWith("ev:"))));
}
{
  // End to end through the production endpoint with a faked provider that answers in short ids.
  const s = productionShapedState({ patterns: 0 });
  const rawState = { ...s, selectedFavorites: [...s.selectedFavorites], libraryFavorites: [...s.libraryFavorites], blindSpotDismissed: [], modelHypotheses: [] };
  const env = { TASTEMAKE_AI_ENABLED: "1", ANTHROPIC_API_KEY: "fake-key", TASTEMAKE_AI_MODEL: "claude-test", TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1", TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1", TASTEMAKE_AI_HYPOTHESES_ENABLED: "1", VERCEL_ENV: "preview" };
  let sentRows = [];
  const fetchImpl = async (url, init) => {
    if (!String(url).includes("api.anthropic.com")) throw new Error(`unexpected URL ${url}`);
    sentRows = rowsOf(contextOf(JSON.parse(init.body).messages[0].content));
    const games = sentRows.filter((row) => row.kind === "experienced-strong-positive" && row.domainKey === "play").slice(0, 2);
    const answer = { hypotheses: [{ id: "ai-games", label: "Games with room to explore", claim: "Games stick when exploration is the point rather than a side activity.", evidence: games.map((row) => row.id), counter: [], domains: ["play"], crossDomain: "untested", level: "supported", conditional: false, context: null }], insufficientEvidence: false };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 10, output_tokens: 20 }, model: "claude-test" }) };
  };
  const originalLog = console.log; const originalInfo = console.info;
  console.log = () => {}; console.info = () => {};
  let payload;
  try { payload = await produceHypotheses({ rawState, env, fetchImpl }); }
  finally { console.log = originalLog; console.info = originalInfo; }
  eq("endpoint accepts a short-id answer", payload.source, "model");
  const games = sentRows.filter((row) => row.kind === "experienced-strong-positive" && row.domainKey === "play").slice(0, 2);
  const titles = (payload.hypotheses[0]?.evidence ?? []).map((ref) => buildContext(s).evidence.find((r) => r.ref === ref)?.title);
  eq("endpoint answer cites the full refs of the items the short ids named", JSON.stringify(titles), JSON.stringify(games.map((row) => row.t)));
}

finish();
