// #382 (Nov 17, Paige: "Build store, switch off"): a cache of appeal profiles (src/ai/appeal-profile.mjs),
// filled in the background after a recommendations response, so a later, separately approved change can
// score with them. Nothing reads the profiles yet, and nothing here changes a response.
//
// Off unless TASTEMAKE_APPEAL_PROFILES=1. With it off -- or live AI off (liveConfig), or no database -- the
// queue does nothing at all: no query, no fetch.
//
// Profiles live in their own table, created on first use like ai_call_metrics (src/server/ai-metrics.mjs),
// not in the canonical store's items.traits. One row per catalog item id; a profile describes a title,
// never a person, so one row serves everyone. A profile that fails the check is never stored.
//
// Every function takes an injectable `query` ((text, params) => Promise<rows>), as in
// src/catalog/canonical-store.mjs, so tests run offline against a fake.

import { waitUntil } from "@vercel/functions";
import { query as defaultQuery, isConfigured } from "./db.mjs";
import { liveConfig } from "./anthropic.mjs";
import { aiErrorFields, aiOutcomeForError, recordAiCall } from "./ai-metrics.mjs";
import { APPEAL_PROMPT_VERSION, DEFAULT_APPEAL_MODEL, canProfile, generateAppealProfile } from "../ai/appeal-profile.mjs";

const DEFAULT_MAX_PER_REQUEST = 4;
const DEFAULT_DAILY_CAP = 150;
// Profiles are made one at a time inside the response's waitUntil lifetime; a slow call gives up well
// before the function's own limit.
const CALL_TIMEOUT_MS = 15_000;

function runnerFor({ env = process.env, query: queryImpl } = {}) {
  if (queryImpl) return queryImpl;
  if (!isConfigured(env)) return null;
  return (text, params) => defaultQuery(text, params, { env });
}

// Schema statements run once per function instance for each database client; a failed setup is
// forgotten so the next use retries it (same as ai-metrics.mjs).
const schemaReady = new WeakMap();
function ensureSchema(key, runQuery) {
  if (!schemaReady.has(key)) {
    const setup = runQuery(`
      create table if not exists appeal_profiles (
        item_id text primary key,
        profile jsonb not null,
        prompt_version text not null,
        model text not null,
        created_at timestamptz not null default now()
      )
    `);
    schemaReady.set(key, Promise.resolve(setup).catch((error) => { schemaReady.delete(key); throw error; }));
  }
  return schemaReady.get(key);
}

export async function getCachedIds(ids, options = {}) {
  const runQuery = runnerFor(options);
  const list = [...new Set((ids ?? []).filter(Boolean).map(String))];
  if (!runQuery || !list.length) return new Set();
  await ensureSchema(options.query ?? defaultQuery, runQuery);
  const rows = await runQuery("select item_id from appeal_profiles where item_id = any($1::text[])", [list]);
  return new Set((rows ?? []).map((row) => row.item_id));
}

export async function saveProfile(itemId, profile, { model, promptVersion = APPEAL_PROMPT_VERSION, ...options } = {}) {
  const runQuery = runnerFor(options);
  if (!runQuery || !itemId || !profile || !model) return false;
  await ensureSchema(options.query ?? defaultQuery, runQuery);
  await runQuery(
    `insert into appeal_profiles (item_id, profile, prompt_version, model)
     values ($1, $2::jsonb, $3, $4)
     on conflict (item_id) do update
       set profile = excluded.profile, prompt_version = excluded.prompt_version, model = excluded.model, created_at = now()`,
    [String(itemId), JSON.stringify(profile), promptVersion, model]
  );
  return true;
}

// Appeal-profile calls in the last `hours`, from the metrics table every call is recorded in. Null when
// there is no database to ask.
export async function countRecentCalls({ hours = 24, ...options } = {}) {
  const runQuery = runnerFor(options);
  if (!runQuery) return null;
  const rows = await runQuery(
    `select count(*)::int as count from ai_call_metrics
      where operation = 'appeal_profile' and occurred_at > now() - ($1::int * interval '1 hour')`,
    [hours]
  );
  return Number(rows?.[0]?.count ?? 0);
}

function wholeNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

// Counts only: never titles, ids or profile text.
function log(fields) {
  console.info("[tastemake-appeal]", JSON.stringify(fields));
}

