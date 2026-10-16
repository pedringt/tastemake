#!/usr/bin/env node
// #28 stress eval: run recommendation reasoning over synthetic profiles at 10 / 50 / 100+ experienced
// items, many times, and record every explanation for the deterministic metrics (metrics.mjs, report.mjs).
//
//   node scripts/evals/stress/run-stress.mjs --dry-run                       # free: plan, prompt sizes, cost
//   node scripts/evals/stress/run-stress.mjs --models claude-haiku-5-5 --sizes 10,50,100 \
//        --profiles all --repeats 6 --max-calls 400 --yes                     # PAID
//
// Same code path as production (and as run.mjs --producer live): each call is
// api/recommendations.mjs produceRecommendations() itself -- wire serialization (serializeAiState), state
// hydration, buildContext, the 6-candidate offer, the live gate, buildPickPrompt, the Anthropic transport
// (src/server/anthropic.mjs: model, effort, thinking mode, JSON repair), normalizeModelPicks, validatePicks,
// acceptOrFallback and the copy sanitizer. Two things are injected, and nothing else differs:
//   - candidate retrieval returns the profile's fixed 36-item pool (production retrieval needs provider
//     keys and drifts with the live catalog; holding it fixed isolates the reasoning);
//   - fetch: a wrapper that only lets calls to api.anthropic.com through, enforces --max-calls, and keeps
//     the raw model text so rejected picks can be recorded with the validator's reasons.
// The env passed in is built from scratch (no database URL, so no telemetry rows are written).
// --with-profile also runs the taste profile once per profile (api/hypotheses.mjs produceHypotheses).
//
// A "repeat" is a recommendation round: round r has the r earlier 6-item windows of the pool already
// shown, so each round offers different candidates (as a returning visitor would see). After 6 rounds the
// pool cycles and the same candidates are offered again, which gives true repeats for variance.
//
// Output is JSONL, appended after every call (one line per call), so a timeout or crash keeps every
// finished call. Re-running with the same --out resumes: calls already in the file are skipped.
// --deadline-minutes stops starting new calls in time for the workflow to upload what it has.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { produceRecommendations, normalizeModelPicks, selectPromptEvidence } from "../../../api/recommendations.mjs";
import { produceHypotheses, PROFILE_MAX_OUTPUT_TOKENS } from "../../../api/hypotheses.mjs";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { buildContext } from "../../../src/ai/context.js";
import { validatePicks } from "../../../src/ai/validate.js";
import { parseModelJson, thinkingTypeFor } from "../../../src/server/anthropic.mjs";
import { estimateCostUsd, PRICING_AS_OF } from "../../../src/server/ai-metrics.mjs";
import { priceFor } from "../pricing.mjs";
import { SHAPES, SIZES, candidateItems, itemsIndex, loadProfileSpecs, loadSnapshot, profileState } from "./profiles.mjs";

export const PICK_MAX_OUTPUT_TOKENS = 1000;   // src/server/anthropic.mjs MAX_OUTPUT_TOKENS (production default)
const ANTHROPIC_HOST = "api.anthropic.com";

export function parseArgs(argv) {
  const get = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const list = (value) => String(value).split(",").map((s) => s.trim()).filter(Boolean);
  const profiles = list(get("--profiles", "all"));
  return {
    models: list(get("--models", process.env.TASTEMAKE_RECOMMENDATIONS_MODEL || "claude-haiku-5-5")),
    sizes: list(get("--sizes", Object.keys(SIZES).join(","))),
    shapes: profiles.includes("all") ? SHAPES : profiles,
    repeats: Number(get("--repeats", "3")),
    withProfile: argv.includes("--with-profile"),
    dryRun: argv.includes("--dry-run"),
    confirmed: argv.includes("--yes"),
    maxCalls: Number(get("--max-calls", "100")),
    out: get("--out", join("scripts", "evals", "stress", "results")),
    concurrency: Math.max(1, Number(get("--concurrency", "2"))),
    deadlineMinutes: Number(get("--deadline-minutes", "0")),
    effort: get("--effort", process.env.TASTEMAKE_RECOMMENDATIONS_EFFORT || "low"),
    tag: get("--tag", "")
  };
}

