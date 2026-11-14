#!/usr/bin/env node
// #318 (Nov 13): what a Taste Profile refresh keeps.
//   1. Support filing (src/ai/support-filing.js): Resident Evil 7 and BioShock came back under "Mythic and
//      fantastical worlds" on every refresh, re-cited by the model itself (Nov 6: 10/10; Nov 13: 6/6 with a
//      re-check prompt). A support on a cross-media pattern that shows nothing of its label and already belongs
//      to a pattern of its own medium on another subject is taken off, never emptying a medium.
// Checked on the Example Profile fixtures, then on cases built to catch over-dropping (the Nov 7 deterministic fit
// check flagged 23-77% of fitting supports). Free, no browser, no model call.
//
//   node scripts/qa/support-filing-tests.mjs

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
const { fileSupports, labelStems } = await import("../../src/ai/support-filing.js");
const { markNeedsReview, mergeHypotheses, normalizeHypothesis } = await import("../../src/ai/hypothesis-profile.js");
const { SUPPORT_FIXTURES } = await import("../evals/fixtures.mjs");

const { check, eq, finish } = createSuite("support filing tests");

const fixture = (id) => SUPPORT_FIXTURES.find((f) => f.id === id);
const asProposal = (h) => ({ id: h.id, label: h.title, claim: h.claim, evidence: [...h.supports], counter: [...(h.counters ?? [])], domains: [...h.domains], crossDomain: h.crossDomain ?? "untested", level: String(h.strength ?? "emerging").toLowerCase(), conditional: false, context: h.context ?? null });
// What production does with one model answer (api/hypotheses.mjs), then the client's merge.
function refresh(state, hypotheses) {
  const ctx = buildContext(state);
  const preserved = preserveExistingHypotheses(normalizeHypothesisResponse({ hypotheses }, ctx), ctx, state.modelHypotheses);
  const validated = settleConfirmedHypotheses(validateHypotheses(preserved, ctx), ctx, state.modelHypotheses);
  const next = validated.accepted.map((h, i) => normalizeHypothesis(h, i, state));
  const merged = markNeedsReview(mergeHypotheses(state.modelHypotheses, next, { statements: state.patternStatements, activeLimit: 12, preserveExistingActive: validated.rejected.length > 0 }), validated.needsReview);
  return { ctx, preserved, validated, merged };
}
const titleOf = (ctx) => (ref) => ctx.evidence.find((row) => row.ref === ref)?.title;
const titles = (ctx, h) => (h?.evidence ?? h?.supports ?? []).map(titleOf(ctx));
const find = (list, re) => list.find((h) => re.test(h.label ?? h.title));
const MYTHIC = /^Mythic and fantastical worlds$/;

// ---- 1. the Example Profile: a refresh that copies the stored patterns (what production's model does) ----------
for (const id of ["example-refresh", "example-refresh-confirmed", "example-refresh-partly"]) {
  const state = fixture(id).build();
  const { ctx, preserved, validated } = refresh(state, state.modelHypotheses.map(asProposal));
  const kept = validated.accepted;
  const mythic = find(kept, MYTHIC);
  check(`${id}: the mythic pattern is kept`, Boolean(mythic));
  check(`${id}: Resident Evil 7 is no longer support for it`, !titles(ctx, mythic).includes("Resident Evil 7: Biohazard"));
  check(`${id}: BioShock is no longer support for it`, !titles(ctx, mythic).includes("BioShock"));
  check(`${id}: Circe still supports it`, titles(ctx, mythic).includes("Circe"));
  check(`${id}: Return of the Obra Dinn still supports it (no other pattern cites it)`, titles(ctx, mythic).includes("Return of the Obra Dinn"));
  eq(`${id}: it still covers books and games`, mythic?.domains.join(","), "read,play");
  check(`${id}: Resident Evil 7 still supports the horror pattern`, titles(ctx, find(kept, /horror in games/i)).includes("Resident Evil 7: Biohazard"));
  check(`${id}: Resident Evil 7 still supports the exploration pattern`, titles(ctx, find(kept, /exploration/i)).includes("Resident Evil 7: Biohazard"));
  check(`${id}: BioShock still supports the exploration pattern`, titles(ctx, find(kept, /exploration/i)).includes("BioShock"));
  eq(`${id}: only those two citations are moved`, (preserved.refiled ?? []).map((r) => titleOf(ctx)(r.ref)).sort().join(","), "BioShock,Resident Evil 7: Biohazard");
  eq(`${id}: every pattern is accepted`, kept.length, state.modelHypotheses.length);
  eq(`${id}: nothing flagged for review`, validated.needsReview.length, 0);
  if (id !== "example-refresh") eq(`${id}: the confirmed pattern keeps its wording`, mythic?.claim, state.modelHypotheses.find((h) => MYTHIC.test(h.title)).claim);
}
{
  // The model leaving the mythic pattern out: software carries the stored one, and files it the same way.
  const state = fixture("example-refresh").build();
  const { ctx, validated } = refresh(state, state.modelHypotheses.filter((h) => !MYTHIC.test(h.title)).map(asProposal));
  const mythic = find(validated.accepted, MYTHIC);
  check("carried forward: kept, without Resident Evil 7 or BioShock", Boolean(mythic) && !titles(ctx, mythic).some((t) => /Resident Evil 7|^BioShock$/.test(t)));
}
{
  // A fresh profile is not touched: the rule runs where stored patterns are carried, on a refresh.
  const state = fixture("example-refresh").build();
  const ctx = buildContext(state);
  const fresh = preserveExistingHypotheses(normalizeHypothesisResponse({ hypotheses: state.modelHypotheses.map(asProposal) }, ctx), ctx, []);
  check("a fresh profile's answer is left as the model gave it", titles(ctx, find(fresh.hypotheses, MYTHIC)).includes("Resident Evil 7: Biohazard") && !fresh.refiled);
}

