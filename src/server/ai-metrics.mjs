import { waitUntil } from "@vercel/functions";
import { query as defaultQuery, isConfigured } from "./db.mjs";

export const PRICING_AS_OF = "2026-05-27";
const HAIKU_45 = { input: 1, output: 5, cacheRead: 0.10 };

function ratesFor(model) {
  return /^claude-haiku-4-5(?:-|$)/.test(String(model || "")) ? HAIKU_45 : null;
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

async function ensureTable(runQuery) {
  await runQuery(`
    create table if not exists ai_call_metrics (
      id bigserial primary key,
      occurred_at timestamptz not null default now(),
      model text not null,
      duration_ms integer not null,
      input_tokens integer,
      output_tokens integer,
      cache_read_tokens integer,
      estimated_cost_usd double precision,
      pricing_as_of text
    )
  `);
  await runQuery("create index if not exists idx_ai_call_metrics_occurred_at on ai_call_metrics (occurred_at desc)");
}

export async function recordAiCall(metric, { env = process.env, query: queryImpl } = {}) {
  if (!queryImpl && !isConfigured(env)) return false;
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  const model = String(metric?.model || "");
  const durationMs = Math.max(0, Math.round(Number(metric?.durationMs || 0)));
  if (!model || !durationMs) return false;
  const inputTokens = metric?.inputTokens == null ? null : Number(metric.inputTokens);
  const outputTokens = metric?.outputTokens == null ? null : Number(metric.outputTokens);
  const cacheReadTokens = metric?.cacheReadTokens == null ? 0 : Number(metric.cacheReadTokens);
  const estimatedCostUsd = estimateCostUsd({ model, inputTokens, outputTokens, cacheReadTokens });
  await ensureTable(runQuery);
  await runQuery(
    `insert into ai_call_metrics
      (model, duration_ms, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, pricing_as_of)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [model, durationMs, inputTokens, outputTokens, cacheReadTokens, estimatedCostUsd, estimatedCostUsd == null ? null : PRICING_AS_OF]
  );
  return true;
}

export function recordAiCallInBackground(metric, options = {}) {
  const task = recordAiCall(metric, options).catch((error) => {
    console.info("[tastemake-ai-metrics]", JSON.stringify({ error: error?.message || "record failed" }));
  });
  try { waitUntil(task); } catch { /* local/off-platform tests have no request context */ }
}

export async function aggregateAiMetrics({ env = process.env, query: queryImpl, days = 30 } = {}) {
  if (!queryImpl && !isConfigured(env)) return { configured: false };
  const runQuery = queryImpl ?? ((text, params) => defaultQuery(text, params, { env }));
  await ensureTable(runQuery);
  const rows = await runQuery(
    `select
       count(*)::int as sample_count,
       percentile_cont(0.5) within group (order by duration_ms)::double precision as p50_ms,
       percentile_cont(0.95) within group (order by duration_ms)::double precision as p95_ms,
       coalesce(sum(input_tokens),0)::bigint as input_tokens,
       coalesce(sum(output_tokens),0)::bigint as output_tokens,
       coalesce(sum(cache_read_tokens),0)::bigint as cache_read_tokens,
       sum(estimated_cost_usd)::double precision as estimated_cost_usd,
       max(occurred_at) as last_call_at
     from ai_call_metrics
     where occurred_at >= now() - ($1::int * interval '1 day')`,
    [days]
  );
  const row = rows?.[0] || {};
  return {
    configured: true,
    available: true,
    period_days: days,
    sample_count: Number(row.sample_count || 0),
    latency_ms: {
      p50: row.p50_ms == null ? null : Math.round(Number(row.p50_ms)),
      p95: row.p95_ms == null ? null : Math.round(Number(row.p95_ms))
    },
    tokens: {
      input: Number(row.input_tokens || 0),
      output: Number(row.output_tokens || 0),
      cache_read: Number(row.cache_read_tokens || 0)
    },
    estimated_cost_usd: row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
    pricing_as_of: PRICING_AS_OF,
    last_call_at: row.last_call_at || null,
    scope: "live recommendation model calls only",
    privacy: { content_included: false }
  };
}
