import { browseCatalog } from "../src/catalog/browse.mjs";
import { browseGenreById } from "../src/catalog/browse-genres.js";
import { cachedValue } from "../src/server/cache.mjs";
import { requestQuery } from "../src/server/query.mjs";
import { correctOldBookYears } from "../src/catalog/wikidata-years.mjs";

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
  const key = `browse:v6:${domain}:${genre}:${page}`;
  // Oct 24: book pages took 0.8-8.8 s cold (Open Library) and 0.08 s cached, and Open Library's subject
  // lists barely change, so book pages are kept a day. Other areas answer fast and keep 15 minutes.
  const cached = await cachedValue(key, () => browseCatalog({ domain, genreId: genre, page }), { ttl: domain === "read" ? 24 * 60 * 60 : 900, tags: ["browse-catalog"] });
  // Older books' years from Wikidata, waiting at most 500 ms (the lookup finishes in the background and
  // caches itself for a week, so the next visit gets them).
  const payload = domain === "read" && cached?.items?.length ? { ...cached, items: await correctOldBookYears(cached.items, { waitMs: 500 }) } : cached;
  console.info("[tastemake-browse]", JSON.stringify({ domain, genre, page, ms: Date.now() - started, results: payload.items?.length ?? 0 }));
  res.setHeader("cache-control", "public, max-age=300, stale-while-revalidate=900");
  return res.status(200).json(payload);
}
