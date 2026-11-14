#!/usr/bin/env node
// #318 (Nov 13): two software fixes for what a Taste Profile refresh keeps.
//   1. Support filing (src/ai/support-filing.js): Resident Evil 7 and BioShock came back under "Mythic and
//      fantastical worlds" on every refresh, re-cited by the model itself (Nov 6: 10/10; Nov 13: 6/6 with a
//      re-check prompt). A support on a cross-media pattern that shows nothing of its label and already belongs
//      to a pattern of its own medium on another subject is taken off, never emptying a medium.
//   2. Narrowing a confirmed pattern (src/ai/validate.js): when a refresh cites nothing in one of a confirmed
//      pattern's areas, the narrower version used to be rejected and the stored one put back, wrong supports
//      included. It is now kept and flagged "Needs another look" with the areas it lost, until the user confirms.
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
const { markNeedsReview, mergeHypotheses, normalizeHypothesis, refreshProfileHypotheses } = await import("../../src/ai/hypothesis-profile.js");
const { NEEDS_REVIEW, NEEDS_REVIEW_TEXT, canReconfirm, needsReviewText, patternDisplayStatus, reconfirmPattern, statementFor } = await import("../../src/model/statements.js");
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
  const merged = markNeedsReview(mergeHypotheses(state.modelHypotheses, next, { statements: state.patternStatements, activeLimit: 12, preserveExistingActive: validated.rejected.length > 0 }), validated.needsReview, validated.narrowed);
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

