import { cachedValue } from "../server/cache.mjs";
import { canonicalizeWriteBehind, mergeCanonicalFacts } from "./canonical-store.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";
import { buildItemId } from "./item-id.mjs";
import { waitUntil } from "@vercel/functions";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w780";
const OL_SEARCH = "https://openlibrary.org/search.json";
const IGDB_GAMES = "https://api.igdb.com/v4/games";
const TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token";
const GOOGLE_BOOKS = "https://www.googleapis.com/books/v1";

const domainAllows = (domain, wanted) => domain === "all" || domain === wanted;
const clean = (value, n = 280) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const normalizeSearch = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const stripLeadingArticle = (value) => normalizeSearch(value).replace(/^(the|a|an)\s+/, "");

function searchRelevance(title, query, popularity = 0) {
  const wanted = normalizeSearch(query);
  const got = normalizeSearch(title);
  const wantedCore = stripLeadingArticle(query);
  const gotCore = stripLeadingArticle(title);
  if (!wanted || !got) return 0;
  const wantedWords = wanted.split(" ");
  const gotWords = got.split(" ");
  let score = 0;
  if (got === wanted || (wantedCore && gotCore === wantedCore)) score = 10_000;
  // Treat canonical title-family matches as near-exact. This puts things like
  // "The Lord of the Rings: The Fellowship of the Ring" near a "lord of the rings"
  // query instead of below obscure titles that merely happen to have a cleaner prefix.
  else if (wantedCore && (gotCore.startsWith(`${wantedCore} `) || gotCore.startsWith(`${wantedCore}:`) || wantedCore.startsWith(`${gotCore} `))) score = 8_500;
  else if (got.startsWith(wanted) || (wantedCore && gotCore.startsWith(wantedCore))) score = 7_000;
  else if (got.includes(wanted) || (wantedCore && gotCore.includes(wantedCore))) score = 5_000;
  else if (wantedWords.every((word) => gotWords.some((candidate) => candidate.startsWith(word)))) score = 3_000;
  else if (wantedWords.every((word) => gotWords.includes(word))) score = 2_000;

  // Within the same textual match class, prefer the provider's better-known/canonical result.
  // This is especially useful when a title exists as both a flagship show and a minor documentary,
  // or when a game search returns multiple editions of the same work.
  return score - Math.max(0, gotWords.length - wantedWords.length) * 5 + Math.log10(Math.max(1, Number(popularity) || 0) + 1);
}

const uniq = (items) => {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
};

