import { cachedValue } from "../server/cache.mjs";
import { canonicalizeWriteBehind, mergeCanonicalFacts } from "./canonical-store.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";
import { buildItemId } from "./item-id.mjs";
import { bookSeriesFromRow } from "./book-series.mjs";
import { isBookCompanion } from "./book-companions.mjs";
import { fallbackSummary, sanitizeAbout } from "./synopsis.mjs";
import { waitUntil } from "@vercel/functions";
import { rankSearchResults, searchRelevance } from "./search-ranking.mjs";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w780";
const OL_SEARCH = "https://openlibrary.org/search.json";
const IGDB_GAMES = "https://api.igdb.com/v4/games";
const TWITCH_TOKEN = "https://id.twitch.tv/oauth2/token";
const GOOGLE_BOOKS = "https://www.googleapis.com/books/v1";

const domainAllows = (domain, wanted) => domain === "all" || domain === wanted;
const clean = (value, n = 280) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const uniq = (items) => {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
};

function tmdbItem(row, type) {
  const title = type === "tv" ? row.name : row.title;
  const date = type === "tv" ? row.first_air_date : row.release_date;
  const item = {
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
    sourceUrl: type === "tv" ? `https://www.themoviedb.org/tv/${row.id}` : `https://www.themoviedb.org/movie/${row.id}`,
    // Search-only signal. Stripped before results leave searchCatalog so it never becomes product state.
    _searchPopularity: Number(row.popularity) || 0
  };
  // Shared synopsis check (catalog/synopsis.mjs): TMDb's own adult flag plus the sensitive-term list.
  return { ...item, ...sanitizeAbout(item, { adult: row.adult === true }) };
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

  // TMDb ranks movie and TV searches independently. Merge them with the shared ranking (title match,
  // popularity, record completeness, work type) so an exact flagship series is not buried behind
  // weaker movies (#106) and a stub with a short exact title does not bury the well-known work (#115).
  return rankSearchResults(rows.map(({ row, type }) => tmdbItem(row, type)), query).slice(0, 12);
}

// #257: an Open Library *work* title is often the original-language title ("Mémoires d'Hadrien",
// "Krew elfów"). Searches ask for lang=en, which returns the best English edition when there is one; its
// title is used when it is genuinely different (not just capitalization or an added subtitle), and the
// work title is kept as originalTitle. No English edition -> the work title, as before.
const comparableTitle = (value) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function englishEditionTitle(row) {
  const edition = row?.editions?.docs?.[0];
  if (!edition?.title || !(edition.language ?? []).includes("eng")) return null;
  const work = comparableTitle(row.title);
  const english = comparableTitle(edition.title);
  if (!english || english === work || english.startsWith(`${work} `)) return null;
  return clean(edition.title, 120);
}

// #257: search rows list narrators and translators as authors ("Alexandra Bracken, Amy McFadden,
// Montserrat Triviño Gonzalez"). Two names are usually real co-authors; three or more usually are not,
// so only the first is kept then.
function openLibraryAuthors(names = []) {
  return clean((names.length > 2 ? names.slice(0, 1) : names).join(", "), 120);
}

// Open Library's first_publish_year is the earliest date on any edition, so one mis-dated record wins.
// Oct 23 smoke test: The Blade Itself, The Lies of Locke Lamora and The Alloy of Law all read 2001, from
// one Gollancz reprint each imported with a 2001 date (the real years are 2006, 2006, 2011). When the
// earliest year stands alone, 4+ years before every other edition of a modern book, the next year is used.
// Older books are left alone: a long gap before the first reprint is normal for them.
export function firstPublishedYear(row = {}) {
  const first = Number(row.first_publish_year) || null;
  const years = [...new Set([].concat(row.publish_year ?? []).map(Number).filter((y) => y > 0))].sort((a, b) => a - b);
  if (!first || years.length < 3 || years[0] !== first || first < 1980) return first;
  return years[1] - years[0] >= 4 ? years[1] : first;
}

