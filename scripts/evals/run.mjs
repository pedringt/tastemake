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
// (api/recommendations.mjs, src/server/anthropic.mjs), so what is measured here is what production
// would send. It needs ANTHROPIC_API_KEY and TASTEMAKE_AI_MODEL in the environment, and --yes to
// actually spend.
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
import { buildPickPrompt, normalizeModelPicks } from "../../api/recommendations.mjs";
import { callAnthropic, thinkingTypeFor } from "../../src/server/anthropic.mjs";
import { HYPOTHESES_OUTPUT_SCHEMA, PICKS_OUTPUT_SCHEMA } from "../../src/server/output-schemas.mjs";
import { recommendations as qaRecommendations, followUpPool as qaFollowUps } from "../qa/fixtures/catalog.js";
import { serializeAiState } from "../../src/ai/live-client.js";
import { priceFor } from "./pricing.mjs";
import { buildHypothesisRequest, PROFILE_MAX_OUTPUT_TOKENS } from "../../api/hypotheses.mjs";
import { expandProfileRefs } from "../../src/ai/profile-context.js";
import { normalizeHypothesisResponse, preserveExistingHypotheses } from "../../src/ai/validate.js";
import { normalizeHypothesis } from "../../src/ai/hypothesis-profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const producerName = args.includes("--producer") ? args[args.indexOf("--producer") + 1] : "baseline";
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");
const endpointUrl = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "https://tastemake.vercel.app").replace(/\/$/, "");
const pauseMs = Number(args.includes("--pause") ? args[args.indexOf("--pause") + 1] : 11_000);   // the endpoint rate-limits a burst
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const endpointRuns = [];
const EVAL_CANDIDATES = [...qaRecommendations, ...qaFollowUps];

// The live producer measures what production's recommendation call runs: the same model setting
// (TASTEMAKE_RECOMMENDATIONS_MODEL, default Sonnet 5.5), effort and thinking mode. --model overrides it
// for an A/B (e.g. --model claude-haiku-5-5).
const liveModel = args.includes("--model") ? args[args.indexOf("--model") + 1] : (process.env.TASTEMAKE_RECOMMENDATIONS_MODEL || "claude-sonnet-5-5");
const liveEffort = process.env.TASTEMAKE_RECOMMENDATIONS_EFFORT || "low";
const liveThinking = thinkingTypeFor(liveModel, "between_tools");
// Taste profile: production calls TASTEMAKE_AI_MODEL; --model sets both steps for an A/B and
// --profile-model sets this one alone. --profile baseline keeps the deterministic profile.
const liveProfileModel = args.includes("--profile-model") ? args[args.indexOf("--profile-model") + 1]
  : args.includes("--model") ? liveModel : (process.env.TASTEMAKE_AI_MODEL || "claude-sonnet-5-5");
