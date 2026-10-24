import { fetchAndPersistItemDetail, watchForRegion } from "../src/catalog/providers.mjs";
import { cachedValue } from "../src/server/cache.mjs";
import { requestQuery } from "../src/server/query.mjs";

// #103 item 1/2: on-demand per-media-type metadata (director/cast/runtime, creator/cast/years,
// book description/page count, developer/publisher/platforms), fetched only when a user expands a specific item so bulk
// search/recommendation retrieval never pays this latency cost. Missing fields come back as
// null/undefined and the client omits them rather than rendering an empty label.
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

  try {
    const cacheKey = `catalog-detail:v4:${provider}:${type}:${providerId}`;
    const cached = await cachedValue(cacheKey, () => fetchAndPersistItemDetail({ provider, providerId, type }), { ttl: 3600, tags: ["catalog-detail"] });
    // #10: every country's watch providers are cached together; only the viewer's country is sent.
    const { watch, ...detail } = cached ?? {};
    if (watch) detail.whereToWatch = watchForRegion(watch, params.region);
    res.setHeader("cache-control", "public, max-age=300, stale-while-revalidate=3600");
    return res.status(200).json({ detail });
  } catch {
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ detail: {} });
  }
}
