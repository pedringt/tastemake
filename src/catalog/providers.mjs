import { cachedValue } from "../server/cache.mjs";
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
    // #92: belongs_to_collection is TMDb's own franchise/collection relationship (e.g. every Lord of the
    // Rings film shares one collection id). When the provider response includes it, the shared novelty
    // guard in catalog/related.mjs can suppress same-collection sequels without relying on title text.
    providerMeta: { genreIds: row.genre_ids ?? [], collectionId: row.belongs_to_collection?.id ?? null },
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
  if (!movies.ok && !tv.ok) throw new Error(`tmdb ${movies.status || ""}/${tv.status || ""}`);
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
  if (!response.ok) throw new Error(`openlibrary ${response.status}`);
  return ((await response.json()).docs ?? []).slice(0, 8).map(openLibraryItem);
}

async function igdbToken(env, fetchImpl) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const load = async () => {
    const url = `${TWITCH_TOKEN}?client_id=${encodeURIComponent(env.IGDB_CLIENT_ID)}&client_secret=${encodeURIComponent(env.IGDB_CLIENT_SECRET)}&grant_type=client_credentials`;
    const response = await fetchImpl(url, { method: "POST" });
    if (!response.ok) throw new Error(`twitch ${response.status}`);
    return (await response.json()).access_token ?? null;
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`igdb-token:${env.IGDB_CLIENT_ID}`, load, { ttl: 3300, tags: ["igdb-auth"] });
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
    // #92: IGDB's franchise/collection ids group numbered game series (e.g. every entry in a series
    // shares a collection id) so the shared novelty guard can suppress sequels without title guessing.
    providerMeta: {
      genreIds: (row.genres ?? []).map((x) => x.id),
      collectionId: row.collection?.id ?? null,
      franchiseId: (row.franchises ?? [])[0]?.id ?? row.franchise?.id ?? null
    },
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
    body: `search "${String(query).replace(/"/g, "")}"; fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,collection.id,franchises.id; limit 8;`
  });
  if (!response.ok) throw new Error(`igdb ${response.status}`);
  return (await response.json()).map(igdbItem);
}

export async function searchCatalog(query, { domain = "all", env = process.env, fetchImpl = fetch } = {}) {
  const q = clean(query, 100);
  if (q.length < 2) return { items: [], providers: {}, degraded: false };

  const specs = [];
  if (domainAllows(domain, "watch")) specs.push(["tmdb", Boolean(env.TASTEMAKE_TMDB_TOKEN), () => searchTmdb(q, env, fetchImpl)]);
  if (domainAllows(domain, "read")) specs.push(["openlibrary", true, () => searchOpenLibrary(q, env, fetchImpl)]);
  if (domainAllows(domain, "play")) specs.push(["igdb", Boolean(env.IGDB_CLIENT_ID && env.IGDB_CLIENT_SECRET), () => searchIgdb(q, env, fetchImpl)]);

  const settled = await Promise.all(specs.map(async ([name, configured, run]) => {
    if (!configured) return [name, [], null, false, false];
    try { return [name, await run(), null, true, true]; }
    catch (error) { return [name, [], error?.message || "unavailable", true, false]; }
  }));

  const providers = {};
  const buckets = [];
  for (const [name, rows, error, configured, available] of settled) {
    providers[name] = { available, configured, error };
    if (available) buckets.push(rows);
  }

  // Interleave provider results so "All" really shows Watch + Read + Play instead of
  // filling the first page with the providers that happened to be concatenated first.
  const interleaved = [];
  const depth = Math.max(0, ...buckets.map((rows) => rows.length));
  for (let i = 0; i < depth; i += 1) {
    for (const rows of buckets) if (rows[i]) interleaved.push(rows[i]);
  }

  const configured = settled.filter(([, , , isConfigured]) => isConfigured);
  const degraded = configured.length === 0 || configured.every(([, , , , available]) => !available);
  return { items: uniq(interleaved).slice(0, 24), providers, degraded };
}

export { igdbToken, igdbItem, openLibraryItem, tmdbItem };