function openLibraryItem(row) {
  const firstYear = firstPublishedYear(row);
  const key = String(row.key ?? "").replace("/works/", "");
  const englishTitle = englishEditionTitle(row);
  const item = {
    id: buildItemId("openlibrary", "book", key),
    provider: "openlibrary",
    providerId: key,
    title: englishTitle ?? clean(row.title, 120),
    ...(englishTitle ? { originalTitle: clean(row.title, 120) } : {}),
    type: "book",
    domains: ["read"],
    by: openLibraryAuthors(row.author_name ?? []),
    about: firstYear ? `First published ${firstYear}.` : "Book from Open Library.",
    year: firstYear ? String(firstYear) : null,
    artwork: row.cover_i ? `https://covers.openlibrary.org/b/id/${row.cover_i}-L.jpg?default=false` : null,
    genres: (row.subject ?? []).slice(0, 12).map((x) => clean(x, 60)),
    // #142: Open Library's own series metadata (series_key), when the record has it, lets the
    // shared novelty guard suppress a same-series book the same way collectionId/franchiseId
    // already work for movies/TV/games. Genuinely absent on many real books (confirmed directly
    // against the API for two popular in-print series) -- this is a real, honest improvement where
    // the upstream data supports it, not a claim that book sequel-suppression is now complete.
    // Follow-up: series_key arrives as an array; bookSeriesFromRow keeps the first id as a string
    // and also reads series names from series_name, "series:..." subjects and "(X, Book 2)" titles.
    providerMeta: { ...bookSeriesFromRow(row), isbns: (row.isbn ?? []).slice(0, 24) },
    sourceUrl: key ? `https://openlibrary.org/works/${key}` : "https://openlibrary.org/",
    // Open Library already exposes edition_count in search. Keep it only long enough to break
    // ties between equally relevant title matches in the combined All search.
    _searchPopularity: Number(row.edition_count) || 0
  };
  return { ...item, ...sanitizeAbout(item) };
}

async function searchOpenLibrary(query, env, fetchImpl) {
  const fields = "key,title,author_name,first_publish_year,publish_year,cover_i,subject,series_key,series_name,series_position,isbn,edition_count,editions,editions.title,editions.language";
  // Asks for a few extra so dropping study guides and the like (book-companions.mjs) still leaves 8.
  const response = await fetchWithTimeout(fetchImpl, `${OL_SEARCH}?q=${encodeURIComponent(query)}&limit=12&lang=en&fields=${fields}`, {
    headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
  });
  if (!response.ok) throw new Error(`openlibrary ${response.status}`);
  return ((await response.json()).docs ?? []).filter((row) => !isBookCompanion(row, query)).slice(0, 8).map(openLibraryItem);
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
  const item = {
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
      // #48: IGDB keeps Horror, Romance, Warfare and Kids as themes, not genres.
      themes: (row.themes ?? []).map((x) => clean(x.name, 40)).filter(Boolean),
      collectionId: row.collection?.id ?? null,
      franchiseId: (row.franchises ?? [])[0]?.id ?? row.franchise?.id ?? null
    },
    sourceUrl: row.url ?? null,
    // Search-only signal. Stripped before results leave searchCatalog.
    _searchPopularity: Number(row.total_rating_count) || 0
  };
  return { ...item, ...sanitizeAbout(item) };
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
    body: `search "${String(query).replace(/"/g, "")}"; fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,themes.name,collection.id,franchises.id,total_rating_count; limit 20;`
  });
  if (!response.ok) throw new Error(`igdb ${response.status}`);
  const rows = await response.json();
  return rankSearchResults(rows.map(igdbItem), query).slice(0, 8);
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
    `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(providerId)}?append_to_response=credits,watch/providers&language=en-US`,
    { headers }
  );
  if (!response.ok) throw new Error(`tmdb detail ${response.status}`);
  const row = await response.json();
  const credits = row.credits ?? {};
  const cast = namesOf(credits.cast, 6);
  const watch = compactWatchProviders(row["watch/providers"]?.results);
  if (kind === "movie") {
    const director = namesOf((credits.crew ?? []).filter((person) => person.job === "Director"), 2);
    return {
      director: director.length ? director.join(", ") : null,
      cast: cast.length ? cast : null,
      runtime: row.runtime || null,
      watch
    };
  }
  // TV: showrunner/creator comes from `created_by`, not the crew list. Not every series has one on record.
  const creator = namesOf(row.created_by, 2);
  return {
    creator: creator.length ? creator.join(", ") : null,
    cast: cast.length ? cast : null,
    yearsRun: tvYearsRun(row),
    watch
  };
}

