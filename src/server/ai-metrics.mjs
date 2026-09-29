import { waitUntil } from "@vercel/functions";
import { query as defaultQuery, isConfigured } from "./db.mjs";

// Verified against Anthropic's published pricing on 2026-09-29.
// Sonnet 5 pricing was made permanent on 2026-08-10: $2/M input, $10/M output.
// Cache reads are $0.20/M for the current Sonnet generation.
export const PRICING_AS_OF = "2026-09-29";
const HAIKU_45 = { input: 1, output: 5, cacheRead: 0.10 };
const SONNET_5 = { input: 2, output: 10, cacheRead: 0.20 };

const KNOWN_OPERATIONS = new Set(["recommendations", "taste_profile"]);
const KNOWN_OUTCOMES = new Set([
  "success",
  "validation_fallback",
  "malformed_response",
  "timeout",
  "provider_error",
  "transport_error"
]);

function ratesFor(model) {
  const value = String(model || "");
  if (/^claude-haiku-4-5(?:-|$)/.test(value)) return HAIKU_45;
  if (/^claude-sonnet-5(?:-|$)/.test(value)) return SONNET_5;
  if (/^claude-sonnet-5-5(?:-|$)/.test(value)) return SONNET_5;
  return null;
}

export function estimateCostUsd({ model, inputTokens, outputTokens, cacheReadTokens = 0 }) {
  const rates = ratesFor(model);
  if (!rates) return null;
  const input = Number(inputTokens);
  const output = Number(outputTokens);
  const cacheRead = Number(cacheReadTokens || 0);
  if (![input, output, cacheRead].every(Number.isFinite)) return null;
  return (input * rates.input + output * rates.output + cacheRead * rates.cacheRead) / 1_000_000;
}

export function aiOutcomeForError(error) {
  if (error?.name === "AbortError") return "timeout";
  if (error?.anthropicType === "malformed-response" || error?.anthropicType === "no-text-block") return "malformed_response";
  if (error?.status) return "provider_error";
  return "transport_error";
}

// Schema setup/migration happens only on the write path. A read-only health request never creates
// or alters database objects. Existing rows from #166 remain valid and default to
// recommendations/success when these columns are added.
async function ensureWriteSchema(runQuery) {
  await runQuery(`
    create table if not exists ai_call_metrics (
      id bigserial primary key,
      occurred_at timestamptz not null default now(),
      operation text not null default 'recommendations',
      outcome text not null default 'success',
      model text not null,
      duration_ms integer not null,
      input_tokens integer,
      output_tokens integer,
      cache_read_tokens integer,
      estimated_cost_usd double precision,
      pricing_as_of text
    )
  `);
  await runQuery("alter table ai_call_metrics add column if not exists operation text not null default 'recommendations'");
  await runQuery("alter table ai_call_metrics add column if not exists outcome text not null default 'success'");
  await runQuery("create index if not exists idx_ai_call_metrics_occurred_at on ai_call_metrics (occurred_at desc)");
  await runQuery("create index if not exists idx_ai_call_metrics_operation_outcome on ai_call_metrics (operation, outcome, occurred_at desc)");
}

