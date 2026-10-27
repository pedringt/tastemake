// #48: hard boundaries. "Never recommend this creator / series / kind of thing." A constraint, not taste:
// an exclusion is never evidence, never lowers a pattern's confidence, and is never shown as a dislike.
// It only removes matching candidates before Tastemake picks (api/recommendations.mjs) and, when added
// from a card, removes matching cards from the set on screen.
//
// Shared by the browser and the server (plain data in, plain data out).

import { hasSeriesSignal, isFranchiseContinuation } from "../catalog/novelty.mjs";

// Kinds of thing a person can rule out, matched per medium from the catalog's own genre data. Gaps are
// the catalog's: TMDb has no Horror or Romance genre for TV, so those match movies, books and games only.
export const EXCLUDABLE_GENRES = [
  { id: "horror", label: "Horror", tmdbMovie: [27], tmdbTv: [], book: /\bhorror\b|\bghost stories\b/i, game: /^horror$/i },
  { id: "romance", label: "Romance", tmdbMovie: [10749], tmdbTv: [], book: /\bromance\b|\blove stories\b/i, game: /^romance$/i },
  { id: "war", label: "War", tmdbMovie: [10752], tmdbTv: [10768], book: /\bwar(?:fare)?\b|\bmilitary\b/i, game: /^warfare$/i },
  { id: "crime", label: "Crime", tmdbMovie: [80], tmdbTv: [80], book: /\btrue crime\b|\bcrime\b|\bmurder\b/i, game: null },
  { id: "kids", label: "Kids & family", tmdbMovie: [10751], tmdbTv: [10762], book: /\bjuvenile\b|\bchildren'?s\b|\bpicture books?\b/i, game: /^kids$/i },
  { id: "documentary", label: "Documentary", tmdbMovie: [99], tmdbTv: [99], book: null, game: null },
  { id: "animation", label: "Animation", tmdbMovie: [16], tmdbTv: [16], book: null, game: null }
];

const genreById = (id) => EXCLUDABLE_GENRES.find((genre) => genre.id === id) ?? null;

const normalizeName = (name) => String(name ?? "")
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

// Names the catalog gives for who made it: book authors (on every book), and director / showrunner /
// developer when Tastemake has fetched that title's details.
export function creatorsOf(item) {
  const raw = [item?.by, item?.director, item?.creator, item?.developer].filter(Boolean).join(",");
  const seen = new Map();
  for (const part of raw.split(",")) {
    const label = part.trim();
    const key = normalizeName(label);
    if (key.length >= 3 && !seen.has(key)) seen.set(key, label);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

export function genresOf(item) {
  const genres = (item?.genres ?? []).map(String);
  const ids = genres.map(Number).filter(Number.isFinite);
  const themes = (item?.providerMeta?.themes ?? []).map(String);
  return EXCLUDABLE_GENRES.filter((genre) => {
    if (item?.provider === "tmdb") return (item.type === "tv" ? genre.tmdbTv : genre.tmdbMovie).some((id) => ids.includes(id));
    if (item?.provider === "openlibrary" || item?.provider === "googlebooks") return Boolean(genre.book) && genres.some((g) => genre.book.test(g));
    if (item?.provider === "igdb") return Boolean(genre.game) && [...genres, ...themes].some((g) => genre.game.test(g));
    return false;
  }).map((genre) => genre.id);
}

// Just enough of an item to recognize the rest of its series later (the novelty guard's own rules:
// collection/franchise ids, book series ids and names, numbered and same-author titles).
function seriesReference(item) {
  const meta = item?.providerMeta ?? {};
  return {
    id: item.id,
    provider: item.provider,
    type: item.type,
    title: item.title,
    by: item.by ?? null,
    providerMeta: {
      collectionId: meta.collectionId ?? null,
      franchiseId: meta.franchiseId ?? null,
      seriesKey: meta.seriesKey ?? null,
      seriesKeys: meta.seriesKeys ?? null,
      seriesNames: meta.seriesNames ?? null
    }
  };
}

// The choices a card's "Don't recommend…" menu offers for this item.
export function exclusionOptions(item) {
  const options = creatorsOf(item).slice(0, 2).map(({ key, label }) => ({ kind: "creator", key, label: `Anything by ${label}` }));
  if (hasSeriesSignal(item)) options.push({ kind: "series", key: item.id, label: `${item.title} and its series` });
  for (const id of genresOf(item)) options.push({ kind: "genre", key: id, label: `All ${genreById(id).label.toLowerCase()}` });
  return options;
}

export function makeExclusion(kind, key, item = null) {
  if (kind === "genre") {
    const genre = genreById(key);
    return genre ? { id: `genre:${genre.id}`, kind, key: genre.id, label: genre.label } : null;
  }
  if (kind === "creator") {
    const label = creatorsOf(item).find((c) => c.key === key)?.label ?? String(key ?? "").trim();
    const normalized = normalizeName(label);
    return normalized.length >= 3 ? { id: `creator:${normalized}`, kind, key: normalized, label } : null;
  }
  if (kind === "series" && item) return { id: `series:${item.id}`, kind, key: item.id, label: `${item.title} series`, ref: seriesReference(item) };
  return null;
}

export function exclusionMatches(exclusion, item) {
  if (!exclusion || !item) return false;
  if (exclusion.kind === "genre") return genresOf(item).includes(exclusion.key);
  if (exclusion.kind === "creator") return creatorsOf(item).some((c) => c.key === exclusion.key);
  if (exclusion.kind === "series") return Boolean(exclusion.ref) && isFranchiseContinuation(item, exclusion.ref);
  return false;
}

export function excludedBy(item, exclusions = []) {
  return exclusions.find((exclusion) => exclusionMatches(exclusion, item)) ?? null;
}

export function addExclusion(state, exclusion) {
  if (!exclusion) return false;
  state.exclusions = (state.exclusions ?? []).filter((e) => e.id !== exclusion.id);
  state.exclusions.push({ ...exclusion, addedAt: new Date().toISOString() });
  return true;
}

export function removeExclusion(state, id) {
  const before = (state.exclusions ?? []).length;
  state.exclusions = (state.exclusions ?? []).filter((e) => e.id !== id);
  return state.exclusions.length < before;
}

// Removes matching picks from the set on screen. Nothing is recorded about them.
export function dropExcludedFromActiveSet(state, exclusion) {
  const sets = state.recommendationSets ?? [];
  if (!sets.length) return 0;
  const current = sets[sets.length - 1];
  const kept = current.filter((item) => state.feedbackByRecommendation?.[item.id] || !exclusionMatches(exclusion, item));
  sets[sets.length - 1] = kept;
  return current.length - kept.length;
}
