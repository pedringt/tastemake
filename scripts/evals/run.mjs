#!/usr/bin/env node
// Live-AI eval suite (#32). Runs a producer over fixed fixtures, validates every answer with the product's
// contract (src/ai/validate.js), scores it, and writes a report a product reviewer can read.
//
//   node scripts/evals/run.mjs                        # the deterministic baseline (free, no model)
//   node scripts/evals/run.mjs --producer live --dry-run   # the exact prompts + a cost estimate, no call
//   node scripts/evals/run.mjs --producer live            # PAID: one Anthropic call per fixture
//   node scripts/evals/run.mjs --producer endpoint --yes  # PAID: sends each fixture to the deployed
//                                                         # endpoint, so the API key stays in Vercel
//
// The live producer uses the same prompt builder and transport as the production endpoint
// (api/recommendations.mjs), so what is measured here is what production would send. It needs
// ANTHROPIC_API_KEY and TASTEMAKE_AI_MODEL in the environment, and --yes to actually spend.
//
// Output: scripts/evals/reports/<producer>-latest.md (+ .json). Exit code 1 if a hard check fails or the
// validator lets a deliberately bad answer through.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, badResponses } from "./fixtures.mjs";
import { scoreFixture } from "./scorers.mjs";
import { buildContext } from "../../src/ai/context.js";
import { validateHypotheses, validatePicks } from "../../src/ai/validate.js";
import { CONTRACT_VERSION } from "../../src/ai/contract.js";
import * as baseline from "../../src/ai/baseline.js";
import { buildPickPrompt, callAnthropic } from "../../api/recommendations.mjs";
import { nextRecommendations } from "../../src/model/taste.js";
import { serializeAiState } from "../../src/ai/live-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const producerName = args.includes("--producer") ? args[args.indexOf("--producer") + 1] : "baseline";
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");
const endpointUrl = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "https://tastemake.vercel.app").replace(/\/$/, "");
const pauseMs = Number(args.includes("--pause") ? args[args.indexOf("--pause") + 1] : 11_000);   // the endpoint rate-limits a burst
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const endpointRuns = [];

// Rough per-million-token prices, only for the estimate printed before a paid run. Override with
// TASTEMAKE_AI_PRICE_IN / TASTEMAKE_AI_PRICE_OUT if the model's pricing differs.
const PRICE_IN = Number(process.env.TASTEMAKE_AI_PRICE_IN || 3);
const PRICE_OUT = Number(process.env.TASTEMAKE_AI_PRICE_OUT || 15);
const spend = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
const dryRunPlan = [];
const estimateTokens = (text) => Math.ceil(String(text).length / 4);   // ~4 characters per token

const PRODUCERS = {
  baseline: {
    label: "Deterministic baseline (today's logic, no model)",
    infer: async (state) => baseline.inferHypotheses(state),
    pick: async (state, ctx) => baseline.explainPicks(state, ctx)
  },
  // Sends each fixture to the deployed endpoint. The model call happens there, so no key is needed here,
  // and what is measured is exactly what a visitor would get (including the endpoint's own validation).
  endpoint: {
    label: `Deployed endpoint (PAID, live AI where enabled): ${endpointUrl}`,
    infer: async (state) => baseline.inferHypotheses(state),
    pick: async (state, ctx) => {
      if (!nextRecommendations(state).length) return { picks: [] };
      if (dryRun) { dryRunPlan.push({ fixture: ctx.__fixture, count: nextRecommendations(state).length, promptChars: 0, estIn: 0, prompt: `(POST ${endpointUrl}/api/recommendations)` }); return { picks: [] }; }
      if (!confirmed) throw new Error("this spends money on the deployed endpoint: re-run with --yes");
      for (let attempt = 1; ; attempt += 1) {
        const response = await fetch(`${endpointUrl}/api/recommendations`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: serializeAiState(state) })
        });
        if (response.status === 429 && attempt <= 5) { await sleep(pauseMs); continue; }
        if (!response.ok) throw new Error(`endpoint returned ${response.status}`);
        const payload = await response.json();
        endpointRuns.push({ fixture: ctx.__fixture, source: payload.source, reason: payload.reason, meta: payload.meta });
        if (payload.meta?.usage) {
          spend.calls += 1;
          spend.inputTokens += payload.meta.usage.input_tokens ?? 0;
          spend.outputTokens += payload.meta.usage.output_tokens ?? 0;
          spend.usd = (spend.inputTokens / 1e6) * PRICE_IN + (spend.outputTokens / 1e6) * PRICE_OUT;
        }
        await sleep(pauseMs);
        // A deterministic answer from the endpoint carries no citations: report it as a fallback, not as model output.
        if (payload.source !== "model") return { picks: [] };
        return { picks: payload.picks.map((pick) => ({ itemId: pick.id, why: pick.reason, cites: pick.ai?.cites ?? [], tests: pick.ai?.tests ?? null, kind: pick.ai?.kind ?? "pick" })) };
      }
    }
  },
  live: {
    label: dryRun ? "Live model (DRY RUN: no calls made)" : `Live model (PAID: ${process.env.TASTEMAKE_AI_MODEL || "model not set"})`,
    // Hypothesis inference is not a live job yet (#31 v1 is picks only): use the baseline so the report
    // still shows the profile side, and say so.
    infer: async (state) => baseline.inferHypotheses(state),
    pick: async (state, ctx) => {
      const count = nextRecommendations(state).length;
      if (!count) return { picks: [] };
      const prompt = buildPickPrompt(ctx, count);
      if (dryRun) {
        dryRunPlan.push({ fixture: ctx.__fixture, count, promptChars: prompt.length, estIn: estimateTokens(prompt), prompt });
        return { picks: [] };   // nothing is called; the fixture will report the fallback
      }
      if (!process.env.ANTHROPIC_API_KEY || !process.env.TASTEMAKE_AI_MODEL) throw new Error("ANTHROPIC_API_KEY and TASTEMAKE_AI_MODEL must be set for a live run");
      if (!confirmed) throw new Error("a live run spends money: re-run with --yes once the dry run has been reviewed");
      const model = await callAnthropic({ prompt });
      spend.calls += 1;
      spend.inputTokens += model.usage?.input_tokens ?? 0;
      spend.outputTokens += model.usage?.output_tokens ?? 0;
      spend.usd = (spend.inputTokens / 1e6) * PRICE_IN + (spend.outputTokens / 1e6) * PRICE_OUT;
      return model.json;
    }
  }
};
const producer = PRODUCERS[producerName];
if (!producer) { console.error(`unknown producer "${producerName}"`); process.exit(2); }

