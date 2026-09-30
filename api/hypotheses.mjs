import { Buffer } from "node:buffer";
import { buildContext } from "../src/ai/context.js";
import { normalizeHypothesisResponse, validateHypotheses } from "../src/ai/validate.js";
import { aiOutcomeForError, recordAiCallInBackground } from "../src/server/ai-metrics.mjs";
import { callAnthropic, hydrateState as hydrateBaseState, liveConfig } from "./recommendations.mjs";
import { visibleDomains } from "../src/data/domains.js";

const MAX_BODY_BYTES = 160_000;
const PROFILE_MAX_OUTPUT_TOKENS = 3200;

// QA sweep real bug (fixed here): this used to be a second, hand-maintained copy of
// recommendations.mjs's hydrateState -- it had already drifted (missing blindSpots,
// blindSpotDrafts, recommendationFilter). Sharing the base function means the two endpoints can
// never drift again; modelHypotheses is the one field genuinely unique to this endpoint.
function hydrateState(raw = {}) {
  return { ...hydrateBaseState(raw), modelHypotheses: raw.modelHypotheses ?? [] };
}

export function hypothesisConfig(env = process.env) {
  const base = liveConfig(env);
  const reasons = [...base.reasons];
  if (env.TASTEMAKE_AI_HYPOTHESES_ENABLED !== "1") reasons.push("hypotheses-off-switch");
  return { enabled: reasons.length === 0, reasons, model: base.model };
}

export function buildHypothesisPrompt(ctx, existing = []) {
  const allowedDomains = visibleDomains().map((domain) => domain.id);
  const safe = {
    evidence: (ctx.evidence ?? []).filter((row) => row?.class === "experienced").map(({ ref, title, type, domains, kind, polarity, weight, facts }) => ({ ref, title, type, domains, kind, polarity, weight, facts })),
    statements: ctx.statements,
    contexts: ctx.contexts,
    existing: existing.map(({ id, title, claim, domains, strength }) => ({ id, label: title, claim, domains, level: strength }))
  };
  return [
    "You are the taste-interpretation layer inside Tastemake.",
    "Software owns evidence and state. You may only propose working hypotheses from the experienced evidence supplied below.",
    "Return JSON only: {\"hypotheses\":[{\"id\":\"ai-stable-id\",\"label\":\"...\",\"claim\":\"...\",\"evidence\":[\"ev:...\"],\"counter\":[],\"domains\":[\"movies\"],\"crossDomain\":\"untested\",\"level\":\"emerging\",\"conditional\":false,\"context\":null}],\"insufficientEvidence\":false}.",
    `domains may contain only these exact product ids: ${allowedDomains.join(", ")}. Never use umbrella labels such as "watch"; movies and TV are separate domains. Every claimed domain must appear on at least one cited supporting evidence row.`,
    "level must be exactly one of: emerging, supported, strong. Never use established, confident, high, or any other synonym. When unsure, choose the lower allowed level.",
    "crossDomain must be exactly one of: untested, tentative, supported. Use \"untested\" unless the cited evidence itself spans two or more domains — there is no \"none\" value.",
    "Use 4 to 6 concise hypotheses when the evidence supports that many. Prefer distinct, well-grounded patterns over repeating the same idea. Reuse an existing ai-* id when revising the same underlying idea; create a new ai-* id only for a genuinely new pattern.",
    "Every supporting/counter reference must exist. Intent, saved items, browsing and untried reactions are not taste evidence. User-confirmed corrections outrank inference. A says=not-me statement rejects that pattern; says=partial means do not broaden it beyond the user's context/domain refinements; says=unsure is not confirmation. Do not assign one global aesthetic or identity. Do not claim a domain without cited support in that domain. Prefer specific testable patterns over genres.",
    "Each evidence row may include facts. If facts.resolved is false, do not supply missing genres, themes, creator, series, or other properties from model memory; use only the title/type/reaction that the product actually knows. Specific claims should lean on resolved factual metadata or multiple independent evidence rows.",
    "The first character must be { and the last must be }. No markdown or prose outside JSON.",
    `CONTEXT\n${JSON.stringify(safe)}`
  ].join("\n\n");
}

function rejectionCategory(reason) {
  const text = String(reason || "").toLowerCase();
  if (text.includes("level") && text.includes("not one of")) return "invalid_level";
  if (text.includes("claims domains with no cited support")) return "unsupported_domain";
  if (text.includes("cross-domain overreach")) return "cross_domain_overreach";
  if (text.includes("cites evidence that does not exist")) return "missing_evidence";
  if (text.includes("no supporting evidence")) return "no_support";
  if (text.includes("uses intent")) return "intent_as_evidence";
  if (text.includes("disliked as support")) return "negative_as_support";
  if (text.includes("counter-evidence")) return "invalid_counter";
  if (text.includes("single identity or aesthetic")) return "identity_claim";
  if (text.includes("genre-only") || text.includes("too generic")) return "generic_claim";
  if (text.includes("invents a context")) return "invented_context";
  if (text.includes("user said this pattern is not them")) return "contradicts_user";
  if (text.includes("duplicate")) return "duplicate";
  if (text.includes("domains") && text.includes("not a list")) return "invalid_domains_shape";
  if (text.includes("crossdomain")) return "invalid_cross_domain";
  if (text.includes("evidence refs")) return "invalid_evidence_shape";
  return "other";
}

