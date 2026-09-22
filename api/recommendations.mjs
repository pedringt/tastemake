import { Buffer } from "node:buffer";
import { buildContext } from "../src/ai/context.js";
import * as baseline from "../src/ai/baseline.js";
import { acceptOrFallback, validatePicks } from "../src/ai/validate.js";

const MAX_BODY_BYTES = 160_000;
const MAX_OUTPUT_TOKENS = 1200;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_VISITOR_LIMIT = 6;
const DEFAULT_WINDOW_MS = 60_000;
const rateBuckets = globalThis.__tastemakeAiRateBuckets ??= new Map();

function parseBody(req) {
  const body = req.body;
  if (body && typeof body === "object") return body;
  if (typeof body === "string") return JSON.parse(body);
  return {};
}

function hydrateState(raw = {}) {
  return {
    ...raw,
    selectedFavorites: new Set(raw.selectedFavorites ?? []),
    libraryFavorites: new Set(raw.libraryFavorites ?? []),
    blindSpotDismissed: new Set(raw.blindSpotDismissed ?? []),
    feedbackByRecommendation: raw.feedbackByRecommendation ?? {},
    recommendationSets: Array.isArray(raw.recommendationSets) ? raw.recommendationSets : [],
    customItems: raw.customItems ?? {},
    blindSpots: raw.blindSpots ?? {},
    blindSpotDrafts: raw.blindSpotDrafts ?? {},
    patternStatements: raw.patternStatements ?? [],
    areas: raw.areas ?? {},
    curveball: raw.curveball !== false
  };
}

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"] ?? req.headers?.get?.("x-forwarded-for");
  return String(forwarded || "unknown").split(",")[0].trim();
}

function underBestEffortRateLimit(ip, now = Date.now()) {
  const limit = Number(process.env.TASTEMAKE_AI_VISITOR_LIMIT || DEFAULT_VISITOR_LIMIT);
  const windowMs = Number(process.env.TASTEMAKE_AI_RATE_WINDOW_MS || DEFAULT_WINDOW_MS);
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.started >= windowMs) {
    rateBuckets.set(ip, { started: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function liveConfig(env = process.env) {
  const reasons = [];
  if (env.TASTEMAKE_AI_ENABLED !== "1") reasons.push("off-switch");
  if (!env.ANTHROPIC_API_KEY) reasons.push("missing-key");
  if (!env.TASTEMAKE_AI_MODEL) reasons.push("missing-model");
  if (env.TASTEMAKE_AI_RATE_LIMIT_CONFIRMED !== "1") reasons.push("rate-limit-not-confirmed");
  if (env.TASTEMAKE_AI_SPEND_CAP_CONFIRMED !== "1") reasons.push("spend-cap-not-confirmed");
  return { enabled: reasons.length === 0, reasons, model: env.TASTEMAKE_AI_MODEL || null };
}

function buildPickPrompt(ctx, count) {
  const safeContext = {
    evidence: ctx.evidence,
    candidates: ctx.candidates.map(({ id, title, type, domains, about, hypotheses }) => ({ id, title, type, domains, about, hypotheses })),
    curveball: ctx.curveball,
    statements: ctx.statements,
    contexts: ctx.contexts
  };
  return [
    "You are the recommendation interpreter inside Tastemake.",
    "The product, not you, decides what is evidence, which candidates are eligible, and what state may change.",
    `Choose exactly ${count} items from candidates and return JSON only in this shape: {"picks":[{"itemId":"...","why":"...","cites":["ev:..."],"tests":null,"kind":"pick"}]}.`,
    "Rules: itemId must come from candidates; every why must cite at least one experienced evidence ref; interest/bookmarks/untried reactions are not taste evidence; tests must be null or one of that candidate's hypothesis ids; never use a tests pattern the user marked not-me; never contradict a user-confirmed pattern statement; never describe one global identity/aesthetic; never use circular reasons like 'matches your taste'; at most one curveball, and none when curveball is false; explain what the pick tests in specific plain English.",
    "Do not return markdown fences or commentary outside the JSON.",
    `CONTEXT\n${JSON.stringify(safeContext)}`
  ].join("\n\n");
}

function parseModelJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

async function callAnthropic({ prompt, env = process.env, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.TASTEMAKE_AI_TIMEOUT_MS || REQUEST_TIMEOUT_MS));
  try {
    const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.TASTEMAKE_AI_MODEL,
        max_tokens: Number(env.TASTEMAKE_AI_MAX_TOKENS || MAX_OUTPUT_TOKENS),
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
    const data = await response.json();
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no text block");
    return { json: parseModelJson(text), usage: data.usage ?? null, model: data.model ?? env.TASTEMAKE_AI_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

function clientPicks(validated) {
  return validated.map((pick) => ({
    ...pick.item,
    reason: pick.why,
    ai: { cites: pick.cites, tests: pick.tests, kind: pick.kind, contract: pick.contract }
  }));
}

function fallbackPayload(validatedBaseline, reason, meta = {}) {
  return {
    source: "deterministic",
    reason,
    picks: clientPicks(validatedBaseline.accepted),
    meta: { ...meta, paidCallMade: meta.paidCallMade ?? false }
  };
}

async function produceRecommendations({ rawState, env = process.env, fetchImpl = fetch } = {}) {
  const state = hydrateState(rawState);
  const ctx = buildContext(state);
  const deterministic = validatePicks(baseline.explainPicks(state, ctx), ctx);
  if (!deterministic.accepted.length) return fallbackPayload(deterministic, "no eligible deterministic picks remain");

  const config = liveConfig(env);
  if (!config.enabled) return fallbackPayload(deterministic, "live AI is not enabled");

  try {
    const model = await callAnthropic({ prompt: buildPickPrompt(ctx, deterministic.accepted.length), env, fetchImpl });
    const validated = validatePicks(model.json, ctx);
    const result = acceptOrFallback(validated, deterministic.accepted, { minAccepted: deterministic.accepted.length });
    if (result.source !== "model") {
      return fallbackPayload(deterministic, result.reason || "model output did not pass validation", {
        model: model.model,
        usage: model.usage,
        paidCallMade: true
      });
    }
    return {
      source: "model",
      reason: null,
      picks: clientPicks(result.items),
      meta: { model: model.model, usage: model.usage, rejected: result.rejected ?? 0, paidCallMade: true }
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "model request timed out" : "model unavailable";
    return fallbackPayload(deterministic, reason, { paidCallMade: true });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  if (typeof req.body === "string" && Buffer.byteLength(req.body, "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  if (!underBestEffortRateLimit(clientIp(req))) return res.status(429).json({ error: "too many requests" });

  try {
    const body = parseBody(req);
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
    if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });
    const payload = await produceRecommendations({ rawState: body.state });
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(payload);
  } catch {
    return res.status(400).json({ error: "invalid request" });
  }
}
