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

// Oct 27 smoke test: a book search for "Project Hail Mary" also listed "Blake Estate oral history project"
// and "La dame aux camélias", which Open Library's full-text search matched on one loose word. A book
// whose title doesn't match the query is kept only when the query names one of its authors ("andy weir"
// should still find his books) or matches one of its series ("stormlight archive" finds The Way of Kings).
const NAME_SUFFIXES = new Set(["jr", "sr", "fils", "ii", "iii", "iv"]);

export function isOffTopicBook(title, authors, query, seriesNames = [], titleMatchAuthors = new Set()) {
  if (matchClass(title, query).score) return false;
  if ([].concat(authors ?? []).some((name) => titleMatchAuthors.has(normalizeSearch(name)))) return false;
  if ([].concat(seriesNames ?? []).some((name) => matchClass(name, query).score)) return false;
  const words = new Set(normalizeSearch(query).split(" "));
  return ![].concat(authors ?? []).some((name) => {
    const parts = normalizeSearch(name).split(" ").filter((part) => part && !NAME_SUFFIXES.has(part));
    const surname = parts.at(-1);
    return Boolean(surname && surname.length >= 3 && words.has(surname));
  });
}

// Oct 27 smoke test (after #301): "stormlight archive" lost The Way of Kings and the rest, because Open
// Library leaves series_name empty for them and only the box sets carry the series in their title. A book
// that shares an author with a result whose title does match is kept too: the box set is by Brandon
// Sanderson, so his other books stay. Rows: whatever the provider returns; `fields` says where the title,
// authors and series names are. Run after the companion filter, so a study guide's author never counts.
export function dropOffTopicBooks(rows, query, { title, authors, series = () => [] }) {
  const titleMatchAuthors = new Set(rows
    .filter((row) => matchClass(title(row), query).score)
    .flatMap((row) => [].concat(authors(row) ?? []).map(normalizeSearch))
    .filter(Boolean));
  return rows.filter((row) => !isOffTopicBook(title(row), authors(row), query, series(row), titleMatchAuthors));
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
// Oct 27: Music (10402) too, for score listings ("Project Hail Mary | Watch Rocky Sleep"), and
// screenplays, scores, collector's editions and box sets ("Andy Weir's 3-Book Collection Set"), which
// should rank below the work itself.
const DERIVATIVE_GENRES = new Set([99, 10402, 10763, 10764, 10767]); // Documentary, Music, News, Reality, Talk
const DERIVATIVE_WORDS = /\b(making of|behind the scenes|retrospective|featurette|trailer|teaser|soundtrack|documentary|screenplay|song reader|(?:original|motion picture) score|collector s edition|box(?:ed)? set|collection set|\d+ book (?:set|collection|bundle))\b/;
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

// #243: a title ABOUT another work ("The Making of The Legend of Zelda: Breath of the Wild") can still
// match the query exactly in its subtitle, which earned it the family score and put it above the work's
// own DLC. Unless the query asks for that kind of thing, such a title matches no better than "contains".
function derivativeTitle(title, query) {
  const hit = normalizeSearch(title).match(DERIVATIVE_WORDS)?.[1];
  return Boolean(hit) && !normalizeSearch(query).includes(hit);
}

export function scoreSearchResult(item, query) {
  const found = matchClass(item?.title, query);
  if (!found.score) return 0;
  // One point below "contains", so it never ties the work's own entries when popularity is unknown.
  const match = derivativeTitle(item?.title, query) ? { score: Math.min(found.score, MATCH.contains) - 1, literal: false } : found;
  const wantedWords = normalizeSearch(query).split(" ").length;
  const gotWords = normalizeSearch(item?.title).split(" ").length;
  const extraWords = Math.min(MAX_EXTRA_WORD_PENALTY, Math.max(0, gotWords - wantedWords) * EXTRA_WORD_PENALTY);
  return match.score
    + (match.literal ? LITERAL_EXACT_BONUS : 0)
    + NOTABILITY_WEIGHT * notabilityScore(item, query)
    - extraWords;
}

// ---- Oct 27: tie-ins and editions --------------------------------------------------------------------
// Ranking only re-orders, so "Project Hail Mary" still listed "Project Hail Mary | Watch Rocky Sleep" (a
// TMDb music listing for the score) and "Project Hail Mary: A Novel" (an Open Library work with no
// author, 1 edition, no cover), and "Everything Everywhere All at Once" listed its coverless 1-edition
// screenplay, song reader and collector's edition. Open Library keeps each of those as its own work, so
// dedupe by id never catches them. After ranking, pruneSearchResults:
//   1. merges book editions of one work (same title once ": a novel" and edition words are stripped,
//      same first author or none on one side), keeping the one with more editions;
//   2. drops a result whose title is another result's title plus a tie-in suffix, but only when it is
//      also weak: a book with at most 1 edition and no cover, or no author; or a TMDb documentary or
//      music listing. Real box sets and screenplays with metadata stay, demoted by DERIVATIVE_WORDS.
// A query that asks for the suffix ("everything everywhere screenplay") keeps it, like isBookCompanion.
const EDITION_SUFFIX = "a novel|(?:the )?(?:collector s|deluxe|special|(?:\\d+(?:st|nd|rd|th) )?anniversary)(?: \\w+)? edition";
const TIE_IN_SUFFIX = new RegExp(`^(?:${EDITION_SUFFIX}|(?:the )?screenplay(?: book)?|song reader|(?:the )?(?:original )?(?:motion picture )?(?:score|soundtrack))$`);
const EDITION_TAIL = new RegExp(`^(.+?) (${EDITION_SUFFIX})$`);
const PLAIN_WORDS = new Set(["a", "the", "book", "original", "motion", "picture", "edition"]);
const isBook = (item) => item?.provider === "openlibrary" || item?.provider === "googlebooks";
// Open Library's edition_count travels as _searchPopularity; a Google volume is one edition.
const editionCount = (item) => item?.provider === "openlibrary" ? Number(item._searchPopularity) || 0 : 1;
const firstAuthor = (item) => normalizeSearch(String(item?.by ?? "").split(",")[0]);
const asksFor = (suffix, query) => {
  const wanted = new Set(normalizeSearch(query).split(" "));
  return normalizeSearch(suffix).split(" ").some((word) => word && !PLAIN_WORDS.has(word) && wanted.has(word));
};

// The suffix after `base` when `title` is `base` plus "| ..." or a tie-in/edition suffix; otherwise null.
export function tieInSuffix(title, base) {
  const raw = String(title ?? "");
  const wanted = normalizeSearch(base);
  if (!wanted) return null;
  const bar = raw.indexOf("|");
  if (bar > 0 && normalizeSearch(raw.slice(0, bar)) === wanted && normalizeSearch(raw.slice(bar + 1))) return raw.slice(bar + 1).trim();
  const got = normalizeSearch(raw);
  if (!got.startsWith(`${wanted} `)) return null;
  const rest = got.slice(wanted.length + 1);
  return TIE_IN_SUFFIX.test(rest) ? rest : null;
}

function isWeakTieIn(item, query) {
  if (isBook(item)) return !firstAuthor(item) || (editionCount(item) <= 1 && !item.artwork);
  if (item?.provider !== "tmdb" || matchClass(item.title, query).score === MATCH.exact) return false;
  return (item.providerMeta?.genreIds ?? []).some((id) => Number(id) === 99 || Number(id) === 10402);
}

export function dropWeakTieIns(items, query) {
  const titles = items.map((item) => item?.title).filter(Boolean);
  return items.filter((item) => {
    if (!isWeakTieIn(item, query)) return true;
    const suffix = titles.map((base) => base === item.title ? null : tieInSuffix(item.title, base)).find(Boolean);
    return !suffix || asksFor(suffix, query);
  });
}

// "Project Hail Mary: A Novel" keys as "project hail mary", unless the query asks for that edition.
function editionKey(title, query) {
  const key = stripLeadingArticle(title);
  const tail = key.match(EDITION_TAIL);
  return tail && !asksFor(tail[2], query) ? tail[1] : key;
}

// More editions wins; then a cover and an author.
function strongerEdition(a, b) {
  const meta = (item) => (item.artwork ? 1 : 0) + (firstAuthor(item) ? 1 : 0);
  const diff = editionCount(b) - editionCount(a) || meta(b) - meta(a);
  return diff > 0 ? b : a;
}

// Ranked order is kept: the merged work sits where the first of its editions ranked. Different first
// authors never merge.
export function mergeBookEditions(items, query) {
  const out = [];
  for (const item of items) {
    const key = isBook(item) ? editionKey(item.title, query) : null;
    const twin = key ? out.findIndex((kept) => isBook(kept) && editionKey(kept.title, query) === key
      && (!firstAuthor(kept) || !firstAuthor(item) || firstAuthor(kept) === firstAuthor(item))) : -1;
    if (twin === -1) out.push(item);
    else out[twin] = strongerEdition(out[twin], item);
  }
  return out;
}

export function pruneSearchResults(items, query) {
  return dropWeakTieIns(mergeBookEditions(items, query), query);
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