// #10: where a movie or show can be watched, per country, from TMDb's watch-provider data (supplied by
// JustWatch, which must be credited wherever it is shown). Names only, a few per kind. Never stored
// in the canonical catalog (not a factual field there); the detail endpoint returns one country.
const WATCH_KINDS = { flatrate: "stream", free: "free", ads: "ads", rent: "rent", buy: "buy" };

// Oct 23: TMDb lists every plan and resold channel of a service separately ("Paramount Plus Premium",
// "Paramount Plus Essential", "Paramount+ Amazon Channel", "Paramount+ Roku Premium Channel"), so one
// service filled the list. Plans and channels collapse to the service; the "All options" link keeps the detail.
const CHANNEL_SUFFIX = /\s+(?:amazon|roku premium|roku|apple tv|youtube)\s+channel$/i;
const PLAN_SUFFIX = /\s+(?:(?:standard|basic|premium)\s+)?with\s+ads$|\s+(?:premium\s+plus|premium|essential|basic|standard)$/i;
export function watchServiceName(name) {
  let text = String(name ?? "").replace(/\s+/g, " ").trim();
  for (const pattern of [CHANNEL_SUFFIX, PLAN_SUFFIX]) {
    const shorter = text.replace(pattern, "").trim();
    if (shorter) text = shorter;
  }
  return text.replace(/\s+Plus$/i, "+").replace(/\s+Plus\b/i, "+");
}
export function compactWatchProviders(results) {
  if (!results || typeof results !== "object") return null;
  const out = {};
  for (const [country, entry] of Object.entries(results)) {
    if (!/^[A-Z]{2}$/.test(country) || !entry) continue;
    const kinds = {};
    for (const [from, to] of Object.entries(WATCH_KINDS)) {
      const seen = new Set();
      const names = (entry[from] ?? [])
        .map((p) => watchServiceName(clean(p.provider_name, 40)))
        .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
        .slice(0, 6);
      if (names.length) kinds[to] = names;
    }
    out[country] = { link: typeof entry.link === "string" && entry.link.startsWith("https://www.themoviedb.org/") ? entry.link : null, ...kinds };
  }
  return Object.keys(out).length ? out : null;
}

// The one country a viewer asked for, or null. "XX" from a browser language like "en-GB".
export function watchForRegion(watch, region) {
  const code = String(region ?? "").toUpperCase();
  if (!watch || !/^[A-Z]{2}$/.test(code)) return null;
  return watch[code] ? { region: code, ...watch[code] } : { region: code, none: true };
}

// A series still in production has a last_air_date (its latest episode), not an end year, so it
// reads "2023–present" rather than a run that looks finished.
export function tvYearsRun(row) {
  const start = row?.first_air_date ? String(row.first_air_date).slice(0, 4) : "";
  if (!start) return null;
  if (row.in_production === true) return `${start}–present`;
  const end = row.last_air_date ? String(row.last_air_date).slice(0, 4) : "";
  if (!end) return null;
  return end === start ? start : `${start}–${end}`;
}

// Page count is not on the work record. Open Library's search index carries a median across editions
// for the work, so it is one small keyed lookup, made only alongside the work detail on expand.
async function openLibraryPageCount(providerId, env, fetchImpl) {
  try {
    const url = `${OL_SEARCH}?q=${encodeURIComponent(`key:/works/${providerId}`)}&fields=key,number_of_pages_median&limit=1`;
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: { "user-agent": env.TASTEMAKE_CATALOG_USER_AGENT || "TastemakePrototype/1.0 (https://tastemake.vercel.app)" }
    });
    if (!response.ok) return null;
    const pages = Math.round(Number((await response.json()).docs?.[0]?.number_of_pages_median));
    return Number.isFinite(pages) && pages > 0 ? pages : null;
  } catch {
    return null;
  }
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

