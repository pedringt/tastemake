import { similarToItem } from "../src/catalog/related.mjs";
import { bridgeCandidates } from "../src/catalog/bridge-candidates.mjs";
import { BRIDGE_TARGETS } from "../src/catalog/bridges.mjs";
import { browseCatalog } from "../src/catalog/browse.mjs";
import { bridgeReason, fallbackReason } from "../src/catalog/fallback-reasons.mjs";
import { cachedValue } from "../src/server/cache.mjs";
import { correctOldBookYears } from "../src/catalog/wikidata-years.mjs";

// Oct 27: "See similar" from a liked item. POST, because the client sends the item it already has
// (genres and provider ids) and the ids it has already reacted to, so nothing comes back twice.
// No model call: each result's reason names what it shares with the item.
// #252 part 2 (Oct 27): with `targetDomain` ("read", "movies", "tv" or "screen") it answers "with these
// vibes" instead: things from another medium on the same genre shelves (src/catalog/bridge-candidates.mjs).
const MAX_BODY_BYTES = 40_000;
const MAX_EXCLUDE = 500;
const PROVIDERS = new Set(["tmdb", "openlibrary", "igdb", "googlebooks"]);
const TYPES = new Set(["movie", "tv", "book", "game"]);
// Which targets each type may ask for: movies, shows and games bridge to books, books to the screen.
const BRIDGE_FROM = { movie: ["read"], tv: ["read"], game: ["read"], book: ["movies", "tv", "screen"] };

const clean = (value, max = 200) => String(value ?? "").slice(0, max);

// A failed answer is never cached anywhere, like api/browse.mjs.
const refuse = (res, code, error) => {
  res.setHeader("cache-control", "no-store");
  return res.status(code).json({ error });
};

// The same shelves Browse shows, cached the same way (a day for books, 15 minutes otherwise), but under
// their own key: a failed or empty shelf is never kept.
const cachedShelf = (args) => cachedValue(`bridge-shelf:v1:${args.domain}:${args.genreId}`, async () => {
  const result = await browseCatalog(args);
  if (result.degraded || !(result.items ?? []).length) throw Object.assign(new Error("not cacheable"), { partial: result });
  return result;
}, { ttl: args.domain === "read" ? 24 * 60 * 60 : 900, tags: ["browse-catalog"] }).catch((error) => {
  if (error?.partial) return error.partial;
  throw error;
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return refuse(res, 405, "POST required");
  }
  if (Number(req.headers?.["content-length"] || 0) > MAX_BODY_BYTES) return refuse(res, 413, "request too large");
  let body;
  try {
    const raw = req.body;
    body = typeof raw === "string" ? JSON.parse(raw || "{}") : raw ?? {};
  } catch {
    return refuse(res, 400, "invalid request");
  }
  const given = body?.item;
  if (!given || !PROVIDERS.has(given.provider) || !TYPES.has(given.type) || !given.providerId) {
    return refuse(res, 400, "item with provider, providerId and type is required");
  }
  const targetDomain = body.targetDomain == null ? null : String(body.targetDomain);
  if (targetDomain !== null && (!BRIDGE_TARGETS[targetDomain] || !BRIDGE_FROM[given.type].includes(targetDomain))) {
    return refuse(res, 400, "targetDomain must be another area this item can bridge to");
  }
  const givenMeta = given.providerMeta && typeof given.providerMeta === "object" ? given.providerMeta : null;
  const item = {
    id: clean(given.id),
    provider: given.provider,
    providerId: clean(given.providerId, 80),
    type: given.type,
    title: clean(given.title),
    domains: Array.isArray(given.domains) ? given.domains.slice(0, 4).map((d) => clean(d, 20)) : [],
    genres: Array.isArray(given.genres) ? given.genres.slice(0, 30).map((g) => clean(g, 120)) : [],
    providerMeta: givenMeta
      ? {
          genreIds: Array.isArray(givenMeta.genreIds) ? givenMeta.genreIds.slice(0, 20) : [],
          collectionId: givenMeta.collectionId ?? null,
          // IGDB themes (#48) are where a game's fantasy or horror lives, so bridges read them.
          themes: Array.isArray(givenMeta.themes) ? givenMeta.themes.slice(0, 20).map((t) => clean(t, 40)) : []
        }
      : {}
  };
  const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, MAX_EXCLUDE).map((id) => clean(id)) : [];

  if (targetDomain) {
    const found = await bridgeCandidates(item, targetDomain, { exclude, browse: cachedShelf });
    // Older books' years from Wikidata, as Browse does, waiting at most 500 ms.
    const dated = found.some((candidate) => candidate.type === "book") ? await correctOldBookYears(found, { waitMs: 500 }) : found;
    const items = dated.map((candidate, index) => ({ ...candidate, reason: bridgeReason(candidate, { index }) }));
    res.setHeader("cache-control", "no-store");
    return res.status(200).json({ items, targetDomain });
  }

  const items = (await similarToItem(item, { exclude }))
    .map((candidate, index) => ({ ...candidate, reason: fallbackReason(candidate, item, { index }) }));
  res.setHeader("cache-control", "no-store");
  return res.status(200).json({ items });
}
