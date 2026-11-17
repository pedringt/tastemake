#!/usr/bin/env node
// #323 phase 3: a paid check of the app's reasons call, through production's own code path. NOT RUN without
// Paige's OK. For 10 reasons-eval cases (scripts/evals/reasons/fixtures.mjs) it builds the request the browser
// sends (src/ai/partly-reasons-request.js, buildReasonsRequest) from the frozen Oct 21 Example Profile, and runs
// it through the server's produceReasons (api/hypotheses.mjs, reasons mode) in-process, like
// regen-example-profile.mjs does with producePlacement.
//
//   node scripts/evals/partly-reasons-check.mjs --dry-run            # free: the plan, each request and the worst case
//   node scripts/evals/partly-reasons-check.mjs --yes --out <dir>    # PAID: 10 calls, needs ANTHROPIC_API_KEY
//
// Caps, enforced in the fetch the server code uses: at most 10 calls, claude-haiku-5-5 only, and a call is
// refused if its worst case could push the total over $0.01. Pass: at least 9 of 10 sets come back from the model
// and pass the app's checks. Writes <dir>/partly-reasons-check.json (each set's reasons, the checks, usage, cost).
//
// The cases' patterns are built from their names, claims and titles; the titles' facts are what the Example
// Profile stores (so The Office is the stored 2001 UK series, not the US one the eval's override describes).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const APPROVED_CALLS = 10;
export const CAP_USD = 0.01;
export const MODEL = "claude-haiku-5-5";
export const PASS_AT = 9;

