#!/usr/bin/env node
// #323 phase 1 suggestion eval (Nov 16). PAID only with Paige's OK (approved Nov 16: about 30 calls, under $0.02).
// For each case (fixtures.mjs) the model writes the suggested correction; free checks run on every answer, and the
// answers are written out for Paige to rate blind, mixed with the prototype's hand-written versions.
//
//   node scripts/evals/suggestions/run.mjs --dry-run                 # free: the plan, a prompt and the worst case
//   node scripts/evals/suggestions/run.mjs --yes --max-usd 0.02      # PAID: 10 cases x 3 reps = 30 calls
//   add --prompt v2 for the v2 prompt (prompt.mjs; default v1). v2 rerun approved by Paige Nov 16: 30 calls.
//   add --cases id,id to run only those cases. v3 approved by Paige Nov 16: 4 cases x 3 = 12 calls.
//
// Caps, enforced before every call: at most APPROVED_CALLS calls, and the run stops before a call whose worst case
// could cross --max-usd. --auth ant (a personal login) is refused in CI.
// Report: scripts/evals/reports/runs/suggestions-<tag>-latest.json (an ignored folder).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, caseContext } from "./fixtures.mjs";
import { PROMPT_VERSIONS, SUGGESTION_MAX_OUTPUT_TOKENS, SUGGESTION_OUTPUT_SCHEMA, buildSuggestionPrompt, checkSuggestion } from "./prompt.mjs";
import { usageCostUsd, worstCaseUsd } from "../pricing.mjs";

export const REPS = 3;
export const APPROVED_CALLS = 30;
export const DEFAULT_MODEL = "claude-haiku-5-5";

export function plan(cases = CASES, reps = REPS) {
  const calls = [];
  for (let rep = 1; rep <= reps; rep += 1) for (const kase of cases) calls.push({ rep, kase });
  return calls;
}

// `call(prompt)` returns { json, usage } or throws; injected so tests never reach the network.
export async function runPlan(calls, { call, model = DEFAULT_MODEL, maxUsd, maxCalls = APPROVED_CALLS, version = "v1" }) {
  const spend = { calls: 0, usd: 0 };
  const results = [];
  let stopped = null;
  for (const { rep, kase } of calls) {
    const context = caseContext(kase);
    const prompt = buildSuggestionPrompt(context, version);
    const worst = worstCaseUsd(model, prompt.length, SUGGESTION_MAX_OUTPUT_TOKENS);
    if (spend.calls >= maxCalls) { stopped = `call cap ${maxCalls} reached`; break; }
    if (spend.usd + worst > maxUsd) { stopped = `spend cap $${maxUsd}: the next call could cost up to $${worst.toFixed(4)} on top of $${spend.usd.toFixed(4)}`; break; }
    let answer = null, error = null, usage = null;
    try {
      ({ json: answer, usage } = await call(prompt));
    } catch (e) {
      error = String(e?.message ?? e);
    }
    spend.calls += 1;
    spend.usd += usage ? usageCostUsd(model, usage) : worst;
    const check = answer ? checkSuggestion(answer, kase, context) : { ok: false, problems: [error ?? "no answer"], warnings: [] };
    results.push({ id: kase.id, rep, answer, check, error, usage });
  }
  return { results, spend, stopped };
}

export function summarize({ results, spend, stopped }) {
  const ok = results.filter((r) => r.check.ok).length;
  const lines = [`${results.length} answer(s), ${ok} passed the checks; ${spend.calls} call(s), about $${spend.usd.toFixed(4)}${stopped ? `; stopped: ${stopped}` : ""}.`];
  for (const r of results) {
    const pats = (r.answer?.patterns ?? []).map((p) => `${p.name} [${(p.titles ?? []).length}]`).join(" + ") || "(none)";
    const aside = (r.answer?.setAside ?? []).length ? `; set aside: ${r.answer.setAside.join(", ")}` : "";
    const notes = [...r.check.problems, ...r.check.warnings.map((w) => `warn: ${w}`)];
    lines.push(`- ${r.id} r${r.rep}: ${pats}${aside}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
  }
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
  const only = arg("--cases")?.split(",").filter(Boolean) ?? null;
  const unknown = (only ?? []).filter((id) => !CASES.some((c) => c.id === id));
  if (unknown.length) refuse(`unknown case(s): ${unknown.join(", ")}`);
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  const calls = plan(cases);
  if (calls.length > APPROVED_CALLS) refuse(`plan needs ${calls.length} calls, approved ${APPROVED_CALLS}`);
  const worst = calls.reduce((sum, { kase }) => sum + worstCaseUsd(model, buildSuggestionPrompt(caseContext(kase), version).length, SUGGESTION_MAX_OUTPUT_TOKENS), 0);
  console.log(`Plan: prompt ${version}, ${cases.length} cases x ${REPS} reps = ${calls.length} calls on ${model}; worst case $${worst.toFixed(4)} for the whole run${dryRun ? " (DRY RUN: no calls)" : ""}.`);
  if (dryRun) {
    console.log(`\nFirst prompt (${cases[0].id}):\n${buildSuggestionPrompt(caseContext(cases[0]), version)}`);
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
    const result = await callAnthropic({ prompt, env, fetchImpl, model, maxTokens: SUGGESTION_MAX_OUTPUT_TOKENS, outputSchema: SUGGESTION_OUTPUT_SCHEMA });
    if (!result?.json) throw new Error("no parseable answer");
    return { json: result.json, usage: result.usage };
  };
  const run = await runPlan(calls, { call, model, maxUsd, version });
  console.log(summarize(run));
  const out = join(here, "..", "reports", "runs");
  mkdirSync(out, { recursive: true });
  const file = join(out, `suggestions-${tag}-latest.json`);
  writeFileSync(file, JSON.stringify({ model, prompt: version, generatedAt: new Date().toISOString(), cases, ...run }, null, 2));
  console.log(`report: ${file}`);
}
