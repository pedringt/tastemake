// Series position from Wikidata, for books Open Library has no position for. Server-only.
//
// Oct 20: King of the Murgos (Malloreon #2) and similar later entries were offered because Open Library
// records no position for them anywhere. Wikidata (CC0) records "part of the series" (P179) with a "series
// ordinal" qualifier (P1545) for many well-known books: Lord of Chaos -> Wheel of Time 6, The Hero of Ages
// -> Mistborn 3, King of the Murgos -> The Malloreon 2.
//
// - Matched by Open Library work id (P648) first, then by English title with the author checked, because
//   many works (King of the Murgos) have no Open Library link on Wikidata.
// - Used only where Open Library gave no position: Open Library says Krew elfów is Witcher #1 (the first
//   novel); Wikidata says 3 (it counts two story collections). The product keeps Open Library's answer.
// - A book in several series (Mistborn and the Cosmere) takes the smallest ordinal, the conservative
//   choice: a book is only held back when every series it is numbered in has it after #1.
// - One request for the ids and one for the titles, a short timeout, cached a week per work, and any
//   failure means "no position" (the book is kept), so a slow or down Wikidata never blocks picks.

import { cachedValue } from "../server/cache.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";

const ENDPOINT = "https://query.wikidata.org/sparql?format=json&query=";
const TIMEOUT_MS = 1500;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const userAgent = (env) => env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)";
export const sparqlString = (text) => `"${String(text).replace(/["\\\n\r]/g, " ").trim()}"`;

// The title Wikidata is likely to use: no "(Malloreon)" suffix, no subtitle.
export function plainTitle(title) {
  return String(title ?? "").replace(/\([^)]*\)/g, " ").split(/\s*[:–—]\s+/)[0].replace(/\s+/g, " ").trim();
}

const surname = (name) => String(name ?? "").trim().split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "";

function smallestOrdinal(values) {
  const numbers = values.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 50);
  return numbers.length ? Math.min(...numbers) : null;
}

export async function sparql(query, { env, fetchImpl, timeoutMs }) {
  const response = await fetchWithTimeout(fetchImpl, ENDPOINT + encodeURIComponent(query), {
    headers: { "user-agent": userAgent(env), accept: "application/sparql-results+json" }
  }, timeoutMs);
  if (!response.ok) throw new Error(`wikidata ${response.status}`);
  return (await response.json())?.results?.bindings ?? [];
}

// Map of item id -> position (or null) for the given Open Library books. Never throws.
export async function wikidataSeriesPositions(items, { env = process.env, fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const books = items.filter((item) => item?.provider === "openlibrary" && item.providerId);
  const out = new Map();
  if (!books.length) return out;

  const lookup = async () => {
    const byId = new Map();
    try {
      const ids = books.map((b) => sparqlString(b.providerId)).join(" ");
      const rows = await sparql(`SELECT ?olid ?ordinal WHERE { VALUES ?olid { ${ids} } ?book wdt:P648 ?olid ; p:P179 ?st . ?st pq:P1545 ?ordinal . }`, { env, fetchImpl, timeoutMs });
      for (const row of rows) byId.set(row.olid.value, [...(byId.get(row.olid.value) ?? []), row.ordinal.value]);
    } catch { /* fail open */ }

    const missing = books.filter((b) => !byId.has(b.providerId) && plainTitle(b.title));
    const byTitle = new Map();
    if (missing.length) {
      try {
        const titles = [...new Set(missing.map((b) => `${sparqlString(plainTitle(b.title))}@en`))].join(" ");
        const rows = await sparql(`SELECT ?title ?authorLabel ?ordinal WHERE { VALUES ?title { ${titles} } ?book rdfs:label ?title ; wdt:P50 ?author ; p:P179 ?st . ?st pq:P1545 ?ordinal . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`, { env, fetchImpl, timeoutMs });
        for (const row of rows) {
          const key = row.title.value.toLowerCase();
          byTitle.set(key, [...(byTitle.get(key) ?? []), { author: surname(row.authorLabel?.value), ordinal: row.ordinal.value }]);
        }
      } catch { /* fail open */ }
    }

    const result = {};
    for (const book of books) {
      if (byId.has(book.providerId)) { result[book.id] = smallestOrdinal(byId.get(book.providerId)); continue; }
      // A title match counts only when one of the book's authors is the Wikidata author.
      const authors = String(book.by ?? "").split(",").map(surname).filter(Boolean);
      const hits = (byTitle.get(plainTitle(book.title).toLowerCase()) ?? []).filter((h) => authors.includes(h.author));
      result[book.id] = hits.length ? smallestOrdinal(hits.map((h) => h.ordinal)) : null;
    }
    return result;
  };

  let result = {};
  try {
    // Cached as one entry per set of works; production keys on the sorted ids so repeat rounds hit it.
    const key = `book-series:v1:wikidata:${books.map((b) => b.providerId).sort().join(",")}`;
    result = fetchImpl === fetch ? await cachedValue(key, lookup, { ttl: CACHE_TTL_SECONDS, tags: ["related-catalog"] }) : await lookup();
  } catch { result = {}; }
  for (const book of books) out.set(book.id, result?.[book.id] ?? null);
  return out;
}