// The browser modules read these at import time; nothing here is saved anywhere.
const memory = new Map();
globalThis.localStorage ??= { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
globalThis.sessionStorage ??= globalThis.localStorage;
globalThis.document ??= { documentElement: { dataset: {} }, querySelector: () => null };

const { readFileSync } = await import("node:fs");
const { restoreStateFromBackupText, state } = await import("../../src/state.js");
const { buildReasonsRequest } = await import("../../src/ai/partly-reasons-request.js");
const { buildReasonsPromptV3, reasonsContextFromState, REASONS_MAX_OUTPUT_TOKENS } = await import("../../src/ai/partly-reasons.js");
const { CASES, findItem } = await import("./reasons/fixtures.mjs");
const { produceReasons } = await import("../../api/hypotheses.mjs");
const { usageCostUsd, worstCaseUsd } = await import("./pricing.mjs");

const FIXTURE = fileURLToPath(new URL("./fixtures/example-profile-2026-10-21.json", import.meta.url));

// One pattern per case, a partial answer on it, and the flagged title marked "different side".
export function buildPlan(cases = CASES.slice(0, APPROVED_CALLS)) {
  restoreStateFromBackupText(readFileSync(FIXTURE, "utf8"));
  const refOf = (title) => `ev:${findItem(title).id}`;
  const patterns = cases.map((kase) => ({ id: `ai-check-${kase.id}`, title: kase.pattern.name, claim: kase.pattern.claim, supports: [kase.flagged, ...kase.others].map(refOf), counters: [], domains: [], strength: "supported" }));
  state.modelHypotheses = patterns;
  state.patternStatements = cases.map((kase, i) => ({
    hypothesisId: patterns[i].id, label: patterns[i].title, says: "partial", weight: null, context: null, authority: "user-confirmed",
    elements: { words: [], wordsAbout: null, titles: { [refOf(kase.flagged)]: { verdict: "different", reasons: [], note: null } }, grouped: null }
  }));
  return cases.map((kase, i) => {
    const body = buildReasonsRequest(state, patterns[i].id, refOf(kase.flagged));
    const built = reasonsContextFromState({ ...state, modelHypotheses: patterns }, body.reasons);
    const prompt = built.context ? buildReasonsPromptV3(built.context) : "";
    return { kase, body, error: built.error ?? null, promptChars: prompt.length };
  });
}

// The fetch the server code uses. Throws (so no request is sent) when a cap would be crossed.
export function makeCappedFetch({ realFetch = (...args) => fetch(...args), spend = { calls: 0, usd: 0 }, maxCalls = APPROVED_CALLS, capUsd = CAP_USD, model = MODEL } = {}) {
  const capped = async (url, init = {}) => {
    if (spend.calls >= maxCalls) throw new Error(`refused: call cap ${maxCalls} reached, so this call wasn't made`);
    const body = JSON.parse(init.body);
    if (body.model !== model) throw new Error(`refused: the request is for ${body.model}, approved ${model}`);
    const worst = worstCaseUsd(model, init.body.length, body.max_tokens);
    if (!Number.isFinite(worst) || spend.usd + worst > capUsd) throw new Error(`refused: worst case $${worst.toFixed(5)} on top of $${spend.usd.toFixed(5)} could cross the $${capUsd} cap`);
    spend.calls += 1;
    spend.usd += worst;   // reserved at the worst case until the real usage is known
    spend.lastWorst = worst;
    return realFetch(url, init);
  };
  return { fetchImpl: capped, spend };
}

export async function runCheck(plan, { fetchImpl, spend, env }) {
  const sets = [];
  for (const { kase, body } of plan) {
    const before = spend.calls;
    const payload = await produceReasons({ rawState: body.state, reasons: body.reasons, env, fetchImpl });
    const made = spend.calls > before;
    let usd = made ? spend.lastWorst : 0;
    if (made && payload.meta?.usage) {
      usd = usageCostUsd(MODEL, payload.meta.usage);
      spend.usd += usd - spend.lastWorst;
    }
    sets.push({ id: kase.id, pattern: kase.pattern.name, flagged: kase.flagged, source: payload.source, reasons: payload.reasons ?? [], checksPassed: payload.source === "model", problems: payload.meta?.problems ?? (payload.source === "model" ? [] : [payload.reason]), usage: payload.meta?.usage ?? null, usd, callMade: made });
  }
  const passed = sets.filter((s) => s.source === "model" && s.checksPassed).length;
  return { model: MODEL, calls: spend.calls, usd: spend.usd, passed, pass: passed >= PASS_AT, passAt: PASS_AT, sets };
}

// Why a run is refused before anything happens, or null.
export function refusalFor(args, env = process.env) {
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  if (!dryRun && !yes) return "pass --dry-run (free) or --yes (paid, needs Paige's OK)";
  if (dryRun && yes) return "pass --dry-run or --yes, not both";
  if (yes && !(args.includes("--out") && args[args.indexOf("--out") + 1])) return "--yes needs --out <dir>";
  if (yes && !env.ANTHROPIC_API_KEY) return "ANTHROPIC_API_KEY is not set";
  return null;
}

export function describePlan(plan) {
  const worst = plan.reduce((sum, p) => sum + worstCaseUsd(MODEL, p.promptChars + 1200, REASONS_MAX_OUTPUT_TOKENS), 0);
  const lines = [`Plan: ${plan.length} calls (1 per case) on ${MODEL}, through produceReasons; caps ${APPROVED_CALLS} calls and $${CAP_USD}; worst case about $${worst.toFixed(4)} in all. Pass: ${PASS_AT} of ${plan.length} sets from the model with the checks passing.`];
  for (const p of plan) lines.push(`- ${p.kase.id}: "${p.kase.flagged}" in "${p.kase.pattern.name}" (${p.body.state.modelHypotheses[0].supports.length - 1} other titles, prompt ${p.promptChars} chars${p.body.reasons.about ? ", with synopsis" : ""})${p.error ? `  REFUSED: ${p.error}` : ""}`);
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const refusal = refusalFor(args);
  if (refusal) { console.error(`refused: ${refusal}`); process.exit(2); }
  const plan = buildPlan();
  console.log(describePlan(plan));
  if (plan.some((p) => p.error)) { console.error("refused: a request doesn't match its state (see above)"); process.exit(2); }
  if (args.includes("--dry-run")) { console.log("DRY RUN: no calls made."); process.exit(0); }

  const outDir = args[args.indexOf("--out") + 1];
  const env = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    TASTEMAKE_AI_MODEL: MODEL,
    TASTEMAKE_AI_ENABLED: "1",
    TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
    TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1",
    TASTEMAKE_AI_HYPOTHESES_ENABLED: "1",
    TASTEMAKE_PARTLY_REASONS: "1"
  };
  const { fetchImpl, spend } = makeCappedFetch();
  const report = await runCheck(plan, { fetchImpl, spend, env });
  for (const s of report.sets) console.log(`- ${s.id}: ${s.source}${s.reasons.length ? `: ${s.reasons.join(" | ")}` : ""}${s.checksPassed ? "" : `  [${s.problems.join("; ")}]`}`);
  console.log(`${report.passed}/${report.sets.length} sets passed; ${report.calls} call(s), about $${report.usd.toFixed(5)}. ${report.pass ? "PASS" : "FAIL"}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "partly-reasons-check.json");
  writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
  console.log(`report: ${file}`);
  process.exit(report.pass ? 0 : 1);
}
