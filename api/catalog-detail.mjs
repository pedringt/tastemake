import { fetchAndPersistItemDetail, hasDetailFacts, watchForRegion } from "../src/catalog/providers.mjs";
import { cachedValue } from "../src/server/cache.mjs";
import { requestQuery } from "../src/server/query.mjs";

// #103 item 1/2: on-demand per-media-type metadata (director/cast/runtime, creator/cast/years,
// book description/page count, developer/publisher/platforms), fetched only when a user expands a specific item so bulk
// search/recommendation retrieval never pays this latency cost. Missing fields come back as
// null/undefined and the client omits them rather than rendering an empty label.
const PROVIDERS = new Set(["tmdb", "openlibrary", "igdb"]);
const TYPES = new Set(["movie", "tv", "book", "game"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }
  const params = requestQuery(req);
  const provider = String(params.provider ?? "");
  const providerId = String(params.providerId ?? "");
  const type = String(params.type ?? "");
  if (!provider || !providerId) return res.status(400).json({ error: "provider and providerId are required" });
  if (!PROVIDERS.has(provider)) return res.status(400).json({ error: "unknown provider" });
  if (!TYPES.has(type)) return res.status(400).json({ error: "type must be movie, tv, book or game" });

  try {
    // Oct 24: an empty answer (the provider failed) is never cached here or at the edge, so the next look
    // tries again. v5 clears empty answers the old version kept.
    const cacheKey = `catalog-detail:v5:${provider}:${type}:${providerId}`;
    let cached;
    try {
      cached = await cachedValue(cacheKey, async () => {
        const result = await fetchAndPersistItemDetail({ provider, providerId, type });
        if (!hasDetailFacts(result)) throw Object.assign(new Error("not cacheable"), { partial: result ?? {} });
        return result;
      }, { ttl: 3600, tags: ["catalog-detail"] });
    } catch (error) {
      if (!error?.partial) throw error;
      cached = error.partial;
    }
    // #10: every country's watch providers are cached together; only the viewer's country is sent.
    const { watch, ...detail } = cached ?? {};
    if (watch) detail.whereToWatch = watchForRegion(watch, params.region);
    res.setHeader("cache-control", hasDetailFacts(cached) ? "public, max-age=300, stale-while-revalidate=3600" : "no-store");
    return res.status(200).json({ detail });
  } catch {
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ detail: {} });
  }
}
