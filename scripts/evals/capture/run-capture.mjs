#!/usr/bin/env node
// #341 step 4: run the approved capture against the protected preview (api/eval-capture.mjs) and save
// each recording locally. Paige runs this herself: the Vercel protection-bypass secret comes from her
// shell (VERCEL_AUTOMATION_BYPASS_SECRET) and is never printed or saved.
//
//   VERCEL_AUTOMATION_BYPASS_SECRET=... node scripts/evals/capture/run-capture.mjs \
//     --run <name> --url https://<preview>.vercel.app --max-calls <N> --max-total-requests <N> \
//     (--max-requests <N> | --caps example-profile=80,rosa=60,...) [--only rosa:1,theo:1,...]
//
// --only takes a comma-separated list of profile:round and runs it in that order, so a budget that may not
// cover every call stops at a planned point. The runner never retries: a rejected or failed recording is
// reported, and a re-capture needs its own approved run.
//
// Each --run gets its own folder and ledger under ~/tastemake-research-local/step4/, so an approved budget
// can't borrow from another run's, and earlier ledgers stay as they were for audit (the first, 150-request
// run's ledger is step4/ledger.json).
//
// Three limits, all enforced here and recorded in a ledger in the output folder, across runs:
// - calls: at most --max-calls capture calls in total;
// - per call: --max-requests for every call, or --caps with one limit per profile (each 1-80); the server
//   enforces it inside each call;
// - global: at most --max-total-requests external requests across the whole experiment, retries and
//   token requests included. A call starts only if the budget left covers its full cap (Nov 8 review):
//   otherwise the run stops there, a planned stopping point, rather than spending what's left on a call
//   that can't finish. A call that fails without a recording is charged its full cap, since its real
//   count is unknown.
// A profile:round already in the run's ledger is refused: one attempt per call per run.
// Pacing (Nov 8, after Stage 3's timeouts rose under a burst): --quiet-seconds N waits N seconds before
// every call, the first included, so runs never overlap or burst. --stop-if-failures S stops the run
// after any call whose share of failed provider lookups exceeds S (e.g. 0.25), instead of continuing
// into a provider that's struggling.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const refuse = (message) => { console.error(`refused: ${message}`); process.exit(2); };

const base = String(arg("--url") ?? "").replace(/\/$/, "");
const maxCalls = Number(arg("--max-calls"));
const maxRequests = arg("--max-requests") == null ? null : Number(arg("--max-requests"));
const capsArg = arg("--caps");
const maxTotal = Number(arg("--max-total-requests"));
const run = arg("--run");
if (!run || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(run)) refuse("--run <name> is required (lowercase letters, digits, dashes): each run gets its own folder and ledger");
const outDir = join(arg("--out") ?? join(homedir(), "tastemake-research-local", "step4"), run);
const only = arg("--only");
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const dryRun = args.includes("--dry-run");
const quietSeconds = arg("--quiet-seconds") == null ? 0 : Number(arg("--quiet-seconds"));
const stopShare = arg("--stop-if-failures") == null ? null : Number(arg("--stop-if-failures"));
if (!Number.isFinite(quietSeconds) || quietSeconds < 0 || quietSeconds > 900) refuse("--quiet-seconds must be 0-900");
if (stopShare != null && !(stopShare >= 0 && stopShare <= 1)) refuse("--stop-if-failures must be a share between 0 and 1");

if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(base)) refuse("--url must be the preview's https://….vercel.app address");
if (base === "https://tastemake.vercel.app") refuse("that's production; use the preview address");
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 15) refuse("--max-calls is required (1-15, the approved total)");
if ((maxRequests == null) === (capsArg == null)) refuse("give either --max-requests (one cap for every call) or --caps (one per profile), not both or neither");
if (maxRequests != null && (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 80)) refuse("--max-requests must be 1-80, the approved per-call cap");
const caps = {};
if (capsArg != null) {
  for (const part of capsArg.split(",")) {
    const [id, value] = part.split("=");
    const cap = Number(value);
    if (!id || !Number.isInteger(cap) || cap < 1 || cap > 80) refuse(`--caps entries look like profile=N with N 1-80 (got "${part}")`);
    caps[id] = cap;
  }
}
if (!Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 700) refuse("--max-total-requests is required: the approved global budget of external requests (no default)");
if (!dryRun && !secret) refuse("set VERCEL_AUTOMATION_BYPASS_SECRET in your shell first");

