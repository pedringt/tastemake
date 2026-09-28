import { igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";
import { applyNoveltyGuard } from "./novelty.mjs";
import { cachedValue } from "../server/cache.mjs";
import { canonicalizeWriteBehind, lookupMetadataCompleteness, relatedCanonicalItems } from "./canonical-store.mjs";

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
  const buckets = new Map([["watch", []], ["read", []], ["play", []], ["other", []]]);
  for (const item of items) {
    const key = ["watch", "read", "play"].find((domain) => item.domains?.includes(domain)) ?? "other";
    buckets.get(key).push(item);
  }
  return interleave([...buckets.values()].filter((bucket) => bucket.length));
}

function externalEvidenceItems(state) {
  const ids = new Set([
    ...(state.selectedFavorites ?? []),
    ...Object.keys(state.feedbackByRecommendation ?? {})
  ]);
  return Object.values(state.customItems ?? {})
    .filter((item) => item?.provider && ids.has(item.id))
    .map((item) => ({
      ...item,
      seriesExperience: state.feedbackByRecommendation?.[item.id]?.seriesExperience ?? null
    }));
}

// #144: appends related candidates Tastemake has already canonicalized (genre overlap with the
// anchor) that this live call didn't happen to return. Store lookup failures/timeouts already
// resolve to [] inside relatedCanonicalItems, so this never affects the live-provider pool passed
// in as `live`. Capped at 20 total, matching openLibraryRelated's pool cap below.
async function mergeCanonicalCandidates(live, anchor, subjects, { env, queryImpl, buildProviderMeta }) {
  const storeItems = await relatedCanonicalItems(anchor, subjects, { env, query: queryImpl });
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
    const response = await fetchImpl(`https://api.themoviedb.org/3/${kind}/${item.providerId}/recommendations?language=en-US&page=1`, {
      headers: { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" }
    });
    if (!response.ok) return [];
    return ((await response.json()).results ?? []).slice(0, 12).map((row) => tmdbItem(row, kind));
  };
  const live = fetchImpl !== fetch ? await load() : await cachedValue(`related:tmdb:${item.type}:${item.providerId}`, load, { ttl: 900, tags: ["related-catalog"] });
  return mergeCanonicalCandidates(live, item, item.genres ?? [], {
    env,
    queryImpl,
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

async function openLibrarySubjectSearch(subject, env, fetchImpl) {
  const fields = "key,title,author_name,first_publish_year,cover_i,subject,series_key";
  const load = async () => {
    const response = await fetchImpl(`https://openlibrary.org/search.json?q=${encodeURIComponent(`subject:"${subject}"`)}&limit=12&fields=${fields}`, {
      headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
    });
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
async function openLibraryRelated(item, env, fetchImpl, queryImpl) {
  if (item.provider !== "openlibrary") return [];
  const sourceSubjects = meaningfulBookSubjects(item.genres ?? []);
  const querySubjects = sourceSubjects.slice(0, 3);
  if (!querySubjects.length) return [];

  const rows = (await Promise.all(querySubjects.map((subject) => openLibrarySubjectSearch(subject, env, fetchImpl)))).flat();

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
  const storeItems = await relatedCanonicalItems(item, querySubjects, { env, query: queryImpl });
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
          providerMeta: { seriesKey: null },
          sourceUrl: storeItem.providerId ? `https://openlibrary.org/works/${storeItem.providerId}` : "https://openlibrary.org/",
          relationStrength: strength,
          fromCanonicalStore: true
        }));
}

async function igdbRelated(item, env, fetchImpl, queryImpl) {
  if (item.provider !== "igdb") return [];
  const genreIds = item.providerMeta?.genreIds ?? [];
  if (!genreIds.length) return [];
  const load = async () => {
    const token = await igdbToken(env, fetchImpl);
    if (!token) return [];
    const response = await fetchImpl("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "client-id": env.IGDB_CLIENT_ID,
        authorization: `Bearer ${token}`,
        "content-type": "text/plain"
      },
      body: `fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,collection.id,franchises.id; where genres = (${genreIds.slice(0, 3).join(",")}) & id != ${Number(item.providerId) || 0}; sort total_rating_count desc; limit 12;`
    });
    if (!response.ok) return [];
    return (await response.json()).map(igdbItem);
  };
  const live = fetchImpl !== fetch ? await load() : await cachedValue(`related:igdb:${genreIds.slice(0,3).join("-")}:${item.providerId}`, load, { ttl: 900, tags: ["related-catalog"] });
  // #144: store items canonicalized with IGDB genre *names* (see canonical-store.mjs), so overlap
  // is matched against genre names here, not the numeric genreIds used for the live query above.
  return mergeCanonicalCandidates(live, item, item.genres ?? [], {
    env,
    queryImpl,
    buildProviderMeta: (storeItem) => ({ genreIds: [], collectionId: null, franchiseId: null })
  });
}

