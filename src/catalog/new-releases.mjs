// #6: "New this week for you." Movies, TV and games released in the last 7 or next 7 days, matched to the
// person's own experienced taste without AI: a release must share a genre with something they loved, liked
// or favorited in the same area, and it is explained the way no-AI picks are ("Shares sci-fi with Arrival").
// Server-only. Release lists are shared across visitors and cached; matching is per request.
//
// Sources: TMDb discover (movies by primary release date in the viewer's country; new series by first air
// date) and IGDB (games by first release date). Books are left out: Open Library has no reliable list of
// upcoming releases (#249 would be the source).

import { cachedValue } from "../server/cache.mjs";
import { fetchWithTimeout } from "../lib/fetch-timeout.mjs";
import { igdbItem, igdbToken, tmdbItem } from "./providers.mjs";
import { evidenceRecords } from "../model/evidence.js";
import { fallbackReason } from "./fallback-reasons.mjs";
import { isAdultTagged } from "./adult-content.mjs";
import { excludedBy } from "../model/exclusions.js";

export const WINDOW_DAYS = 7;
export const MAX_RESULTS = 5;
const PER_AREA = 2;
const LIST_TTL_SECONDS = 6 * 60 * 60;
const DAY = 24 * 60 * 60 * 1000;
const iso = (date) => date.toISOString().slice(0, 10);

export function releaseWindow(now = new Date()) {
  return { from: iso(new Date(now.getTime() - WINDOW_DAYS * DAY)), to: iso(new Date(now.getTime() + WINDOW_DAYS * DAY)) };
}

async function tmdbReleases(kind, window, region, env, fetchImpl) {
  if (!env.TASTEMAKE_TMDB_TOKEN) return [];
  const dates = kind === "tv"
    ? `first_air_date.gte=${window.from}&first_air_date.lte=${window.to}`
    : `primary_release_date.gte=${window.from}&primary_release_date.lte=${window.to}&region=${region}&with_release_type=2|3|4`;
  const url = `https://api.themoviedb.org/3/discover/${kind}?${dates}&sort_by=popularity.desc&include_adult=false&language=en-US&page=1`;
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { authorization: `Bearer ${env.TASTEMAKE_TMDB_TOKEN}`, accept: "application/json" } });
  if (!response.ok) throw new Error(`tmdb new releases ${response.status}`);
  return ((await response.json()).results ?? []).slice(0, 20).map((row) => ({
    ...tmdbItem(row, kind),
    releaseDate: (kind === "tv" ? row.first_air_date : row.release_date) || null,
    popularity: Number(row.popularity) || 0
  }));
}

async function igdbReleases(window, env, fetchImpl) {
  const token = await igdbToken(env, fetchImpl);
  if (!token) return [];
  const from = Math.floor(Date.parse(`${window.from}T00:00:00Z`) / 1000);
  const to = Math.floor(Date.parse(`${window.to}T23:59:59Z`) / 1000);
  const response = await fetchWithTimeout(fetchImpl, "https://api.igdb.com/v4/games", {
    method: "POST",
    headers: { "client-id": env.IGDB_CLIENT_ID, authorization: `Bearer ${token}`, "content-type": "text/plain" },
    body: `fields name,summary,first_release_date,url,cover.image_id,genres.id,genres.name,themes.name,collection.id,franchises.id,hypes,total_rating_count; where first_release_date >= ${from} & first_release_date <= ${to} & (hypes > 0 | total_rating_count > 0); sort hypes desc; limit 30;`
  });
  if (!response.ok) throw new Error(`igdb new releases ${response.status}`);
  return (await response.json()).map((row) => ({
    ...igdbItem(row),
    releaseDate: row.first_release_date ? iso(new Date(row.first_release_date * 1000)) : null,
    popularity: Number(row.hypes) || Number(row.total_rating_count) || 0
  }));
}

// One shared list per area, country and day. Production caches; tests (a stub fetch) call straight through.
async function releaseList(area, window, region, env, fetchImpl) {
  const load = () => (area === "play" ? igdbReleases(window, env, fetchImpl) : tmdbReleases(area === "tv" ? "tv" : "movie", window, region, env, fetchImpl));
  try {
    if (fetchImpl !== fetch) return await load();
    return await cachedValue(`new-releases:v1:${area}:${region}:${window.from}`, load, { ttl: LIST_TTL_SECONDS, tags: ["new-releases"] });
  } catch {
    return [];   // one area failing never empties the others
  }
}

// What a release is matched on: TMDb genre ids, IGDB genre names (themes too).
const genreKeys = (item) => new Set([...(item?.genres ?? []), ...(item?.providerMeta?.themes ?? [])].map((g) => String(g).toLowerCase()));

function anchorsByArea(state) {
  const byArea = {};
  for (const record of evidenceRecords(state)) {
    if (!record.countsAsTaste || record.polarity <= 0) continue;
    const item = state.customItems?.[record.itemId] ?? state.feedbackByRecommendation?.[record.itemId]?.item;
    if (!item) continue;
    for (const area of record.domains ?? []) (byArea[area] ??= []).push({ item, weight: record.weight ?? 1 });
  }
  return byArea;
}

// The anchor in the same area that shares the most genres with the release (heavier evidence wins ties).
export function bestAnchor(release, anchors = []) {
  const keys = genreKeys(release);
  let best = null;
  for (const anchor of anchors) {
    const shared = [...genreKeys(anchor.item)].filter((g) => keys.has(g)).length;
    if (!shared) continue;
    const score = shared + anchor.weight / 10;
    if (!best || score > best.score) best = { ...anchor, shared, score };
  }
  return best;
}

export async function newReleasesFor(state, { env = process.env, fetchImpl = fetch, region = "US", now = new Date() } = {}) {
  const window = releaseWindow(now);
  const code = /^[A-Z]{2}$/.test(String(region)) ? region : "US";
  const areas = ["movies", "tv", "play"].filter((area) => state.areas?.[area] !== false);
  const anchors = anchorsByArea(state);
  const known = new Set([...Object.keys(state.feedbackByRecommendation ?? {}), ...(state.selectedFavorites ?? []), ...(state.seenItemIds ?? [])]);

  const perArea = await Promise.all(areas.map(async (area) => {
    if (!(anchors[area] ?? []).length) return [];
    const list = await releaseList(area, window, code, env, fetchImpl);
    return list
      // A shortlist nobody asked for stays clear of flagged synopses, explicitly adult-tagged titles and
      // anything the person ruled out in Never recommend (#48).
      .filter((item) => !known.has(item.id) && !item.aboutFlag && !isAdultTagged(item) && item.releaseDate && !excludedBy(item, state.exclusions ?? []))
      .map((item) => ({ item, anchor: bestAnchor(item, anchors[area]) }))
      .filter((entry) => entry.anchor)
      .sort((a, b) => b.anchor.score - a.anchor.score || b.item.popularity - a.item.popularity)
      .slice(0, PER_AREA);
  }));

  // Interleave areas so one busy week of films doesn't crowd out the rest.
  const picks = [];
  for (let round = 0; picks.length < MAX_RESULTS && round < PER_AREA; round += 1) {
    for (const list of perArea) if (list[round] && picks.length < MAX_RESULTS) picks.push(list[round]);
  }
  return {
    window,
    region: code,
    items: picks.map(({ item, anchor }, index) => {
      const { popularity, _searchPopularity, ...rest } = item;
      return { ...rest, reason: fallbackReason(item, anchor.item, { index }), relatedToTitle: anchor.item.title };
    })
  };
}