async function runOne(fixture) {
  const state = fixture.build();
  const ctx = buildContext(state);
  ctx.__fixture = fixture.id;
  const hyp = validateHypotheses(await producer.infer(state, ctx), ctx);
  const picks = validatePicks(await producer.pick(state, ctx), ctx);
  let before = null;
  if (fixture.before) { const s = fixture.before(); before = validateHypotheses(await producer.infer(s, buildContext(s)), buildContext(s)); }
  return { state, ctx, hyp, picks, before };
}

const results = [];
for (const fixture of FIXTURES) {
  try {
    const run = await runOne(fixture);
    results.push({ fixture, run, scores: scoreFixture(fixture, run) });
  } catch (error) {
    results.push({ fixture, error: String(error.message ?? error), scores: [{ kind: "rule", name: "producer ran", pass: false, detail: String(error.message ?? error) }] });
  }
}

// Validator self-test: deliberately bad answers must all be rejected, for the right reason.
const selfTest = [];
for (const id of ["about-10", "intent-heavy", "single-miss"]) {
  const fixture = FIXTURES.find((f) => f.id === id);
  const ctx = buildContext(fixture.build());
  const bad = badResponses(ctx);
  for (const c of bad.hypotheses) {
    const v = validateHypotheses({ hypotheses: [c.h], insufficientEvidence: false }, ctx);
    const reasons = v.rejected[0]?.reasons ?? [];
    selfTest.push({ fixture: id, name: c.name, caught: v.accepted.length === 0 && reasons.some((r) => c.reason.test(r)), reasons });
  }
  for (const c of bad.picks) {
    const v = validatePicks({ picks: [c.p] }, ctx);
    const reasons = v.rejected[0]?.reasons ?? [];
    selfTest.push({ fixture: id, name: c.name, caught: v.accepted.length === 0 && reasons.some((r) => c.reason.test(r)), reasons });
  }
}

// ---- dry run: show exactly what would be sent, and what it would cost ----
if (dryRun) {
  const totalIn = dryRunPlan.reduce((sum, p) => sum + p.estIn, 0);
  const estOut = dryRunPlan.length * Number(process.env.TASTEMAKE_AI_MAX_TOKENS || 1200);
  const estUsd = (totalIn / 1e6) * PRICE_IN + (estOut / 1e6) * PRICE_OUT;
  console.log(`DRY RUN: ${dryRunPlan.length} call(s) would be made, one per fixture that has picks left.`);
  dryRunPlan.forEach((p) => console.log(`  ${p.fixture}: ${p.count} picks asked for, prompt ~${p.estIn} tokens (${p.promptChars} chars)`));
  console.log(`Estimated input ~${totalIn} tokens; output capped at ${estOut} tokens across all calls.`);
  console.log(`Estimated cost at $${PRICE_IN}/M in and $${PRICE_OUT}/M out: about $${estUsd.toFixed(2)} (worst case; real output is usually far below the cap).`);
  console.log(`Model: ${process.env.TASTEMAKE_AI_MODEL || "(TASTEMAKE_AI_MODEL not set)"}; key ${process.env.ANTHROPIC_API_KEY ? "present" : "absent"}.`);
  const first = dryRunPlan[0];
  if (first) console.log(`\nFirst prompt (${first.fixture}), truncated:\n${first.prompt.slice(0, 1200)}\n...`);
  console.log("\nNo call was made. Re-run with --producer live --yes to spend.");
}