async function record(metric, options) {
  try {
    await recordAiCall({ operation: "appeal_profile", ...metric }, options);
  } catch (error) {
    log({ stage: "record", error: error?.name || "Error" });
  }
}

async function fillAppealProfiles(items, { env, fetchImpl, query: queryImpl }) {
  const started = Date.now();
  const options = { env, query: queryImpl };
  const counts = { offered: items.length, cached: 0, attempted: 0, saved: 0, invalid: 0, failed: 0, capped: 0, paused: false };
  const cached = await getCachedIds(items.map((item) => item.id), options);
  counts.cached = cached.size;
  const maxPerRequest = wholeNumber(env.TASTEMAKE_APPEAL_MAX_PER_REQUEST, DEFAULT_MAX_PER_REQUEST);
  const missing = items.filter((item) => !cached.has(item.id)).slice(0, maxPerRequest);
  if (missing.length) {
    const dailyCap = wholeNumber(env.TASTEMAKE_APPEAL_DAILY_CAP, DEFAULT_DAILY_CAP);
    const used = await countRecentCalls({ hours: 24, ...options });
    const allowance = used == null ? 0 : Math.max(0, dailyCap - used);
    const batch = missing.slice(0, allowance);
    counts.capped = missing.length - batch.length;
    const fallbackModel = env.TASTEMAKE_APPEAL_MODEL || DEFAULT_APPEAL_MODEL;
    // One at a time: a background job, not worth parallel spend or a burst against the rate limit.
    for (const item of batch) {
      counts.attempted += 1;
      const callStarted = Date.now();
      try {
        const result = await generateAppealProfile(item, { env, fetchImpl, timeoutMs: CALL_TIMEOUT_MS });
        const usage = result.usage ?? {};
        await record({
          outcome: result.profile ? "success" : "validation_fallback",
          model: result.model || fallbackModel,
          durationMs: Math.max(1, Date.now() - callStarted),
          inputTokens: usage.input_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
          cacheReadTokens: usage.cache_read_input_tokens ?? null,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? null
        }, options);
        if (!result.profile) { counts.invalid += 1; continue; }
        await saveProfile(item.id, result.profile, { model: result.model || fallbackModel, promptVersion: APPEAL_PROMPT_VERSION, ...options });
        counts.saved += 1;
      } catch (error) {
        const outcome = aiOutcomeForError(error);
        await record({
          outcome,
          model: error?.model ?? fallbackModel,
          durationMs: Math.max(1, Date.now() - callStarted),
          inputTokens: error?.usage?.input_tokens ?? null,
          outputTokens: error?.usage?.output_tokens ?? null,
          cacheReadTokens: error?.usage?.cache_read_input_tokens ?? null,
          cacheWriteTokens: error?.usage?.cache_creation_input_tokens ?? null,
          ...aiErrorFields(error)
        }, options);
        counts.failed += 1;
        // The account's spend limit: the rest would be turned away too.
        if (outcome === "budget_paused") { counts.paused = true; break; }
      }
    }
  }
  log({ ...counts, ms: Date.now() - started });
  return counts;
}

// Write-behind: returns at once (the background task, or null when nothing was queued) and never throws.
// Callers don't await it. `items` are catalog items in priority order; only titles canProfile() accepts
// are considered, at most TASTEMAKE_APPEAL_MAX_PER_REQUEST (default 4) are made, and never more than
// TASTEMAKE_APPEAL_DAILY_CAP (default 150) in 24 hours.
export function queueAppealProfiles(items, { env = process.env, fetchImpl = fetch, query: queryImpl } = {}) {
  try {
    if (env.TASTEMAKE_APPEAL_PROFILES !== "1") return null;
    if (!liveConfig(env).enabled) return null;
    if (!queryImpl && !isConfigured(env)) return null;
    const seen = new Set();
    const unique = (items ?? []).filter((item) => {
      if (!canProfile(item) || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    if (!unique.length) return null;
    const task = Promise.resolve()
      .then(() => fillAppealProfiles(unique, { env, fetchImpl, query: queryImpl }))
      .catch((error) => {
        log({ stage: "fill", error: error?.name || "Error" });
        return null;
      });
    try { waitUntil(task); } catch { /* local/off-platform tests have no request context */ }
    return task;
  } catch (error) {
    log({ stage: "queue", error: error?.name || "Error" });
    return null;
  }
}
