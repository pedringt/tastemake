// Shared Anthropic plumbing for the live endpoints (api/recommendations.mjs, api/hypotheses.mjs) and
// the eval runner (scripts/evals/run.mjs): the fail-closed live gate, the Messages API transport,
// the thinking-mode mapping and the model-JSON parser. Moved out of api/recommendations.mjs in #220
// so neither Vercel handler imports from the other; the code itself is unchanged.

const MAX_OUTPUT_TOKENS = 1000;   // compact recommendation JSON should stay well below this; cap runaway generation
const REQUEST_TIMEOUT_MS = 25_000;   // 12s was tripping on every real call; the function allows 30s

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

// #28: about 60% of live calls were falling back to deterministic not because the model's answer was
// bad, but because it prefixed the JSON with prose ("Looking at your evidence...") despite the prompt's
// instruction, and this only stripped markdown fences. Tightened the prompt above; this also extracts
// the first {...} object as a fallback, so a model that still adds stray text isn't discarded outright.
function repairMissingArrayCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    out += ch;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch); continue; }
    if (ch !== "}" && ch !== "]") continue;
    stack.pop();
    if (stack[stack.length - 1] !== "[") continue;
    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (text[j] === "{" || text[j] === "[") out += ",";
  }
  return out;
}

// #228: Sonnet 5.5 once answered with text after the JSON ("Unexpected non-whitespace character
// after JSON"). Slicing from the first "{" to the LAST "}" fails whenever that trailing text has a
// brace of its own, or a second object follows. This walks the text (string-aware) and returns the
// first complete top-level object, so trailing prose is ignored rather than failing the paid call.
export function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseModelJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  const candidates = [cleaned];
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart && (objectStart > 0 || objectEnd < cleaned.length - 1)) {
    candidates.push(cleaned.slice(objectStart, objectEnd + 1));
  }
  const balanced = firstJsonObject(cleaned);
  if (balanced && !candidates.includes(balanced)) candidates.push(balanced);

  let firstError = null;
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch (error) {
      firstError ??= error;
      const repaired = repairMissingArrayCommas(candidate);
      if (repaired !== candidate) {
        try { return JSON.parse(repaired); } catch { /* keep the original parse failure */ }
      }
    }
  }
  throw firstError ?? new SyntaxError("model response was not JSON");
}

// "between_tools" is Sonnet 5.5's way to turn off up-front thinking and only exists there; every
// other model (Haiku 5.5 included) rejects it with 400 invalid_request_error and takes "disabled"
// instead (platform.claude.com effort docs, checked 2026-10-10).
// The reverse also holds: Sonnet 5.5 rejects "disabled" (the Oct 10 ai-eval run's taste-profile
// calls on Sonnet 5.5 all returned 400), so it always gets "between_tools" when thinking is off.
// Opus 5.5 (Oct 16, eval comparison only) can't turn thinking off at any effort and rejects both
// values, so it returns null: callAnthropic then omits `thinking`, sets effort "low" and adds
// OPUS_THINKING_HEADROOM to max_tokens so thinking can't use up the JSON's budget.
export function thinkingTypeFor(model, requested) {
  const value = String(model || "");
  const sonnet55 = /^claude-sonnet-5-5(?:-|$)/.test(value);
  const opus55 = /^claude-opus-5-5(?:-|$)/.test(value);
  const off = !requested || requested === "disabled" || requested === "between_tools";
  if (off) return opus55 ? null : sonnet55 ? "between_tools" : "disabled";
  return requested;
}

const OPUS_THINKING_HEADROOM = 8000;

export async function callAnthropic({ prompt, env = process.env, fetchImpl = fetch, maxTokens = null, model = null, effort = null, thinkingMode = null }) {
  const resolvedModel = model || env.TASTEMAKE_AI_MODEL;
  const thinkingType = env.TASTEMAKE_AI_THINKING === "enabled" ? null : thinkingTypeFor(resolvedModel, thinkingMode);
  const alwaysThinks = env.TASTEMAKE_AI_THINKING !== "enabled" && thinkingType === null;
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
        model: resolvedModel,
        // This is a short, strict JSON job. With thinking on by default, the model spent the whole budget
        // thinking and returned no text at all (stop_reason=max_tokens, blocks=thinking).
        // Set TASTEMAKE_AI_THINKING=enabled to turn it back on, with a much larger cap.
        ...(thinkingType ? { thinking: { type: thinkingType } } : {}),
        ...(alwaysThinks ? { output_config: { effort: "low" } } : effort ? { output_config: { effort } } : {}),
        max_tokens: Number(maxTokens ?? env.TASTEMAKE_AI_MAX_TOKENS ?? MAX_OUTPUT_TOKENS) + (alwaysThinks ? OPUS_THINKING_HEADROOM : 0),
        // No `temperature`: newer models reject it ("temperature is deprecated for this model"), which
        // failed every live call with 400 invalid_request_error. Runs are therefore not bit-identical;
        // eval comparisons allow for that (docs/ai-evals.md).
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
    let data;
    try {
      data = await response.json();
    } catch (err) {
      err.paidCallMade = true;
      err.model = resolvedModel;
      err.anthropicType = "malformed-response";
      throw err;
    }
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      // Seen when the cap is spent before any text is produced: content holds no text block.
      const err = new Error(`Anthropic returned no text block (stop_reason ${data.stop_reason ?? "?"}, blocks: ${(data.content ?? []).map((b) => b.type).join(",") || "none"})`);
      err.anthropicType = "no-text-block";
      err.anthropicDetail = `stop_reason=${data.stop_reason ?? "?"} blocks=${(data.content ?? []).map((b) => b.type).join(",") || "none"} out_tokens=${data.usage?.output_tokens ?? "?"}`;
      err.paidCallMade = true;
      err.model = data.model ?? resolvedModel;
      err.usage = data.usage ?? null;
      throw err;
    }
    try {
      return { json: parseModelJson(text), usage: data.usage ?? null, model: data.model ?? resolvedModel };
    } catch (err) {
      // The provider already returned a successful model response, so this was a paid call even if
      // Tastemake cannot parse the model's text into valid JSON.
      err.paidCallMade = true;
      err.model = data.model ?? resolvedModel;
      err.usage = data.usage ?? null;
      err.anthropicType = "malformed-response";
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}
