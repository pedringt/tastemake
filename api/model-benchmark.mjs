import { buildContext } from "../src/ai/context.js";
import { validateHypotheses, validatePicks } from "../src/ai/validate.js";
import * as baseline from "../src/ai/baseline.js";
import { buildPickPrompt, parseModelJson } from "./recommendations.mjs";
import { FIXTURES } from "../scripts/evals/fixtures.mjs";
import { scoreFixture } from "../scripts/evals/scorers.mjs";
import { recommendations as qaRecommendations, followUpPool as qaFollowUps } from "../scripts/qa/fixtures/catalog.js";

const CANDIDATES = [...qaRecommendations, ...qaFollowUps];
const FIXTURE_IDS = ["starter-6", "about-10", "intent-heavy", "cross-domain", "scale-100"];
const CONFIGS = {
  sonnet5: { label: "Claude Sonnet 5 (current)", model: "claude-sonnet-5", thinking: { type: "disabled" } },
  sonnet55low: { label: "Claude Sonnet 5.5 low effort", model: "claude-sonnet-5-5", thinking: { type: "between_tools" }, effort: "low" },
  haiku45: { label: "Claude Haiku 4.5", model: "claude-haiku-4-5", thinking: { type: "disabled" } }
};

function normalize(json) {
  if (!json || !Array.isArray(json.picks)) return json;
  return {
    ...json,
    picks: json.picks.map((pick) => ({
      ...pick,
      tests: pick.tests ?? null,
      kind: pick.kind ?? (json.curveballItemId && pick.itemId === json.curveballItemId ? "curveball" : "pick")
    }))
  };
}

async function callModel(prompt, config) {
  const started = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      ...(config.effort ? { effort: config.effort } : {}),
      thinking: config.thinking,
      max_tokens: 1000,
      system: [{
        type: "text",
        text: prompt.includes("\n\nCONTEXT\n") ? prompt.split("\n\nCONTEXT\n", 1)[0] : prompt,
        cache_control: { type: "ephemeral" }
      }],
      messages: [{
        role: "user",
        content: prompt.includes("\n\nCONTEXT\n")
          ? `CONTEXT\n${prompt.slice(prompt.indexOf("\n\nCONTEXT\n") + "\n\nCONTEXT\n".length)}`
          : prompt
      }]
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.type ?? "error"}: ${body?.error?.message ?? ""}`);
  const text = body.content?.find((block) => block.type === "text")?.text;
  if (!text) throw new Error(`no text block; stop_reason=${body.stop_reason ?? "?"}`);
  return {
    json: parseModelJson(text),
    ms: Date.now() - started,
    usage: body.usage ?? {},
    model: body.model ?? config.model
  };
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV === "production") return res.status(404).json({ error: "not available" });
  if (req.method !== "GET") return res.status(405).json({ error: "GET required" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "missing Anthropic key" });

  const key = String(req.query?.config ?? "sonnet5");
  const config = CONFIGS[key];
  if (!config) return res.status(400).json({ error: "unknown config", available: Object.keys(CONFIGS) });

  const rows = [];
  for (const id of FIXTURE_IDS) {
    const fixture = FIXTURES.find((entry) => entry.id === id);
    const state = fixture.build();
    const ctx = buildContext(state, CANDIDATES);
    ctx.__fixture = fixture.id;
    const count = Math.min(5, ctx.candidates.length);
    if (!count) continue;
    const promptCtx = { ...ctx, candidates: ctx.candidates.slice(0, count) };
    const hyp = validateHypotheses(baseline.inferHypotheses(state), ctx);
    try {
      const result = await callModel(buildPickPrompt(promptCtx, count), config);
      const picks = validatePicks(normalize(result.json), promptCtx);
      const scores = scoreFixture(fixture, { ctx: promptCtx, hyp, picks, before: null });
      rows.push({
        fixture: id,
        ms: result.ms,
        inputTokens: result.usage?.input_tokens ?? null,
        outputTokens: result.usage?.output_tokens ?? null,
        cacheReadTokens: result.usage?.cache_read_input_tokens ?? null,
        accepted: picks.accepted.length,
        rejected: picks.rejected.length,
        ruleFailures: scores.filter((s) => s.kind === "rule" && s.pass === false).map((s) => s.name),
        qualityFindings: scores.filter((s) => s.kind === "quality" && s.pass === false).map((s) => s.name)
      });
    } catch (error) {
      rows.push({ fixture: id, error: String(error?.message ?? error) });
    }
  }

  const successful = rows.filter((row) => !row.error);
  const mean = (values) => values.length ? Math.round(values.reduce((a,b)=>a+b,0) / values.length) : null;
  const sorted = successful.map((row) => row.ms).sort((a,b)=>a-b);
  const p50 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.5)] : null;
  return res.status(200).json({
    config: key,
    label: config.label,
    model: config.model,
    fixtures: rows,
    summary: {
      successful: successful.length,
      failed: rows.length - successful.length,
      meanMs: mean(successful.map((row) => row.ms)),
      p50Ms: p50,
      meanInputTokens: mean(successful.map((row) => row.inputTokens ?? 0)),
      meanOutputTokens: mean(successful.map((row) => row.outputTokens ?? 0)),
      totalAccepted: successful.reduce((sum,row)=>sum+row.accepted,0),
      totalRejected: successful.reduce((sum,row)=>sum+row.rejected,0),
      totalRuleFailures: successful.reduce((sum,row)=>sum+row.ruleFailures.length,0),
      totalQualityFindings: successful.reduce((sum,row)=>sum+row.qualityFindings.length,0)
    }
  });
}
