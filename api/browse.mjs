import { browseCatalog } from "../src/catalog/browse.mjs";
import { browseGenreById } from "../src/catalog/browse-genres.js";
import { cachedValue } from "../src/server/cache.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "GET required" });
  }

  const domain = ["watch", "read", "play"].includes(req.query?.domain) ? req.query.domain : null;
  const genre = String(req.query?.genre ?? "");
  const page = Math.max(1, Math.min(20, Number(req.query?.page) || 1));
  if (!domain || !browseGenreById(domain, genre)) {
    return res.status(400).json({ error: "valid domain and genre are required" });
  }

  const started = Date.now();
  const key = `browse:v1:${domain}:${genre}:${page}`;
  const payload = await cachedValue(key, () => browseCatalog({ domain, genreId: genre, page }), { ttl: 900, tags: ["browse-catalog"] });
  console.info("[tastemake-browse]", JSON.stringify({ domain, genre, page, ms: Date.now() - started, results: payload.items?.length ?? 0 }));
  res.setHeader("cache-control", "public, max-age=300, stale-while-revalidate=900");
  return res.status(200).json(payload);
}