function rejectionCategoryCounts(rejected = []) {
  const counts = {};
  for (const entry of rejected) {
    for (const reason of entry.reasons ?? []) {
      const key = rejectionCategory(reason);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

export async function produceHypotheses({ rawState, env = process.env, fetchImpl = fetch } = {}) {
  const state = hydrateState(rawState);
  const ctx = buildContext(state);
  const config = hypothesisConfig(env);
  if (!config.enabled) {
    // #86: this gate was failing silently in production with no way to tell which of the six
    // required env vars was missing. Every other return path below already gets logged one way
    // or another (accepted, or the handler's catch block); this was the one silent gap.
    console.error("[tastemake-profile-ai]", "config disabled", config.reasons.join(","));
    return { source: "unavailable", reason: "live profile AI is not enabled", hypotheses: [], meta: { paidCallMade: false } };
  }

  let started = Date.now();
  try {
    const model = await callAnthropic({ prompt: buildHypothesisPrompt(ctx, state.modelHypotheses), env, fetchImpl, maxTokens: PROFILE_MAX_OUTPUT_TOKENS });
    const durationMs = Math.max(1, Date.now() - started);
    const baseMetric = {
      operation: "taste_profile",
      model: model.model,
      durationMs,
      inputTokens: model.usage?.input_tokens ?? null,
      outputTokens: model.usage?.output_tokens ?? null,
      cacheReadTokens: model.usage?.cache_read_input_tokens ?? null
    };
    const normalizedResponse = normalizeHypothesisResponse(model.json, ctx);
    const validated = validateHypotheses(normalizedResponse, ctx);
    const rejectionCategories = rejectionCategoryCounts(validated.rejected);
    if (validated.rejected.length) {
      console.info("[tastemake-profile-validation]", JSON.stringify({
        proposedCount: Array.isArray(normalizedResponse?.hypotheses) ? normalizedResponse.hypotheses.length : 0,
        acceptedCount: validated.accepted.length,
        rejectedCount: validated.rejected.length,
        rejectionCategories
      }));
    }
    if (!validated.accepted.length) {
      // #86: a rejected/insufficient-evidence response returns 200 (it's a normal outcome, not an
      // error), so nothing surfaced why the profile stayed empty. Log the real reason set so a blank
      // Profile can be told apart from "not enough evidence yet" without guessing.
      console.log("[tastemake-profile-ai]", "no hypotheses accepted", JSON.stringify({
        fallback: validated.fallback ?? false,
        proposedCount: Array.isArray(normalizedResponse?.hypotheses) ? normalizedResponse.hypotheses.length : 0,
        rejectedCount: validated.rejected?.length ?? 0,
        notes: validated.notes ?? [],
        rejectedReasons: (validated.rejected ?? []).flatMap((r) => r.reasons ?? [])
      }));
      recordAiCallInBackground({ ...baseMetric, outcome: "validation_fallback" }, { env });
      return { source: "unavailable", reason: validated.notes?.[0] || "model hypotheses did not pass validation", hypotheses: [], meta: { paidCallMade: true, model: model.model, usage: model.usage } };
    }
    recordAiCallInBackground({ ...baseMetric, outcome: "success" }, { env });
    return {
      source: "model",
      reason: null,
      hypotheses: validated.accepted,
      meta: { paidCallMade: true, model: model.model, usage: model.usage, rejected: validated.rejected.length, rejectionCategories, notes: validated.notes }
    };
  } catch (error) {
    recordAiCallInBackground({
      operation: "taste_profile",
      outcome: aiOutcomeForError(error),
      model: error?.model ?? config.model,
      durationMs: Math.max(1, Date.now() - started),
      inputTokens: error?.usage?.input_tokens ?? null,
      outputTokens: error?.usage?.output_tokens ?? null,
      cacheReadTokens: error?.usage?.cache_read_input_tokens ?? null
    }, { env });
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  // QA sweep real bug: unlike api/recommendations.mjs (hardened after a real production 413
  // incident), this endpoint measured size only after fully parsing the body into memory. A
  // content-length check up front rejects an oversized request before it's buffered/parsed at all,
  // same as the sibling endpoint.
  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
    if (!body.state || typeof body.state !== "object") return res.status(400).json({ error: "state is required" });
    const started = Date.now();
    const payload = await produceHypotheses({ rawState: body.state });
    console.info("[tastemake-profile]", JSON.stringify({
      ms: Date.now() - started,
      source: payload.source,
      hypotheses: payload.hypotheses?.length ?? 0,
      paidCallMade: Boolean(payload.meta?.paidCallMade),
      rejected: payload.meta?.rejected ?? null,
      notes: payload.meta?.notes?.slice?.(0, 2) ?? []
    }));
    res.setHeader("cache-control", "no-store");
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[tastemake-profile-ai]", error?.status ?? "", error?.anthropicType ?? "", error?.message ?? "");
    return res.status(200).json({
      source: "unavailable",
      reason: "live profile AI unavailable",
      hypotheses: [],
      meta: {
        paidCallMade: Boolean(error?.paidCallMade),
        model: error?.model ?? null,
        usage: error?.usage ?? null
      }
    });
  }
}
