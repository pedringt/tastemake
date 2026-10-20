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
//
// #255: the same edition list also says where a book sits in its series ("The Mistborn Saga #3"), which
// is the only place some later entries say so (The Hero of Ages has no series data in search). Book
// candidates whose position is still unknown get a lookup from a separate, small budget, so a later
// entry of a series the user has not started can be dropped. Same cache, same fail-open behavior.

import { cachedValue } from "../server/cache.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";
import { bookSeriesNames, bookSeriesPosition, isBook, sameBookAuthor, seriesNamesFromEditions, seriesPositionFromEditions } from "./book-series.mjs";
import { isFranchiseContinuation } from "./novelty.mjs";

const MAX_LOOKUPS = 6;
const MAX_POSITION_LOOKUPS = 10;
const LOOKUP_TIMEOUT_MS = 1500;
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const isOpenLibraryBook = (item) => isBook(item) && item?.provider === "openlibrary" && item?.providerId;

const NO_FACTS = Object.freeze({ names: [], position: null });

async function editionSeriesFacts(providerId, { env, fetchImpl, timeoutMs }) {
  const load = async () => {
    const response = await fetchWithTimeout(fetchImpl, `https://openlibrary.org/works/${encodeURIComponent(providerId)}/editions.json?limit=50`, {
      headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
    }, timeoutMs);
    if (!response.ok) return NO_FACTS;
    const entries = (await response.json()).entries ?? [];
    return { names: seriesNamesFromEditions(entries), position: seriesPositionFromEditions(entries) };
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`book-series:v2:editions:${providerId}`, load, { ttl: CACHE_TTL_SECONDS, tags: ["related-catalog"] });
}

// Returns { candidates, evidenceItems } with edition-derived series names merged into
// providerMeta.seriesNames where a lookup ran. Never throws. `memo` (a Map) is shared across the
// guard passes of one request.
export async function withBookSeriesEvidence(candidates, evidenceItems, {
  env = process.env,
  fetchImpl = fetch,
  memo = new Map(),
  maxLookups = MAX_LOOKUPS,
  maxPositionLookups = MAX_POSITION_LOOKUPS,
  timeoutMs = LOOKUP_TIMEOUT_MS
} = {}) {
  const bookEvidence = evidenceItems.filter(isOpenLibraryBook);
  const bookCandidates = candidates.filter(isOpenLibraryBook);
  if (!bookEvidence.length && !bookCandidates.length) return { candidates, evidenceItems, lookups: 0 };

  // Both budgets are per request: the counts live on the shared memo, so later guard passes in the
  // same request spend from what is left.
  const wanted = [];
  memo.nameLookups ??= 0;
  memo.positionLookups ??= 0;
  const want = (item) => {
    if (memo.has(item.providerId) || wanted.includes(item.providerId)) return;
    if (bookSeriesNames(item).length) return;
    if (memo.nameLookups >= maxLookups) return;
    memo.nameLookups += 1;
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
  // #255: candidates whose series position is still unknown, in pool order, from their own budget.
  for (const candidate of bookCandidates) {
    if (memo.positionLookups >= maxPositionLookups) break;
    if (bookSeriesPosition(candidate) || memo.has(candidate.providerId) || wanted.includes(candidate.providerId)) continue;
    memo.positionLookups += 1;
    wanted.push(candidate.providerId);
  }
  if (!wanted.length && !memo.size) return { candidates, evidenceItems, lookups: 0 };

  await Promise.all(wanted.map(async (providerId) => {
    let facts = NO_FACTS;
    try { facts = await editionSeriesFacts(providerId, { env, fetchImpl, timeoutMs }); } catch { facts = NO_FACTS; }
    memo.set(providerId, facts);
  }));

  const enrich = (item) => {
    const facts = isOpenLibraryBook(item) ? memo.get(item.providerId) : null;
    if (!facts || (!facts.names?.length && !facts.position)) return item;
    const providerMeta = { ...(item.providerMeta ?? {}) };
    if (facts.names?.length) providerMeta.seriesNames = [...new Set([...(providerMeta.seriesNames ?? []), ...facts.names])];
    if (facts.position && !bookSeriesPosition(item)) providerMeta.seriesPosition = facts.position;
    return { ...item, providerMeta };
  };
  return { candidates: candidates.map(enrich), evidenceItems: evidenceItems.map(enrich), lookups: wanted.length };
}
