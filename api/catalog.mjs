import { searchCatalog } from "../src/catalog/providers.mjs";
import { cachedValue } from "../src/server/cache.mjs";
import { requestQuery } from "../src/server/query.mjs";

export const booksFailed = (payload) => payload?.providers?.openlibrary?.configured === true && payload.providers.openlibrary.available === false;

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
    // A search whose books failed is answered but never cached (here, by the CDN or by the browser), so the
    // next try asks Open Library again instead of serving the book-less result for minutes. cachedValue
    // never stores a producer failure, so the partial result travels on the error.
    let payload;
    try {
      payload = await cachedValue(cacheKey, async () => {
        const result = await searchCatalog(query, { domain, skipBooks });
        if (booksFailed(result)) throw Object.assign(new Error("books unavailable"), { partial: result });
        return result;
      }, { ttl: 300, tags: ["catalog-search"] });
    } catch (error) {
      if (!error?.partial) throw error;
      payload = error.partial;
    }
    const partial = booksFailed(payload);
    console.info("[tastemake-catalog]", JSON.stringify({ domain, skipBooks, partial, ms: Date.now() - started, results: payload.items?.length ?? 0 }));
    res.setHeader("cache-control", partial ? "no-store" : "public, max-age=60, stale-while-revalidate=300");
    return res.status(200).json(payload);
  } catch {
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ items: [], providers: {}, degraded: true });
  }
}
