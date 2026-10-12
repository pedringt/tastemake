// #142: bounded Open Library edition lookup for book-series names. Server-only (uses the runtime
// cache).
//
// Why a lookup at all: for some real sequels the only place Open Library names the series is the
// edition records. "Words of Radiance" has no series_key and no "series:" subject, but its editions
// say "The Stormlight Archive, 2"; "The Well of Ascension" editions say "The Mistborn Saga #2".
//
// Why it stays cheap:
//   - Only runs for a book candidate that shares an author with a book the user experienced and is
//     not already caught by another rule. Most candidates are by other authors, so most requests make
//     no lookup at all.
//   - Only a side that has no series name yet is looked up, at most MAX_LOOKUPS works per request,
//     all in parallel with a short timeout. Measured at ~0.2-0.3s and 20-45KB per work (Oct 2026).
//   - Results are cached for a week per work (series membership does not change) and memoized per
//     request, so later guard passes in the same request and later rounds do not refetch.
//   - Any failure or timeout means "no extra names", i.e. the guard behaves exactly as without this.

import { cachedValue } from "../server/cache.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";
import { bookSeriesNames, isBook, sameBookAuthor, seriesNamesFromEditions } from "./book-series.mjs";
import { isFranchiseContinuation } from "./novelty.mjs";

const MAX_LOOKUPS = 6;
const LOOKUP_TIMEOUT_MS = 1500;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const isOpenLibraryBook = (item) => isBook(item) && item?.provider === "openlibrary" && item?.providerId;

async function editionSeriesNames(providerId, { env, fetchImpl, timeoutMs }) {
  const load = async () => {
    const response = await fetchWithTimeout(fetchImpl, `https://openlibrary.org/works/${encodeURIComponent(providerId)}/editions.json?limit=50`, {
      headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
    }, timeoutMs);
    if (!response.ok) return [];
    return seriesNamesFromEditions((await response.json()).entries ?? []);
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`book-series:v1:editions:${providerId}`, load, { ttl: CACHE_TTL_SECONDS, tags: ["related-catalog"] });
}

// Returns { candidates, evidenceItems } with edition-derived series names merged into
// providerMeta.seriesNames where a lookup ran. Never throws. `memo` (a Map) is shared across the
// guard passes of one request.
export async function withBookSeriesEvidence(candidates, evidenceItems, {
  env = process.env,
  fetchImpl = fetch,
  memo = new Map(),
  maxLookups = MAX_LOOKUPS,
  timeoutMs = LOOKUP_TIMEOUT_MS
} = {}) {
  const bookEvidence = evidenceItems.filter(isOpenLibraryBook);
  if (!bookEvidence.length) return { candidates, evidenceItems, lookups: 0 };

  const wanted = [];
  const want = (item) => {
    if (memo.has(item.providerId) || wanted.includes(item.providerId)) return;
    if (bookSeriesNames(item).length) return;
    if (memo.size + wanted.length >= maxLookups) return;
    wanted.push(item.providerId);
  };
  for (const candidate of candidates) {
    if (!isOpenLibraryBook(candidate)) continue;
    for (const anchor of bookEvidence) {
      if (!sameBookAuthor(candidate, anchor) || isFranchiseContinuation(candidate, anchor)) continue;
      // A side that already has a name keeps it; only the nameless side needs its editions read.
      // When both sides already have names they are known, different series: nothing to look up.
      want(anchor);
      want(candidate);
    }
  }
  if (!wanted.length && !memo.size) return { candidates, evidenceItems, lookups: 0 };

  await Promise.all(wanted.map(async (providerId) => {
    let names = [];
    try { names = await editionSeriesNames(providerId, { env, fetchImpl, timeoutMs }); } catch { names = []; }
    memo.set(providerId, names);
  }));

  const enrich = (item) => {
    if (!isOpenLibraryBook(item) || !memo.get(item.providerId)?.length) return item;
    const seriesNames = [...new Set([...(item.providerMeta?.seriesNames ?? []), ...memo.get(item.providerId)])];
    return { ...item, providerMeta: { ...(item.providerMeta ?? {}), seriesNames } };
  };
  return { candidates: candidates.map(enrich), evidenceItems: evidenceItems.map(enrich), lookups: wanted.length };
}