const PLAN = [
  // Round 4 (Nov 8): a separate, spaced re-capture of the Example Profile. A distinct label, so a new
  // recording is never mistaken for, or silently swapped in for, rounds 1-3.
  ...[1, 2, 3, 4].map((round) => ({ profileId: "example-profile", round })),
  ...["rosa", "theo", "mara", "dev"].flatMap((profileId) => [1, 2].map((round) => ({ profileId, round })))
];
let plan = PLAN;
if (only) {
  plan = only.split(",").map((key) => PLAN.find((p) => `${p.profileId}:${p.round}` === key.trim()) ?? refuse(`--only ${key} isn't in the plan`));
  if (new Set(plan).size !== plan.length) refuse("--only lists a call twice");
}
const capFor = (profileId) => (maxRequests ?? caps[profileId]);
const uncapped = [...new Set(plan.map((p) => p.profileId))].filter((id) => !capFor(id));
if (uncapped.length) refuse(`--caps has no limit for: ${uncapped.join(", ")}`);

mkdirSync(outDir, { recursive: true });
const ledgerPath = join(outDir, "ledger.json");
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : { calls: [] };
const remaining = maxCalls - ledger.calls.length;
const spent = () => ledger.calls.reduce((sum, call) => sum + (call.charged ?? 0), 0);
const planMax = plan.reduce((sum, p) => sum + capFor(p.profileId), 0);
console.log(`Plan: ${plan.length} capture call(s) in this order: ${plan.map((p) => `${p.profileId}:${p.round} (cap ${capFor(p.profileId)})`).join(", ")}.`);
if (quietSeconds || stopShare != null) console.log(`Pacing: ${quietSeconds} s quiet before every call${stopShare != null ? `; stop after any call with more than ${Math.round(stopShare * 100)}% of provider lookups failing` : ""}.`);
console.log(`Budget: the calls' caps add up to ${planMax}; the approved global budget is ${maxTotal}${planMax > maxTotal ? `, so the run may stop before every call (a call starts only if the budget left covers its full cap)` : ""}. ${ledger.calls.length} of ${maxCalls} approved calls and ${spent()} of ${maxTotal} approved external requests already used; output ${outDir}.`);
if (plan.length > remaining) refuse(`only ${remaining} approved call(s) left; this run needs ${plan.length}`);
const attempted = new Set(ledger.calls.map((c) => `${c.profileId}:${c.round}`));
const repeats = plan.filter((p) => attempted.has(`${p.profileId}:${p.round}`)).map((p) => `${p.profileId}:${p.round}`);
if (repeats.length) refuse(`already attempted in this run (one attempt per call per run; a re-capture needs its own run): ${repeats.join(", ")}`);
if (dryRun) { plan.forEach((p) => console.log(`  would capture ${p.profileId} round ${p.round}`)); process.exit(0); }

let usable = 0;
for (const { profileId, round } of plan) {
  const allowance = capFor(profileId);
  const left = maxTotal - spent();
  if (left < allowance) { console.log(`Stopped before ${profileId} round ${round}: ${left} of the ${maxTotal}-request budget left, and its cap is ${allowance}.`); break; }
  if (quietSeconds) { console.log(`Waiting ${quietSeconds} s before ${profileId} round ${round}...`); await new Promise((resolve) => setTimeout(resolve, quietSeconds * 1000)); }
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
    if (!recording.stopped) usable += 1;
    // Usability (clean, degraded or unusable) is decided by the offline replay check, not here.
    console.log(`${profileId} round ${round}: ${recording.stopped ? `STOPPED by the recorder: ${recording.stopped}` : "recorded"}; ${recording.attempts}/${recording.maxRequests} requests; pool ${recording.pool.length}${recording.failures.length ? `; ${recording.failures.length} provider failure(s)` : ""} -> ${file}`);
    const share = recording.requests?.length ? recording.failures.length / recording.requests.length : 0;
    if (stopShare != null && share > stopShare) { console.log(`Stopped: ${Math.round(share * 100)}% of ${profileId} round ${round}'s provider lookups failed (over ${Math.round(stopShare * 100)}%).`); break; }
  } else {
    console.log(`${profileId} round ${round}: FAILED (HTTP ${status}) ${note.replace(secret || "\u0000", "[secret]")}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
console.log(`Done: ${usable} of ${plan.length} recorded without a recorder stop (run the replay check for clean / degraded / unusable); ${ledger.calls.length} of ${maxCalls} approved calls and ${spent()} of ${maxTotal} approved external requests used. Nothing is retried automatically.`);
