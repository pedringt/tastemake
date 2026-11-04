#!/usr/bin/env node
// #1a candidate trace: show one recommendation request's full path -- which ratings retrieval used,
// every candidate's taste-score parts and why it was offered or cut, and for each final pick the ratings
// that selected it and whether its reason cites one of them.
//
//   node scripts/evals/trace-request.mjs                          # stress profile narrow-10, round 0
//   node scripts/evals/trace-request.mjs --profile split-50 --round 2
//   node scripts/evals/trace-request.mjs --all                    # summary line per stress profile
//   node scripts/evals/trace-request.mjs --profile broad-10 --json trace.json
//
// Free and offline: production's produceRecommendations with the stress profile's fixed candidate pool
// injected as retrieval (as run-stress.mjs does) and an empty env, so live AI is off and the catalog
// fallback answers. No model call, no provider call, no database.

import { writeFileSync } from "node:fs";
import { produceRecommendations } from "../../api/recommendations.mjs";
import { serializeAiState } from "../../src/ai/live-client.js";
import { candidateItems, itemsIndex, loadProfileSpecs, profileState } from "./stress/profiles.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };

export async function traceProfile(spec, { round = 0, snapshotIndex = itemsIndex() } = {}) {
  const state = profileState(spec, { round, itemsById: snapshotIndex });
  const candidates = candidateItems(spec, { itemsById: snapshotIndex });
  const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
  const info = console.info;
  console.info = () => {};
  try {
    return await produceRecommendations({ rawState, env: {}, fetchImpl: async () => { throw new Error("trace-request makes no network calls"); }, retrieve: async () => candidates, trace: true });
  } finally {
    console.info = info;
  }
}

const fmt = (value) => (typeof value === "number" ? value.toFixed(3) : String(value ?? "-"));

function printTrace(spec, result) {
  const { trace } = result;
  console.log(`${spec.id} -- source ${result.source}; ${trace.summary.candidates} candidates, ${trace.summary.offered} offered, ${trace.summary.picks} picks; reasons citing selection evidence: ${trace.summary.citesSelectionEvidence}/${trace.summary.picks}`);
  console.log("\nCandidates (retrieval order):");
  for (const c of trace.candidates) {
    const top = c.positives.slice(0, 2).map((m) => `${m.title ?? m.ref} ${fmt(m.contribution)}`).join(", ");
    console.log(`  #${String(c.retrievalIndex).padStart(2)} ${c.outcome.padEnd(17)} score ${fmt(c.score).padStart(7)}  taste rank ${String(c.tasteRank).padStart(2)}  ${c.medium.padEnd(6)} ${c.title}  <- ${c.relatedTo ?? "-"}${top ? `  [${top}]` : ""}`);
  }
  console.log("\nPicks:");
  for (const p of trace.picks) {
    console.log(`  ${p.title}: found from ${p.retrievedFromRef ?? p.retrievedFrom ?? "-"}; scored from ${p.scoredFrom.join(", ") || "-"}; cites ${p.cites.join(", ") || "-"} -> ${p.citesSelectionEvidence ? "cites selection evidence" : "DOES NOT cite selection evidence"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const specs = loadProfileSpecs();
  const snapshotIndex = itemsIndex();
  const round = Number(arg("--round", 0));
  if (args.includes("--all")) {
    for (const spec of specs) {
      const { source, trace } = await traceProfile(spec, { round, snapshotIndex });
      const outcomes = trace.candidates.reduce((counts, c) => ({ ...counts, [c.outcome]: (counts[c.outcome] ?? 0) + 1 }), {});
      console.log(`${spec.id.padEnd(14)} ${source}  picks ${trace.summary.picks}  cite selection evidence ${trace.summary.citesSelectionEvidence}/${trace.summary.picks}  ${JSON.stringify(outcomes)}`);
    }
  } else {
    const id = arg("--profile", "narrow-10");
    const spec = specs.find((s) => s.id === id);
    if (!spec) throw new Error(`no stress profile ${id}; ids: ${specs.map((s) => s.id).join(", ")}`);
    const result = await traceProfile(spec, { round, snapshotIndex });
    printTrace(spec, result);
    const out = arg("--json");
    if (out) { writeFileSync(out, JSON.stringify(result.trace, null, 1) + "\n"); console.log(`\nwrote ${out}`); }
  }
}