export function validateOptions(opts) {
  const problems = [];
  for (const m of opts.models) if (!/^claude-[a-z0-9.-]+$/.test(m)) problems.push(`"${m}" is not a model id`);
  for (const s of opts.sizes) if (!SIZES[s]) problems.push(`size "${s}" is not one of ${Object.keys(SIZES).join(", ")}`);
  for (const s of opts.shapes) if (!SHAPES.includes(s)) problems.push(`profile "${s}" is not one of ${SHAPES.join(", ")}`);
  if (!Number.isInteger(opts.repeats) || opts.repeats < 1) problems.push("--repeats must be a positive whole number");
  if (!Number.isFinite(opts.maxCalls) || opts.maxCalls < 0) problems.push("--max-calls must be a number");
  return problems;
}

// One task = one model call. Picks: one per model x profile x round. Profile: one per model x profile.
export function planTasks(opts, specs = loadProfileSpecs()) {
  const tasks = [];
  for (const model of opts.models) {
    for (const size of opts.sizes) {
      for (const shape of opts.shapes) {
        const spec = specs.find((p) => p.shape === shape && p.size === size);
        if (!spec) throw new Error(`no committed profile ${shape}-${size}`);
        if (opts.withProfile) tasks.push({ kind: "profile", model, spec, round: 0, key: `${model}|${spec.id}|profile` });
        for (let round = 0; round < opts.repeats; round += 1) tasks.push({ kind: "picks", model, spec, round, key: `${model}|${spec.id}|r${round}` });
      }
    }
  }
  return tasks;
}

function envFor(model, opts, key) {
  return {
    ANTHROPIC_API_KEY: key,
    TASTEMAKE_AI_ENABLED: "1",
    TASTEMAKE_AI_MODEL: model,                       // taste profile (api/hypotheses.mjs)
    TASTEMAKE_RECOMMENDATIONS_MODEL: model,          // picks (api/recommendations.mjs)
    TASTEMAKE_RECOMMENDATIONS_EFFORT: opts.effort,
    TASTEMAKE_AI_RATE_LIMIT_CONFIRMED: "1",
    TASTEMAKE_AI_SPEND_CAP_CONFIRMED: "1",
    TASTEMAKE_AI_HYPOTHESES_ENABLED: "1"
  };
}

const estimateTokens = (text) => Math.ceil(String(text).length / 4);   // same ~4 chars/token as run.mjs