// ---- 3. a confirmed pattern narrowed by a refresh ------------------------------------------------------------
{
  // The model re-checks the confirmed mythic pattern and cites only books: same id, label and claim.
  const state = fixture("example-refresh-confirmed").build();
  const storedMythic = state.modelHypotheses.find((h) => MYTHIC.test(h.title));
  const booksOnly = state.modelHypotheses.map(asProposal).map((h) => (h.id === storedMythic.id ? { ...h, evidence: h.evidence.filter((r) => /openlibrary|book/.test(r)) } : h));
  const { ctx, validated, merged } = refresh(state, booksOnly);
  const kept = validated.accepted.find((h) => h.id === storedMythic.id);
  eq("narrowed: the narrower version is accepted, books only", kept?.domains.join(","), "read");
  check("narrowed: the stored game supports are not put back", !titles(ctx, kept).some((t) => /Resident Evil 7|^BioShock$|Obra Dinn/.test(t)));
  eq("narrowed: label and claim word for word", `${kept?.label}|${kept?.claim}`, `${storedMythic.title}|${storedMythic.claim}`);
  eq("narrowed: listed for review", validated.needsReview.join(","), storedMythic.id);
  eq("narrowed: with the area it lost", JSON.stringify(validated.narrowed), JSON.stringify([{ id: storedMythic.id, areas: ["play"] }]));
  const shown = merged.find((p) => p.id === storedMythic.id);
  eq("client: flagged Needs another look", shown?.evidenceStatus, NEEDS_REVIEW);
  eq("client: remembers the area it lost", shown?.narrowedAreas?.join(","), "play");
  eq("client: the display status is the flag", patternDisplayStatus(shown, statementFor(state, shown)).kind, "needs-review");
  const text = needsReviewText(shown);
  check("client: the explanation names what it lost and what it covers now", text.includes("Games") && text.includes("now covers Books only"));
  check("client: not the removed-evidence explanation", text !== NEEDS_REVIEW_TEXT);
  eq("client: other patterns aren't flagged", merged.filter((p) => p.evidenceStatus === NEEDS_REVIEW).length, 1);
  {
    const { state: app } = await import("../../src/state.js");
    const { renderProfile } = await import("../../src/screens/profile.js");
    Object.assign(app, { feedbackByRecommendation: state.feedbackByRecommendation, patternStatements: state.patternStatements, modelHypotheses: merged, profileView: "list" });
    const html = renderProfile();
    const at = html.indexOf(`data-profile-pattern="${storedMythic.id}"`);
    const row = html.slice(at, html.indexOf("</article>", at));
    check("profile: the narrowed row shows Needs another look", row.includes(">Needs another look</span>"), row.slice(0, 400));
    check("profile: and explains the narrowing", row.includes("found nothing in Games") && row.includes("now covers Books only"), row.slice(0, 1600));
    check("profile: with a way to confirm it", row.includes(`data-reconfirm-pattern="${storedMythic.id}"`) && row.includes("If it still describes you without Games"));
  }

  // The flag stays through the next refresh (which checks the narrower version, and would pass), until confirmed.
  const after = { ...state, modelHypotheses: merged };
  const realFetch = globalThis.fetch;
  const again = after.modelHypotheses.map((p) => ({ id: p.id, label: p.title, claim: p.claim, evidence: p.supports, counter: p.counters, domains: p.domains, level: String(p.strength).toLowerCase(), crossDomain: "untested", conditional: false, context: null }));
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ source: "model", hypotheses: again, meta: { paidCallMade: true, needsReview: [], notChecked: [], narrowed: [], rejected: 0 } }) });
  try { await refreshProfileHypotheses(after, { force: true }); } finally { globalThis.fetch = realFetch; }
  const stillShown = after.modelHypotheses.find((p) => p.id === storedMythic.id);
  eq("next refresh: still flagged", stillShown?.evidenceStatus, NEEDS_REVIEW);
  eq("next refresh: still remembers the area", stillShown?.narrowedAreas?.join(","), "play");
  check("next refresh: the message says patterns were narrowed", /narrowed/.test(after.hypothesisAiMessage ?? ""));

  check("the user can confirm it", canReconfirm(after, storedMythic.id));
  const message = reconfirmPattern(after, storedMythic.id);
  check("confirming says what was confirmed", /still fits without Games/.test(message ?? ""));
  const confirmed = after.modelHypotheses.find((p) => p.id === storedMythic.id);
  check("confirming clears the flag and the note", confirmed && !confirmed.evidenceStatus && !confirmed.narrowedAreas);
  eq("confirming keeps the narrower version", confirmed?.domains.join(","), "read");
  check("confirming is recorded in the pattern's history", (after.hypothesisHistory ?? []).some((r) => r.hypothesisId === storedMythic.id && r.origin === "user-confirmed"));
}
{
  // An area the user excluded is not a narrowing: the Partly fixture excludes games, and a books-only re-check
  // is not flagged.
  const state = fixture("example-refresh-partly").build();
  const storedMythic = state.modelHypotheses.find((h) => MYTHIC.test(h.title));
  const booksOnly = state.modelHypotheses.map(asProposal).map((h) => (h.id === storedMythic.id ? { ...h, evidence: h.evidence.filter((r) => /openlibrary|book/.test(r)), domains: ["read"] } : h));
  const { validated } = refresh(state, booksOnly);
  eq("excluded area: not reported as narrowed", validated.narrowed.length, 0);
  check("excluded area: not flagged for review", !validated.needsReview.includes(storedMythic.id));
}
{
  // An unconfirmed pattern narrowed by a refresh is ordinary: no flag (the user hasn't said anything about it).
  const state = fixture("example-refresh").build();
  const storedMythic = state.modelHypotheses.find((h) => MYTHIC.test(h.title));
  const booksOnly = state.modelHypotheses.map(asProposal).map((h) => (h.id === storedMythic.id ? { ...h, evidence: h.evidence.filter((r) => /openlibrary|book/.test(r)), domains: ["read"] } : h));
  const { validated } = refresh(state, booksOnly);
  eq("unconfirmed: narrowed without a flag", `${validated.accepted.find((h) => h.id === storedMythic.id)?.domains.join(",")}|${validated.needsReview.length}`, "read|0");
}

finish();
