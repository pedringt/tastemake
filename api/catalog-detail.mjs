import { fetchItemDetail } from "../src/catalog/providers.mjs";
import { cachedValue } from "../src/server/cache.mjs";

// #103 item 1/2: on-demand per-media-type metadata (director/cast, creator/cast,
// developer/publisher/platforms), fetched only when a user expands a specific item so bulk
// search/recommendation retrieval never pays this latency cost. Missing fields come back as
// null/undefined and the client omits them rather than rendering an empty label.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }
  const provider = String(req.query?.provider ?? "");
  const providerId = String(req.query?.providerId ?? "");
  const type = String(req.query?.type ?? "");
  if (!provider || !providerId) return res.status(400).json({ error: "provider and providerId are required" });

  try {
    const cacheKey = `catalog-detail:v1:${provider}:${type}:${providerId}`;
    const detail = await cachedValue(cacheKey, () => fetchItemDetail({ provider, providerId, type }), { ttl: 3600, tags: ["catalog-detail"] });
    res.setHeader("cache-control", "public, max-age=300, stale-while-revalidate=3600");
    return res.status(200).json({ detail });
  } catch {
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ detail: {} });
  }
}
