#!/usr/bin/env node
// #1b explanation provenance: each offered candidate carries the ratings that decided it (its basis),
// the model is shown them, its reason must cite one, and a weak basis is labelled rather than hidden.
// Free: no network, no model.
//
//   node scripts/qa/explanation-provenance-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";
import { selectionBasis } from "../../src/ai/taste-score.js";
import { validatePicks } from "../../src/ai/validate.js";
import { buildPickPrompt, offeredCandidates, produceRecommendations, promptContext, selectPromptEvidence } from "../../api/recommendations.mjs";
import { serializeAiState } from "../../src/ai/live-client.js";
import { hydrateState } from "../../src/server/request-state.mjs";
import { buildContext } from "../../src/ai/context.js";
import { candidateItems, itemsIndex, loadProfileSpecs, profileState } from "../evals/stress/profiles.mjs";

const { check, eq, finish } = createSuite("explanation provenance tests");

const rec = (id, title, genres, polarity, weight, extra = {}) => ({
  ref: `ev:${id}`, itemId: id, title, class: "experienced", polarity, weight,
  kind: polarity > 0 ? "experienced-strong-positive" : "experienced-negative", facts: { genres }, domains: ["movies"], ...extra
});
const movie = (id, title, genres, extra = {}) => ({ id, title, genres, domains: ["movies"], type: "movie", ...extra });

// 1. The basis and its labels on constructed cases.
{
  const records = [
    rec("big", "Big Match", ["27", "9648"], 1, 3),
    rec("small", "Small Match", ["27"], 1, 1.25),
    rec("hate", "Disliked", ["27", "9648"], -1, -2)   // weighs 2 against a positive total of about 3.9
  ];
  const basis = selectionBasis(movie("c1", "Candidate", ["27", "9648"]), records);
  eq("decisive set: the top contributor alone covers half the positive score", basis.refs.join(","), "ev:big");
  eq("shared facts use genre names, not TMDb ids", basis.rows[0].shares.join(","), "Horror,Mystery");
  check("a dislike that weighs at least half the positives marks it contested", basis.contested && basis.weakBasis.includes("contested"));
  check("genre-only sharing is labelled broad-only", basis.weakBasis.includes("broad-only"));
  eq("the dislike is listed as weighing against it", basis.against.map((a) => a.ref).join(","), "ev:hate");

  const found = selectionBasis(movie("c2", "Found Candidate", ["35"], { relatedToId: "big" }), records);
  eq("found from a loved rating: that rating is the basis", found.rows.map((r) => `${r.role}:${r.ref}`).join(","), "found-from:ev:big");
  check("found from a rating that nothing scores positively is labelled found-from-only", found.weakBasis.includes("found-from-only") && !found.weakBasis.includes("broad-only"));

  const none = selectionBasis(movie("c3", "Unrelated", ["99"]), records);
  check("no found-from rating and no positive match: no-positive-basis, empty basis", none.refs.length === 0 && none.weakBasis.includes("no-positive-basis"));

  const themed = selectionBasis({ id: "b1", title: "Book", type: "book", domains: ["read"], genres: ["Fantasy", "Romance"], by: "Same Author" },
    [rec("bk", "Rated Book", ["Fantasy"], 1, 2, { domains: ["read"], facts: { genres: ["Fantasy"], creator: "Same Author" }, type: "book" })]);
  check("sharing a creator is not broad-only", !themed.weakBasis.includes("broad-only") && themed.rows[0].shares.includes("same author"));

  const spread = selectionBasis(movie("c4", "Spread", ["27", "9648", "53"]), [
    rec("p1", "One", ["27"], 1, 1.25), rec("p2", "Two", ["9648"], 1, 1.25), rec("p3", "Three", ["53"], 1, 1.25)
  ]);
  eq("equal contributors: the smallest set reaching half takes two", spread.refs.length, 2);
}