// ---- 2. guards against over-dropping -------------------------------------------------------------------------
eq("label words that name a medium or carry no meaning are ignored", labelStems("Mythic and fantastical worlds in both books and games").join(","), "myth,fant");
{
  const state = fixture("example-refresh").build();
  const ctx = buildContext(state);
  const base = state.modelHypotheses.map(asProposal);
  const ref = (title) => ctx.evidence.find((row) => row.title === title)?.ref;
  const filed = (hypotheses) => fileSupports(normalizeHypothesisResponse({ hypotheses }, ctx).hypotheses, ctx);
  const withMythic = (evidence, extra = {}) => base.map((h) => (MYTHIC.test(h.label) ? { ...h, evidence, ...extra } : h));

  // The rule never empties a medium: with no game left that it would keep, it keeps them all.
  const onlyMisfiled = filed(withMythic([ref("Circe"), ref("Piranesi"), ref("Resident Evil 7: Biohazard"), ref("BioShock")]));
  eq("never empties a medium: no move when every game on the pattern would go", onlyMisfiled.refiled.length, 0);

  // A support with no other pattern stays (Return of the Obra Dinn), however little its genres say.
  check("a support no other pattern cites stays", !filed(base).refiled.some((r) => r.ref === ref("Return of the Obra Dinn")));

  // Single-medium patterns are never touched, even when they share items.
  check("a single-medium pattern is never touched", filed(base).refiled.every((r) => MYTHIC.test(base.find((h) => h.id === r.id).label)));

  // Genres that show the label keep a support: a fantasy film under a books-and-movies mythic pattern, also cited by
  // "Epic adventure on screen".
  const lotr = ref("The Lord of the Rings: The Fellowship of the Ring");
  const fantasyFilm = filed(base.map((h) => (MYTHIC.test(h.label) ? { ...h, evidence: [ref("Circe"), ref("Piranesi"), lotr, ref("Mad Max: Fury Road")], domains: ["read", "movies"] } : h)));
  check("a support whose genres show the label stays (The Lord of the Rings: Fantasy)", !fantasyFilm.refiled.some((r) => r.ref === lotr));
  check("...while one whose genres don't, cited by a movies pattern on another subject, goes (Mad Max)", fantasyFilm.refiled.some((r) => r.ref === ref("Mad Max: Fury Road")));

  // Two readings on the same subject keep a shared support: Twin Peaks under an uncanny books-and-TV pattern and
  // "Uncanny mystery on television".
  const uncanny = { id: "ai-uncanny-x", label: "Uncanny, eerie stories", claim: "Drawn to uncanny stories in books and TV.", evidence: [ref("Piranesi"), ref("Circe"), ref("Twin Peaks"), ref("Midnight Mass")], counter: [], domains: ["read", "tv"], crossDomain: "tentative", level: "emerging", conditional: false, context: null };
  check("a support shared with a pattern on the same subject stays (Twin Peaks, both 'uncanny')", !filed([...base, uncanny]).refiled.some((r) => r.id === "ai-uncanny-x" && r.ref === ref("Twin Peaks")));

  // A support with no genres can't be judged and stays.
  const bare = { ...ctx, evidence: ctx.evidence.map((row) => (row.title === "BioShock" ? { ...row, facts: { ...row.facts, genres: [] } } : row)) };
  check("a support with no genres stays", !fileSupports(normalizeHypothesisResponse({ hypotheses: base }, bare).hypotheses, bare).refiled.some((r) => r.ref === ref("BioShock")));
}

finish();