const liveProfile = !(args.includes("--profile") && args[args.indexOf("--profile") + 1] === "baseline");
// --tag names the report files (e.g. live-claude-haiku-5-5-run1-latest.json) so runs don't overwrite each other.
const reportTag = args.includes("--tag") ? args[args.indexOf("--tag") + 1].replace(/[^a-zA-Z0-9._-]/g, "-") : "";
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
      if (!ctx.candidates.length) return { picks: [] };
      if (dryRun) { dryRunPlan.push({ fixture: ctx.__fixture, count: Math.min(5, ctx.candidates.length), promptChars: 0, estIn: 0, prompt: `(POST ${endpointUrl}/api/recommendations)` }); return { picks: [] }; }
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
          spend.usd += priceFor(payload.meta.model || "claude-sonnet-5-5", payload.meta.usage.input_tokens ?? 0, payload.meta.usage.output_tokens ?? 0);
        }
        await sleep(pauseMs);
        // A deterministic answer from the endpoint carries no citations: report it as a fallback, not as model output.
        if (payload.source !== "model") return { picks: [] };
        return { picks: payload.picks.map((pick) => ({ itemId: pick.id, why: pick.reason, cites: pick.ai?.cites ?? [], tests: pick.ai?.tests ?? null, kind: pick.ai?.kind ?? "pick" })) };
      }
    }
  },
  live: {
    label: dryRun ? `Live model (DRY RUN: picks ${liveModel}, profile ${liveProfile ? liveProfileModel : "baseline"}, no calls made)` : `Live model (PAID: picks ${liveModel}, effort ${liveEffort}, thinking ${liveThinking}; profile ${liveProfile ? liveProfileModel : "baseline"})`,
    // Taste profile through production's own path (api/hypotheses.mjs): same prompt, call shape and
    // normalization; run.mjs then validates it like every producer. --profile baseline skips it.
    infer: async (state) => {
      if (!liveProfile) return baseline.inferHypotheses(state);
      const pctx = buildContext(state);
      const { prompt, refs } = buildHypothesisRequest(pctx, state.modelHypotheses);
      if (dryRun) {
        dryRunPlan.push({ fixture: "(profile)", count: 0, promptChars: prompt.length, estIn: estimateTokens(prompt), prompt, profile: true });
        return { hypotheses: [] };
      }
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be set for a live run");
      if (!confirmed) throw new Error("a live run spends money: re-run with --yes once the dry run has been reviewed");
      const model = await callAnthropic({ prompt, model: liveProfileModel, maxTokens: PROFILE_MAX_OUTPUT_TOKENS, outputSchema: HYPOTHESES_OUTPUT_SCHEMA });
      spend.calls += 1;
      spend.inputTokens += model.usage?.input_tokens ?? 0;
      spend.outputTokens += model.usage?.output_tokens ?? 0;
      spend.usd += priceFor(liveProfileModel, model.usage?.input_tokens ?? 0, model.usage?.output_tokens ?? 0);
      // Same post-validation as api/hypotheses.mjs: earlier patterns are carried forward unless two misses count against them.
      return preserveExistingHypotheses(normalizeHypothesisResponse(expandProfileRefs(model.json, refs), pctx), pctx, state.modelHypotheses);
    },
    pick: async (state, ctx) => {
      const count = Math.min(5, ctx.candidates.length);
      if (!count) return { picks: [] };
      const prompt = buildPickPrompt(ctx, count);
      if (dryRun) {
        dryRunPlan.push({ fixture: ctx.__fixture, count, promptChars: prompt.length, estIn: estimateTokens(prompt), prompt });
        return { picks: [] };   // nothing is called; the fixture will report the fallback
      }
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be set for a live run");
      if (!confirmed) throw new Error("a live run spends money: re-run with --yes once the dry run has been reviewed");
      // Same call shape as api/recommendations.mjs: model, effort and thinking mode.
      const model = await callAnthropic({ prompt, model: liveModel, effort: liveEffort, thinkingMode: "between_tools", outputSchema: PICKS_OUTPUT_SCHEMA });
      spend.calls += 1;
      spend.inputTokens += model.usage?.input_tokens ?? 0;
      spend.outputTokens += model.usage?.output_tokens ?? 0;
      spend.usd += priceFor(liveModel, model.usage?.input_tokens ?? 0, model.usage?.output_tokens ?? 0);
      // Production fills in each pick's kind/tests from the compact answer before validating; without
      // this every live pick was rejected (Oct 10 A/B: 0 kept on both Sonnet 5.5 and Haiku 5.5).
      return normalizeModelPicks(model.json);
    }
  }
};
const producer = PRODUCERS[producerName];
if (!producer) { console.error(`unknown producer "${producerName}"`); process.exit(2); }