export async function recordAiCall(metric, { env = process.env, query: queryImpl } = {}) {
  if (!queryImpl && !isConfigured(env)) return false;
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  const model = String(metric?.model || "");
  const durationMs = Math.max(0, Math.round(Number(metric?.durationMs || 0)));
  const operation = KNOWN_OPERATIONS.has(metric?.operation) ? metric.operation : "recommendations";
  const outcome = KNOWN_OUTCOMES.has(metric?.outcome) ? metric.outcome : "transport_error";
  if (!model || !durationMs) return false;
  const inputTokens = metric?.inputTokens == null ? null : Number(metric.inputTokens);
  const outputTokens = metric?.outputTokens == null ? null : Number(metric.outputTokens);
  const cacheReadTokens = metric?.cacheReadTokens == null ? 0 : Number(metric.cacheReadTokens);
  const estimatedCostUsd = estimateCostUsd({ model, inputTokens, outputTokens, cacheReadTokens });

  await ensureWriteSchema(runQuery);
  await runQuery(
    `insert into ai_call_metrics
      (operation, outcome, model, duration_ms, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, pricing_as_of)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [operation, outcome, model, durationMs, inputTokens, outputTokens, cacheReadTokens, estimatedCostUsd, estimatedCostUsd == null ? null : PRICING_AS_OF]
  );
  return true;
}

export function recordAiCallInBackground(metric, options = {}) {
  const task = recordAiCall(metric, options).catch((error) => {
    console.info("[tastemake-ai-metrics]", JSON.stringify({ error: error?.message || "record failed" }));
  });
  try { waitUntil(task); } catch { /* local/off-platform tests have no request context */ }
}

function rate(value, denominator) {
  return denominator ? Number((Number(value || 0) / denominator).toFixed(4)) : null;
}

function normalizeSummary(row = {}) {
  const attempts = Number(row.attempts || 0);
  const successes = Number(row.successes || 0);
  const fallbacks = Number(row.fallbacks || 0);
  const failures = Number(row.failures || 0);
  return {
    attempts,
    successes,
    fallbacks,
    failures,
    success_rate: rate(successes, attempts),
    fallback_rate: rate(fallbacks, attempts),
    latency_ms: {
      p50: row.p50_ms == null ? null : Math.round(Number(row.p50_ms)),
      p95: row.p95_ms == null ? null : Math.round(Number(row.p95_ms))
    },
    tokens: {
      input: Number(row.input_tokens || 0),
      output: Number(row.output_tokens || 0),
      cache_read: Number(row.cache_read_tokens || 0)
    },
    last_call_at: row.last_call_at || null
  };
}

function costFromModelRows(rows = []) {
  let total = 0;
  let known = false;
  for (const row of rows) {
    const tokens = Number(row.input_tokens || 0) + Number(row.output_tokens || 0) + Number(row.cache_read_tokens || 0);
    const cost = estimateCostUsd({
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens
    });
    // Never present a partial total as if it were complete. Unknown-model rows with no usage
    // (for example an early transport failure) do not make the known cost incomplete.
    if (cost == null) {
      if (tokens > 0) return null;
      continue;
    }
    total += cost;
    known = true;
  }
  return known ? total : null;
}

export async function aggregateAiMetrics({ env = process.env, query: queryImpl, days = 30 } = {}) {
  if (!queryImpl && !isConfigured(env)) return { configured: false };
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));

  // Deliberately read-only: if the telemetry table has never been initialized, the endpoint's
  // outer handler reports telemetry unavailable instead of creating schema from a GET request.
  // Legacy #166 tables do not yet have operation/outcome; detect that read-only so the endpoint
  // stays available until the first new write migrates the schema.
  const columns = await runQuery(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ai_call_metrics'"
  );
  const columnNames = new Set((columns ?? []).map((row) => row.column_name));
  const operationExpr = columnNames.has("operation") ? "coalesce(operation, 'recommendations')" : "'recommendations'";
  const outcomeExpr = columnNames.has("outcome") ? "coalesce(outcome, 'success')" : "'success'";

  const summaryRows = await runQuery(
    `select
       count(*)::int as attempts,
       count(*) filter (where ${outcomeExpr} = 'success')::int as successes,
       count(*) filter (where ${outcomeExpr} = 'validation_fallback')::int as fallbacks,
       count(*) filter (where ${outcomeExpr} not in ('success','validation_fallback'))::int as failures,
       percentile_cont(0.5) within group (order by duration_ms)
         filter (where ${outcomeExpr} = 'success')::double precision as p50_ms,
       percentile_cont(0.95) within group (order by duration_ms)
         filter (where ${outcomeExpr} = 'success')::double precision as p95_ms,
       coalesce(sum(input_tokens),0)::bigint as input_tokens,
       coalesce(sum(output_tokens),0)::bigint as output_tokens,
       coalesce(sum(cache_read_tokens),0)::bigint as cache_read_tokens,
       max(occurred_at) as last_call_at
     from ai_call_metrics
     where occurred_at >= now() - ($1::int * interval '1 day')`,
    [days]
  );

  const operationRows = await runQuery(
    `select
       ${operationExpr} as operation,
       count(*)::int as attempts,
       count(*) filter (where ${outcomeExpr} = 'success')::int as successes,
       count(*) filter (where ${outcomeExpr} = 'validation_fallback')::int as fallbacks,
       count(*) filter (where ${outcomeExpr} not in ('success','validation_fallback'))::int as failures,
       percentile_cont(0.5) within group (order by duration_ms)
         filter (where ${outcomeExpr} = 'success')::double precision as p50_ms,
       percentile_cont(0.95) within group (order by duration_ms)
         filter (where ${outcomeExpr} = 'success')::double precision as p95_ms,
       coalesce(sum(input_tokens),0)::bigint as input_tokens,
       coalesce(sum(output_tokens),0)::bigint as output_tokens,
       coalesce(sum(cache_read_tokens),0)::bigint as cache_read_tokens,
       max(occurred_at) as last_call_at
     from ai_call_metrics
     where occurred_at >= now() - ($1::int * interval '1 day')
     group by ${operationExpr}
     order by operation`,
    [days]
  );

  const modelRows = await runQuery(
    `select
       ${operationExpr} as operation,
       model,
       coalesce(sum(input_tokens),0)::bigint as input_tokens,
       coalesce(sum(output_tokens),0)::bigint as output_tokens,
       coalesce(sum(cache_read_tokens),0)::bigint as cache_read_tokens
     from ai_call_metrics
     where occurred_at >= now() - ($1::int * interval '1 day')
     group by ${operationExpr}, model`,
    [days]
  );

  const outcomeRows = await runQuery(
    `select ${outcomeExpr} as outcome, count(*)::int as count
       from ai_call_metrics
      where occurred_at >= now() - ($1::int * interval '1 day')
      group by ${outcomeExpr}
      order by outcome`,
    [days]
  );

  const summary = normalizeSummary(summaryRows?.[0]);
  const operations = {};
  for (const row of operationRows ?? []) {
    const normalized = normalizeSummary(row);
    normalized.estimated_cost_usd = costFromModelRows((modelRows ?? []).filter((modelRow) => modelRow.operation === row.operation));
    operations[row.operation] = normalized;
  }

  const estimatedCostUsd = costFromModelRows(modelRows);
  const outcomes = Object.fromEntries((outcomeRows ?? []).map((row) => [row.outcome, Number(row.count || 0)]));

  return {
    configured: true,
    available: true,
    period_days: days,

    // Backward-compatible fields used by Project Health today.
    sample_count: summary.attempts,
    latency_ms: summary.latency_ms,
    tokens: summary.tokens,
    estimated_cost_usd: estimatedCostUsd,
    last_call_at: summary.last_call_at,

    // Product-facing health fields.
    attempts: summary.attempts,
    successes: summary.successes,
    fallbacks: summary.fallbacks,
    failures: summary.failures,
    success_rate: summary.success_rate,
    fallback_rate: summary.fallback_rate,
    latency_scope: "successful model calls only",
    operations,
    outcomes,

    pricing_as_of: PRICING_AS_OF,
    scope: "live model calls for recommendations and taste profile",
    privacy: { content_included: false }
  };
}
