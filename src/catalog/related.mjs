import { enrichCanonicalItemWriteBehind, igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";
import { applyNoveltyGuard } from "./novelty.mjs";
import { cachedValue } from "../server/cache.mjs";
import { canonicalizeWriteBehind, lookupCanonicalAnchorMetadata, relatedCanonicalItems } from "./canonical-store.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";

// Deliberately NOT imported from model/evidence.js: this module sits in a real circular import
// chain (taste.js -> evidence.js -> starters.js -> search.js -> taste.js), and adding related.mjs
// as a new entry point into that cycle threw a real "Cannot access before initialization" ReferenceError
// (taste.js's top-level `export const isPositiveExperience = isExperiencedPositive` executes before
// evidence.js's exports are live, under this module's specific import ordering). This mirrors
// evidence.js's own evidenceKind()/isExperienced() rule exactly (rating "more"+"loved-before" or
// "liked-before", or rating "less"+"tried-disliked" -- everything else, including a bare reaction
// with no detail, "not-tried"/bookmarked, or "not-interested", is intent, not experience) -- keep
// this in sync with evidenceKind() in model/evidence.js if that rule table ever changes.
function positiveAnchorStrength(feedback) {
  if (!feedback) return 0;
  const { rating, detail } = feedback;
  if (rating === "more" && detail === "loved-before") return 3;
  if (rating === "more" && detail === "liked-before") return 1;
  return 0;
}

const uniq = (items) => {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
};

const areaAllowed = (state, item) => !item.domains?.length || item.domains.some((domain) => state.areas?.[domain] !== false);
const modeAllowed = (state, item) => {
  const mode = state.recommendationFilter ?? "all";
  return mode === "all" || item.domains?.includes(mode);
};

function interleave(rows) {
  const out = [];
  const depth = Math.max(0, ...rows.map((bucket) => bucket.length));
  for (let i = 0; i < depth; i += 1) {
    for (const bucket of rows) if (bucket[i]) out.push(bucket[i]);
  }
  return out;
}

function balanceDomains(items, mode) {
  if (mode !== "all") return items;
  const buckets = new Map([["movies", []], ["tv", []], ["read", []], ["play", []], ["other", []]]);
  for (const item of items) {
    const key = ["movies", "tv", "read", "play"].find((domain) => item.domains?.includes(domain)) ?? "other";
    buckets.get(key).push(item);
  }
  return interleave([...buckets.values()].filter((bucket) => bucket.length));
}

const MIXED_DOMAINS = ["movies", "tv", "read", "play"];
const primaryDomain = (item) => MIXED_DOMAINS.find((domain) => item?.domains?.includes(domain)) ?? "other";

function selectAllAnchors(items, max = 8) {
  const buckets = new Map(MIXED_DOMAINS.map((domain) => [domain, []]));
  for (const item of items) {
    const domain = primaryDomain(item);
    if (buckets.has(domain)) buckets.get(domain).push(item);
  }
  // Two passes means every represented medium gets one anchor before any medium gets a second.
  // Eight is still a small bounded retrieval set, but unlike the old six-anchor cap it can give
  // all four visible media two chances when All is selected.
  const selected = [];
  for (let depth = 0; depth < 2 && selected.length < max; depth += 1) {
    for (const domain of MIXED_DOMAINS) {
      const item = buckets.get(domain)?.[depth];
      if (item) selected.push(item);
      if (selected.length >= max) break;
    }
  }
  return selected;
}

function applyMixedNoveltyGuard(candidates, evidenceItems, mode) {
  if (mode !== "all") return applyNoveltyGuard(candidates, evidenceItems);

  const candidateBuckets = new Map(MIXED_DOMAINS.map((domain) => [domain, []]));
  const other = [];
  for (const candidate of candidates) {
    const domain = primaryDomain(candidate);
    (candidateBuckets.get(domain) ?? other).push(candidate);
  }

  const primaryBuckets = [];
  const suppressed = [];
  for (const domain of MIXED_DOMAINS) {
    const bucket = candidateBuckets.get(domain) ?? [];
    if (!bucket.length) continue;
    const sameDomainEvidence = evidenceItems.filter((item) => primaryDomain(item) === domain);
    const guarded = applyNoveltyGuard(bucket, sameDomainEvidence);
    primaryBuckets.push(guarded.primary);
    suppressed.push(...guarded.suppressed);
  }
  if (other.length) {
    const guarded = applyNoveltyGuard(other, evidenceItems);
    primaryBuckets.push(guarded.primary);
    suppressed.push(...guarded.suppressed);
  }

  return { primary: interleave(primaryBuckets), suppressed };
}

// Real bug (2026-09-28): reacting Loved it/Liked it directly on a recommendation card only ever
// wrote the item into feedbackByRecommendation[id].item (see saveQuickFeedback in
// actions/recommendations.js) -- it was never copied into state.customItems, which only search-added
// favorites/browse picks populate. This function used to source anchor item data from customItems
// alone, so every reacted-to pick that wasn't also separately search-added silently could never
// become a future retrieval anchor: it displayed correctly in Library (libraryItems() in
// model/library.js already reads feedback.item directly) but was invisible here. With a handful of
// starter favorites and no other anchors ever accruing, "more recommendations" drains a small fixed
// pool fast -- exactly the real-usage report this fixes. customItems still wins when both exist (it
// tends to be the fresher/canonical copy for a searched-and-favorited item).
// Real bug (QA sweep, 2026-09-28): this used every key of feedbackByRecommendation regardless of
// rating class, so a bookmark or "Not interested" reaction (intent, never taste evidence per
// model/evidence.js) could become a live-provider anchor -- "find things related to X" for an X the
// user never actually experienced. Harmless-looking before today's anchor-rotation fix (deterministic
// sort tended to keep low-signal items out of the top-6), but the shuffle now gives every item in the
// pool, intent-only included, a real chance of being picked each round. selectedFavorites is exempt
// from the filter: choosing a Favorite means the user already tried and loved it (see
// EVIDENCE_KINDS.starter-favorite in model/evidence.js), it was never a feedback-rating action.
function externalEvidenceItems(state) {
  const selectedFavorites = new Set(state.selectedFavorites ?? []);
  const strengthById = new Map();

  for (const id of selectedFavorites) strengthById.set(id, 3);
  for (const [id, feedback] of Object.entries(state.feedbackByRecommendation ?? {})) {
    const strength = positiveAnchorStrength(feedback);
    if (strength > 0) strengthById.set(id, Math.max(strengthById.get(id) ?? 0, strength));
  }

  const byId = new Map();
  for (const item of Object.values(state.customItems ?? {})) {
    if (item?.provider) byId.set(item.id, item);
  }
  for (const feedback of Object.values(state.feedbackByRecommendation ?? {})) {
    const item = feedback?.item;
    if (item?.provider && !byId.has(item.id)) byId.set(item.id, item);
  }

  return [...strengthById.entries()]
    .map(([id, anchorStrength]) => {
      const item = byId.get(id);
      if (!item) return null;
      return {
        ...item,
        anchorStrength,
        seriesExperience: state.feedbackByRecommendation?.[item.id]?.seriesExperience ?? null
      };
    })
    .filter(Boolean);
}

// #144: appends related candidates Tastemake has already canonicalized (genre overlap with the
// anchor) that this live call didn't happen to return. Store lookup failures/timeouts already
// resolve to [] inside relatedCanonicalItems, so this never affects the live-provider pool passed
// in as `live`. Capped at 20 total, matching openLibraryRelated's pool cap below.
async function mergeCanonicalCandidates(live, storeItems, { buildProviderMeta }) {
  if (!storeItems.length) return live;
  const seen = new Set(live.map((row) => row.id));
  const merged = [...live];
  for (const storeItem of storeItems) {
    if (seen.has(storeItem.id)) continue;
    seen.add(storeItem.id);
    merged.push({
      ...storeItem,
      artwork: null,
      about: "From Tastemake's canonical store.",
      sourceUrl: null,
      providerMeta: buildProviderMeta(storeItem)
    });
  }
  return merged.slice(0, 20);
}

async function tmdbRelated(item, env, fetchImpl, queryImpl) {
  if (!env.TASTEMAKE_TMDB_TOKEN || item.provider !== "tmdb") return [];
  const load = async () => {
    const kind = item.type === "tv" ? "tv" : "movie";
    const response = await fetchWithTimeout(fetchImpl, `https://api.themoviedb.org/3/${kind}/${item.providerId}/recommendations?language=en-US&page=1`, {
      headers: { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" }
    });
    if (!response.ok) return [];
    return ((await response.json()).results ?? []).slice(0, 12).map((row) => tmdbItem(row, kind));
  };
  const storePromise = relatedCanonicalItems(item, item.genres ?? [], { env, query: queryImpl });
  const livePromise = fetchImpl !== fetch
    ? load()
    : cachedValue(`related:tmdb:${item.type}:${item.providerId}`, load, { ttl: 900, tags: ["related-catalog"] });
  const [live, storeItems] = await Promise.all([livePromise, storePromise]);
  return mergeCanonicalCandidates(live, storeItems, {
    buildProviderMeta: (storeItem) => ({ genreIds: storeItem.genres ?? [], collectionId: null })
  });
}

const GENERIC_BOOK_SUBJECT = /^(fiction|literature|books?|reading|bestsellers?|new york times bestsellers?|nyt bestsellers?|protected daisy|accessible book)$/i;

function normalizeBookSubject(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function meaningfulBookSubjects(values = []) {
  return values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && value.length >= 3 && !GENERIC_BOOK_SUBJECT.test(value))
    .filter((value, index, rows) => rows.findIndex((other) => normalizeBookSubject(other) === normalizeBookSubject(value)) === index);
}

// #131 follow-up: overlap is now a graded signal rather than one hard pass/fail gate. A candidate
// with 2+ meaningful subject overlaps (or, when the source itself only ever offers one meaningful
// subject, that one overlap -- it's the best signal available) is "strong" evidence. A candidate
// with exactly one meaningful overlap against a richer source is "weak" -- still eligible, so a
// good neighbor doesn't get dropped purely because Open Library's taxonomy is noisy/inconsistent,
// but ranked below strong matches so it doesn't crowd out clearly-related books. Zero meaningful
// overlap (including "only a generic/noisy label in common", since GENERIC_BOOK_SUBJECT is already
// stripped out of both sides before this runs) is rejected outright.
function openLibraryOverlapStrength(sourceSubjects, candidateSubjects) {
  const source = new Set(meaningfulBookSubjects(sourceSubjects).map(normalizeBookSubject));
  if (!source.size) return null;
  const candidate = meaningfulBookSubjects(candidateSubjects).map(normalizeBookSubject);
  const overlap = candidate.filter((subject) => source.has(subject)).length;
  if (overlap <= 0) return null;
  return overlap >= Math.min(2, source.size) ? "strong" : "weak";
}

// Kept for callers/tests that only need the old boolean pass/fail shape.
function openLibraryCandidateIsRelated(sourceSubjects, candidateSubjects) {
  return openLibraryOverlapStrength(sourceSubjects, candidateSubjects) !== null;
}

async function openLibrarySubjectSearch(subject, env, fetchImpl, timeoutMs) {
  const fields = "key,title,author_name,first_publish_year,cover_i,subject,series_key";
  const load = async () => {
    const response = await fetchWithTimeout(fetchImpl, `https://openlibrary.org/search.json?q=${encodeURIComponent(`subject:"${subject}"`)}&limit=12&fields=${fields}`, {
      headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
    }, timeoutMs);
    if (!response.ok) return [];
    return (await response.json()).docs ?? [];
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`related:openlibrary:${String(subject).toLowerCase()}`, load, { ttl: 900, tags: ["related-catalog"] });
}

// #131/#135: query more than one meaningful subject when the source book has them (the top 2-3,
// each a separate Open Library subject-search query run concurrently, matching the existing
// Promise.all fan-out pattern used elsewhere in this file) instead of just `sourceSubjects[0]`.
// One brittle single-subject query was the root cause of a healthy 12-row pool collapsing to 4
// once the post-#130 overlap gate ran (#131). Results across queries are merged/deduped by Open
// Library work key, then ranked by overlap strength (see openLibraryOverlapStrength above) so the
// combined pool stays large without readmitting the Atomic-Habits-style false positive #130 fixed.
async function openLibraryRelated(item, env, fetchImpl, queryImpl, timeoutMs) {
  if (item.provider !== "openlibrary") return [];
  const sourceSubjects = meaningfulBookSubjects(item.genres ?? []);
  const querySubjects = sourceSubjects.slice(0, 3);
  if (!querySubjects.length) return [];

  const storePromise = relatedCanonicalItems(item, querySubjects, { env, query: queryImpl });
  const rows = (await Promise.all(querySubjects.map((subject) => openLibrarySubjectSearch(subject, env, fetchImpl, timeoutMs)))).flat();

  // Keyed by the raw Open Library work key (the real identity), so a live result and a
  // store-canonicalized result for the same book collapse into one entry either way.
  const byKey = new Map();
  for (const row of rows) {
    const key = String(row?.key ?? "");
    if (!key || byKey.has(key)) continue;
    const strength = openLibraryOverlapStrength(sourceSubjects, row.subject ?? []);
    if (!strength) continue;
    byKey.set(key, { row, strength });
  }

  // #144: also consider books Tastemake has already canonicalized with overlapping subjects, run
  // through the same overlap-strength grading as live results, so the pool isn't limited to what
  // this one live subject search happens to return. relatedCanonicalItems degrades to [] on any
  // store failure/timeout, so this never affects the live rows already collected above.
  const storeItems = await storePromise;
  for (const storeItem of storeItems) {
    const key = String(storeItem.providerId ?? "");
    if (!key || byKey.has(key)) continue;
    const strength = openLibraryOverlapStrength(sourceSubjects, storeItem.subject ?? []);
    if (!strength) continue;
    byKey.set(key, { storeItem, strength });
  }

  return [...byKey.values()]
    .sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1))
    .slice(0, 20)
    .map(({ row, storeItem, strength }) => (row
      ? { ...openLibraryItem(row), relationStrength: strength }
      : {
          id: storeItem.id,
          provider: "openlibrary",
          providerId: storeItem.providerId,
          title: storeItem.title,
          type: "book",
          domains: ["read"],
          by: storeItem.by,
          about: storeItem.year ? `First published ${storeItem.year}.` : "Book from Open Library.",
          year: storeItem.year,
          artwork: null,
          genres: storeItem.genres ?? [],
          providerMeta: { seriesKey: storeItem.factual?.seriesKey ?? null, isbns: storeItem.factual?.isbns ?? [] },
          sourceUrl: storeItem.providerId ? `https://openlibrary.org/works/${storeItem.providerId}` : "https://openlibrary.org/",
          relationStrength: strength,
          fromCanonicalStore: true
        }));
}

