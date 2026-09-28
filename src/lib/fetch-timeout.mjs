// #120: TMDb/Open Library/IGDB calls had no timeout at all, unlike the Anthropic call (which has
// had one since early on). Real production logs showed a single Open Library subject-search call
// taking 10.7s -- candidateRetrieval, previously "never the bottleneck" at under 2s, spiked to
// 10-14s because of exactly this. Every caller here already has an outer try/catch that treats a
// thrown/aborted fetch as "no results from this provider" and degrades gracefully (retrieveCatalogCandidates'
// per-anchor try/catch in related.mjs, searchCatalog's per-provider try/catch in providers.mjs), so
// adding AbortController here needed no new error handling -- a timeout is just another kind of
// network failure those paths already treat as normal.
const DEFAULT_TIMEOUT_MS = 8000;

export function fetchWithTimeout(fetchImpl, url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}