async function runOne(fixture) {
  // A before/after fixture runs the "before" profile first. Its accepted patterns are then stored on the
  // "after" state the way the client stores them (state.modelHypotheses), because production sends the
  // earlier profile with every refresh; without it the after-run was a fresh profile, not a refresh (#228).
  let before = null;
  let beforeProfile = [];
  if (fixture.before) {
    const s = fixture.before();
    const beforeCtx = buildContext(s, EVAL_CANDIDATES);
    before = validateHypotheses(await producer.infer(s, beforeCtx), beforeCtx);
    beforeProfile = before.accepted.map((h, index) => normalizeHypothesis(h, index, s));
  }
  const state = fixture.build();
  if (beforeProfile.length) state.modelHypotheses = beforeProfile;
  const ctx = buildContext(state, EVAL_CANDIDATES);
  ctx.__fixture = fixture.id;
  const hyp = validateHypotheses(await producer.infer(state, ctx), ctx);
  const picks = validatePicks(await producer.pick(state, ctx), ctx);
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
  const ctx = buildContext(fixture.build(), EVAL_CANDIDATES);
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
  const estOut = dryRunPlan.reduce((sum, p) => sum + (p.profile ? PROFILE_MAX_OUTPUT_TOKENS : Number(process.env.TASTEMAKE_AI_MAX_TOKENS || 1200)), 0);
  const estUsd = dryRunPlan.reduce((sum, p) => sum + priceFor(p.profile ? liveProfileModel : liveModel, p.estIn, p.profile ? PROFILE_MAX_OUTPUT_TOKENS : Number(process.env.TASTEMAKE_AI_MAX_TOKENS || 1200)), 0);
  console.log(`DRY RUN: ${dryRunPlan.length} call(s) would be made (${dryRunPlan.filter((p) => p.profile).length} taste-profile, ${dryRunPlan.filter((p) => !p.profile).length} picks).`);
  dryRunPlan.forEach((p) => console.log(`  ${p.fixture}: ${p.count} picks asked for, prompt ~${p.estIn} tokens (${p.promptChars} chars)`));
  console.log(`Estimated input ~${totalIn} tokens; output capped at ${estOut} tokens across all calls.`);
  console.log(`Estimated cost for ${liveModel}: about $${estUsd.toFixed(3)} (worst case; real output is usually far below the cap).`);
  console.log(`Model: ${liveModel} (effort ${liveEffort}, thinking ${liveThinking}); key ${process.env.ANTHROPIC_API_KEY ? "present" : "absent"}.`);
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
    // Oct 20: the claim text is kept so a rejection can be judged (made-up reason, or an over-strict check?).
    r.run.hyp.rejected.forEach((x) => {
      lines.push(`- ${x.proposal?.label ?? "(malformed)"}: ${x.reasons.join("; ")}`);
      if (x.proposal?.claim) lines.push(`  - Claim: "${x.proposal.claim}" (cites ${(x.proposal.evidence ?? []).join(", ") || "nothing"}; counter ${(x.proposal.counter ?? []).join(", ") || "none"})`);
    });
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
const reportName = `${producerName}${reportTag ? `-${reportTag}` : ""}-latest`;
writeFileSync(join(outDir, `${reportName}.md`), lines.join("\n") + "\n");
writeFileSync(join(outDir, `${reportName}.json`), JSON.stringify({
  producer: producerName, contract: CONTRACT_VERSION,
  models: producerName === "live" ? { picks: liveModel, profile: liveProfile ? liveProfileModel : "baseline" } : null,
  spend,
  fixtures: results.map((r) => ({ id: r.fixture.id, error: r.error ?? null, scores: r.scores,
    hypotheses: r.run?.hyp.accepted.map(({ label, level, crossDomain, evidence, counter, summary, statement }) => ({ label, level, crossDomain, evidence, counter, summary: summary ?? statement ?? null })) ?? [],
    rejected: r.run?.hyp.rejected.map((x) => ({ label: x.proposal?.label, claim: x.proposal?.claim ?? null, evidence: x.proposal?.evidence ?? [], counter: x.proposal?.counter ?? [], reasons: x.reasons })) ?? [],
    picks: r.run?.picks.accepted.map((p) => ({ itemId: p.itemId, title: p.item?.title ?? null, kind: p.kind, why: p.why ?? null, cites: p.cites })) ?? [] })),
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
