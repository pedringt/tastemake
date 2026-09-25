import { igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";
import { applyNoveltyGuard } from "./novelty.mjs";

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
  const kind = item.type === "tv" ? "tv" : "movie";
  const response = await fetchImpl(`https://api.themoviedb.org/3/${kind}/${item.providerId}/recommendations?language=en-US&page=1`, {
    headers: { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" }
  });
  if (!response.ok) return [];
  return ((await response.json()).results ?? []).slice(0, 12).map((row) => tmdbItem(row, kind));
}

async function openLibraryRelated(item, env, fetchImpl) {
  if (item.provider !== "openlibrary") return [];
  const subject = item.genres?.find(Boolean);
  if (!subject) return [];
  const fields = "key,title,author_name,first_publish_year,cover_i,subject";
  const response = await fetchImpl(`https://openlibrary.org/search.json?q=${encodeURIComponent(`subject:"${subject}"`)}&limit=12&fields=${fields}`, {
    headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
  });
  if (!response.ok) return [];
  return ((await response.json()).docs ?? []).slice(0, 12).map(openLibraryItem);
}

async function igdbRelated(item, env, fetchImpl) {
  if (item.provider !== "igdb") return [];
  const genreIds = item.providerMeta?.genreIds ?? [];
  if (!genreIds.length) return [];
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
}

export async function retrieveCatalogCandidates(state, { env = process.env, fetchImpl = fetch, limit = 30 } = {}) {
  const evidenceItems = externalEvidenceItems(state).slice(0, 6);
  if (!evidenceItems.length) return [];

  const rows = await Promise.all(evidenceItems.map(async (item) => {
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

  const blocked = new Set([
    ...evidenceItems.map((item) => item.id),
    ...Object.keys(state.feedbackByRecommendation ?? {}),
    ...(state.recommendationSets ?? []).flat().map((item) => item.id)
  ]);
  const eligible = uniq(interleave(rows)).filter((item) => !blocked.has(item.id) && areaAllowed(state, item) && modeAllowed(state, item));

  // #92: the novelty guard runs here — after retrieval, before this shared function returns
  // candidates to either the deterministic baseline (src/ai/baseline.js) or the live-AI ranking
  // path (api/recommendations.mjs), both of which call retrieveCatalogCandidates. Suppressed
  // sequels/remakes are dropped from the primary pool; whatever else was retrieved fills their slot.
  const { primary } = applyNoveltyGuard(eligible, evidenceItems);
  return balanceDomains(primary, state.recommendationFilter ?? "all").slice(0, limit);
}