// A flagged synopsis is replaced with the provider's own tagline when TMDb has a clean one (the list
// responses used for recommendations carry no tagline, so this is one small detail call per flagged
// item -- never per recommendation). Anything that goes wrong leaves the genre-and-year fallback that
// ingestion already put in `about`.
async function fetchTmdbTagline(item, { env, fetchImpl }) {
  const token = env.TASTEMAKE_TMDB_TOKEN;
  if (!token || item.provider !== "tmdb" || !item.providerId) return null;
  const kind = item.type === "tv" ? "tv" : "movie";
  const load = async () => {
    const response = await fetchWithTimeout(fetchImpl,
      `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(item.providerId)}?language=en-US`,
      { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
      3000
    );
    if (!response.ok) return null;
    return clean((await response.json()).tagline, 160) || null;
  };
  try {
    return fetchImpl !== fetch
      ? await load()
      : await cachedValue(`tmdb-tagline:v1:${kind}:${item.providerId}`, load, { ttl: 86400, tags: ["catalog-detail"] });
  } catch {
    return null;
  }
}

export async function applyTaglineFallback(items, { env = process.env, fetchImpl = fetch } = {}) {
  if (!Array.isArray(items) || !items.some((item) => item?.aboutFlag && item.provider === "tmdb")) return items;
  return Promise.all(items.map(async (item) => {
    if (!item?.aboutFlag || item.provider !== "tmdb") return item;
    const tagline = await fetchTmdbTagline(item, { env, fetchImpl });
    return tagline ? { ...item, about: fallbackSummary(item, { tagline }) } : item;
  }));
}

// Books carry author and year from search. The detail adds what search does not have: the work's
// own description and subjects, and a page count from the search index (both calls run together).
export async function fetchItemDetail(item, { env = process.env, fetchImpl = fetch } = {}) {
  if (!item?.providerId) return {};
  try {
    if (item.provider === "tmdb") return await tmdbDetail(item.providerId, item.type, env, fetchImpl);
    if (item.provider === "openlibrary") {
      const [detail, pageCount] = await Promise.all([
        openLibraryDetail(item.providerId, env, fetchImpl),
        openLibraryPageCount(item.providerId, env, fetchImpl)
      ]);
      return { ...detail, pageCount };
    }
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
  const cacheKey = `canonical-enrichment:v4:${item.provider}:${item.type}:${item.providerId}`;
  const detail = fetchImpl !== fetch
    ? await fetchItemDetail(item, { env, fetchImpl })
    : await cachedValue(cacheKey, () => fetchItemDetail(item, { env, fetchImpl }), { ttl: 86400, tags: ["canonical-enrichment"] });
  // #10: watch providers change often and differ by country; they are served, never stored as facts.
  const { watch, ...facts } = detail ?? {};
  if (Object.values(facts).some((value) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length))) {
    await mergeCanonicalFacts(item, facts, { env, query, source: item.provider });
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
  const combined = rankSearchResults(uniq(buckets.flat()), q);

  const configured = settled.filter(([, , , isConfigured]) => isConfigured);
  const degraded = configured.length === 0 || configured.every(([, , , , available]) => !available);
  // Do not leak provider popularity/rating counts into persistent catalog items. They are only
  // ranking hints for this search response.
  const results = combined.slice(0, 24).map(({ _searchPopularity, ...item }) => item);

  // #135 foundation: start building up the canonical item store in the background from whatever
  // real provider items search already fetched. This is write-behind only (nothing here is
  // awaited), so it can never add latency or throw into the search response, and it is a no-op
  // when TASTEMAKE_DATABASE_URL isn't configured (e.g. this sandbox, or a preview env without it).
  canonicalizeWriteBehind(results, { env });

  return { items: results, providers, degraded };
}

export { igdbToken, igdbItem, openLibraryItem, tmdbItem, searchRelevance };