function tmdbItem(row, type) {
  const title = type === "tv" ? row.name : row.title;
  const date = type === "tv" ? row.first_air_date : row.release_date;
  return {
    id: buildItemId("tmdb", type, row.id),
    provider: "tmdb",
    providerId: String(row.id),
    title: clean(title, 100),
    type,
    domains: [type === "tv" ? "tv" : "movies"],
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

async function searchTmdb(query, env, fetchImpl, domain = "all") {
  const token = env.TASTEMAKE_TMDB_TOKEN;
  if (!token) return [];
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const q = encodeURIComponent(query);
  const wantMovies = domain === "all" || domain === "movies";
  const wantTv = domain === "all" || domain === "tv";
  const [movies, tv] = await Promise.all([
    wantMovies
      ? fetchWithTimeout(fetchImpl, `https://api.themoviedb.org/3/search/movie?query=${q}&include_adult=false&language=en-US&page=1`, { headers })
      : Promise.resolve(null),
    wantTv
      ? fetchWithTimeout(fetchImpl, `https://api.themoviedb.org/3/search/tv?query=${q}&include_adult=false&language=en-US&page=1`, { headers })
      : Promise.resolve(null)
  ]);
  if ((wantMovies && !movies?.ok) && (wantTv && !tv?.ok)) throw new Error(`tmdb ${movies?.status || ""}/${tv?.status || ""}`);

  const rows = [];
  if (movies?.ok) rows.push(...((await movies.json()).results ?? []).slice(0, 12).map((row) => ({ row, type: "movie" })));
  if (tv?.ok) rows.push(...((await tv.json()).results ?? []).slice(0, 12).map((row) => ({ row, type: "tv" })));

  // TMDb ranks movie and TV searches independently. Merge them by title relevance before returning
  // Watch results so an exact flagship series is not automatically buried behind six weaker movies.
  rows.sort((a, b) => {
    const aTitle = a.type === "tv" ? a.row.name : a.row.title;
    const bTitle = b.type === "tv" ? b.row.name : b.row.title;
    return searchRelevance(bTitle, query, b.row.popularity) - searchRelevance(aTitle, query, a.row.popularity);
  });
  return rows.slice(0, 12).map(({ row, type }) => tmdbItem(row, type));
}

function openLibraryItem(row) {
  const key = String(row.key ?? "").replace("/works/", "");
  return {
    id: buildItemId("openlibrary", "book", key),
    provider: "openlibrary",
    providerId: key,
    title: clean(row.title, 120),
    type: "book",
    domains: ["read"],
    by: clean((row.author_name ?? []).slice(0, 3).join(", "), 120),
    about: row.first_publish_year ? `First published ${row.first_publish_year}.` : "Book from Open Library.",
    year: row.first_publish_year ? String(row.first_publish_year) : null,
    artwork: row.cover_i ? `https://covers.openlibrary.org/b/id/${row.cover_i}-L.jpg?default=false` : null,
    genres: (row.subject ?? []).slice(0, 12).map((x) => clean(x, 60)),
    // #142: Open Library's own series metadata (series_key), when the record has it, lets the
    // shared novelty guard suppress a same-series book the same way collectionId/franchiseId
    // already work for movies/TV/games. Genuinely absent on many real books (confirmed directly
    // against the API for two popular in-print series) -- this is a real, honest improvement where
    // the upstream data supports it, not a claim that book sequel-suppression is now complete.
    providerMeta: { seriesKey: row.series_key ?? null, isbns: (row.isbn ?? []).slice(0, 24) },
    sourceUrl: key ? `https://openlibrary.org/works/${key}` : "https://openlibrary.org/"
  };
}

async function searchOpenLibrary(query, env, fetchImpl) {
  const fields = "key,title,author_name,first_publish_year,cover_i,subject,series_key,isbn";
  const response = await fetchWithTimeout(fetchImpl, `${OL_SEARCH}?q=${encodeURIComponent(query)}&limit=8&fields=${fields}`, {
    headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
  });
  if (!response.ok) throw new Error(`openlibrary ${response.status}`);
  return ((await response.json()).docs ?? []).slice(0, 8).map(openLibraryItem);
}

async function igdbToken(env, fetchImpl) {
  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
  const load = async () => {
    const url = `${TWITCH_TOKEN}?client_id=${encodeURIComponent(env.IGDB_CLIENT_ID)}&client_secret=${encodeURIComponent(env.IGDB_CLIENT_SECRET)}&grant_type=client_credentials`;
    const response = await fetchWithTimeout(fetchImpl, url, { method: "POST" });
    if (!response.ok) throw new Error(`twitch ${response.status}`);
    return (await response.json()).access_token ?? null;
  };
  if (fetchImpl !== fetch) return load();
  return cachedValue(`igdb-token:${env.IGDB_CLIENT_ID}`, load, { ttl: 3300, tags: ["igdb-auth"] });
}

function igdbItem(row) {
  const cover = row.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${row.cover.image_id}.jpg` : null;
  return {
    id: buildItemId("igdb", "game", row.id),
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
  const response = await fetchWithTimeout(fetchImpl, IGDB_GAMES, {
    method: "POST",
    headers: {
      "client-id": env.IGDB_CLIENT_ID,
      authorization: `Bearer ${token}`,
      "content-type": "text/plain"
    },
    body: `search "${String(query).replace(/"/g, "")}"; fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,collection.id,franchises.id,total_rating_count; limit 20;`
  });
  if (!response.ok) throw new Error(`igdb ${response.status}`);
  const rows = await response.json();
  rows.sort((a, b) => searchRelevance(b.name, query, b.total_rating_count) - searchRelevance(a.name, query, a.total_rating_count));
  return rows.slice(0, 8).map(igdbItem);
}

// ---- Per-media-type detail metadata (#103 item 1/2) --------------------------------------------
// Search/candidate retrieval above intentionally stays cheap (no per-item detail calls) so it never
// adds latency to recommendation generation. Detail metadata (director/cast, creator/cast,
// developer/publisher/platforms) is fetched lazily, one item at a time, only when a user actually
// expands that item (Library detail view, search result detail). Every field is omitted, never sent
// as an empty label, when the upstream provider does not have it.

function namesOf(list, n) {
  return (list ?? []).slice(0, n).map((x) => clean(x.name, 80)).filter(Boolean);
}