// 2. The validator rule.
{
  const records = [rec("big", "Big Match", ["27"], 1, 3), rec("other", "Other Loved", ["35"], 1, 3), rec("hate", "Disliked", ["27"], -1, -2)];
  const candidates = [movie("m1", "Night Film", ["27"]), movie("m2", "Unrelated Doc", ["99"])];
  const ctx = { evidence: records, candidates, basis: new Map(candidates.map((c) => [c.id, selectionBasis(c, records)])), curveball: false };
  const pick = (itemId, cites) => ({ itemId, why: "Shares its slow, creeping dread with Big Match.", cites, tests: null, kind: "pick" });
  const out = validatePicks({ picks: [pick("m1", ["ev:other"])] }, ctx);
  check("citing a loved rating that did not decide the pick is rejected", out.rejected[0]?.reasons.includes("cites none of the ratings that decided this pick"), JSON.stringify(out.rejected));
  eq("citing the deciding rating passes, even though the candidate is contested", validatePicks({ picks: [pick("m1", ["ev:big"])] }, ctx).accepted.length, 1);
  eq("citing the deciding rating plus extra context passes", validatePicks({ picks: [pick("m1", ["ev:other", "ev:big"])] }, ctx).accepted.length, 1);
  eq("a candidate with no basis is not rejected by this rule", validatePicks({ picks: [pick("m2", ["ev:other"])] }, ctx).accepted.length, 1);
  eq("without basis in the context (older callers) the rule does not apply", validatePicks({ picks: [pick("m1", ["ev:other"])] }, { ...ctx, basis: undefined }).accepted.length, 1);
}

// 3. Prompt and evidence on every stress profile: the model is shown each basis, and at least one basis
//    rating of every offered candidate is in its evidence list, within the 18-row cap.
{
  const index = itemsIndex();
  let candidatesChecked = 0, missing = 0, overCap = 0, promptsMissingBasis = 0, weakShown = 0, weakTotal = 0;
  for (const spec of loadProfileSpecs()) {
    const state = profileState(spec, { itemsById: index });
    const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
    const ctx = buildContext(hydrateState(rawState), candidateItems(spec, { itemsById: index }));
    const promptCtx = promptContext(ctx, offeredCandidates(ctx));
    const evidenceRefs = new Set(selectPromptEvidence(promptCtx).map((r) => r.ref));
    if (evidenceRefs.size > 18) overCap += 1;
    const payload = JSON.parse(buildPickPrompt(promptCtx, promptCtx.candidates.length).split("CONTEXT\n")[1]);
    for (const c of promptCtx.candidates) {
      const basis = promptCtx.basis.get(c.id);
      candidatesChecked += 1;
      if (basis.refs.length && !basis.refs.some((ref) => evidenceRefs.has(ref))) missing += 1;
      const shown = payload.candidates.find((p) => p.id === c.id);
      if (JSON.stringify(shown.basis?.map((b) => b.ref) ?? []) !== JSON.stringify(basis.refs)) promptsMissingBasis += 1;
      if (basis.weakBasis.length) { weakTotal += 1; if (JSON.stringify(shown.weakBasis) === JSON.stringify(basis.weakBasis)) weakShown += 1; }
    }
  }
  eq(`every offered candidate with a basis has a basis rating in its evidence (${candidatesChecked} candidates)`, missing, 0);
  eq("prompt evidence stays within 18 rows", overCap, 0);
  eq("the prompt shows each candidate's basis refs", promptsMissingBasis, 0);
  eq(`weak candidates carry weakBasis in the prompt (${weakTotal})`, weakShown, weakTotal);
  check("the prompt tells the model to cite the basis and keep weak picks modest", /Cite at least one basis ref/.test(buildPickPrompt({ evidence: [], candidates: [] }, 6)) && /never invent a specific reason/.test(buildPickPrompt({ evidence: [], candidates: [] }, 6)));
}

// 4. Trace: the stricter check and the weakness label are reported per pick.
{
  const spec = loadProfileSpecs().find((s) => s.id === "split-50");
  const index = itemsIndex();
  const rawState = JSON.parse(JSON.stringify(serializeAiState(profileState(spec, { itemsById: index }))));
  const info = console.info; console.info = () => {};
  const { trace } = await produceRecommendations({ rawState, env: {}, fetchImpl: async () => { throw new Error("no network"); }, retrieve: async () => candidateItems(spec, { itemsById: index }), trace: true });
  console.info = info;
  check("trace: each pick reports decidedBy, citesDecisiveBasis and weakBasis", trace.picks.every((p) => Array.isArray(p.decidedBy) && "citesDecisiveBasis" in p && Array.isArray(p.weakBasis)));
  check("trace: summary counts decisive citations and weak picks", Number.isInteger(trace.summary.citesDecisiveBasis) && Number.isInteger(trace.summary.weakBasis));
}

finish();
