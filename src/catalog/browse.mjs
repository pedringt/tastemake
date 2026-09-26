import { browseGenreById } from "./browse-genres.js";
import { igdbItem, igdbToken, openLibraryItem, tmdbItem } from "./providers.mjs";

export const BROWSE_PAGE_SIZE = 12;

function interleave(rows) {
  const out = [];
  const depth = Math.max(0, ...rows.map((bucket) => bucket.length));
  for (let i = 0; i < depth; i += 1) {
    for (const bucket of rows) if (bucket[i]) out.push(bucket[i]);
  }
  return out;
}

async function browseWatch(genre, page, env, fetchImpl) {
  if (!env.TASTEMAKE_TMDB_TOKEN) return { items: [], configured: false };
  const headers = { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" };
  const params = `with_genres=${genre.provider.value}&sort_by=popularity.desc&include_adult=false&language=en-US&page=${page}`;
  const [movies, tv] = await Promise.all([
    fetchImpl(`https://api.themoviedb.org/3/discover/movie?${params}`, { headers }),
    fetchImpl(`https://api.themoviedb.org/3/discover/tv?${params}`, { headers })
  ]);
  if (!movies.ok && !tv.ok) throw new Error("tmdb browse unavailable");
  const movieRows = movies.ok ? ((await movies.json()).results ?? []).slice(0, 10).map((row) => tmdbItem(row, "movie")) : [];
  const tvRows = tv.ok ? ((await tv.json()).results ?? []).slice(0, 10).map((row) => tmdbItem(row, "tv")) : [];
  const items = interleave([movieRows, tvRows]).slice(0, BROWSE_PAGE_SIZE);
  return { items, configured: true, hasMore: movieRows.length >= 10 || tvRows.length >= 10 };
}

async function browseRead(genre, page, env, fetchImpl) {
  const fields = "key,title,author_name,first_publish_year,cover_i,subject";
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
    if (domain === "watch") result = await browseWatch(genre, safePage, env, fetchImpl);
    else if (domain === "read") result = await browseRead(genre, safePage, env, fetchImpl);
    else if (domain === "play") result = await browsePlay(genre, safePage, env, fetchImpl);
    else return { items: [], hasMore: false, degraded: true };

    return {
      items: result.items ?? [],
      hasMore: Boolean(result.hasMore),
      degraded: result.configured === false
    };
  } catch {
    return { items: [], hasMore: false, degraded: true };
  }
}
