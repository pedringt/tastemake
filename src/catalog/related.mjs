import { igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";
import { applyNoveltyGuard } from "./novelty.mjs";
import { cachedValue } from "../server/cache.mjs";

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

async function tmdbRelated(item, env, fetchImpl) {
  if (!env.TASTEMAKE_TMDB_TOKEN || item.provider !== "tmdb") return [];
  const load = async () => {
    const kind = item.type === "tv" ? "tv" : "movie";
    const response = await fetchImpl(`https://api.themoviedb.org/3/${kind}/${item.providerId}/recommendations?language=en-US&page=1`, {
      headers: { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" }
    });
    if (!response.ok) return [];
    return ((await response.json()).results ?? []).slice(0, 12).map((row) => tmdbItem(row, kind));
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`related:tmdb:${item.type}:${item.providerId}`, load, { ttl: 900, tags: ["related-catalog"] });
}

async function openLibraryRelated(item, env, fetchImpl) {
  if (item.provider !== "openlibrary") return [];
  const subject = item.genres?.find(Boolean);
  if (!subject) return [];
  const load = async () => {
    const fields = "key,title,author_name,first_publish_year,cover_i,subject";
    const response = await fetchImpl(`https://openlibrary.org/search.json?q=${encodeURIComponent(`subject:"${subject}"`)}&limit=12&fields=${fields}`, {
      headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
    });
    if (!response.ok) return [];
    return ((await response.json()).docs ?? []).slice(0, 12).map(openLibraryItem);
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`related:openlibrary:${String(subject).toLowerCase()}`, load, { ttl: 900, tags: ["related-catalog"] });
}

async function igdbRelated(item, env, fetchImpl) {
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
  if (fetchImpl !== fetch) return load();
  return cachedValue(`related:igdb:${genreIds.slice(0,3).join("-")}:${item.providerId}`, load, { ttl: 900, tags: ["related-catalog"] });
}

export async function retrieveCatalogCandidates(state, { env = process.env, fetchImpl = fetch, limit = 30 } = {}) {
  const mode = state.recommendationFilter ?? "all";
  const allEvidence = externalEvidenceItems(state);
  const evidenceItems = (mode === "all"
    ? balanceDomains(allEvidence, "all")
    : allEvidence.filter((item) => item.domains?.includes(mode))
  ).slice(0, 6);
  if (!evidenceItems.length) return [];

  const loadEvidence = async (items) => Promise.all(items.map(async (item) => {
    try {
      let related = [];
      if (item.provider === "tmdb") related = await tmdbRelated(item, env, fetchImpl);
      else if (item.provider === "openlibrary") related = await openLibraryRelated(item, env, fetchImpl);
      else if (item.provider === "igdb") related = await igdbRelated(item, env, fetchImpl);
      return related.map((candidate) => ({ ...candidate, relatedTo: item.title, relatedToId: item.id }));
    } catch {
      return [];
    }
  }));

  // Start with four diverse evidence sources. Only fan out to the remaining two when the
  // first wave cannot provide a healthy pool, which keeps the common path faster.
  const firstWave = evidenceItems.slice(0, 4);
  const laterWave = evidenceItems.slice(4);
  const rows = await loadEvidence(firstWave);

  const blocked = new Set([
    ...evidenceItems.map((item) => item.id),
    ...Object.keys(state.feedbackByRecommendation ?? {}),
    ...(state.recommendationSets ?? []).flat().map((item) => item.id)
  ]);
  let eligible = uniq(interleave(rows)).filter((item) => !blocked.has(item.id) && areaAllowed(state, item) && modeAllowed(state, item));
  let guarded = applyNoveltyGuard(eligible, evidenceItems);
  if (guarded.primary.length < Math.min(12, limit) && laterWave.length) {
    rows.push(...await loadEvidence(laterWave));
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
    if (adventurous.length >= 6) adventurous[5] = ranked[Math.min(ranked.length - 1, 9)];
    return adventurous;
  }
  return ranked.slice(0, limit);
}
