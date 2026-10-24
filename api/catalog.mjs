import { searchCatalog } from "../src/catalog/providers.mjs";
import { cachedValue } from "../src/server/cache.mjs";
import { requestQuery } from "../src/server/query.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }
  const params = requestQuery(req);
  const query = String(params.q ?? "").trim();
  const domain = ["all", "movies", "tv", "read", "play"].includes(params.domain) ? params.domain : "all";
  // Search speed (Oct 24): Open Library takes 2-10 s while TMDb and IGDB answer in under 1 s. The client
  // asks for "All" twice, once with skip=read, and shows those results while books are still coming.
  const skipBooks = params.skip === "read";
  if (query.length < 2) return res.status(200).json({ items: [], providers: {} });
  try {
    const started = Date.now();
    const cacheKey = `catalog:v3:${domain}${skipBooks ? ":skip-read" : ""}:${query.toLowerCase()}`;
    const payload = await cachedValue(cacheKey, () => searchCatalog(query, { domain, skipBooks }), { ttl: 300, tags: ["catalog-search"] });
    console.info("[tastemake-catalog]", JSON.stringify({ domain, skipBooks, ms: Date.now() - started, results: payload.items?.length ?? 0 }));
    res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch {
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ items: [], providers: {}, degraded: true });
  }
}
