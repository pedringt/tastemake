#!/usr/bin/env node
// #1b explanation provenance, diagnostic only: the trace records which ratings decided each pick, whether
// its reason cites one, and every weakness label that applies. Nothing here may change what is offered,
// what the model is shown, or what the validator accepts. Free: no network, no model.
//
//   node scripts/qa/explanation-provenance-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";
import { selectionBasis } from "../../src/ai/taste-score.js";
import { buildPickPrompt, offeredCandidates, produceRecommendations } from "../../api/recommendations.mjs";
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
  check("labels are not exclusive: broad-only and contested together", basis.weakBasis.includes("broad-only") && basis.weakBasis.includes("contested"));
  check("the totals behind the labels are returned", basis.positiveTotal > 3.8 && basis.positiveTotal < 4 && Math.abs(basis.againstTotal - 2) < 1e-9, `${basis.positiveTotal} / ${basis.againstTotal}`);
  eq("the dislike is listed as weighing against it", basis.against.map((a) => a.ref).join(","), "ev:hate");

  const found = selectionBasis(movie("c2", "Found Candidate", ["35"], { relatedToId: "big" }), records);
  eq("found from a loved rating: that rating is the basis", found.rows.map((r) => `${r.role}:${r.ref}`).join(","), "found-from:ev:big");
  check("found from a rating that nothing scores positively is labelled found-from-only, not broad-only", found.weakBasis.includes("found-from-only") && !found.weakBasis.includes("broad-only"));

  const none = selectionBasis(movie("c3", "Unrelated", ["99"]), records);
  check("no found-from rating and no positive match: no-positive-basis, empty basis", none.refs.length === 0 && none.weakBasis.includes("no-positive-basis") && !none.contested);

  const onlyAgainst = selectionBasis(movie("c4", "Only Against", ["10749"]), [...records, rec("rom", "Disliked Romance", ["10749"], -1, -2)]);
  eq("no positive basis but a dislike against it: both labels", onlyAgainst.weakBasis.join(","), "no-positive-basis,contested");

  const themed = selectionBasis({ id: "b1", title: "Book", type: "book", domains: ["read"], genres: ["Fantasy", "Romance"], by: "Same Author" },
    [rec("bk", "Rated Book", ["Fantasy"], 1, 2, { domains: ["read"], facts: { genres: ["Fantasy"], creator: "Same Author" }, type: "book" })]);
  check("sharing a creator is not broad-only", !themed.weakBasis.includes("broad-only") && themed.rows[0].shares.includes("same author"));

  const spread = selectionBasis(movie("c5", "Spread", ["27", "9648", "53"]), [
    rec("p1", "One", ["27"], 1, 1.25), rec("p2", "Two", ["9648"], 1, 1.25), rec("p3", "Three", ["53"], 1, 1.25)
  ]);
  eq("equal contributors: the smallest set reaching half takes two", spread.refs.length, 2);
}

// 2. Diagnostic only: on every stress profile, the model is shown no basis, and tracing changes nothing
//    in the request's payload.
{
  const index = itemsIndex();
  let promptsWithBasis = 0, payloadMismatches = 0, runs = 0, notApplicableOk = true, picksChecked = 0;
  const info = console.info; console.info = () => {};
  for (const spec of loadProfileSpecs()) {
    const state = profileState(spec, { itemsById: index });
    const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
    const ctx = buildContext(hydrateState(rawState), candidateItems(spec, { itemsById: index }));
    const offered = offeredCandidates(ctx);
    const prompt = buildPickPrompt({ ...ctx, candidates: offered }, offered.length);
    if (/"basis"|weakBasis|basis ref/.test(prompt)) promptsWithBasis += 1;
    const run = (trace) => produceRecommendations({ rawState, env: {}, fetchImpl: async () => { throw new Error("no network"); }, retrieve: async () => candidateItems(spec, { itemsById: index }), ...(trace ? { trace: true } : {}) });
    const plain = await run(false);
    const { trace, ...rest } = await run(true);
    runs += 1;
    if (JSON.stringify(rest) !== JSON.stringify(plain)) payloadMismatches += 1;
    for (const p of trace.picks) {
      picksChecked += 1;
      if (p.decidedBy.length === 0 && p.citesDecisiveBasis !== null) notApplicableOk = false;
      if (p.decidedBy.length > 0 && typeof p.citesDecisiveBasis !== "boolean") notApplicableOk = false;
    }
    if (trace.summary.citesDecisiveBasis + trace.summary.decisiveBasisNotApplicable > trace.summary.picks) notApplicableOk = false;
  }
  console.info = info;
  eq("the prompt shows the model no basis on any stress profile", promptsWithBasis, 0);
  eq(`payload identical with and without trace (${runs} profiles)`, payloadMismatches, 0);
  check(`citesDecisiveBasis is null exactly when nothing decided the pick (${picksChecked} picks)`, notApplicableOk);
}

finish();