async function tmdbDetail(providerId, type, env, fetchImpl) {
  const token = env.TASTEMAKE_TMDB_TOKEN;
  if (!token) return {};
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const kind = type === "tv" ? "tv" : "movie";
  const response = await fetchWithTimeout(fetchImpl,
    `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(providerId)}?append_to_response=credits&language=en-US`,
    { headers }
  );
  if (!response.ok) throw new Error(`tmdb detail ${response.status}`);
  const row = await response.json();
  const credits = row.credits ?? {};
  const cast = namesOf(credits.cast, 6);
  if (kind === "movie") {
    const director = namesOf((credits.crew ?? []).filter((person) => person.job === "Director"), 2);
    return {
      director: director.length ? director.join(", ") : null,
      cast: cast.length ? cast : null,
      runtime: row.runtime || null
    };
  }
  // TV: showrunner/creator comes from `created_by`, not the crew list. Not every series has one on record.
  const creator = namesOf(row.created_by, 2);
  return {
    creator: creator.length ? creator.join(", ") : null,
    cast: cast.length ? cast : null,
    yearsRun: row.first_air_date && row.last_air_date
      ? `${String(row.first_air_date).slice(0, 4)}–${String(row.last_air_date).slice(0, 4)}`
      : null
  };
}

async function openLibraryDetail(providerId, env, fetchImpl) {
  const response = await fetchWithTimeout(fetchImpl, `https://openlibrary.org/works/${encodeURIComponent(providerId)}.json`, {
    headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
  });
  if (!response.ok) throw new Error(`openlibrary detail ${response.status}`);
  const row = await response.json();
  const description = typeof row.description === "string"
    ? clean(row.description, 1200)
    : clean(row.description?.value ?? "", 1200);
  const subjects = (row.subjects ?? []).slice(0, 20).map((x) => clean(x, 80)).filter(Boolean);
  const seriesKey = (row.series ?? row.series_key ?? [])[0] ?? null;
  return {
    description: description || null,
    subjects: subjects.length ? subjects : null,
    seriesKey: seriesKey ? String(seriesKey) : null
  };
}

export async function googleBooksSeriesDetail(item, { env = process.env, fetchImpl = fetch } = {}) {
  const key = env.TASTEMAKE_GOOGLE_BOOKS_API_KEY;
  const isbn = (item?.providerMeta?.isbns ?? item?.isbns ?? [])
    .map((value) => String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase())
    .find((value) => value.length === 10 || value.length === 13);
  if (!key || !isbn) return {};

  const search = await fetchWithTimeout(
    fetchImpl,
    `${GOOGLE_BOOKS}/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}&maxResults=1&key=${encodeURIComponent(key)}`,
    {},
    3000
  );
  if (!search.ok) return {};
  const volumeId = (await search.json()).items?.[0]?.id;
  if (!volumeId) return {};

  const detail = await fetchWithTimeout(
    fetchImpl,
    `${GOOGLE_BOOKS}/volumes/${encodeURIComponent(volumeId)}?includeNonComicsSeries=true&key=${encodeURIComponent(key)}`,
    {},
    3000
  );
  if (!detail.ok) return {};
  const row = await detail.json();
  const series = row.volumeInfo?.seriesInfo?.volumeSeries?.find((entry) => entry?.seriesId);
  if (!series?.seriesId) return {};
  return {
    seriesKey: `googlebooks:${series.seriesId}`,
    seriesOrder: Number.isFinite(Number(series.orderNumber)) ? Number(series.orderNumber) : null
  };
}

async function igdbDetail(providerId, env, fetchImpl) {
  const token = await igdbToken(env, fetchImpl);
  if (!token) return {};
  const response = await fetchWithTimeout(fetchImpl, IGDB_GAMES, {
    method: "POST",
    headers: {
      "client-id": env.IGDB_CLIENT_ID,
      authorization: `Bearer ${token}`,
      "content-type": "text/plain"
    },
    body: `fields involved_companies.developer,involved_companies.publisher,involved_companies.company.name,platforms.name; where id = ${Number(providerId) || 0};`
  });
  if (!response.ok) throw new Error(`igdb detail ${response.status}`);
  const [row] = await response.json();
  if (!row) return {};
  const companies = row.involved_companies ?? [];
  const developer = namesOf(companies.filter((c) => c.developer).map((c) => c.company), 3);
  const publisher = namesOf(companies.filter((c) => c.publisher).map((c) => c.company), 3);
  const platforms = namesOf(row.platforms, 8);
  return {
    developer: developer.length ? developer.join(", ") : null,
    publisher: publisher.length ? publisher.join(", ") : null,
    platforms: platforms.length ? platforms : null
  };
}

// Books already carry their one required field (author) from search; Open Library's work-level
// response does not reliably add more per-item detail beyond what search already returns, so there
// is no separate detail call for books.
export async function fetchItemDetail(item, { env = process.env, fetchImpl = fetch } = {}) {
  if (!item?.providerId) return {};
  try {
    if (item.provider === "tmdb") return await tmdbDetail(item.providerId, item.type, env, fetchImpl);
    if (item.provider === "openlibrary") return await openLibraryDetail(item.providerId, env, fetchImpl);
    if (item.provider === "igdb") return await igdbDetail(item.providerId, env, fetchImpl);
  } catch {
    // Sparse/unavailable detail is expected (item 2): omit the fields rather than fail the card.
    return {};
  }
  return {};
}

