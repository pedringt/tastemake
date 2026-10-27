import { similarToItem } from "../src/catalog/related.mjs";
import { fallbackReason } from "../src/catalog/fallback-reasons.mjs";

// Oct 27: "See similar" from a liked item. POST, because the client sends the item it already has
// (genres and provider ids) and the ids it has already reacted to, so nothing comes back twice.
// No model call: each result's reason names what it shares with the item.
const MAX_BODY_BYTES = 40_000;
const MAX_EXCLUDE = 500;
const PROVIDERS = new Set(["tmdb", "openlibrary", "igdb"]);
const TYPES = new Set(["movie", "tv", "book", "game"]);

const clean = (value, max = 200) => String(value ?? "").slice(0, max);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "POST required" });
  }
  if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) return res.status(413).json({ error: "request too large" });
  let body;
  try {
    const raw = req.body;
    body = typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};
  } catch {
    return res.status(400).json({ error: "invalid request" });
  }
  const given = body?.item;
  if (!given || !PROVIDERS.has(given.provider) || !TYPES.has(given.type) || !given.providerId) {
    return res.status(400).json({ error: "item with provider, providerId and type is required" });
  }
  const item = {
    id: clean(given.id),
    provider: given.provider,
    providerId: clean(given.providerId, 80),
    type: given.type,
    title: clean(given.title),
    domains: Array.isArray(given.domains) ? given.domains.slice(0, 4).map((d) => clean(d, 20)) : [],
    genres: Array.isArray(given.genres) ? given.genres.slice(0, 30).map((g) => clean(g, 120)) : [],
    providerMeta: given.providerMeta && typeof given.providerMeta === "object"
      ? { genreIds: Array.isArray(given.providerMeta.genreIds) ? given.providerMeta.genreIds.slice(0, 20) : [], collectionId: given.providerMeta.collectionId ?? null }
      : {}
  };
  const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, MAX_EXCLUDE).map((id) => clean(id)) : [];

  const items = (await similarToItem(item, { exclude }))
    .map((candidate, index) => ({ ...candidate, reason: fallbackReason(candidate, item, { index }) }));
  res.setHeader("cache-control", "no-store");
  return res.status(200).json({ items });
}