// The only fetch the production code gets. Dry run: answers locally with an empty model reply and records
// the request size; nothing leaves the machine. Live: forwards to Anthropic only, enforces the budget.
export function makeFetch({ dryRun, budget, realFetch = globalThis.fetch }) {
  // `captures` is per call (runTask passes its own list), so concurrent calls never mix their records.
  return async function stressFetch(url, init = {}, captures = []) {
    const host = new URL(String(url)).host;
    if (host !== ANTHROPIC_HOST) throw new Error(`stress eval refuses a request to ${host}: only ${ANTHROPIC_HOST} is allowed`);
    const body = JSON.parse(init.body);
    const promptText = [...(body.system ?? []).map((b) => b.text), ...(body.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))].join("\n");
    const capture = { model: body.model, maxTokens: body.max_tokens, thinking: body.thinking?.type ?? null, effort: body.output_config?.effort ?? null, promptChars: promptText.length, estInputTokens: estimateTokens(promptText) };
    captures.push(capture);
    if (dryRun) {
      const empty = promptText.includes("taste-interpretation layer") ? '{"hypotheses":[],"insufficientEvidence":true}' : '{"picks":[]}';
      capture.text = empty;
      return new Response(JSON.stringify({ model: body.model, content: [{ type: "text", text: empty }], usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (budget.used >= budget.max) throw new Error(`call budget reached (${budget.max}); refusing another paid call`);
    budget.used += 1;
    const response = await realFetch(url, init);
    const copy = response.clone();
    try {
      const data = await copy.json();
      capture.status = response.status;
      capture.usage = data.usage ?? null;
      capture.text = data.content?.find((b) => b.type === "text")?.text ?? null;
      capture.stopReason = data.stop_reason ?? null;
      if (!response.ok) capture.error = { type: data?.error?.type ?? null, message: String(data?.error?.message ?? "").slice(0, 300) };
    } catch { capture.status = response.status; }
    return response;
  };
}

// Recency comes from the profile's own reaction order (the order they were added), not from the wire,
// which reorders reactions by domain when it trims a long history to 96.
function evidenceIndex(ctx, spec) {
  const tried = (ctx.evidence ?? []).filter((r) => r.class === "experienced" && r.kind !== "starter-favorite");
  const n = spec.reactions.length;
  const recency = new Map(spec.reactions.map((r, i) => [`ev:${r.id}`, n > 1 ? i / (n - 1) : 1]));
  return { byRef: new Map((ctx.evidence ?? []).map((r) => [r.ref, r])), recency, tried };
}

function citedEvidence(cites, index, promptRefs) {
  return (cites ?? []).map((ref) => index.byRef.get(ref)).filter(Boolean).map((r) => ({
    ref: r.ref, title: r.title, kind: r.kind, polarity: r.polarity, domains: r.domains, genres: r.facts?.genres ?? [],
    refinements: (r.refinements ?? []).map((x) => x.id ?? x), recency: index.recency.get(r.ref) ?? null, inPrompt: promptRefs.has(r.ref)
  }));
}

// Production logs every stage ([tastemake-*] lines). Silence them while calls are in flight; reference
// counted so overlapping calls (--concurrency) restore the real console only when the last one ends.
const realConsole = { info: console.info, log: console.log, error: console.error, warn: console.warn };
let quietDepth = 0;
const quietly = async (fn) => {
  if (quietDepth++ === 0) console.info = console.log = console.error = console.warn = () => {};
  try { return await fn(); } finally { if (--quietDepth === 0) Object.assign(console, realConsole); }
};

export async function runTask(task, opts, { fetchImpl, snapshotIndex }) {
  const { spec, model, round } = task;
  const state = profileState(spec, { round, itemsById: snapshotIndex });
  const candidates = candidateItems(spec, { itemsById: snapshotIndex });
  // The wire round trip production does: browser serializes (96-reaction cap etc.), server hydrates.
  const rawState = JSON.parse(JSON.stringify(serializeAiState(state)));
  const env = envFor(model, opts, opts.dryRun ? "dry-run-no-key" : (opts.apiKey ?? process.env.ANTHROPIC_API_KEY));
  const captures = [];
  const taskFetch = (url, init) => fetchImpl(url, init, captures);
  const started = Date.now();

  // What production knows server-side, rebuilt the same way, for recording and re-validation.
  const ctx = buildContext(hydrateState(rawState), candidates);
  const index = evidenceIndex(ctx, spec);
  const fullExperienced = Object.values(state.feedbackByRecommendation).filter((f) => ["more", "less"].includes(f.rating) && ["loved-before", "liked-before", "tried-disliked"].includes(f.detail)).length + spec.favorites.length;
  const profileFacts = {
    experiencedInProfile: fullExperienced,
    experiencedOnWire: (ctx.evidence ?? []).filter((r) => r.class === "experienced").length,
    triedDomains: [...new Set(index.tried.flatMap((r) => r.domains ?? []))].sort()
  };

  if (task.kind === "profile") {
    let payload = null, error = null;
    try { payload = await quietly(() => produceHypotheses({ rawState: { ...rawState, modelHypotheses: [] }, env, fetchImpl: taskFetch })); }
    catch (e) { error = String(e?.message ?? e).slice(0, 300); }
    const capture = captures[0] ?? null;
    return {
      type: "call", kind: "profile", key: task.key, model, profile: spec.id, shape: spec.shape, size: spec.size, round,
      ms: Date.now() - started, source: payload?.source ?? "error", reason: payload?.reason ?? error,
      patterns: (payload?.hypotheses ?? []).map(({ id, label, claim, evidence, counter, domains, crossDomain, level }) => ({ id, label, claim, evidence, counter, domains, crossDomain, level })),
      notes: payload?.meta?.notes ?? [], rejectedCount: payload?.meta?.rejected ?? 0, rejectionCategories: payload?.meta?.rejectionCategories ?? {},
      profileFacts, request: capture && { promptChars: capture.promptChars, estInputTokens: capture.estInputTokens, maxTokens: capture.maxTokens, thinking: capture.thinking },
      usage: capture?.usage ?? null, httpError: capture?.error ?? null,
      costUsd: capture?.usage ? estimateCostUsd({ model, inputTokens: capture.usage.input_tokens, outputTokens: capture.usage.output_tokens, cacheReadTokens: capture.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: capture.usage.cache_creation_input_tokens ?? 0, perCall: true }) ?? 0 : 0
    };
  }

  const payload = await quietly(() => produceRecommendations({ rawState, env, fetchImpl: taskFetch, retrieve: async () => candidates }));
  const capture = captures[0] ?? null;
  // Production's own offer and validation context (api/recommendations.mjs: promptCtx).
  const offered = ctx.candidates.slice(0, 6);
  const promptCtx = { ...ctx, candidates: offered };
  const promptRefs = new Set(selectPromptEvidence(promptCtx).map((r) => r.ref));
  let validated = null, parseError = null;
  if (capture?.text) {
    try { validated = validatePicks(normalizeModelPicks(parseModelJson(capture.text)), promptCtx); }
    catch (e) { parseError = String(e?.message ?? e).slice(0, 200); }
  }
  const rawById = new Map((validated?.accepted ?? []).map((p) => [p.itemId, p]));
  const picks = payload.source === "model" ? payload.picks.map((p) => ({
    itemId: p.id, title: p.title, domains: p.domains ?? [], genres: p.genres ?? [], about: p.about ?? null,
    why: p.reason, rawWhy: rawById.get(p.id)?.why ?? null, cites: p.ai?.cites ?? [], kind: p.ai?.kind ?? "pick",
    fit: p.fit, prediction: p.prediction,
    citedEvidence: citedEvidence(p.ai?.cites, index, promptRefs)
  })) : [];
  return {
    type: "call", kind: "picks", key: task.key, model, profile: spec.id, shape: spec.shape, size: spec.size, round,
    ms: Date.now() - started, source: payload.source, reason: payload.reason ?? null,
    offered: offered.map((c) => ({ id: c.id, title: c.title, domains: c.domains })),
    promptEvidence: { count: promptRefs.size, refs: [...promptRefs] },
    profileFacts, picks,
    rejected: (validated?.rejected ?? []).map((r) => ({ itemId: r.proposal?.itemId ?? null, why: r.proposal?.why ?? null, cites: r.proposal?.cites ?? [], reasons: r.reasons })),
    consistency: validated ? { recomputedKept: validated.accepted.length, productionKept: picks.length } : null,
    parseError, request: capture && { promptChars: capture.promptChars, estInputTokens: capture.estInputTokens, maxTokens: capture.maxTokens, thinking: capture.thinking, effort: capture.effort },
    usage: capture?.usage ?? null, stopReason: capture?.stopReason ?? null, httpError: capture?.error ?? null,
    errorType: payload.meta?.errorType ?? null,
    costUsd: capture?.usage ? estimateCostUsd({ model, inputTokens: capture.usage.input_tokens, outputTokens: capture.usage.output_tokens, cacheReadTokens: capture.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: capture.usage.cache_creation_input_tokens ?? 0, perCall: true }) ?? 0 : 0
  };
}

// Worst-case and floor cost from the dry run's measured prompt sizes (no output = floor, output at the
// max_tokens cap = ceiling). Real output is usually far below the cap.
export function costTable(records) {
  const rows = new Map();
  for (const r of records) {
    const key = `${r.model}|${r.size}|${r.kind}`;
    const row = rows.get(key) ?? { model: r.model, size: r.size, kind: r.kind, calls: 0, inTokens: 0, maxOut: 0 };
    row.calls += 1;
    row.inTokens += r.request?.estInputTokens ?? 0;
    row.maxOut += r.request?.maxTokens ?? (r.kind === "profile" ? PROFILE_MAX_OUTPUT_TOKENS : PICK_MAX_OUTPUT_TOKENS);
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({ ...row, floorUsd: priceFor(row.model, row.inTokens, 0), ceilingUsd: priceFor(row.model, row.inTokens, row.maxOut) }));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const problems = validateOptions(opts);
  if (problems.length) { console.error(`Refusing: ${problems.join("; ")}`); process.exit(2); }
  const tasks = planTasks(opts);
  const planned = { picks: tasks.filter((t) => t.kind === "picks").length, profile: tasks.filter((t) => t.kind === "profile").length };
  console.log(`${opts.dryRun ? "DRY RUN: " : ""}${tasks.length} call(s) planned (${planned.picks} picks, ${planned.profile} taste-profile): models ${opts.models.join(", ")}; sizes ${opts.sizes.join(", ")}; profiles ${opts.shapes.join(", ")}; repeats ${opts.repeats}.`);
  if (tasks.length > opts.maxCalls) {
    console.error(`Refusing: ${tasks.length} planned calls is above --max-calls ${opts.maxCalls}.`);
    process.exit(3);
  }
  if (!opts.dryRun) {
    if (!process.env.ANTHROPIC_API_KEY) { console.error("Refusing: ANTHROPIC_API_KEY must be set for a live run (or use --dry-run)."); process.exit(2); }
    if (!opts.confirmed) { console.error("Refusing: a live run spends money. Review --dry-run first, then re-run with --yes."); process.exit(2); }
  }

  const snapshotIndex = itemsIndex(loadSnapshot());
  const budget = { used: 0, max: opts.maxCalls };
  const fetchImpl = makeFetch({ dryRun: opts.dryRun, budget });

  mkdirSync(opts.out, { recursive: true });
  const name = `stress-${opts.dryRun ? "dryrun-" : ""}${opts.tag || `${opts.models.join("+")}-${opts.sizes.join("+")}`}`.replace(/[^a-zA-Z0-9._+-]/g, "-");
  const file = join(opts.out, `${name}.jsonl`);
  const done = new Set();
  if (existsSync(file) && !opts.dryRun) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const rec = JSON.parse(line); if (rec.type === "call" && rec.source !== "error") done.add(rec.key); } catch { /* partial last line */ }
    }
  } else {
    writeFileSync(file, "");
  }
  appendFileSync(file, JSON.stringify({ type: "header", startedAt: new Date().toISOString(), dryRun: opts.dryRun, models: opts.models, sizes: opts.sizes, profiles: opts.shapes, repeats: opts.repeats, withProfile: opts.withProfile, effort: opts.effort, thinking: Object.fromEntries(opts.models.map((m) => [m, thinkingTypeFor(m, "between_tools")])), pricingAsOf: PRICING_AS_OF, resumedSkipping: done.size }) + "\n");

  const todo = tasks.filter((t) => !done.has(t.key));
  const deadline = opts.deadlineMinutes > 0 ? Date.now() + opts.deadlineMinutes * 60_000 : Infinity;
  const records = [];
  let next = 0, finished = 0, skippedForDeadline = 0, spent = 0;
  async function worker() {
    while (next < todo.length) {
      const task = todo[next++];
      if (Date.now() > deadline) { skippedForDeadline += 1; continue; }
      let record;
      try { record = await runTask(task, opts, { fetchImpl, snapshotIndex }); }
      catch (e) { record = { type: "call", kind: task.kind, key: task.key, model: task.model, profile: task.spec.id, shape: task.spec.shape, size: task.spec.size, round: task.round, source: "error", reason: String(e?.message ?? e).slice(0, 300) }; }
      appendFileSync(file, JSON.stringify(record) + "\n");   // incremental: every finished call is on disk
      records.push(record);
      spent += record.costUsd ?? 0;
      finished += 1;
      if (!opts.dryRun) process.stdout.write(`  ${finished}/${todo.length} ${task.key}: ${record.source}${record.picks ? ` (${record.picks.length} kept, ${record.rejected?.length ?? 0} rejected)` : ""}; spent $${spent.toFixed(4)}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, todo.length || 1) }, worker));

  if (opts.dryRun) {
    const table = costTable(records);
    console.log("\nPer model x size (prompt sizes measured from the real production prompts; no call was made):");
    console.log("| Model | Size | Kind | Calls | Est. input tokens | Output cap | Floor (input only) | Ceiling (output at cap) |");
    console.log("|---|---|---|---|---|---|---|---|");
    for (const r of table) console.log(`| ${r.model} | ${r.size} | ${r.kind} | ${r.calls} | ${r.inTokens} | ${r.maxOut} | $${r.floorUsd.toFixed(4)} | $${r.ceilingUsd.toFixed(4)} |`);
    const byModel = {};
    for (const r of table) { byModel[r.model] ??= { calls: 0, floor: 0, ceiling: 0 }; byModel[r.model].calls += r.calls; byModel[r.model].floor += r.floorUsd; byModel[r.model].ceiling += r.ceilingUsd; }
    console.log("");
    for (const [m, v] of Object.entries(byModel)) console.log(`Total ${m}: ${v.calls} calls, $${v.floor.toFixed(3)} to $${v.ceiling.toFixed(3)} (rates as of ${PRICING_AS_OF}).`);
    const errors = records.filter((r) => r.source === "error");
    if (errors.length) { console.log(`\n${errors.length} task(s) failed in the dry run:`); errors.slice(0, 5).forEach((e) => console.log(`  ${e.key}: ${e.reason}`)); process.exit(1); }
    console.log("\nNo call was made. Re-run without --dry-run and with --yes to spend.");
  } else {
    const usd = records.reduce((a, r) => a + (r.costUsd ?? 0), 0);
    console.log(`Done: ${finished} call(s) this run, ${done.size} resumed, ${skippedForDeadline} not started (deadline); paid calls ${budget.used}; estimated cost $${usd.toFixed(4)}. Results: ${file}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
