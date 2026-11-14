// Best-effort per-visitor limit for the endpoints that can make a paid model call. In memory on each
// function instance, so it slows a burst from one visitor; the Anthropic workspace spend limit is still
// the hard backstop. Moved here from api/recommendations.mjs for #349 so /api/hypotheses shares it.
// Callers pass a key with their own prefix ("warm:", "profile:") so each kind of request has its own
// allowance and one never uses up another's.
const DEFAULT_VISITOR_LIMIT = 6;
const DEFAULT_WINDOW_MS = 60_000;
const rateBuckets = globalThis.__tastemakeAiRateBuckets ??= new Map();

export function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"] ?? req.headers?.get?.("x-forwarded-for");
  return String(forwarded || "unknown").split(",")[0].trim();
}

export function underBestEffortRateLimit(key, now = Date.now()) {
  const limit = Number(process.env.TASTEMAKE_AI_VISITOR_LIMIT || DEFAULT_VISITOR_LIMIT);
  const windowMs = Number(process.env.TASTEMAKE_AI_RATE_WINDOW_MS || DEFAULT_WINDOW_MS);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.started >= windowMs) {
    rateBuckets.set(key, { started: now, count: 1 });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
