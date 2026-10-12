// Catalog search ranking (#106, #115). Dependency-free so the unit suites can replay real captured
// search responses through it.
//
// A result's score combines two things:
//
//   1. How closely the title matches the query (the match class). An exact title is the strongest
//      class. A title that begins with the query, or whose subtitle is the query ("The Legend of
//      Zelda: Breath of the Wild" for "breath of the wild"), is the next class. Titles that merely
//      contain the query are weaker.
//   2. How well known the record looks (notability, 0..1). This is the provider's own popularity
//      signal, put on one scale across providers, plus how complete the record is (artwork,
//      genres, a real synopsis, a year). A record with none of those is usually a stub.
//
// #106 made exact titles win. #115: that let a stub with a short exact title (a 5-episode companion
// web series called "Crouching Tiger", no artwork, no genres) outrank the well-known work whose
// official title is longer ("Crouching Tiger, Hidden Dragon"). The gap between the exact class and
// the title-family class is now worth NOTABILITY_FOR_FAMILY_FLIP of notability, so:
//   - when the two are comparably known, the exact title still wins (#106's intent);
//   - a clearly better-known title-family match can pass an obscure or stub exact match.
// Looser classes (title merely contains the query) need a much larger notability gap.

const normalizeSearch = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const stripLeadingArticle = (value) => normalizeSearch(value).replace(/^(the|a|an)\s+/, "");

// Match classes. Scores are on the same scale as NOTABILITY_WEIGHT below.
const MATCH = {
  exact: 100,
  family: 90,      // begins with the query at a word boundary, or the subtitle is the query
  prefix: 80,      // begins with the query mid-word
  contains: 60,
  wordPrefix: 40,  // every query word starts a title word
  allWords: 30,
  none: 0
};
// Exact title with the same leading article as the query ("Parasite" vs "The Parasite" for "parasite").
const LITERAL_EXACT_BONUS = 0.5;
const NOTABILITY_WEIGHT = 50;
// For reference only: exact beats a title-family match unless the family match's notability is this
// much higher (MATCH.exact - MATCH.family) / NOTABILITY_WEIGHT.
export const NOTABILITY_FOR_FAMILY_FLIP = (MATCH.exact - MATCH.family) / NOTABILITY_WEIGHT;
const EXTRA_WORD_PENALTY = 0.25;
const MAX_EXTRA_WORD_PENALTY = 2;

export function matchClass(title, query) {
  const wanted = normalizeSearch(query);
  const got = normalizeSearch(title);
  if (!wanted || !got) return { score: MATCH.none, literal: false };
  const wantedCore = stripLeadingArticle(query) || wanted;
  const gotCore = stripLeadingArticle(title) || got;
  if (got === wanted) return { score: MATCH.exact, literal: true };
  if (gotCore === wantedCore) return { score: MATCH.exact, literal: false };
  if (gotCore.startsWith(`${wantedCore} `) || wantedCore.startsWith(`${gotCore} `)) return { score: MATCH.family };
  // Subtitle match: "<series>: <query>" or "<series> - <query>" with nothing after the query.
  const raw = String(title ?? "");
  const sep = raw.search(/\s*[:–—-]\s+/);
  if (sep > 0) {
    const subtitle = stripLeadingArticle(raw.slice(sep).replace(/^\s*[:–—-]\s+/, ""));
    if (subtitle && subtitle === wantedCore) return { score: MATCH.family };
  }
  if (got.startsWith(wanted) || gotCore.startsWith(wantedCore)) return { score: MATCH.prefix };
  if (got.includes(wanted) || gotCore.includes(wantedCore)) return { score: MATCH.contains };
  const wantedWords = wanted.split(" ");
  const gotWords = got.split(" ");
  if (wantedWords.every((word) => gotWords.some((candidate) => candidate.startsWith(word)))) return { score: MATCH.wordPrefix };
  if (wantedWords.every((word) => gotWords.includes(word))) return { score: MATCH.allWords };
  return { score: MATCH.none };
}

