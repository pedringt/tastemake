import { browseGenreById } from "./browse-genres.js";
import { igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";

export const BROWSE_PAGE_SIZE = 12;

async function resolveTmdbKeywordId(keyword, headers, fetchImpl) {
  const response = await fetchImpl(`https://api.themoviedb.org/3/search/keyword?query=${encodeURIComponent(keyword)}&page=1`, { headers });
  if (!response.ok) throw new Error("tmdb keyword search unavailable");
  const results = (await response.json()).results ?? [];
  const exact = results.find((row) => String(row.name ?? "").trim().toLowerCase() === String(keyword).trim().toLowerCase());
  return exact?.id ?? results[0]?.id ?? null;
}

async function browseTmdb(genre, page, env, fetchImpl, mediaType) {
  if (!env.TASTEMAKE_TMDB_TOKEN) return { items: [], configured: false };
  const headers = { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" };
  const common = `sort_by=popularity.desc&include_adult=false&language=en-US&page=${page}`;
  let filter = "";
  if (genre.provider.kind === "keyword") {
    const keywordId = await resolveTmdbKeywordId(genre.provider.value, headers, fetchImpl);
    if (!keywordId) return { items: [], configured: true, hasMore: false };
    filter = `with_keywords=${keywordId}`;
  } else {
    const genreId = mediaType === "tv" ? genre.provider.tv : genre.provider.movie;
    if (!genreId) return { items: [], configured: true, hasMore: false };
    filter = `with_genres=${genreId}`;
  }
  const response = await fetchImpl(`https://api.themoviedb.org/3/discover/${mediaType}?${filter}&${common}`, { headers });
  if (!response.ok) throw new Error("tmdb browse unavailable");
  const rows = ((await response.json()).results ?? []).slice(0, BROWSE_PAGE_SIZE).map((row) => tmdbItem(row, mediaType));
  return { items: rows, configured: true, hasMore: rows.length >= BROWSE_PAGE_SIZE };
}

const browseMovies = (genre, page, env, fetchImpl) => browseTmdb(genre, page, env, fetchImpl, "movie");
const browseTv = (genre, page, env, fetchImpl) => browseTmdb(genre, page, env, fetchImpl, "tv");

async function browseRead(genre, page, env, fetchImpl) {
  const fields = "key,title,author_name,first_publish_year,cover_i,subject,series_key";
  const offset = (page - 1) * BROWSE_PAGE_SIZE;
  const url = `https://openlibrary.org/search.json?subject=${encodeURIComponent(genre.provider.value)}&limit=${BROWSE_PAGE_SIZE}&offset=${offset}&fields=${fields}`;
  const response = await fetchImpl(url, {
    headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
  });
  if (!response.ok) throw new Error("openlibrary browse unavailable");
  const docs = (await response.json()).docs ?? [];
  return {
    items: docs.slice(0, BROWSE_PAGE_SIZE).map(openLibraryItem),
    configured: true,
    hasMore: docs.length >= BROWSE_PAGE_SIZE
  };
}

async function igdbTaxonomy(token, env, fetchImpl) {
  const request = async (path) => {
    const response = await fetchImpl(`https://api.igdb.com/v4/${path}`, {
      method: "POST",
      headers: {
        "client-id": env.IGDB_CLIENT_ID,
        authorization: `Bearer ${token}`,
        "content-type": "text/plain"
      },
      body: "fields id,name; limit 100;"
    });
    if (!response.ok) throw new Error(`igdb ${path} unavailable`);
    return response.json();
  };
  const [genres, themes] = await Promise.all([request("genres"), request("themes")]);
  return { genres, themes };
}

function taxonomyIds(rows, names = []) {
  const wanted = new Set(names.map((name) => String(name).toLowerCase()));
  return rows.filter((row) => wanted.has(String(row.name ?? "").toLowerCase())).map((row) => Number(row.id)).filter(Number.isFinite);
}

function igdbMetadataFilter(provider, taxonomy) {
  const genreIds = taxonomyIds(taxonomy.genres, provider.genres);
  const themeIds = taxonomyIds(taxonomy.themes, provider.themes);
  const parts = [];
  if (genreIds.length) parts.push(`genres = (${genreIds.join(", ")})`);
  if (themeIds.length) parts.push(`themes = (${themeIds.join(", ")})`);
  return { where: parts.length ? `where ${parts.join(" | ")};` : "", genreIds, themeIds };
}

function metadataNames(rows = []) {
  return new Set(rows.map((row) => String(row?.name ?? "").trim().toLowerCase()).filter(Boolean));
}

function matchesRequiredMetadata(row, provider) {
  const genres = metadataNames(row.genres);
  const themes = metadataNames(row.themes);
  const excludedGenres = (provider.excludeGenres ?? []).map((name) => String(name).toLowerCase());
  const excludedThemes = (provider.excludeThemes ?? []).map((name) => String(name).toLowerCase());
  if (excludedGenres.some((name) => genres.has(name))) return false;
  if (excludedThemes.some((name) => themes.has(name))) return false;

  const requiredGenres = (provider.requireGenres ?? []).map((name) => String(name).toLowerCase());
  const requiredThemes = (provider.requireThemes ?? []).map((name) => String(name).toLowerCase());
  if (requiredGenres.length && !requiredGenres.some((name) => genres.has(name))) return false;
  if (requiredThemes.length && !requiredThemes.some((name) => themes.has(name))) return false;
  return true;
}

async function browsePlay(genre, page, env, fetchImpl) {
  const token = await igdbToken(env, fetchImpl);
  if (!token) return { items: [], configured: false };

  const provider = genre.provider;
  if (provider.kind !== "metadata") return { items: [], configured: true, hasMore: false };

  const taxonomy = await igdbTaxonomy(token, env, fetchImpl);
  const { where } = igdbMetadataFilter(provider, taxonomy);
  if (!where) return { items: [], configured: true, hasMore: false };

  // Curated categories can be much narrower than IGDB's discovery query. Build pages from
  // qualifying results rather than from raw candidate pages so users do not see 1 item, then 7,
  // then an empty page even though more matching games exist farther down the provider results.
  const candidateLimit = BROWSE_PAGE_SIZE * 3;
  const targetStart = (page - 1) * BROWSE_PAGE_SIZE;
  const targetEnd = targetStart + BROWSE_PAGE_SIZE;
  const maxBatches = 10;
  const qualifying = [];
  let offset = 0;
  let exhausted = false;

  for (let batch = 0; batch < maxBatches && qualifying.length < targetEnd; batch += 1) {
    const response = await fetchImpl("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "client-id": env.IGDB_CLIENT_ID,
        authorization: `Bearer ${token}`,
        "content-type": "text/plain"
      },
      body: `fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,themes.id,themes.name,collection.id,franchises.id,total_rating_count; ${where} sort total_rating_count desc; limit ${candidateLimit}; offset ${offset};`
    });
    if (!response.ok) throw new Error("igdb browse unavailable");
    const rows = await response.json();
    qualifying.push(...rows.filter((row) => matchesRequiredMetadata(row, provider)));
    if (rows.length < candidateLimit) {
      exhausted = true;
      break;
    }
    offset += candidateLimit;
  }

  return {
    items: qualifying.slice(targetStart, targetEnd).map(igdbItem),
    configured: true,
    hasMore: qualifying.length > targetEnd || (!exhausted && qualifying.length >= targetEnd)
  };
}

export async function browseCatalog({ domain, genreId, page = 1, env = process.env, fetchImpl = fetch } = {}) {
  const genre = browseGenreById(domain, genreId);
  const safePage = Math.max(1, Math.min(20, Number(page) || 1));
  if (!genre) return { items: [], hasMore: false, degraded: true };

  try {
    let result;
    if (domain === "movies") result = await browseMovies(genre, safePage, env, fetchImpl);
    else if (domain === "tv") result = await browseTv(genre, safePage, env, fetchImpl);
    else if (domain === "read") result = await browseRead(genre, safePage, env, fetchImpl);
    else if (domain === "play") result = await browsePlay(genre, safePage, env, fetchImpl);
    else return { items: [], hasMore: false, degraded: true };

    return {
      items: result.items ?? [],
      hasMore: safePage < 20 && Boolean(result.hasMore),
      degraded: result.configured === false
    };
  } catch {
    return { items: [], hasMore: false, degraded: true };
  }
}
