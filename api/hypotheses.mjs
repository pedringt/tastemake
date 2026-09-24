import { Buffer } from "node:buffer";
import { buildContext } from "../src/ai/context.js";
import { validateHypotheses } from "../src/ai/validate.js";
import { callAnthropic, liveConfig } from "./recommendations.mjs";

const MAX_BODY_BYTES = 160_000;

function hydrateState(raw = {}) {
  return {
    ...raw,
    selectedFavorites: new Set(raw.selectedFavorites ?? []),
    libraryFavorites: new Set(raw.libraryFavorites ?? []),
    blindSpotDismissed: new Set(raw.blindSpotDismissed ?? []),
    feedbackByRecommendation: raw.feedbackByRecommendation ?? {},
    recommendationSets: Array.isArray(raw.recommendationSets) ? raw.recommendationSets : [],
    customItems: raw.customItems ?? {},
    patternStatements: raw.patternStatements ?? [],
    modelHypotheses: raw.modelHypotheses ?? [],
    areas: raw.areas ?? {},
    curveball: raw.curveball !== false
  };
}

export function hypothesisConfig(env = process.env) {
  const base = liveConfig(env);
  const reasons = [...base.reasons];
  if (env.TASTEMAKE_AI_HYPOTHESES_ENABLED !== "1") reasons.push("hypotheses-off-switch");
  return { enabled: reasons.length === 0, reasons, model: base.model };
}

export function buildHypothesisPrompt(ctx, existing = []) {
  const safe = {
    evidence: ctx.evidence,
    statements: ctx.statements,
    contexts: ctx.contexts,
    existing: existing.map(({ id, title, claim, domains, strength }) => ({ id, label: title, claim, domains, level: strength }))
  };
  return [
    "You are the taste-interpretation layer inside Tastemake.",
    "Software owns evidence and state. You may only propose working hypotheses from the experienced evidence supplied below.",
    "Return JSON only: {\"hypotheses\":[{\"id\":\"ai-stable-id\",\"label\":\"...\",\"claim\":\"...\",\"evidence\":[\"ev:...\"],\"counter\":[],\"domains\":[\"watch\"],\"crossDomain\":\"none\",\"level\":\"emerging\",\"conditional\":false,\"context\":null}],\"insufficientEvidence\":false}.",
    "Use 3 to 6 hypotheses when evidence supports them. Reuse an existing ai-* id when revising the same underlying idea; create a new ai-* id only for a genuinely new pattern.",
    "Every supporting/counter reference must exist. Intent, saved items, browsing and untried reactions are not taste evidence. User-confirmed corrections outrank inference. Do not assign one global aesthetic or identity. Do not claim a domain without cited support in that domain. Prefer specific testable patterns over genres.",
    "The first character must be { and the last must be }. No markdown or prose outside JSON.",
    `CONTEXT\n${JSON.stringify(safe)}`
  ].join("\n\n");
}

export async function produceHypotheses({ rawState, env = process.env, fetchImpl = fetch } = {}) {
  const state = hydrateState(rawState);
  const ctx = buildContext(state);
  const config = hypothesisConfig(env);
  if (!config.enabled) return { source: "deterministic", reason: "live profile AI is not enabled", hypotheses: [], meta: { paidCallMade: false } };

  const model = await callAnthropic({ prompt: buildHypothesisPrompt(ctx, state.modelHypotheses), env, fetchImpl });
  const validated = validateHypotheses(model.json, ctx);
  if (!validated.accepted.length) {
    return { source: "deterministic", reason: validated.notes?.[0] || "model hypotheses did not pass validation", hypotheses: [], meta: { paidCallMade: true, model: model.model, usage: model.usage } };
  }
  return {
    source: "model",
    reason: null,
    hypotheses: validated.accepted,
    meta: { paidCallMade: true, model: model.model, usage: model.usage, rejected: validated.rejected.length, notes: validated.notes }
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
    if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });
    const payload = await produceHypotheses({ rawState: body.state });
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[tastemake-profile-ai]", error?.status ?? "", error?.anthropicType ?? "", error?.message ?? "");
    return res.status(200).json({ source: "deterministic", reason: "live profile AI unavailable", hypotheses: [], meta: { paidCallMade: false } });
  }
}
