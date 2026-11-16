#!/usr/bin/env node
// #323 reason-generation eval (Nov 15). NOT RUN without Paige's OK. For each case (fixtures.mjs) the model writes
// three "What's different about it?" options; free shape checks run on every answer, and the answers are written
// out for Paige to judge blind (the judging page is built from the report afterwards).
//
//   node scripts/evals/reasons/run.mjs --dry-run                          # free: the plan, prompts and worst case
//   node scripts/evals/reasons/run.mjs --yes --max-usd 0.05 [--auth ant]  # PAID: 10 cases x 3 reps = 30 calls
//   add --prompt v2 or v3 (prompt.mjs; default v1). v3 approved by Paige Nov 16: 30 calls, cap $0.01.
//
// Caps, enforced here before every call: at most APPROVED_CALLS calls, and the run stops before a call whose worst
// case could cross --max-usd. --auth ant (Paige's own login) is for her machine only and refused in CI.
// Report: scripts/evals/reports/runs/reasons-<tag>-latest.json (an ignored folder).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, caseContext } from "./fixtures.mjs";
import { PROMPT_VERSIONS, REASONS_MAX_OUTPUT_TOKENS, REASONS_OUTPUT_SCHEMA, buildReasonsPrompt, checkReasons } from "./prompt.mjs";
import { usageCostUsd, worstCaseUsd } from "../pricing.mjs";

export const REPS = 3;
export const APPROVED_CALLS = 30;
export const DEFAULT_MODEL = "claude-haiku-5-5";

export function plan(cases = CASES, reps = REPS) {
  const calls = [];
  // Reps interleaved across cases, so a cap stop leaves every case with as many answers as possible.
  for (let rep = 1; rep <= reps; rep += 1) for (const kase of cases) calls.push({ rep, kase });
  return calls;
}

// Runs the plan. `call(prompt)` returns { json, usage } or throws; it's injected so tests never reach the network.
export async function runPlan(calls, { call, model = DEFAULT_MODEL, maxUsd, maxCalls = APPROVED_CALLS, version = "v1" }) {
  const spend = { calls: 0, usd: 0 };
  const results = [];
  let stopped = null;
  for (const { rep, kase } of calls) {
    const context = caseContext(kase);
    const prompt = buildReasonsPrompt(context, version);
    const worst = worstCaseUsd(model, prompt.length, REASONS_MAX_OUTPUT_TOKENS);
    if (spend.calls >= maxCalls) { stopped = `call cap ${maxCalls} reached`; break; }
    if (spend.usd + worst > maxUsd) { stopped = `spend cap $${maxUsd}: the next call could cost up to $${worst.toFixed(4)} on top of $${spend.usd.toFixed(4)}`; break; }
    let answer = null, error = null, usage = null;
    try {
      ({ json: answer, usage } = await call(prompt));
    } catch (e) {
      error = String(e?.message ?? e);
    }
    spend.calls += 1;
    spend.usd += usage ? usageCostUsd(model, usage) : worst;   // no usage reported: count the worst case
    const check = answer ? checkReasons(answer, context, version) : { ok: false, problems: [error ?? "no answer"], labels: [] };
    results.push({ id: kase.id, rep, flagged: kase.flagged, pattern: kase.pattern.name, gold: kase.gold, reasons: answer?.reasons ?? [], check, error });
  }
  return { results, spend, stopped };
}

export function summarize({ results, spend, stopped }) {
  const ok = results.filter((r) => r.check.ok).length;
  const lines = [`${results.length} answer(s), ${ok} passed the shape checks; ${spend.calls} call(s), about $${spend.usd.toFixed(4)}${stopped ? `; stopped: ${stopped}` : ""}.`];
  for (const r of results) lines.push(`- ${r.id} r${r.rep}: ${r.check.labels.join(" | ") || "(none)"}${r.check.ok ? "" : `  [${r.check.problems.join("; ")}]`}`);
  return lines.join("\n");
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  const model = arg("--model") ?? DEFAULT_MODEL;
  const maxUsd = Number(arg("--max-usd"));
  const useAnt = arg("--auth") === "ant";
  const version = arg("--prompt") ?? "v1";
  const tag = (arg("--tag") ?? "live").replace(/[^a-zA-Z0-9._-]/g, "-");
  const refuse = (message) => { console.error(`refused: ${message}`); process.exit(2); };
  if (!dryRun && !yes) refuse("pass --dry-run (free) or --yes (paid, needs Paige's OK)");
  if (!PROMPT_VERSIONS.includes(version)) refuse(`--prompt must be one of ${PROMPT_VERSIONS.join(", ")}`);
  if (useAnt && process.env.CI) refuse("--auth ant uses a personal login meant for your own machine, not CI");
  const calls = plan();
  if (calls.length > APPROVED_CALLS) refuse(`plan needs ${calls.length} calls, approved ${APPROVED_CALLS}`);
  const worst = calls.reduce((sum, { kase }) => sum + worstCaseUsd(model, buildReasonsPrompt(caseContext(kase), version).length, REASONS_MAX_OUTPUT_TOKENS), 0);
  console.log(`Plan: prompt ${version}, ${CASES.length} cases x ${REPS} reps = ${calls.length} calls on ${model}; worst case $${worst.toFixed(4)} for the whole run${dryRun ? " (DRY RUN: no calls)" : ""}.`);
  if (dryRun) {
    console.log(`\nFirst prompt (${CASES[0].id}):\n${buildReasonsPrompt(caseContext(CASES[0]), version)}`);
    process.exit(0);
  }
  if (!(Number.isFinite(maxUsd) && maxUsd > 0)) refuse("a paid run needs a spend cap: --max-usd <dollars>");
  if (!useAnt && !process.env.ANTHROPIC_API_KEY) refuse("ANTHROPIC_API_KEY must be set (or pass --auth ant on your own machine)");

  const { callAnthropic } = await import("../../../src/server/anthropic.mjs");
  let token = null;
  const antToken = () => execFileSync("ant", ["auth", "print-credentials", "--access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const fetchImpl = async (url, init) => {
    if (!useAnt) return fetch(url, init);
    token ??= antToken();
    const headers = { ...init.headers, authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" };
    delete headers["x-api-key"];
    return fetch(url, { ...init, headers });
  };
  const env = { ...process.env, ANTHROPIC_API_KEY: useAnt ? "unused-oauth" : process.env.ANTHROPIC_API_KEY };
  const call = async (prompt) => {
    const result = await callAnthropic({ prompt, env, fetchImpl, model, maxTokens: REASONS_MAX_OUTPUT_TOKENS, outputSchema: REASONS_OUTPUT_SCHEMA });
    if (!result?.json) throw new Error("no parseable answer");
    return { json: result.json, usage: result.usage };
  };
  const run = await runPlan(calls, { call, model, maxUsd, version });
  console.log(summarize(run));
  const out = join(here, "..", "reports", "runs");
  mkdirSync(out, { recursive: true });
  const file = join(out, `reasons-${tag}-latest.json`);
  writeFileSync(file, JSON.stringify({ model, prompt: version, generatedAt: new Date().toISOString(), ...run }, null, 2));
  console.log(`report: ${file}`);
}