// Each provider reports popularity on its own scale: TMDb `popularity`, IGDB `total_rating_count`,
// Open Library `edition_count`. Comparing them raw let one provider's numbers dominate "All". Each is
// mapped onto 0..1 on a log scale between a floor (at or below it a work is effectively unknown) and
// a reference (at or above it a work is well known for that provider).
const POPULARITY_SCALE = {
  tmdb: { floor: 1, ref: 30 },
  igdb: { floor: 2, ref: 300 },
  openlibrary: { floor: 2, ref: 100 }
};
const DEFAULT_SCALE = POPULARITY_SCALE.tmdb;

export function popularityScore(popularity, provider) {
  const { floor, ref } = POPULARITY_SCALE[provider] ?? DEFAULT_SCALE;
  const value = Number(popularity) || 0;
  if (value <= floor) return 0;
  const low = Math.log10(1 + floor);
  return Math.min(1, (Math.log10(1 + value) - low) / (Math.log10(1 + ref) - low));
}

const GENERIC_ABOUT = /^(no description (available|shown)|game from igdb|book from open library|first published \d+)\.?$/i;

// How complete the record is, over the fields this provider can supply. Open Library search rows
// never carry a synopsis, so books are not marked down for lacking one.
export function completenessScore(item) {
  const parts = [
    [0.5, Boolean(item?.artwork)],
    [0.2, (item?.genres ?? []).length > 0],
    [0.1, Boolean(item?.year)]
  ];
  if (item?.provider !== "openlibrary") {
    const about = String(item?.about ?? "").trim();
    parts.push([0.2, Boolean(about) && !GENERIC_ABOUT.test(about)]);
  }
  const total = parts.reduce((sum, [weight]) => sum + weight, 0);
  return parts.reduce((sum, [weight, ok]) => sum + (ok ? weight : 0), 0) / total;
}

// Work type: a documentary about the work, a news/talk/reality show, or a trailer/making-of is
// rarely what a title search means. Uses TMDb's own genre ids plus a short list of generic
// derivative-work words, and only when the query itself does not ask for that kind of thing.
const DERIVATIVE_GENRES = new Set([99, 10763, 10764, 10767]); // Documentary, News, Reality, Talk
const DERIVATIVE_WORDS = /\b(making of|behind the scenes|retrospective|featurette|trailer|teaser|soundtrack|documentary)\b/;
const DERIVATIVE_PENALTY = 0.15;

function isDerivative(item, query) {
  const wanted = normalizeSearch(query);
  const title = normalizeSearch(item?.title);
  const titleHit = title.match(DERIVATIVE_WORDS)?.[1];
  if (titleHit && !wanted.includes(titleHit)) return true;
  if (/\bdocumentar/.test(wanted)) return false;
  return (item?.providerMeta?.genreIds ?? []).some((id) => DERIVATIVE_GENRES.has(Number(id)));
}

export function notabilityScore(item, query = "") {
  const pop = popularityScore(item?._searchPopularity, item?.provider);
  const complete = completenessScore(item);
  const base = 0.65 * pop + 0.35 * complete;
  return Math.max(0, base - (isDerivative(item, query) ? DERIVATIVE_PENALTY : 0));
}

export function scoreSearchResult(item, query) {
  const match = matchClass(item?.title, query);
  if (!match.score) return 0;
  const wantedWords = normalizeSearch(query).split(" ").length;
  const gotWords = normalizeSearch(item?.title).split(" ").length;
  const extraWords = Math.min(MAX_EXTRA_WORD_PENALTY, Math.max(0, gotWords - wantedWords) * EXTRA_WORD_PENALTY);
  return match.score
    + (match.literal ? LITERAL_EXACT_BONUS : 0)
    + NOTABILITY_WEIGHT * notabilityScore(item, query)
    - extraWords;
}

// Stable: equal scores keep the provider's own order.
export function rankSearchResults(items, query) {
  return items
    .map((item, index) => ({ item, index, score: scoreSearchResult(item, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

// Title-only relevance kept for existing callers and tests: the same score for a bare title plus an
// optional TMDb-scale popularity.
export function searchRelevance(title, query, popularity = 0) {
  return scoreSearchResult({ title, _searchPopularity: popularity }, query);
}
