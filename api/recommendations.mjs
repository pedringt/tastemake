import { Buffer } from "node:buffer";
import { buildContext } from "../src/ai/context.js";
import { acceptOrFallback, validatePicks } from "../src/ai/validate.js";
import { retrieveCatalogCandidates } from "../src/catalog/related.mjs";

const MAX_BODY_BYTES = 160_000;
const MAX_OUTPUT_TOKENS = 2000;   // the cap has to cover any thinking tokens as well as the JSON itself
const REQUEST_TIMEOUT_MS = 25_000;   // 12s was tripping on every real call; the function allows 30s
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

export function liveConfig(env = process.env) {
  const reasons = [];
  if (env.TASTEMAKE_AI_ENABLED !== "1") reasons.push("off-switch");
  if (!env.ANTHROPIC_API_KEY) reasons.push("missing-key");
  if (!env.TASTEMAKE_AI_MODEL) reasons.push("missing-model");
  if (env.TASTEMAKE_AI_RATE_LIMIT_CONFIRMED !== "1") reasons.push("rate-limit-not-confirmed");
  if (env.TASTEMAKE_AI_SPEND_CAP_CONFIRMED !== "1") reasons.push("spend-cap-not-confirmed");
  // Main auto-deploys publicly. A production deployment needs its own explicit gate so merely
  // having the API key and test flags present cannot turn on paid calls for public traffic.
  if (env.VERCEL_ENV === "production" && env.TASTEMAKE_AI_PRODUCTION_APPROVED !== "1") reasons.push("production-live-not-approved");
  return { enabled: reasons.length === 0, reasons, model: env.TASTEMAKE_AI_MODEL || null };
}

export function buildPickPrompt(ctx, count) {
  const safeContext = {
    evidence: ctx.evidence,
    candidates: ctx.candidates.map(({ id, title, type, domains, about, hypotheses, provider, providerId, year, genres }) => ({ id, title, type, domains, about, hypotheses, provider, providerId, year, genres })),
    curveball: ctx.curveball,
    statements: ctx.statements,
    contexts: ctx.contexts
  };
  return [
    "You are the recommendation interpreter inside Tastemake.",
    "The product, not you, decides what is evidence, which candidates are eligible, and what state may change.",
    `Choose exactly ${count} items from candidates and return JSON only in this shape: {"picks":[{"itemId":"...","why":"...","cites":["ev:..."],"tests":null,"kind":"pick"}]}.`,
    "Rules: itemId must come from candidates; every why must cite at least one experienced evidence ref; interest/bookmarks/untried reactions are not taste evidence; tests must be null or one of that candidate's hypothesis ids; never use a tests pattern the user marked not-me; never contradict a user-confirmed pattern statement; never describe one global identity/aesthetic; never use circular reasons like 'matches your taste'; at most one curveball, and none when curveball is false; explain what the pick tests in specific plain English; call a pick a curveball, in kind or in why, only for that one exploratory pick, and set kind to \"curveball\" whenever why calls it one — every other pick keeps kind \"pick\" and its why should not describe itself as a curveball.",
    "Respond with the JSON object only — the very first character of your reply must be { and the very last must be }. No markdown fences, no preamble like \"Looking at...\", no commentary before or after the JSON.",
    `CONTEXT\n${JSON.stringify(safeContext)}`
  ].join("\n\n");
}

// #28: about 60% of live calls were falling back to deterministic not because the model's answer was
// bad, but because it prefixed the JSON with prose ("Looking at your evidence...") despite the prompt's
// instruction, and this only stripped markdown fences. Tightened the prompt above; this also extracts
// the first {...} object as a fallback, so a model that still adds stray text isn't discarded outright.
function parseModelJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw error;
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

