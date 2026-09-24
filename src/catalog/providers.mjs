const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
const OL_SEARCH = "https://openlibrary.org/search.json";
const IGDB_GAMES = "https://api.igdb.com/v4/games";
const TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token";

const domainAllows = (domain, wanted) => domain === "all" || domain === wanted;
const clean = (value, n = 280) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const uniq = (items) => {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
};

function tmdbItem(row, type) {
  const title = type === "tv" ? row.name : row.title;
  const date = type === "tv" ? row.first_air_date : row.release_date;
  return {
    id: `tmdb-${type}-${row.id}`,
    provider: "tmdb",
    providerId: String(row.id),
    title: clean(title, 100),
    type,
    domains: ["watch"],
    about: clean(row.overview || "No description available."),
    year: date ? String(date).slice(0, 4) : null,
    artwork: row.poster_path ? `${TMDB_IMAGE}${row.poster_path}` : null,
    genres: (row.genre_ids ?? []).map(String),
    providerMeta: { genreIds: row.genre_ids ?? [] },
    sourceUrl: type === "tv" ? `https://www.themoviedb.org/tv/${row.id}` : `https://www.themoviedb.org/movie/${row.id}`
  };
}

async function searchTmdb(query, env, fetchImpl) {
  const token = env.TASTEMAKE_TMDB_TOKEN;
  if (!token) return [];
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const q = encodeURIComponent(query);
  const [movies, tv] = await Promise.all([
    fetchImpl(`https://api.themoviedb.org/3/search/movie?query=${q}&include_adult=false&language=en-US&page=1`, { headers }),
    fetchImpl(`https://api.themoviedb.org/3/search/tv?query=${q}&include_adult=false&language=en-US&page=1`, { headers })
  ]);
  const out = [];
  if (movies.ok) out.push(...((await movies.json()).results ?? []).slice(0, 6).map((x) => tmdbItem(x, "movie")));
  if (tv.ok) out.push(...((await tv.json()).results ?? []).slice(0, 6).map((x) => tmdbItem(x, "tv")));
  return out;
}

function openLibraryItem(row) {
  const key = String(row.key ?? "").replace("/works/", "");
  return {
    id: `openlibrary-book-${key.replace(/[^A-Za-z0-9_-]/g, "")}`,
    provider: "openlibrary",
    providerId: key,
    title: clean(row.title, 120),
    type: "book",
    domains: ["read"],
    by: clean((row.author_name ?? []).slice(0, 3).join(", "), 120),
    about: row.first_publish_year ? `First published ${row.first_publish_year}.` : "Book from Open Library.",
    year: row.first_publish_year ? String(row.first_publish_year) : null,
    artwork: row.cover_i ? `https://covers.openlibrary.org/b/id/${row.cover_i}-M.jpg?default=false` : null,
    genres: (row.subject ?? []).slice(0, 12).map((x) => clean(x, 60)),
    sourceUrl: key ? `https://openlibrary.org/works/${key}` : "https://openlibrary.org/"
  };
}

async function searchOpenLibrary(query, env, fetchImpl) {
  const fields = "key,title,author_name,first_publish_year,cover_i,subject";
  const response = await fetchImpl(`${OL_SEARCH}?q=${encodeURIComponent(query)}&limit=8&fields=${fields}`, {
    headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
  });
  if (!response.ok) return [];
  return ((await response.json()).docs ?? []).slice(0, 8).map(openLibraryItem);
}

async function igdbToken(env, fetchImpl) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const url = `${TWITCH_TOKEN}?client_id=${encodeURIComponent(env.IGDB_CLIENT_ID)}&client_secret=${encodeURIComponent(env.IGDB_CLIENT_SECRET)}&grant_type=client_credentials`;
  const response = await fetchImpl(url, { method: "POST" });
  if (!response.ok) return null;
  return (await response.json()).access_token ?? null;
}

function igdbItem(row) {
  const cover = row.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${row.cover.image_id}.jpg` : null;
  return {
    id: `igdb-game-${row.id}`,
    provider: "igdb",
    providerId: String(row.id),
    title: clean(row.name, 120),
    type: "game",
    domains: ["play"],
    about: clean(row.summary || "Game from IGDB."),
    year: row.first_release_date ? String(new Date(row.first_release_date * 1000).getUTCFullYear()) : null,
    artwork: cover,
    genres: (row.genres ?? []).map((x) => clean(x.name, 60)),
    providerMeta: { genreIds: (row.genres ?? []).map((x) => x.id) },
    sourceUrl: row.url ?? null
  };
}

async function searchIgdb(query, env, fetchImpl) {
  const token = await igdbToken(env, fetchImpl);
  if (!token) return [];
  const response = await fetchImpl(IGDB_GAMES, {
    method: "POST",
    headers: {
      "client-id": env.IGDB_CLIENT_ID,
      authorization: `Bearer ${token}`,
      "content-type": "text/plain"
    },
    body: `search "${String(query).replace(/"/g, "")}"; fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name; limit 8;`
  });
  if (!response.ok) return [];
  return (await response.json()).map(igdbItem);
}

export async function searchCatalog(query, { domain = "all", env = process.env, fetchImpl = fetch } = {}) {
  const q = clean(query, 100);
  if (q.length < 2) return { items: [], providers: {} };
  const tasks = [];
  if (domainAllows(domain, "watch")) tasks.push(["tmdb", searchTmdb(q, env, fetchImpl)]);
  if (domainAllows(domain, "read")) tasks.push(["openlibrary", searchOpenLibrary(q, env, fetchImpl)]);
  if (domainAllows(domain, "play")) tasks.push(["igdb", searchIgdb(q, env, fetchImpl)]);
  const settled = await Promise.all(tasks.map(async ([name, p]) => {
    try { return [name, await p, null]; } catch (error) { return [name, [], error?.message || "unavailable"]; }
  }));
  const providers = {};
  const items = [];
  for (const [name, rows, error] of settled) {
    providers[name] = { available: !error && rows.length >= 0, configured: name === "openlibrary" || (name === "tmdb" ? Boolean(env.TASTEMAKE_TMDB_TOKEN) : Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET)), error };
    items.push(...rows);
  }
  return { items: uniq(items).slice(0, 24), providers };
}

export { igdbToken, igdbItem, openLibraryItem, tmdbItem };
