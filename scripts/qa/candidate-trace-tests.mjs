#!/usr/bin/env node
// #1a candidate trace: tracing must never change what is offered, the score parts must add up to the
// taste score exactly, and every candidate must get one outcome. Free: no network, no model.
//
//   node scripts/qa/candidate-trace-tests.mjs

globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

import { createSuite } from "./lib/assert.mjs";
import { chooseCandidates, featureRarity, tasteScore, tasteScoreParts } from "../../src/ai/taste-score.js";
import { evidenceRecords } from "../../src/model/evidence.js";
import { produceRecommendations } from "../../api/recommendations.mjs";
import { serializeAiState } from "../../src/ai/live-client.js";
import { candidateItems, itemsIndex, loadProfileSpecs, profileState } from "../evals/stress/profiles.mjs";

const { check, eq, finish } = createSuite("candidate trace tests");
const OUTCOMES = new Set(["chosen", "edge", "same-franchise", "scored-below-zero", "count-reached"]);
const specs = loadProfileSpecs();
const index = itemsIndex();
const quiet = async (fn) => { const info = console.info; console.info = () => {}; try { return await fn(); } finally { console.info = info; } };

// 1. Parity and completeness on every stress profile, filter mode and surprise setting.
let parityRuns = 0, partsChecked = 0;
for (const spec of specs) {
  const state = profileState(spec, { itemsById: index });
  const records = evidenceRecords(state);
  const candidates = candidateItems(spec, { itemsById: index });
  for (const mode of ["all", "movies", "read"]) {
    for (const curveball of [true, false]) {
      const plain = chooseCandidates(candidates, records, { mode, curveball });
      const trace = {};
      const traced = chooseCandidates(candidates, records, { mode, curveball, trace });
      parityRuns += 1;
      if (JSON.stringify(plain) !== JSON.stringify(traced)) check(`${spec.id} ${mode} curveball=${curveball}: same offer with and without trace`, false);
      const entries = trace.candidates ?? [];
      if (entries.length !== candidates.length) check(`${spec.id} ${mode}: one trace entry per candidate`, false, `${entries.length} vs ${candidates.length}`);
      if (!entries.every((e) => OUTCOMES.has(e.outcome))) check(`${spec.id} ${mode}: every outcome is known`, false);
      const offered = entries.filter((e) => e.outcome === "chosen" || e.outcome === "edge").map((e) => e.itemId).sort();
      if (JSON.stringify(offered) !== JSON.stringify(plain.map((p) => p.id).sort())) check(`${spec.id} ${mode} curveball=${curveball}: chosen/edge outcomes are exactly the offer`, false);
      if (entries.filter((e) => e.outcome === "edge").length !== plain.filter((p) => p.edge).length) check(`${spec.id} ${mode}: edge outcome matches the edge pick`, false);
    }
  }
  // Score parts equal the score bit for bit, with and without the rarity weighting production uses.
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  for (const candidate of candidates) {
    for (const options of [{ cache, rarity }, {}]) {
      const parts = tasteScoreParts(candidate, records, options);
      partsChecked += 1;
      if (parts.score !== tasteScore(candidate, records, options)) check(`${spec.id} ${candidate.id}: parts score equals tasteScore`, false);
      const sum = [...parts.positives, ...parts.negatives].reduce((s, m) => s + m.contribution, 0) + parts.anchorBonus;
      if (Math.abs(sum - parts.score) > 1e-9) check(`${spec.id} ${candidate.id}: contributions add up to the score`, false);
    }
  }
}
check(`offer unchanged by tracing in all ${parityRuns} profile/mode/surprise runs`, true);
check(`score parts equal tasteScore for all ${partsChecked} candidate scorings`, true);

// 2. Constructed cases for each cut reason.
const rec = (id, title, genres, polarity, weight, kind = polarity > 0 ? "experienced-strong-positive" : "experienced-negative") =>
  ({ ref: `ev:${id}`, itemId: id, title, class: "experienced", polarity, weight, kind, facts: { genres }, domains: ["movies"] });
const movie = (id, title, genres, extra = {}) => ({ id, title, genres, domains: ["movies"], type: "movie", ...extra });
{
  const records = [rec("m-love", "Loved Film", ["Horror", "Mystery"], 1, 2), rec("m-hate", "Hated Film", ["Romance"], -1, -2)];
  const candidates = [
    movie("m-a", "Alien", ["Horror", "Mystery"]),
    movie("m-b", "Alien 2", ["Horror", "Mystery"]),
    movie("m-c", "Night Drive", ["Horror"]),
    movie("m-d", "Love Story", ["Romance"])
  ];
  const trace = {};
  const offer = chooseCandidates(candidates, records, { count: 2, mode: "movies", curveball: false, trace });
  const outcome = Object.fromEntries(trace.candidates.map((e) => [e.title, e.outcome]));
  eq("constructed: the best fit is chosen", outcome.Alien, "chosen");
  eq("constructed: its numbered sequel is cut as same-franchise", outcome["Alien 2"], "same-franchise");
  eq("constructed: the next fit fills the set", outcome["Night Drive"], "chosen");
  eq("constructed: a candidate like a dislike is scored-below-zero", outcome["Love Story"], "scored-below-zero");
  eq("constructed: the offer itself is unchanged", offer.map((p) => p.title).join(","), "Alien,Night Drive");
  const alien = trace.candidates.find((e) => e.title === "Alien");
  check("constructed: positives name the rating that scored it", alien.positives.some((m) => m.ref === "ev:m-love" && m.contribution > 0));
  check("constructed: negatives carry the dislike's negative contribution", trace.candidates.find((e) => e.title === "Love Story").negatives.some((m) => m.ref === "ev:m-hate" && m.contribution < 0));
  const full = {};
  chooseCandidates(candidates, records, { count: 1, mode: "movies", curveball: false, trace: full });
  eq("constructed: with one slot, a reached-later candidate is count-reached", full.candidates.find((e) => e.title === "Night Drive").outcome, "count-reached");
}

// 3. Request level: same payload with and without trace; trace only when asked; every pick traced.
{
  const spec = specs.find((s) => s.id === "split-50");
  const state = profileState(spec, { itemsById: index });
  const candidates = candidateItems(spec, { itemsById: index });
  const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
  const noNetwork = async () => { throw new Error("no network in this test"); };
  const run = (trace) => quiet(() => produceRecommendations({ rawState, env: {}, fetchImpl: noNetwork, retrieve: async () => candidates, ...(trace ? { trace } : {}) }));
  const plain = await run(false);
  const traced = await run(true);
  check("request: no trace field unless asked", !("trace" in plain));
  const { trace, ...rest } = traced;
  eq("request: payload identical apart from trace", JSON.stringify(rest), JSON.stringify(plain));
  eq("request: one trace pick per pick", trace.picks.length, plain.picks.length);
  check("request: every pick traces to a candidate outcome", trace.picks.every((p) => p.outcome === "chosen" || p.outcome === "edge"));
  check("request: prompt evidence refs are recorded", Array.isArray(trace.promptEvidence) && trace.promptEvidence.length > 0);
  check("request: live AI off, so no model step", trace.model === null);
  check("request: evidence records are not exposed in the trace", !("evidence" in trace));
}

finish();