// ---- report ----
const hardFails = results.flatMap((r) => r.scores.filter((s) => s.kind === "rule" && s.pass === false).map((s) => ({ fixture: r.fixture.id, ...s })));
const missed = selfTest.filter((t) => !t.caught);
const quality = results.flatMap((r) => r.scores.filter((s) => s.kind === "quality" && s.pass === false).map((s) => ({ fixture: r.fixture.id, ...s })));
const mark = (s) => (s.pass === null ? "·" : s.pass ? "pass" : s.kind === "rule" ? "**FAIL**" : "finding");
const lines = [
  `# Tastemake eval report: ${producer.label}`,
  "",
  `Contract ${CONTRACT_VERSION}. ${FIXTURES.length} fixtures. Generated by \`node scripts/evals/run.mjs${producerName === "baseline" ? "" : ` --producer ${producerName}`}\`.`,
  "",
  `**Result:** ${hardFails.length ? `${hardFails.length} rule check(s) failed` : "every rule check passed"}; ${quality.length} quality finding(s); validator caught ${selfTest.length - missed.length} of ${selfTest.length} deliberately bad answers.`,
  "",
  endpointRuns.length ? `Endpoint answers: ${endpointRuns.map((r) => `${r.fixture}=${r.source}`).join(", ")}.` : "",
  "Automatic checks cover structure, grounding, intent-vs-experience, calibration, cross-domain caution, user authority, repetition and stability after one miss. Specificity and usefulness need the human rubric in `docs/ai-evals.md`.",
  ""
];
for (const r of results) {
  lines.push(`## ${r.fixture.title} (\`${r.fixture.id}\`)`, "", r.fixture.purpose, "");
  if (r.error) { lines.push(`Producer error: ${r.error}`, ""); continue; }
  lines.push("| Check | Result | Detail |", "|---|---|---|");
  r.scores.forEach((s) => lines.push(`| ${s.name} (${s.kind}) | ${mark(s)} | ${String(s.detail).replace(/\|/g, "/")} |`));
  const hs = r.run.hyp.accepted;
  if (hs.length) {
    lines.push("", "Hypotheses kept:", "");
    hs.forEach((h) => lines.push(`- **${h.label}** (${h.level}; cross-domain ${h.crossDomain}; cites ${h.evidence.join(", ")})`));
  }
  if (r.run.hyp.rejected.length) {
    lines.push("", "Rejected:", "");
    r.run.hyp.rejected.forEach((x) => lines.push(`- ${x.proposal?.label ?? "(malformed)"}: ${x.reasons.join("; ")}`));
  }
  if (r.run.picks.accepted.length) {
    lines.push("", "Picks and why:", "");
    r.run.picks.accepted.forEach((p) => lines.push(`- ${p.item.title}${p.kind === "curveball" ? " (curveball)" : ""}: ${p.why || "(no reason text)"} [cites ${p.cites.join(", ")}]`));
  }
  lines.push("");
}
lines.push("## Validator self-test (deliberately bad answers)", "", "| Fixture | Bad answer | Caught | Reason given |", "|---|---|---|---|");
selfTest.forEach((t) => lines.push(`| ${t.fixture} | ${t.name} | ${t.caught ? "yes" : "**NO**"} | ${t.reasons.join("; ").replace(/\|/g, "/")} |`));

const outDir = join(here, "reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${producerName}-latest.md`), lines.join("\n") + "\n");
writeFileSync(join(outDir, `${producerName}-latest.json`), JSON.stringify({
  producer: producerName, contract: CONTRACT_VERSION,
  fixtures: results.map((r) => ({ id: r.fixture.id, error: r.error ?? null, scores: r.scores,
    hypotheses: r.run?.hyp.accepted.map(({ label, level, crossDomain, evidence, counter }) => ({ label, level, crossDomain, evidence, counter })) ?? [],
    rejected: r.run?.hyp.rejected.map((x) => ({ label: x.proposal?.label, reasons: x.reasons })) ?? [],
    picks: r.run?.picks.accepted.map((p) => ({ itemId: p.itemId, kind: p.kind, cites: p.cites })) ?? [] })),
  selfTest
}, null, 2) + "\n");

console.log(`${producer.label}: ${hardFails.length ? `${hardFails.length} rule check(s) FAILED` : "all rule checks passed"}; ${quality.length} quality finding(s); validator caught ${selfTest.length - missed.length}/${selfTest.length} bad answers`);
hardFails.forEach((f) => console.log(`  x ${f.fixture}: ${f.name} (${f.detail})`));
quality.forEach((f) => console.log(`  - finding ${f.fixture}: ${f.name} (${f.detail})`));
missed.forEach((m) => console.log(`  x validator missed: ${m.fixture} / ${m.name} (${m.reasons.join("; ") || "accepted"})`));
if (endpointRuns.length) {
  console.log("endpoint answers:");
  endpointRuns.forEach((r) => console.log(`  ${r.fixture}: ${r.source}${r.reason ? ` (${r.reason})` : ""}`));
}
if (spend.calls) console.log(`paid calls: ${spend.calls}; tokens in ${spend.inputTokens}, out ${spend.outputTokens}; estimated cost $${spend.usd.toFixed(3)}`);
console.log(`report: scripts/evals/reports/${producerName}-latest.md`);
process.exit(hardFails.length || missed.length ? 1 : 0);