async function igdbRelated(item, env, fetchImpl, queryImpl) {
  if (item.provider !== "igdb") return [];
  const genreIds = item.providerMeta?.genreIds ?? [];
  if (!genreIds.length) return [];
  // QA sweep real bug: `Number(item.providerId) || 0` silently fell back to excluding "id != 0" when
  // providerId was missing/non-numeric (e.g. a canonical-store-reconstructed candidate) -- real IGDB
  // ids are never 0, so that clause excluded nothing and let the anchor game reappear as its own
  // "related" result. Only add the exclusion clause when providerId genuinely parses as a real id;
  // the client-side filter below (never returning the anchor's own id) is the actual guarantee
  // either way, so a missing/invalid providerId now just means one fewer server-side optimization,
  // not a hole in the guarantee.
  const anchorId = Number(item.providerId);
  const excludeClause = Number.isInteger(anchorId) && anchorId > 0 ? ` & id != ${anchorId}` : "";
  const load = async () => {
    const token = await igdbToken(env, fetchImpl);
    if (!token) return [];
    const response = await fetchWithTimeout(fetchImpl, "https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "client-id": env.IGDB_CLIENT_ID,
        authorization: `Bearer ${token}`,
        "content-type": "text/plain"
      },
      body: `fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,collection.id,franchises.id; where genres = (${genreIds.slice(0, 3).join(",")})${excludeClause}; sort total_rating_count desc; limit 12;`
    });
    if (!response.ok) return [];
    return (await response.json()).map(igdbItem).filter((row) => row.providerId !== item.providerId);
  };
  const storePromise = relatedCanonicalItems(item, item.genres ?? [], { env, query: queryImpl });
  const livePromise = fetchImpl !== fetch
    ? load()
    : cachedValue(`related:igdb:${genreIds.slice(0,3).join("-")}:${item.providerId}`, load, { ttl: 900, tags: ["related-catalog"] });
  const [live, storeItems] = await Promise.all([livePromise, storePromise]);
  // #144: store items canonicalized with IGDB genre *names* (see canonical-store.mjs), so overlap
  // is matched against genre names here, not the numeric genreIds used for the live query above.
  return mergeCanonicalCandidates(live, storeItems, {
    buildProviderMeta: (storeItem) => ({ genreIds: [], collectionId: null, franchiseId: null })
  });
}

