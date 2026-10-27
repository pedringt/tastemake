// First-publication years for older books, from Wikidata (CC0). Server-only.
//
// Oct 23 review: Open Library's first_publish_year is the earliest date on any edition record, so a
// mis-dated record wins. firstPublishedYear (providers.mjs) fixes lone outliers for books first dated 1980
// or later; older books are left to this: Open Library says The Great Gatsby is 1920, Wikidata's
// publication date (P577) says 1925.
//
// - Matched by Open Library work id (P648) only. No title guessing: a wrong year from a wrong match is
//   worse than Open Library's own.
// - Only books Open Library dates before 1980, only when Wikidata has a date, and the earliest one wins.
// - One request per batch, a short timeout, cached a week; any failure keeps Open Library's year.

import { cachedValue } from "../server/cache.mjs";
import { waitUntil } from "@vercel/functions";
import { sparql, sparqlString } from "./wikidata-series.mjs";

export const OLD_BOOK_BEFORE = 1980;
const TIMEOUT_MS = 1200;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PLACEHOLDER_ABOUT = /^First published \d{3,4}\.$/;

const isOldBook = (item) => item?.provider === "openlibrary" && item.providerId && Number(item.year) > 0 && Number(item.year) < OLD_BOOK_BEFORE;

// Map of Open Library work id -> Wikidata's earliest publication year. Never throws.
export async function wikidataFirstYears(workIds, { env = process.env, fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ids = [...new Set(workIds.filter(Boolean).map(String))].sort();
  if (!ids.length) return {};
  const lookup = async () => {
    const rows = await sparql(`SELECT ?olid (MIN(YEAR(?date)) AS ?year) WHERE { VALUES ?olid { ${ids.map(sparqlString).join(" ")} } ?book wdt:P648 ?olid ; wdt:P577 ?date . } GROUP BY ?olid`, { env, fetchImpl, timeoutMs });
    const out = {};
    for (const row of rows) {
      const year = Number(row.year?.value);
      if (Number.isInteger(year) && year >= 1400 && year <= new Date().getUTCFullYear()) out[row.olid.value] = year;
    }
    return out;
  };
  try {
    return fetchImpl === fetch
      ? await cachedValue(`book-years:v1:wikidata:${ids.join(",")}`, lookup, { ttl: CACHE_TTL_SECONDS, tags: ["catalog-detail"] })
      : await lookup();
  } catch {
    return {};
  }
}

// Returns the same list with older books' years (and a placeholder "First published …" line) corrected
// where Wikidata knows better. Items that need no lookup cost nothing.
// waitMs (search): stop waiting after that long and keep Open Library's years this time. The lookup itself
// keeps running and caches its answer, so the next search for the same books gets the corrected years.
export async function correctOldBookYears(items, { waitMs = null, ...options } = {}) {
  const old = items.filter(isOldBook);
  if (!old.length) return items;
  const lookup = wikidataFirstYears(old.map((item) => item.providerId), options);
  // Keep the function alive until the lookup has cached its answer, even after the response is sent.
  if (waitMs != null) { try { waitUntil(lookup); } catch { /* local/off-platform tests have no request context */ } }
  const years = waitMs == null ? await lookup : await Promise.race([lookup, new Promise((resolve) => setTimeout(() => resolve({}), waitMs))]);
  return items.map((item) => {
    const year = isOldBook(item) ? years[item.providerId] : null;
    if (!year || String(year) === String(item.year)) return item;
    return {
      ...item,
      year: String(year),
      ...(PLACEHOLDER_ABOUT.test(String(item.about ?? "")) ? { about: `First published ${year}.` } : {})
    };
  });
}
