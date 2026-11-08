#!/usr/bin/env node
// #341 step 4: run the approved capture against the protected preview (api/eval-capture.mjs) and save
// each recording locally. Paige runs this herself: the Vercel protection-bypass secret comes from her
// shell (VERCEL_AUTOMATION_BYPASS_SECRET) and is never printed or saved.
//
//   VERCEL_AUTOMATION_BYPASS_SECRET=... node scripts/evals/capture/run-capture.mjs \
//     --url https://<preview>.vercel.app --max-calls 15 --max-requests 30 --max-total-requests <N> [--only rosa:2]
//
// Three limits, all enforced here and recorded in a ledger in the output folder, across runs:
// - calls: at most --max-calls capture calls in total;
// - per call: at most --max-requests external requests (the server enforces it inside each call);
// - global: at most --max-total-requests external requests across the whole experiment, retries and
//   token requests included. Each call is given min(per-call cap, budget left), so the total can't be
//   exceeded; a call that fails without a recording is charged its full allowance, since its real
//   count is unknown.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const refuse = (message) => { console.error(`refused: ${message}`); process.exit(2); };

const base = String(arg("--url") ?? "").replace(/\/$/, "");
const maxCalls = Number(arg("--max-calls"));
const maxRequests = Number(arg("--max-requests"));
const maxTotal = Number(arg("--max-total-requests"));
const outDir = arg("--out") ?? join(homedir(), "tastemake-research-local", "step4");
const only = arg("--only");
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const dryRun = args.includes("--dry-run");

if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(base)) refuse("--url must be the preview's https://….vercel.app address");
if (base === "https://tastemake.vercel.app") refuse("that's production; use the preview address");
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 15) refuse("--max-calls is required (1-15, the approved total)");
if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 30) refuse("--max-requests is required (1-30, the approved per-call cap)");
if (!Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 450) refuse("--max-total-requests is required: the approved global budget of external requests (no default)");
if (!dryRun && !secret) refuse("set VERCEL_AUTOMATION_BYPASS_SECRET in your shell first");

const PLAN = [
  ...[1, 2, 3].map((round) => ({ profileId: "example-profile", round })),
  ...["rosa", "theo", "mara", "dev"].flatMap((profileId) => [1, 2].map((round) => ({ profileId, round })))
];
const plan = only ? PLAN.filter((p) => `${p.profileId}:${p.round}` === only) : PLAN;
if (only && !plan.length) refuse(`--only ${only} isn't in the plan`);

mkdirSync(outDir, { recursive: true });
const ledgerPath = join(outDir, "ledger.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { calls: [] };
const remaining = maxCalls - ledger.calls.length;
const spent = () => ledger.calls.reduce((sum, call) => sum + (call.charged ?? 0), 0);
console.log(`Plan: ${plan.length} capture call(s), at most ${maxRequests} external requests each; ${ledger.calls.length} of ${maxCalls} approved calls and ${spent()} of ${maxTotal} approved external requests already used; output ${outDir}.`);
if (plan.length > remaining) refuse(`only ${remaining} approved call(s) left; this run needs ${plan.length}`);
if (dryRun) { plan.forEach((p) => console.log(`  would capture ${p.profileId} round ${p.round}`)); process.exit(0); }

let usable = 0;
for (const { profileId, round } of plan) {
  const allowance = Math.min(maxRequests, maxTotal - spent());
  if (allowance < 1) { console.log(`Stopped: the global budget of ${maxTotal} external requests is used up.`); break; }
  // Charged in full before the call, so a crash can't hide requests; corrected to the real count after.
  const entry = { profileId, round, at: new Date().toISOString(), allowance, charged: allowance };
  ledger.calls.push(entry);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  let status = 0;
  let recording = null;
  let note = "";
  try {
    const response = await fetch(`${base}/api/eval-capture`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-protection-bypass": secret },
      body: JSON.stringify({ profileId, round, maxRequests: allowance })
    });
    status = response.status;
    const text = await response.text();
    if (response.ok) recording = JSON.parse(text);
    else note = text.slice(0, 200);
  } catch (error) {
    note = error?.name ?? "error";
  }
  if (recording && Number.isInteger(recording.attempts) && recording.attempts <= allowance) {
    entry.charged = recording.attempts;
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  }
  if (recording) {
    const file = join(outDir, `${profileId}-round${round}.json`);
    writeFileSync(file, JSON.stringify(recording, null, 1));
    if (recording.complete) usable += 1;
    console.log(`${profileId} round ${round}: ${recording.complete ? "complete" : "INCOMPLETE"}; ${recording.attempts}/${recording.maxRequests} requests; pool ${recording.pool.length}${recording.stopped ? `; stopped: ${recording.stopped}` : ""}${recording.failures.length ? `; ${recording.failures.length} failure(s)` : ""} -> ${file}`);
  } else {
    console.log(`${profileId} round ${round}: FAILED (HTTP ${status}) ${note.replace(secret || "\u0000", "[secret]")}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
console.log(`Done: ${usable} of ${plan.length} complete; ${ledger.calls.length} of ${maxCalls} approved calls and ${spent()} of ${maxTotal} approved external requests used.`);
