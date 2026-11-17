#!/usr/bin/env node
// #326 decision 8: regenerate Paige's Example Profile once through Design A (the placement refresh). PAID: one
// call, approved by Paige on Nov 16 with a $0.01 cap. It runs production's own code path: the same queue and
// request body the browser builds (src/ai/hypothesis-profile.js, refreshByPlacement), the server's
// producePlacement (api/hypotheses.mjs), then applyPlacementResult. Both caps are enforced here, in the fetch
// the server code uses: at most 1 call, and the call isn't sent if its worst case could cross the cap.
//
//   node scripts/evals/regen-example-profile.mjs --dry-run            # free: queue size and worst case
//   node scripts/evals/regen-example-profile.mjs --yes --out <dir>    # PAID: 1 call, needs ANTHROPIC_API_KEY
//
// Writes <dir>/example-profile.json (the new profile, for review before it replaces data/example-profile.json)
// and <dir>/regen-report.json (queue, the checked placement, the refresh message, usage and cost).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APPROVED_CALLS = 1;
export const CAP_USD = 0.01;
export const MODEL = "claude-haiku-5-5";

// The browser modules read these at import time; nothing here is saved anywhere.
const memory = new Map();
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null };

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { restoreStateFromBackupText, state } = await import("../../src/state.js");
const { refreshQueue } = await import("../../src/model/refresh-ledger.js");
const { serializeAiState } = await import("../../src/ai/live-client.js");
const { citedEvidenceRefs } = await import("../../src/ai/hypothesis-profile.js");
const { applyPlacementResult } = await import("../../src/model/placement-apply.js");
const { buildBackup } = await import("../../src/model/export.js");
const { buildPlacementRequest } = await import("../../src/ai/placement.js");
const { buildContext } = await import("../../src/ai/context.js");
const { producePlacement } = await import("../../api/hypotheses.mjs");
const { usageCostUsd, worstCaseUsd } = await import("./pricing.mjs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const yes = args.includes("--yes");
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
if (!dryRun && !yes) { console.error("refused: pass --dry-run (free) or --yes (paid, needs Paige's OK)"); process.exit(2); }
if (yes && !outDir) { console.error("refused: --yes needs --out <dir>"); process.exit(2); }

restoreStateFromBackupText(readFileSync(join(root, "data/example-profile.json"), "utf8"));
const queue = refreshQueue(state);
console.log(`Queue: ${queue.items.length} new item(s), ${queue.pool.length} in the pool, ${(state.modelHypotheses ?? []).length} patterns`);
if (!queue.items.length) { console.error("refused: nothing new to place"); process.exit(2); }

if (dryRun) {
  const prompt = buildPlacementRequest(buildContext(state), state.modelHypotheses ?? [], { items: queue.items, pool: queue.pool });
  const text = typeof prompt === "string" ? prompt : (prompt.prompt ?? JSON.stringify(prompt));
  console.log(`DRY RUN: 1 call on ${MODEL}, prompt ~${Math.ceil(text.length / 4)} tokens; cap $${CAP_USD} (no calls made)`);
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) { console.error("refused: ANTHROPIC_API_KEY is not set"); process.exit(2); }
const spend = { calls: 0, usd: 0 };
async function cappedFetch(url, init = {}) {
  if (spend.calls >= APPROVED_CALLS) throw new Error(`call cap ${APPROVED_CALLS} reached, so this call wasn't made`);
  const body = JSON.parse(init.body);
  if (body.model !== MODEL) throw new Error(`refused: the request is for ${body.model}, approved ${MODEL}`);
  const worst = worstCaseUsd(MODEL, init.body.length, body.max_tokens);
  if (!Number.isFinite(worst) || worst > CAP_USD) throw new Error(`refused: worst case $${worst} is above the $${CAP_USD} cap`);
  spend.calls += 1;
  spend.usd = worst;   // until the real usage is known
  return fetch(url, init);
}

const env = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  TASTEMAKE_AI_MODEL: MODEL,
  TASTEMAKE_AI_ENABLED: "1",
  TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
  TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1",
  TASTEMAKE_AI_HYPOTHESES_ENABLED: "1",
  TASTEMAKE_PROFILE_PLACEMENT: "1"
};
const requiredRefs = [...new Set([...citedEvidenceRefs(state), ...queue.items, ...queue.pool])];
const rawState = { ...serializeAiState(state, { requiredRefs }), modelHypotheses: state.modelHypotheses ?? [] };
let payload;
try {
  payload = await producePlacement({ rawState, placement: { items: queue.items, pool: queue.pool }, env, fetchImpl: cappedFetch });
} catch (error) {
  // A failed call may still be billed: it counts at its worst case.
  payload = { source: "error", reason: String(error.message ?? error), placement: null, meta: { usage: error.usage ?? null } };
}
if (payload.meta?.usage) spend.usd = usageCostUsd(MODEL, payload.meta.usage);
console.log(`Calls: ${spend.calls}; cost ~$${spend.usd.toFixed(5)}; source: ${payload.source}`);

const report = { model: MODEL, calls: spend.calls, usd: spend.usd, usage: payload.meta?.usage ?? null, source: payload.source, reason: payload.reason ?? null, queue, placement: payload.placement ?? null, message: null };
mkdirSync(outDir, { recursive: true });
if (payload.source === "model" && payload.placement) {
  report.message = applyPlacementResult(state, queue, payload.placement).message;
  writeFileSync(join(outDir, "example-profile.json"), `${JSON.stringify(buildBackup(state), null, 1)}\n`);
  console.log(`Message: ${report.message}`);
}
writeFileSync(join(outDir, "regen-report.json"), `${JSON.stringify(report, null, 2)}\n`);
if (payload.source !== "model") process.exit(1);
