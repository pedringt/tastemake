import { searchCatalog } from "../src/catalog/providers.mjs";
import { cachedValue } from "../src/server/cache.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }
  const query = String(req.query?.q ?? "").trim();
  const domain = ["all", "watch", "read", "play"].includes(req.query?.domain) ? req.query.domain : "all";
  if (query.length < 2) return res.status(200).json({ items: [], providers: {} });
  try {
    const started = Date.now();
    const cacheKey = `catalog:v2:${domain}:${query.toLowerCase()}`;
    const payload = await cachedValue(cacheKey, () => searchCatalog(query, { domain }), { ttl: 300, tags: ["catalog-search"] });
    console.info("[tastemake-catalog]", JSON.stringify({ domain, ms: Date.now() - started, results: payload.items?.length ?? 0 }));
    res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch {
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ items: [], providers: {}, degraded: true });
  }
}