// #135: provider-backed lazy enrichment. Detail fetching is cached separately from the canonical
// write, so a transient DB failure can retry on the next encounter without re-fetching the provider.
// This never blocks recommendation generation when called through enrichCanonicalItemWriteBehind.
export async function fetchAndPersistItemDetail(item, { env = process.env, fetchImpl = fetch, query } = {}) {
  if (!item?.provider || !item?.providerId || !item?.type) return {};
  const cacheKey = `canonical-enrichment:v1:${item.provider}:${item.type}:${item.providerId}`;
  const detail = fetchImpl !== fetch
    ? await fetchItemDetail(item, { env, fetchImpl })
    : await cachedValue(cacheKey, () => fetchItemDetail(item, { env, fetchImpl }), { ttl: 86400, tags: ["canonical-enrichment"] });
  if (detail && Object.values(detail).some((value) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length))) {
    await mergeCanonicalFacts(item, detail, { env, query, source: item.provider });
  }
  return detail ?? {};
}

export function enrichCanonicalItemWriteBehind(item, options = {}) {
  const task = Promise.resolve()
    .then(async () => {
      const detail = await fetchAndPersistItemDetail(item, options);

      // #142: Open Library's series coverage is incomplete even for major series. Do not add
      // another provider to the live recommendation path; instead, when a book anchor is already
      // being enriched in the background and Open Library still has no series relationship, use
      // Google Books' structured non-comics series metadata as a bounded fallback. The API key is
      // optional, so environments without it behave exactly as before.
      if (item?.provider === "openlibrary" && !detail?.seriesKey) {
        const env = options.env ?? process.env;
        const fetchImpl = options.fetchImpl ?? fetch;
        const isbn = (item?.providerMeta?.isbns ?? [])[0] ?? "none";
        const cacheKey = `canonical-series:v1:googlebooks:${isbn}`;
        const seriesDetail = fetchImpl !== fetch
          ? await googleBooksSeriesDetail(item, { env, fetchImpl })
          : await cachedValue(cacheKey, () => googleBooksSeriesDetail(item, { env, fetchImpl }), { ttl: 86400, tags: ["canonical-enrichment"] });
        if (seriesDetail?.seriesKey) {
          await mergeCanonicalFacts(item, seriesDetail, { env, query: options.query, source: "googlebooks" });
          console.info("[tastemake-canonical]", JSON.stringify({
            operation: "googlebooks-series-enrichment",
            provider: item.provider,
            providerId: item.providerId,
            seriesKey: seriesDetail.seriesKey,
            success: true
          }));
        }
      }

      return detail;
    })
    .catch((error) => {
      console.info("[tastemake-canonical]", JSON.stringify({ error: error?.message || "enrichment failed" }));
    });
  try { waitUntil(task); } catch { /* local/off-platform tests have no request context */ }
}

export async function searchCatalog(query, { domain = "all", env = process.env, fetchImpl = fetch } = {}) {
  const q = clean(query, 100);
  if (q.length < 2) return { items: [], providers: {}, degraded: false };

  const specs = [];
  if (domainAllows(domain, "movies") || domainAllows(domain, "tv")) specs.push(["tmdb", Boolean(env.TASTEMAKE_TMDB_TOKEN), () => searchTmdb(q, env, fetchImpl, domain)]);
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

  // "All" is a relevance-ranked search, not a provider carousel. Rank the combined
  // result set globally so obvious/canonical matches rise to the top regardless of
  // whether they came from TMDb, Open Library, or IGDB. Provider diversity still
  // emerges naturally farther down instead of being forced ahead of stronger matches.
  const combined = uniq(buckets.flat());
  combined.sort((a, b) =>
    searchRelevance(b.title, q) - searchRelevance(a.title, q)
    || a.title.localeCompare(b.title)
  );

  const configured = settled.filter(([, , , isConfigured]) => isConfigured);
  const degraded = configured.length === 0 || configured.every(([, , , , available]) => !available);
  const results = combined.slice(0, 24);

  // #135 foundation: start building up the canonical item store in the background from whatever
  // real provider items search already fetched. This is write-behind only (nothing here is
  // awaited), so it can never add latency or throw into the search response, and it is a no-op
  // when TASTEMAKE_DATABASE_URL isn't configured (e.g. this sandbox, or a preview env without it).
  canonicalizeWriteBehind(results, { env });

  return { items: results, providers, degraded };
}

export { igdbToken, igdbItem, openLibraryItem, tmdbItem, searchRelevance };
