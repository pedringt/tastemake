// #252 part 2 (Oct 27): "with these vibes" results. Runs the shelves bridgeQueriesFor() names through the
// same provider calls as Browse (browse.mjs), then the gates "See similar" uses: nothing already reacted
// to, not the item itself, no later series entries or companion books, and the novelty guard against the
// item (so the book of the film is left out). No model call. Never throws; a failure is an empty list.

import { browseCatalog } from "./browse.mjs";
import { bridgeQueriesFor, domainOfItem, sharedBridgeLabels } from "./bridges.mjs";
import { applyNoveltyGuard, isFranchiseContinuation } from "./novelty.mjs";
import { bookAuthors, bookSeriesPosition, isBook, isLaterSeriesEntry } from "./book-series.mjs";
import { withBookSeriesEvidence } from "./book-series-editions.mjs";
import { wikidataSeriesPositions } from "./wikidata-series.mjs";
import { isBookCompanion } from "./book-companions.mjs";
import { isAdultTagged } from "./adult-content.mjs";

const BRIDGE_LIMIT = 12;

// Oct 27 smoke test: "Books with the vibes of Arrival" listed Agatha Christie and the Hardy Boys on
// "mystery" alone, two Asimov Robot novels in a row, The Naked Sun and The Fall of Hyperion (book 2s),
// and Circe gave the first two Harry Potter films. So:
// - a broad label on its own isn't a vibe: these need a second shared label (sci-fi, fantasy and horror
//   carry one by themselves);
// - one result per author and per franchise;
// - later series books are looked up the way recommendations do (Open Library editions, then Wikidata),
//   since their titles rarely say "Book 2".
const BROAD_LABELS = new Set(["mystery", "thriller", "comedy", "romance", "historical"]);
const SERIES_CHECK = 16;   // books checked for a series position, in ranked order (same budget idea as related.mjs)

export const meaningfulShare = (shared) => shared.length >= 2 || shared.some((label) => !BROAD_LABELS.has(label));

// Fails open: a failed or slow lookup leaves the book as it was.
async function dropLaterSeriesBooks(items, { env, fetchImpl }) {
  const top = items.slice(0, SERIES_CHECK);
  let checked = top;
  try {
    checked = (await withBookSeriesEvidence(top, [], { env, fetchImpl, maxLookups: 0, maxPositionLookups: SERIES_CHECK })).candidates;
  } catch { /* fail open */ }
  const unknown = checked.filter((item) => isBook(item) && bookSeriesPosition(item) == null);
  let wikidata = new Map();
  try { if (unknown.length) wikidata = await wikidataSeriesPositions(unknown, { env, fetchImpl }); } catch { /* fail open */ }
  const withPosition = (item) => (wikidata.get(item.id) ? { ...item, providerMeta: { ...(item.providerMeta ?? {}), seriesPosition: wikidata.get(item.id) } } : item);
  return [...checked, ...items.slice(SERIES_CHECK)].map(withPosition).filter((item) => !isLaterSeriesEntry(item));
}

function onePerAuthorAndFranchise(items) {
  const kept = [];
  const authors = new Set();
  for (const item of items) {
    const author = isBook(item) ? bookAuthors(item)[0] : null;
    if (author && authors.has(author)) continue;
    if (kept.some((other) => isFranchiseContinuation(item, other) || isFranchiseContinuation(other, item))) continue;
    if (author) authors.add(author);
    kept.push(item);
  }
  return kept;
}

const uniqById = (items) => {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
};

function interleave(rows) {
  const out = [];
  const depth = Math.max(0, ...rows.map((bucket) => bucket.length));
  for (let i = 0; i < depth; i += 1) for (const bucket of rows) if (bucket[i]) out.push(bucket[i]);
  return out;
}

export async function bridgeCandidates(item, targetDomain, { env = process.env, fetchImpl = fetch, browse = browseCatalog, exclude = [], limit = BRIDGE_LIMIT } = {}) {
  const queries = bridgeQueriesFor(item, targetDomain);
  if (!queries.length) return [];
  const settled = await Promise.allSettled(queries.map((query) => browse({ domain: query.domain, genreId: query.genreId, page: 1, env, fetchImpl })));
  const rows = settled.map((result, index) => (result.status === "fulfilled" ? result.value?.items ?? [] : [])
    .map((candidate) => ({ candidate, shelf: queries[index] })));

  const key = (candidate) => `${candidate.provider}:${candidate.type ?? ""}:${candidate.providerId}`;
  const blocked = new Set([item.id, ...exclude]);
  const own = domainOfItem(item);
  // An explicitly adult-tagged result only when the item itself is (src/catalog/adult-content.mjs).
  const adultOk = isAdultTagged(item);
  const byId = new Map();
  for (const { candidate, shelf } of interleave(rows)) {
    if (!candidate?.id || blocked.has(candidate.id) || key(candidate) === key(item)) continue;
    if (domainOfItem(candidate) === own) continue;
    if (isLaterSeriesEntry(candidate)) continue;
    if (candidate.type === "book" && isBookCompanion({ title: candidate.title, author_name: String(candidate.by ?? "").split(",").map((a) => a.trim()).filter(Boolean) })) continue;
    if (!adultOk && isAdultTagged(candidate)) continue;
    const shared = sharedBridgeLabels(candidate, item, shelf);
    if (!shared.length) continue;   // broad-only matches are judged after merging shelves, below
    const entry = byId.get(candidate.id);
    if (entry) entry.shared = [...new Set([...entry.shared, ...shared])];
    else byId.set(candidate.id, { candidate, shared, order: byId.size });
  }
  // More shared genres first; otherwise the providers' own order, shelves taking turns.
  const ranked = [...byId.values()].filter((entry) => meaningfulShare(entry.shared)).sort((a, b) => b.shared.length - a.shared.length || a.order - b.order);
  const guarded = applyNoveltyGuard(uniqById(ranked.map((entry) => entry.candidate)), [item]).primary;
  const sharedById = new Map(ranked.map((entry) => [entry.candidate.id, entry.shared]));
  const firstBooks = await dropLaterSeriesBooks(guarded, { env, fetchImpl });
  return onePerAuthorAndFranchise(firstBooks).slice(0, limit).map((candidate) => ({
    ...candidate,
    relatedTo: item.title,
    relatedToId: item.id,
    bridge: { fromId: item.id, fromDomain: own, sharedGenres: sharedById.get(candidate.id) ?? [] }
  }));
}
