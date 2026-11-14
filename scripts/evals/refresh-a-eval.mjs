#!/usr/bin/env node
// #326 Design A, the paid before/after (docs/proposals/326-refresh-options.md, section 7). NOT RUN without Paige's
// OK. Three repetitions, arms interleaved: before = today's refresh (--suite refresh, 5 calls), after = the
// placement refresh (--suite refresh-a, 10 calls). 45 calls in all, under one spend cap for the whole thing,
// enforced here: each run gets --max-usd of what is left and --max-calls of its own plan, and nothing more starts
// once the cap is reached. The runner itself also checks every call against its worst case before making it.
//
//   node scripts/evals/refresh-a-eval.mjs --dry-run                 # free: the plan and each arm's dry run
//   node scripts/evals/refresh-a-eval.mjs --yes [--auth ant]        # PAID: 45 calls, cap $0.06
//
// Reports: scripts/evals/reports/runs/<suite>-live-a-r<rep>-<arm>-latest.{md,json} (ignored folder).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ARMS = [
  { arm: "before", suite: "refresh", calls: 5 },
  { arm: "after", suite: "refresh-a", calls: 10 }
];
export const REPS = 3;
export const APPROVED_CALLS = 45;
export const TOTAL_CAP_USD = 0.06;

export function plan(reps = REPS) {
  const runs = [];
  for (let rep = 1; rep <= reps; rep += 1) for (const arm of ARMS) runs.push({ rep, ...arm, tag: `a-r${rep}-${arm.arm}` });
  return runs;
}
export const plannedCalls = (runs) => runs.reduce((sum, r) => sum + r.calls, 0);
// What the next run may spend: what's left under the total cap, never negative.
export const remainingCap = (spent, cap = TOTAL_CAP_USD) => Math.max(0, Math.round((cap - spent) * 1e6) / 1e6);

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const yes = args.includes("--yes");
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "claude-haiku-5-5";
  const auth = args.includes("--auth") ? ["--auth", args[args.indexOf("--auth") + 1]] : [];
  if (!dryRun && !yes) { console.error("refused: pass --dry-run (free) or --yes (paid, needs Paige's OK)"); process.exit(2); }
  const runs = plan();
  if (plannedCalls(runs) > APPROVED_CALLS) { console.error(`refused: plan needs ${plannedCalls(runs)} calls, approved ${APPROVED_CALLS}`); process.exit(2); }
  console.log(`Plan: ${runs.length} runs, ${plannedCalls(runs)} calls on ${model}, total cap $${TOTAL_CAP_USD}${dryRun ? " (DRY RUN: no calls)" : ""}`);
  runs.forEach((r) => console.log(`  rep ${r.rep} ${r.arm}: --suite ${r.suite}, ${r.calls} calls`));
  const runner = join(here, "run.mjs");
  if (dryRun) {
    for (const { suite } of ARMS) {
      const out = execFileSync(process.execPath, [runner, "--suite", suite, "--producer", "live", "--profile-model", model, "--dry-run", "--tag", `a-dry-${suite}`], { encoding: "utf8" });
      console.log(`\n--suite ${suite}: ${out.split("\n").filter((line) => /^DRY RUN|^Worst-case/.test(line)).join("\n  ")}`);
    }
    process.exit(0);
  }
  let spent = 0;
  let calls = 0;
  for (const r of runs) {
    const cap = remainingCap(spent);
    if (cap <= 0) { console.log(`stopped before rep ${r.rep} ${r.arm}: the $${TOTAL_CAP_USD} cap is reached`); break; }
    console.log(`\nrep ${r.rep} ${r.arm}: up to ${r.calls} calls, up to $${cap.toFixed(4)}`);
    const result = spawnSync(process.execPath, [runner, "--suite", r.suite, "--producer", "live", "--profile-model", model, "--model", model, "--yes", "--max-usd", String(cap), "--max-calls", String(r.calls), "--tag", r.tag, "--raw", ...auth], { stdio: "inherit" });
    if (result.status === 2) { console.error("the runner refused; stopping"); break; }
    try {
      const report = JSON.parse(readFileSync(join(here, "reports", "runs", `${r.suite}-live-${r.tag}-latest.json`), "utf8"));
      spent += report.spend?.usd ?? 0;
      calls += report.spend?.calls ?? 0;
    } catch {
      console.error("couldn't read this run's report, so its spend is unknown; stopping");
      break;
    }
  }
  console.log(`\nDone: ${calls} paid call(s), estimated $${spent.toFixed(4)} of the $${TOTAL_CAP_USD} cap.`);
}