// #135 "prefer anchors with richer metadata": a best-effort reorder of evidence items by their
// canonical-store metadata_completeness, within whatever domain-balancing scheme the caller already
// applies (this only changes ORDER within a domain, never which domains are represented). Scoped
// down per #135's own caveat -- a short-timeout, no-op-on-any-failure lookup, not a rearchitecture
// of anchor selection. A missing/unconfigured/slow store, or any error, leaves input order intact.
async function preferRicherAnchors(items, { env, fetchImpl }) {
  if (!items.length) return items;
  try {
    const completeness = await lookupMetadataCompleteness(items, { env });
    if (!completeness.size) return items;
    return [...items].sort((a, b) => (completeness.get(b.id) ?? -1) - (completeness.get(a.id) ?? -1));
  } catch {
    return items;
  }
}

export async function retrieveCatalogCandidates(state, { env = process.env, fetchImpl = fetch, limit = 30, query: queryImpl } = {}) {
  const mode = state.recommendationFilter ?? "all";
  const allEvidence = await preferRicherAnchors(externalEvidenceItems(state), { env, fetchImpl });
  const evidenceItems = (mode === "all"
    ? balanceDomains(allEvidence, "all")
    : allEvidence.filter((item) => item.domains?.includes(mode))
  ).slice(0, 6);
  if (!evidenceItems.length) return [];

  // #120: per-item provider timing, logged in the sanitized style used elsewhere (never the
  // provider payload itself, just provider name/ms/result count) so a slow TMDb/Open
  // Library/IGDB call is visible without guessing. Items within a wave already run concurrently
  // (Promise.all below) — this only measures that existing concurrency, it does not add any.
  const loadEvidence = async (items) => Promise.all(items.map(async (item) => {
    const startedAt = Date.now();
    try {
      let related = [];
      if (item.provider === "tmdb") related = await tmdbRelated(item, env, fetchImpl, queryImpl);
      else if (item.provider === "openlibrary") related = await openLibraryRelated(item, env, fetchImpl, queryImpl);
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

  const blocked = new Set([
    ...evidenceItems.map((item) => item.id),
    ...Object.keys(state.feedbackByRecommendation ?? {}),
    ...(state.recommendationSets ?? []).flat().map((item) => item.id)
  ]);
  let eligible = uniq(interleave(rows)).filter((item) => !blocked.has(item.id) && areaAllowed(state, item) && modeAllowed(state, item));
  const guardStarted = Date.now();
  let guarded = applyNoveltyGuard(eligible, evidenceItems);
  console.info("[tastemake-related]", JSON.stringify({ noveltyGuardMs: Date.now() - guardStarted, eligible: eligible.length, primary: guarded.primary.length }));
  if (guarded.primary.length < Math.min(12, limit) && laterWave.length) {
    const secondWaveStarted = Date.now();
    rows.push(...await loadEvidence(laterWave));
    console.info("[tastemake-related]", JSON.stringify({ wave: "second", items: laterWave.length, ms: Date.now() - secondWaveStarted }));
    eligible = uniq(interleave(rows)).filter((item) => !blocked.has(item.id) && areaAllowed(state, item) && modeAllowed(state, item));
    guarded = applyNoveltyGuard(eligible, evidenceItems);
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