// #135 "prefer anchors with richer metadata": a best-effort reorder of evidence items by their
// canonical-store metadata_completeness, within whatever domain-balancing scheme the caller already
// applies (this only changes ORDER within a domain, never which domains are represented). Scoped
// down per #135's own caveat -- a short-timeout, no-op-on-any-failure lookup, not a rearchitecture
// of anchor selection. A missing/unconfigured/slow store, or any error, leaves input order intact.
function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Real bug (2026-09-28): with a real evidence pool much bigger than the 6-anchor cap (73 items in
// one real report), this used to sort deterministically by metadata completeness -- and completeness
// lookups frequently time out in practice (see the store's own 250ms cap), in which case it fell
// back to plain insertion order. Either way, the exact same 6 items won every single round, so the
// other ~67 real experienced items were never explored as anchors at all -- a user with substantial
// real usage could still exhaust the live-provider pool fast, because retrieval was only ever
// drawing from a fixed handful of anchors regardless of how much real evidence existed. Shuffling
// first preserves "prefer richer anchors" as a real signal when completeness data is available (a
// stable sort keeps items tied on completeness in their shuffled relative order, so ties rotate
// between rounds instead of being pinned), and gives genuine rotation across the whole evidence pool
// when completeness data isn't available, which real logs show is common.
function preferRicherAnchors(items) {
  // Select anchors without a database round trip. The old path queried metadata for the entire
  // evidence history before it even knew which <=6 anchors would be used.
  return shuffled(items).sort((a, b) => (b.anchorStrength ?? 0) - (a.anchorStrength ?? 0));
}

async function hydrateSelectedAnchorMetadata(items, { env, query }) {
  const needsLookup = items.filter((item) =>
    item?.provider && item?.providerId && (
      (item.type === "book" && !item.providerMeta?.seriesKey)
      || (item.type === "movie" && !item.providerMeta?.collectionId)
      || (item.type === "game" && !item.providerMeta?.franchiseId)
    )
  );
  if (!needsLookup.length) return items;

  const metadata = await lookupCanonicalAnchorMetadata(needsLookup, { env, query, timeoutMs: 100 });
  if (!metadata.size) return items;
  return items.map((item) => {
    const factual = metadata.get(item.id)?.factual ?? {};
    if (item.type === "book" && factual.seriesKey) {
      return { ...item, providerMeta: { ...(item.providerMeta ?? {}), seriesKey: factual.seriesKey, isbns: item.providerMeta?.isbns ?? factual.isbns ?? [] } };
    }
    if (item.type === "movie" && factual.collectionId) {
      return { ...item, providerMeta: { ...(item.providerMeta ?? {}), collectionId: factual.collectionId } };
    }
    if (item.type === "game" && factual.franchiseId) {
      return { ...item, providerMeta: { ...(item.providerMeta ?? {}), franchiseId: factual.franchiseId } };
    }
    return item;
  });
}

export async function retrieveCatalogCandidates(state, { env = process.env, fetchImpl = fetch, limit = 30, query: queryImpl } = {}) {
  const mode = state.recommendationFilter ?? "all";
  const allEvidence = preferRicherAnchors(externalEvidenceItems(state));
  let evidenceItems = mode === "all"
    ? selectAllAnchors(allEvidence)
    : allEvidence.filter((item) => item.domains?.includes(mode)).slice(0, 6);
  if (!evidenceItems.length) return [];
  // Preserve series/franchise suppression, but only query the tiny selected-anchor set and cap
  // the optional lookup at 100ms instead of blocking on the user's entire evidence history.
  evidenceItems = await hydrateSelectedAnchorMetadata(evidenceItems, { env, query: queryImpl });

  // #135: once an experienced item is important enough to become a live retrieval anchor, fill
  // high-value provider metadata in the background and persist it to the canonical store. This
  // never blocks candidate retrieval and does not change what the model sees on this request.
  // Injected fetch implementations are test/offline paths; do not create extra hidden provider
  // calls there. Production uses the native fetch and gets background enrichment normally.
  if (fetchImpl === fetch) {
    for (const item of evidenceItems) enrichCanonicalItemWriteBehind(item, { env, fetchImpl, query: queryImpl });
  }

  // #120: per-item provider timing, logged in the sanitized style used elsewhere (never the
  // provider payload itself, just provider name/ms/result count) so a slow TMDb/Open
  // Library/IGDB call is visible without guessing. Items within a wave already run concurrently
  // (Promise.all below) — this only measures that existing concurrency, it does not add any.
  const loadEvidence = async (items) => Promise.all(items.map(async (item) => {
    const startedAt = Date.now();
    try {
      let related = [];
      if (item.provider === "tmdb") related = await tmdbRelated(item, env, fetchImpl, queryImpl);
      else if (item.provider === "openlibrary") {
        const timeoutMs = mode === "all" ? Number(env.TASTEMAKE_OPENLIBRARY_MIXED_TIMEOUT_MS || 1750) : undefined;
        related = await openLibraryRelated(item, env, fetchImpl, queryImpl, timeoutMs);
      }
      else if (item.provider === "igdb") related = await igdbRelated(item, env, fetchImpl, queryImpl);
      console.info("[tastemake-related]", JSON.stringify({ provider: item.provider, ms: Date.now() - startedAt, results: related.length }));
      // #135 foundation: write-behind canonicalization of real related candidates (see the same
      // note in providers.mjs's searchCatalog). Not awaited, never throws, no-op when
      // TASTEMAKE_DATABASE_URL isn't configured.
      canonicalizeWriteBehind(related, { env });
      return related.map((candidate) => ({ ...candidate, relatedTo: item.title, relatedToId: item.id }));
    } catch {
      console.info("[tastemake-related]", JSON.stringify({ provider: item.provider, ms: Date.now() - startedAt, results: 0, errored: true }));
      return [];
    }
  }));

  // Start with four diverse evidence sources. Only fan out to the remaining two when the
  // first wave cannot provide a healthy pool, which keeps the common path faster.
  const firstWave = evidenceItems.slice(0, 4);
  const laterWave = evidenceItems.slice(4);
  const waveStarted = Date.now();
  const rows = await loadEvidence(firstWave);
  console.info("[tastemake-related]", JSON.stringify({ wave: "first", items: firstWave.length, ms: Date.now() - waveStarted }));

  // #120 follow-up: recommendationSets arrives over the wire as arrays of ids, not full item objects
  // (see serializeAiState in ai/live-client.js) -- this was the only thing ever read from them here.
  // Accepts a bare id or a full object (still the shape several test fixtures construct directly).
  // Real bug (2026-09-28): this used to block only `evidenceItems`, the <=6-item subset actually
  // queried as anchors this round -- fine back when a user's whole real evidence set was roughly
  // that small, but once #150 correctly widened externalEvidenceItems() to surface a user's entire
  // Library history, `allEvidence` regularly holds far more than 6 items. Anything not competitively
  // selected as an anchor this round (e.g. an already-loved favorite that just didn't win one of the
  // 6 anchor slots) fell through every exclusion check here and could resurface as a "new"
  // recommendation -- confirmed for real: a user's own already-marked favorite (Crouching Tiger,
  // Hidden Dragon) came back as a pick. Blocking the full allEvidence set (not just this round's
  // anchor subset) fixes it regardless of how many anchors get used to actually fetch candidates.
  const blocked = new Set([
    ...allEvidence.map((item) => item.id),
    ...(state.seenItemIds ?? []),
    ...Object.keys(state.feedbackByRecommendation ?? {}),
    ...(state.recommendationSets ?? []).flat().map((entry) => (typeof entry === "string" ? entry : entry?.id))
  ]);
  const providerKey = (item) => item?.provider && item?.providerId ? `${item.provider}:${item.type ?? ""}:${item.providerId}` : null;
  const blockedProviderKeys = new Set(allEvidence.map(providerKey).filter(Boolean));
  let eligible = uniq(interleave(rows)).filter((item) => !blocked.has(item.id) && !blockedProviderKeys.has(providerKey(item)) && areaAllowed(state, item) && modeAllowed(state, item));
  const guardStarted = Date.now();
  let guarded = applyMixedNoveltyGuard(eligible, evidenceItems, mode);
  console.info("[tastemake-related]", JSON.stringify({ noveltyGuardMs: Date.now() - guardStarted, eligible: eligible.length, primary: guarded.primary.length }));

  const domainSet = (items) => new Set(items.flatMap((item) => item.domains ?? []));
  const desiredDomains = domainSet(evidenceItems);
  const coveredDomains = domainSet(guarded.primary);
  const missingEvidenceDomain = mode === "all"
    && [...desiredDomains].some((domain) => !coveredDomains.has(domain));

  // A numerically large pool is not actually healthy for the All view when one of the user's
  // represented evidence domains produced no candidates. Previously, two strong movie branches
  // could yield 12+ rows while game/book/TV branches returned zero; that skipped the remaining
  // anchors and made the supposedly mixed set collapse to one medium. Try the remaining anchors
  // whenever coverage is missing, then let balanceDomains() interleave whatever genuinely exists.
  if ((guarded.primary.length < Math.min(12, limit) || missingEvidenceDomain) && laterWave.length) {
    const secondWaveStarted = Date.now();
    rows.push(...await loadEvidence(laterWave));
    console.info("[tastemake-related]", JSON.stringify({ wave: "second", items: laterWave.length, ms: Date.now() - secondWaveStarted }));
    eligible = uniq(interleave(rows)).filter((item) => !blocked.has(item.id) && !blockedProviderKeys.has(providerKey(item)) && areaAllowed(state, item) && modeAllowed(state, item));
    guarded = applyMixedNoveltyGuard(eligible, evidenceItems, mode);
  }

  if (mode === "all") {
    const finalDomains = [...domainSet(guarded.primary)];
    console.info("[tastemake-related]", JSON.stringify({
      domainCoverage: true,
      anchorDomains: [...desiredDomains],
      candidateDomains: finalDomains
    }));
  }

  // #92: the novelty guard runs here — after retrieval, before this shared function returns
  // candidates to either the deterministic baseline (src/ai/baseline.js) or the live-AI ranking
  // path (api/recommendations.mjs), both of which call retrieveCatalogCandidates. Suppressed
  // sequels/remakes are dropped from the primary pool; whatever else was retrieved fills their slot.
  const ranked = balanceDomains(guarded.primary, state.recommendationFilter ?? "all");
  const style = state.recommendationStyle ?? (state.curveball === false ? "safe" : "balanced");
  if (style === "adventurous" && state.curveball !== false && ranked.length > 6) {
    // Balanced keeps the normal top-ranked set. Adventurous preserves the five strongest fits
    // but reaches deeper into the eligible pool for the one exploratory slot.
    const adventurous = ranked.slice(0, limit);
    if (adventurous.length >= 6) {
      const deepIndex = Math.min(adventurous.length - 1, 9);
      [adventurous[5], adventurous[deepIndex]] = [adventurous[deepIndex], adventurous[5]];
    }
    return adventurous;
  }
  return ranked.slice(0, limit);
}
