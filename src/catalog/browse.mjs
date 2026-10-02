import { browseGenreById } from "./browse-genres.js";
import { igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";

export const BROWSE_PAGE_SIZE = 12;

async function browseTmdb(genre, page, env, fetchImpl, mediaType) {
  if (!env.TASTEMAKE_TMDB_TOKEN) return { items: [], configured: false };
  const genreId = mediaType === "tv" ? genre.provider.tv : genre.provider.movie;
  if (!genreId) return { items: [], configured: true, hasMore: false };
  const headers = { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" };
  const common = `sort_by=popularity.desc&include_adult=false&language=en-US&page=${page}`;
  const response = await fetchImpl(`https://api.themoviedb.org/3/discover/${mediaType}?with_genres=${genreId}&${common}`, { headers });
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

async function browsePlay(genre, page, env, fetchImpl) {
  const token = await igdbToken(env, fetchImpl);
  if (!token) return { items: [], configured: false };
  const offset = (page - 1) * BROWSE_PAGE_SIZE;
  const filter = genre.provider.kind === "genre"
    ? `where genres = (${Number(genre.provider.value)});`
    : genre.provider.kind === "theme"
      ? `where themes = (${Number(genre.provider.value)});`
      : genre.provider.kind === "where"
        ? `where ${String(genre.provider.value).replace(/;/g, "")};`
        : `search "${String(genre.provider.value).replace(/"/g, "")}";`;
  const sort = genre.provider.kind === "search" ? "" : "sort total_rating_count desc;";
  const response = await fetchImpl("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "client-id": env.IGDB_CLIENT_ID,
      authorization: `Bearer ${token}`,
      "content-type": "text/plain"
    },
    body: `fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,collection.id,franchises.id,total_rating_count; ${filter} ${sort} limit ${BROWSE_PAGE_SIZE}; offset ${offset};`
  });
  if (!response.ok) throw new Error("igdb browse unavailable");
  const rows = await response.json();
  return {
    items: rows.map(igdbItem),
    configured: true,
    hasMore: rows.length >= BROWSE_PAGE_SIZE
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