export async function callAnthropic({ prompt, env = process.env, fetchImpl = fetch }) {
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
        // This is a short, strict JSON job. With thinking on by default, the model spent the whole budget
        // thinking and returned no text at all (stop_reason=max_tokens, blocks=thinking).
        // Set TASTEMAKE_AI_THINKING=enabled to turn it back on, with a much larger cap.
        ...(env.TASTEMAKE_AI_THINKING === "enabled" ? {} : { thinking: { type: "disabled" } }),
        max_tokens: Number(env.TASTEMAKE_AI_MAX_TOKENS || MAX_OUTPUT_TOKENS),
        // No `temperature`: newer models reject it ("temperature is deprecated for this model"), which
        // failed every live call with 400 invalid_request_error. Runs are therefore not bit-identical;
        // eval comparisons allow for that (docs/ai-evals.md).
        messages: [{ role: "user", content: prompt }]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      // Surface why, without ever echoing the key or the full body: status plus Anthropic's own error type.
      let type = "unknown";
      let detail = "";
      try { const body = await response.json(); type = body?.error?.type ?? "unknown"; detail = body?.error?.message ?? ""; } catch { /* body was not JSON */ }
      const err = new Error(`Anthropic returned ${response.status} (${type})`);
      err.status = response.status;
      err.anthropicType = type;
      err.anthropicDetail = detail;
      throw err;
    }
    const data = await response.json();
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      // Seen when the cap is spent before any text is produced: content holds no text block.
      const err = new Error(`Anthropic returned no text block (stop_reason ${data.stop_reason ?? "?"}, blocks: ${(data.content ?? []).map((b) => b.type).join(",") || "none"})`);
      err.anthropicType = "no-text-block";
      err.anthropicDetail = `stop_reason=${data.stop_reason ?? "?"} blocks=${(data.content ?? []).map((b) => b.type).join(",") || "none"} out_tokens=${data.usage?.output_tokens ?? "?"}`;
      throw err;
    }
    return { json: parseModelJson(text), usage: data.usage ?? null, model: data.model ?? env.TASTEMAKE_AI_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

function clientPicks(validated) {
  return validated.map((pick, index) => ({
    ...pick.item,
    rank: pick.kind === "curveball" ? null : index + 1,
    fit: pick.kind === "curveball" ? "Exploratory fit" : "Promising fit",
    prediction: "Worth testing",
    surprise: pick.kind === "curveball",
    reason: pick.why,
    ai: { cites: pick.cites, tests: pick.tests, kind: pick.kind, contract: pick.contract }
  }));
}

// When live AI is unavailable or its output fails validation, fall back to the same real catalog
// candidates. There is no hand-written recommendation inventory in the product.
function catalogPicks(candidates, state) {
  const chosen = candidates.slice(0, 5);
  return chosen.map((item, index) => {
    const curveball = state.curveball !== false && chosen.length >= 5 && index === chosen.length - 1;
    const basis = item.relatedTo ? `Related in the catalog to ${item.relatedTo}.` : "Related to things you told Tastemake you love.";
    return {
      ...item,
      rank: curveball ? null : index + 1,
      fit: curveball ? "Exploratory fit" : "Catalog match",
      prediction: "Worth testing",
      surprise: curveball,
      reason: `${basis} Live AI did not rank this fallback set.`,
      ai: null
    };
  });
}

function fallbackPayload(candidates, state, reason, meta = {}) {
  return {
    source: "catalog",
    reason,
    picks: catalogPicks(candidates, state),
    meta: { ...meta, paidCallMade: meta.paidCallMade ?? false }
  };
}

export async function produceRecommendations({ rawState, env = process.env, fetchImpl = fetch } = {}) {
  const state = hydrateState(rawState);
  const retrieved = await retrieveCatalogCandidates(state, { env, fetchImpl });
  const ctx = buildContext(state, retrieved);
  const candidates = ctx.candidates.slice(0, 5);
  if (!candidates.length) {
    return { source: "catalog", reason: "no eligible catalog picks remain", picks: [], meta: { paidCallMade: false, exhausted: true, catalogCandidates: retrieved.length } };
  }

  const config = liveConfig(env);
  if (!config.enabled) return fallbackPayload(candidates, state, "live AI is not enabled", { catalogCandidates: retrieved.length });

  try {
    const model = await callAnthropic({ prompt: buildPickPrompt(ctx, candidates.length), env, fetchImpl });
    const validated = validatePicks(model.json, ctx);
    const result = acceptOrFallback(validated, candidates, { minAccepted: candidates.length });
    if (result.source !== "model") {
      return fallbackPayload(candidates, state, result.reason || "model output did not pass validation", {
        model: model.model,
        usage: model.usage,
        paidCallMade: true,
        catalogCandidates: retrieved.length
      });
    }
    return {
      source: "model",
      reason: null,
      picks: clientPicks(result.items),
      meta: { model: model.model, usage: model.usage, rejected: result.rejected ?? 0, paidCallMade: true, catalogCandidates: retrieved.length }
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    const reason = timedOut ? "model request timed out" : "model unavailable";
    console.error("[tastemake-ai]", reason, error?.status ?? "", error?.anthropicType ?? "", error?.anthropicDetail ?? error?.message ?? "");
    return fallbackPayload(candidates, state, reason, {
      paidCallMade: !timedOut && !error?.status,
      errorStatus: error?.status ?? null,
      errorType: error?.anthropicType ?? (timedOut ? "timeout" : "transport"),
      catalogCandidates: retrieved.length
    });
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
