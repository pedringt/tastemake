import { browseCatalog } from "../src/catalog/browse.mjs";
import { browseGenreById } from "../src/catalog/browse-genres.js";
import { cachedValue } from "../src/server/cache.mjs";
import { requestQuery } from "../src/server/query.mjs";
import { correctOldBookYears } from "../src/catalog/wikidata-years.mjs";

export const uncacheable = (domain, result) => Boolean(result?.degraded) || (domain === "read" && !(result?.items ?? []).length);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }

  const params = requestQuery(req);
  const domain = ["movies", "tv", "read", "play"].includes(params.domain) ? params.domain : null;
  const genre = String(params.genre ?? "");
  const page = Math.max(1, Math.min(20, Number(params.page) || 1));
  if (!domain || !browseGenreById(domain, genre)) {
    return res.status(400).json({ error: "valid domain and genre are required" });
  }

  const started = Date.now();
  const key = `browse:v7:${domain}:${genre}:${page}`;
  // Oct 24: book pages took 0.8-8.8 s cold (Open Library) and 0.08 s cached, and Open Library's subject
  // lists barely change, so book pages are kept a day. Other areas answer fast and keep 15 minutes.
  // A failed page (or an empty book page) is answered but never cached, here or by the browser, so the
  // next visit tries again: v6 cached Open Library failures for a day and left pages empty. cachedValue
  // never stores a producer failure, so the uncached result travels on the error.
  let cached;
  try {
    cached = await cachedValue(key, async () => {
      const result = await browseCatalog({ domain, genreId: genre, page });
      if (uncacheable(domain, result)) throw Object.assign(new Error("not cacheable"), { partial: result });
      return result;
    }, { ttl: domain === "read" ? 24 * 60 * 60 : 900, tags: ["browse-catalog"] });
  } catch (error) {
    if (!error?.partial) throw error;
    cached = error.partial;
  }
  // Older books' years from Wikidata, waiting at most 500 ms (the lookup finishes in the background and
  // caches itself for a week, so the next visit gets them).
  const payload = domain === "read" && cached?.items?.length ? { ...cached, items: await correctOldBookYears(cached.items, { waitMs: 500 }) } : cached;
  console.info("[tastemake-browse]", JSON.stringify({ domain, genre, page, ms: Date.now() - started, results: payload.items?.length ?? 0 }));
  res.setHeader("cache-control", uncacheable(domain, cached) ? "no-store" : "public, max-age=300, stale-while-revalidate=900");
  return res.status(200).json(payload);
}
