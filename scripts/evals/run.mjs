#!/usr/bin/env node
// Live-AI eval suite (#32). Runs a producer over fixed fixtures, validates every answer with the product's
// contract (src/ai/validate.js), scores it, and writes a report a product reviewer can read.
//
//   node scripts/evals/run.mjs                        # the deterministic baseline (free, no model)
//   node scripts/evals/run.mjs --producer live --dry-run   # the exact prompts + a cost estimate, no call
//   node scripts/evals/run.mjs --producer live --yes --max-usd 0.10   # PAID: one Anthropic call per fixture
//   node scripts/evals/run.mjs --producer endpoint --yes --max-usd 0.10  # PAID: sends each fixture to the deployed
//                                                         # endpoint, so the API key stays in Vercel
//
// The live producer uses the same prompt builder and transport as the production endpoint
// (api/recommendations.mjs, src/server/anthropic.mjs), so what is measured here is what production
// would send. It needs ANTHROPIC_API_KEY and TASTEMAKE_AI_MODEL in the environment, and --yes to
// actually spend.
//
// Output (#341 step 2): scripts/evals/reports/runs/[<suite>-]<producer>[-<tag>]-latest.md (+ .json), an ignored
// folder, or --out <dir>. A run never overwrites a committed report. The default run (deterministic baseline,
// what `npm test` runs) is compared byte for byte with the committed scripts/evals/reports/baseline-latest.*
// and fails if it differs. Replacing a committed report is a deliberate act: --update-baseline <path>, which
// is refused when CI is set. Exit code 1 if a hard check fails, the validator lets a deliberately bad answer
// through, or the baseline differs.
//
// Paid runs (--producer live or endpoint without --dry-run) also need --yes and --max-usd <dollars>, print
// their plan (calls, models, cap) before the first call, and stop before a call once spend reaches the cap.
// --auth ant is for runs on your own machine only and is refused when CI is set. --raw keeps the model's own
// Taste Profile answer in the local report (off by default).

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES as DEFAULT_FIXTURES, REASON_FIXTURES, SUPPORT_FIXTURES, badResponses } from "./fixtures.mjs";
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
import { usageCostUsd, worstCaseUsd } from "./pricing.mjs";
import { execFileSync } from "node:child_process";
import { buildHypothesisRequest, PROFILE_MAX_OUTPUT_TOKENS } from "../../api/hypotheses.mjs";
import { expandProfileRefs } from "../../src/ai/profile-context.js";
import { normalizeHypothesisResponse, preserveExistingHypotheses, settleConfirmedHypotheses } from "../../src/ai/validate.js";
import { normalizeHypothesis } from "../../src/ai/hypothesis-profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
// --suite reasons runs the #250 PR 2 comparison (three book scenarios x three reason versions) instead of
// the default fixtures; nothing else about the run changes. --suite support runs the #318 support-fit check
// on Paige's Example Profile (two Taste Profile calls, no picks).
const suite = args.includes("--suite") ? args[args.indexOf("--suite") + 1] : "default";
const FIXTURES = suite === "reasons" ? REASON_FIXTURES : suite === "support" ? SUPPORT_FIXTURES : DEFAULT_FIXTURES;
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
// Nov 6 (#318): --auth ant uses Paige's `ant auth login` (as select-n.mjs does, Nov 4): a short-lived access
// token from `ant auth print-credentials`, held in memory only, sent as a Bearer token with the oauth beta
// header in place of x-api-key. --max-usd stops before a call once recorded spend reaches the cap.
const useAnt = args.includes("--auth") && args[args.indexOf("--auth") + 1] === "ant";
const maxUsd = args.includes("--max-usd") ? Number(args[args.indexOf("--max-usd") + 1]) : Infinity;
const keepRaw = args.includes("--raw");
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const updateBaseline = args.includes("--update-baseline") ? (args[args.indexOf("--update-baseline") + 1] ?? "") : null;
const inCI = Boolean(process.env.CI);
const paidRun = (producerName === "live" || producerName === "endpoint") && !dryRun;
const refuse = (message) => { console.error(`refused: ${message}`); process.exit(2); };
// #341 step 2 (Paige, Nov 7): checked before anything runs or any credential is read.
if (useAnt && inCI) refuse("--auth ant uses a personal login meant for runs on your own machine, not CI (CI is set)");
if (paidRun && !(Number.isFinite(maxUsd) && maxUsd > 0)) refuse("a paid run needs a spend cap: --max-usd <dollars>");
if (updateBaseline !== null && inCI) refuse("--update-baseline replaces a committed report; it isn't accepted when CI is set");
if (updateBaseline !== null && (!updateBaseline || updateBaseline.startsWith("--"))) refuse("--update-baseline needs a destination, e.g. --update-baseline scripts/evals/reports/baseline-latest");
// A committed report may only be replaced directly inside scripts/evals/reports: a plain file name, resolved
// through real paths (so "..", absolute paths and symlinked folders can't lead elsewhere), and never through
// a symlinked report file. Checked before anything runs.
const reportsDir = join(here, "reports");
const baselineTarget = updateBaseline ? (() => {
  const target = resolve(updateBaseline.replace(/\.(md|json)$/, ""));
  const name = basename(target);
  const parent = dirname(target);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) refuse(`--update-baseline needs a plain file name: ${updateBaseline}`);
  if (!existsSync(parent) || realpathSync(parent) !== realpathSync(reportsDir)) refuse(`--update-baseline must point directly inside scripts/evals/reports: ${updateBaseline}`);
  for (const ext of ["md", "json"]) {
    const file = join(realpathSync(reportsDir), `${name}.${ext}`);
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) refuse(`--update-baseline won't write through a symlink: ${name}.${ext}`);
  }
  return join(realpathSync(reportsDir), name);
})() : null;
let antTokenValue = null;
const antToken = () => execFileSync("ant", ["auth", "print-credentials", "--access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
async function liveFetch(url, init) {
  if (!useAnt) return fetch(url, init);
  antTokenValue ??= antToken();
  const send = () => { const headers = { ...init.headers, authorization: `Bearer ${antTokenValue}`, "anthropic-beta": "oauth-2025-04-20" }; delete headers["x-api-key"]; return fetch(url, { ...init, headers }); };
  let response = await send();
  if (response.status === 401) { antTokenValue = antToken(); response = await send(); }
  return response;
}
// #341 step 2: the cap is checked before every paid call against that call's worst case (worstCaseUsd), so a run
// stops short of the cap instead of crossing it. Costs are estimates from token counts and the pricing table.
// Output caps mirror callAnthropic: the configured max tokens, plus its thinking headroom for always-thinking models.
const THINKING_HEADROOM = 8000;
const outputCap = (model, base) => Number(base) + (process.env.TASTEMAKE_AI_THINKING !== "enabled" && thinkingTypeFor(model, "between_tools") === null ? THINKING_HEADROOM : 0);
const PICKS_MAX_OUTPUT = Number(process.env.TASTEMAKE_AI_MAX_TOKENS || 1000);
// The endpoint's prompt and model aren't visible here: assume the code's default model, a 30k-token prompt and its cap.
const ENDPOINT_WORST_CASE_USD = worstCaseUsd("claude-sonnet-5-5", 90_000, outputCap("claude-sonnet-5-5", PICKS_MAX_OUTPUT));
function ensureBudget(worstCase) {
  if (spend.usd + worstCase > maxUsd) {
    throw new Error(`spend cap $${maxUsd}: the next call could cost up to $${Number.isFinite(worstCase) ? worstCase.toFixed(4) : "an unknown amount (no rates for this model)"} on top of $${spend.usd.toFixed(4)} spent, so it wasn't made`);
  }
}
function recordSpend(model, usage) {
  spend.calls += 1;
  spend.inputTokens += (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
  spend.outputTokens += usage?.output_tokens ?? 0;
  spend.usd += usageCostUsd(model, usage ?? {});
}
const liveEnv = () => ({ ...process.env, ANTHROPIC_API_KEY: useAnt ? "unused-oauth" : process.env.ANTHROPIC_API_KEY });
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
      ensureBudget(ENDPOINT_WORST_CASE_USD);
      for (let attempt = 1; ; attempt += 1) {
        const response = await fetch(`${endpointUrl}/api/recommendations`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: serializeAiState(state) })
        });
        if (response.status === 429 && attempt <= 5) { await sleep(pauseMs); continue; }
        if (!response.ok) throw new Error(`endpoint returned ${response.status}`);
        const payload = await response.json();
        endpointRuns.push({ fixture: ctx.__fixture, source: payload.source, reason: payload.reason, meta: payload.meta });
        if (payload.meta?.usage) recordSpend(payload.meta.model || "claude-sonnet-5-5", payload.meta.usage);
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
      if (!useAnt && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be set for a live run (or pass --auth ant)");
      if (!confirmed) throw new Error("a live run spends money: re-run with --yes once the dry run has been reviewed");
      ensureBudget(worstCaseUsd(liveProfileModel, prompt.length, outputCap(liveProfileModel, PROFILE_MAX_OUTPUT_TOKENS)));
      const model = await callAnthropic({ prompt, env: liveEnv(), fetchImpl: liveFetch, model: liveProfileModel, maxTokens: PROFILE_MAX_OUTPUT_TOKENS, outputSchema: HYPOTHESES_OUTPUT_SCHEMA });
      recordSpend(liveProfileModel, model.usage);
      // Same carry-forward as api/hypotheses.mjs (#228/#325): earlier patterns the model left out are carried forward.
      // #318 (Nov 6): with --raw, the model's own answer (refs expanded) is kept beside the reconciled result, so
      // a failure can be attributed to the model or to software without another paid run. Local reports only.
      const raw = expandProfileRefs(model.json, refs);
      return { ...preserveExistingHypotheses(normalizeHypothesisResponse(raw, pctx), pctx, state.modelHypotheses), ...(keepRaw ? { __raw: raw } : {}) };
    },
    pick: async (state, ctx) => {
      const count = Math.min(5, ctx.candidates.length);
      if (!count) return { picks: [] };
      const prompt = buildPickPrompt(ctx, count);
      if (dryRun) {
        dryRunPlan.push({ fixture: ctx.__fixture, count, promptChars: prompt.length, estIn: estimateTokens(prompt), prompt });
        return { picks: [] };   // nothing is called; the fixture will report the fallback
      }
      if (!useAnt && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY must be set for a live run (or pass --auth ant)");
      if (!confirmed) throw new Error("a live run spends money: re-run with --yes once the dry run has been reviewed");
      // Same call shape as api/recommendations.mjs: model, effort and thinking mode.
      ensureBudget(worstCaseUsd(liveModel, prompt.length, outputCap(liveModel, PICKS_MAX_OUTPUT)));
      const model = await callAnthropic({ prompt, env: liveEnv(), fetchImpl: liveFetch, model: liveModel, effort: liveEffort, thinkingMode: "between_tools", outputSchema: PICKS_OUTPUT_SCHEMA });
      recordSpend(liveModel, model.usage);
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
    const beforeCtx = buildContext(s, fixture.candidates ?? EVAL_CANDIDATES);
    before = validateHypotheses(await producer.infer(s, beforeCtx), beforeCtx);
    beforeProfile = before.accepted.map((h, index) => normalizeHypothesis(h, index, s));
  }
  const state = fixture.build();
  if (beforeProfile.length) state.modelHypotheses = beforeProfile;
  const ctx = buildContext(state, fixture.candidates ?? EVAL_CANDIDATES);
  ctx.__fixture = fixture.id;
  const inferred = await producer.infer(state, ctx);
  // Production order (api/hypotheses.mjs): validate, then settle confirmed patterns (#325, #318).
  const hyp = { ...settleConfirmedHypotheses(validateHypotheses(inferred, ctx), ctx, state.modelHypotheses ?? []), raw: inferred?.__raw ?? null };
  const picks = validatePicks(await producer.pick(state, ctx), ctx);
  return { state, ctx, hyp, picks, before };
}

// A paid run says what it will do before the first call (#341 step 2).
if (paidRun && confirmed) {
  const planned = producerName === "endpoint"
    ? FIXTURES.length
    : FIXTURES.reduce((sum, f) => sum + (liveProfile ? (f.before ? 2 : 1) : 0) + 1, 0);
  const models = producerName === "endpoint" ? `whatever ${endpointUrl} is configured to use` : `profile ${liveProfile ? liveProfileModel : "baseline (no call)"}, picks ${liveModel}`;
  console.log(`Plan: up to ${planned} paid call(s) over ${FIXTURES.length} fixture(s); ${models}; auth ${useAnt ? "ant login" : producerName === "endpoint" ? "none here" : "ANTHROPIC_API_KEY"}; cap $${maxUsd}: before each call the runner assumes that call's worst case and skips it if the cap could be crossed (costs are estimates from token counts and the pricing table, including prompt caching).`);
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
  const fixture = DEFAULT_FIXTURES.find((f) => f.id === id);   // the self-test always uses the default fixtures
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
  // The same worst case the paid run checks against its cap, so --max-usd at or above this lets every call through.
  const estUsd = dryRunPlan.reduce((sum, p) => sum + (p.profile ? worstCaseUsd(liveProfileModel, p.promptChars, outputCap(liveProfileModel, PROFILE_MAX_OUTPUT_TOKENS)) : worstCaseUsd(liveModel, p.promptChars, outputCap(liveModel, PICKS_MAX_OUTPUT))), 0);
  console.log(`DRY RUN: ${dryRunPlan.length} call(s) would be made (${dryRunPlan.filter((p) => p.profile).length} taste-profile, ${dryRunPlan.filter((p) => !p.profile).length} picks).`);
  dryRunPlan.forEach((p) => console.log(`  ${p.fixture}: ${p.count} picks asked for, prompt ~${p.estIn} tokens (${p.promptChars} chars)`));
  console.log(`Estimated input ~${totalIn} tokens; output capped at ${estOut} tokens across all calls.`);
  console.log(`Worst-case cost: $${estUsd.toFixed(4)} (prompts at the highest input rate, every output cap used); real runs usually cost far less. A paid run needs --max-usd at or above this to make every call.`);
  console.log(`Model: ${liveModel} (effort ${liveEffort}, thinking ${liveThinking}); key ${process.env.ANTHROPIC_API_KEY ? "present" : "absent"}.`);
  const first = dryRunPlan[0];
  if (first) console.log(`\nFirst prompt (${first.fixture}), truncated:\n${first.prompt.slice(0, 1200)}\n...`);
  console.log("\nNo call was made. Re-run with --producer live --yes --max-usd <dollars> to spend (each paid run needs Paige's approval).");
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

const reportMd = lines.join("\n") + "\n";
const reportJson = JSON.stringify({
  producer: producerName, contract: CONTRACT_VERSION,
  models: producerName === "live" ? { picks: liveModel, profile: liveProfile ? liveProfileModel : "baseline" } : null,
  spend,
  fixtures: results.map((r) => ({ id: r.fixture.id, error: r.error ?? null, scores: r.scores,
    hypotheses: r.run?.hyp.accepted.map(({ id, label, claim, level, crossDomain, evidence, counter, summary, statement, evidenceSource }) => ({ id, label, claim: claim ?? null, level, crossDomain, evidence, counter, evidenceSource: evidenceSource ?? "recited", summary: summary ?? statement ?? null })) ?? [],
    needsReview: r.run?.hyp.needsReview ?? [], reviewReasons: r.run?.hyp.reviewReasons ?? {},
    // The model's answer before software reconciled it (--raw with the live producer only; null otherwise).
    raw: keepRaw && r.run?.hyp.raw ? (r.run.hyp.raw.hypotheses ?? []).map(({ id, label, claim, evidence, counter, level, crossDomain }) => ({ id, label, claim, evidence, counter, level, crossDomain })) : null,
    rejected: r.run?.hyp.rejected.map((x) => ({ label: x.proposal?.label, claim: x.proposal?.claim ?? null, evidence: x.proposal?.evidence ?? [], counter: x.proposal?.counter ?? [], reasons: x.reasons })) ?? [],
    picks: r.run?.picks.accepted.map((p) => ({ itemId: p.itemId, title: p.item?.title ?? null, kind: p.kind, why: p.why ?? null, cites: p.cites })) ?? [] })),
  selfTest
}, null, 2) + "\n";

const outDir = outArg ? resolve(outArg) : join(reportsDir, "runs");
mkdirSync(outDir, { recursive: true });
const reportName = `${suite === "default" ? "" : `${suite}-`}${producerName}${reportTag ? `-${reportTag}` : ""}-latest`;
const reportPath = join(outDir, reportName);
writeFileSync(`${reportPath}.md`, reportMd);
writeFileSync(`${reportPath}.json`, reportJson);

// The committed reference for the default run. Only --update-baseline replaces a committed report.
let baselineDiffers = false;
if (baselineTarget) {
  writeFileSync(`${baselineTarget}.md`, reportMd);
  writeFileSync(`${baselineTarget}.json`, reportJson);
  console.log(`baseline updated: ${relative(process.cwd(), baselineTarget)}.md and .json (review and commit deliberately)`);
} else if (suite === "default" && producerName === "baseline" && !reportTag) {
  const committed = (ext) => { try { return readFileSync(join(reportsDir, `baseline-latest.${ext}`), "utf8"); } catch { return null; } };
  baselineDiffers = committed("md") !== reportMd || committed("json") !== reportJson;
  console.log(baselineDiffers
    ? "baseline: DIFFERS from the committed scripts/evals/reports/baseline-latest.* (if the change is intended, review it and run with --update-baseline scripts/evals/reports/baseline-latest)"
    : "baseline: matches the committed scripts/evals/reports/baseline-latest.* byte for byte");
}

console.log(`${producer.label}: ${hardFails.length ? `${hardFails.length} rule check(s) FAILED` : "all rule checks passed"}; ${quality.length} quality finding(s); validator caught ${selfTest.length - missed.length}/${selfTest.length} bad answers`);
hardFails.forEach((f) => console.log(`  x ${f.fixture}: ${f.name} (${f.detail})`));
quality.forEach((f) => console.log(`  - finding ${f.fixture}: ${f.name} (${f.detail})`));
missed.forEach((m) => console.log(`  x validator missed: ${m.fixture} / ${m.name} (${m.reasons.join("; ") || "accepted"})`));
if (endpointRuns.length) {
  console.log("endpoint answers:");
  endpointRuns.forEach((r) => console.log(`  ${r.fixture}: ${r.source}${r.reason ? ` (${r.reason})` : ""}`));
}
if (spend.calls) console.log(`paid calls: ${spend.calls}; tokens in ${spend.inputTokens}, out ${spend.outputTokens}; estimated cost $${spend.usd.toFixed(3)}`);
console.log(`report: ${relative(process.cwd(), reportPath)}.md`);
process.exit(hardFails.length || missed.length || baselineDiffers ? 1 : 0);
