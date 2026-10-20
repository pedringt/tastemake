// #142: deterministic book-series membership, read from Open Library's own data. Browser-safe (no
// server imports) because novelty.mjs, which uses it, also loads in the browser.
//
// Open Library records series in three places, with uneven coverage (checked live, Oct 2026, see
// scripts/qa/fixtures/openlibrary-series-142.json):
//   1. `series_key` on a search row: a curated series id ("OL331367L" for Dune). Present for Dune,
//      The Expanse, Red Rising and Harry Potter; absent for The Hunger Games, Mistborn, Stormlight.
//   2. Work subjects of the form "series:The Expanse" / "Serie:The_Hunger_Games". Present for most
//      first books, sometimes deep in the list (index 90 for The Hunger Games), often absent on
//      sequels ("Words of Radiance", "The Well of Ascension").
//   3. The `series` field on editions ("The Stormlight Archive, 2", "The Mistborn Saga #2"). The only
//      place the two sequels above say what they belong to. Needs a per-work lookup, so it is used
//      sparingly, server-side only (see book-series-editions.mjs).
//
// A series *id* match (1) is trusted on its own, the same way TMDb collection ids are. A series
// *name* match (2, 3, or a "(Mistborn, Book 2)" title suffix) also requires a shared author, because
// names are free text and a publisher line ("Penguin Modern Classics") can look like a series.

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth";
const SEQUENCE_TAIL = new RegExp(
  `(?:[\\s,;:.#\\-–—]+|^)(?:(?:book|bk|vol|volume|no|nr|number|part|pt|tome|tom|livro|libro|buch|band|bd|deel|dl)\\.?\\s*)?#?\\s*(?:\\d+(?:\\.\\d+)?|[ivx]{1,4}|${NUMBER_WORDS})\\.?\\s*$`
);
const GENERIC_SUFFIX = /\s+(series|saga|trilogy|tetralogy|quartet|quintet|duology|sequence|cycle)$/;

// Edition `series` values include publisher lines and imprints, not just story series. These words
// mark a value as a publisher line; such values never count as series evidence.
const IMPRINT_WORDS = /\b(classics?|library|biblioteca|bibliotheque|bibliothek|bunko|anagrama|penguin|vintage|signet|bantam|perennial|editions?|edicion|ediciones|collection|coleccion|bestsellers?|readers?|guide|sparknotes|choice|large print|paperbacks?|pocket|compactos|literature|literary|literaria|narrativa|narrativas|fiction|panorama|masterworks|iread|book club)\b/;

export function normalizeSeriesName(raw) {
  let value = String(raw ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[’']/g, "")
    .replace(/[[\]()]/g, " ")
    .trim();
  for (let i = 0; i < 3 && SEQUENCE_TAIL.test(value); i += 1) value = value.replace(SEQUENCE_TAIL, "").trim();
  value = value.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  value = value.replace(/^(the|a|an)\s+/, "");
  while (GENERIC_SUFFIX.test(value)) value = value.replace(GENERIC_SUFFIX, "").trim();
  return value.length >= 3 && !/^\d+$/.test(value) ? value : null;
}

const SUBJECT_SERIES = /^\s*(?:series|serie|franchise)\s*:\s*(.+)$/i;

// "The Well of Ascension (Mistborn, Book 2)" / "Caliban's War (The Expanse #2)". Only a suffix that
// carries an explicit sequence marker counts; "Dune Messiah (1 of 2)" is a split edition, not a series.
const TITLE_SERIES_SUFFIX = /\(([^()]*?(?:#\s*\d+|\b(?:book|bk|vol|volume|no)\.?\s*(?:\d+|[ivx]{1,4}|one|two|three|four|five|six|seven|eight|nine|ten))[^()]*)\)\s*$/i;

export function seriesNameFromTitle(title) {
  const match = String(title ?? "").match(TITLE_SERIES_SUFFIX);
  return match ? normalizeSeriesName(match[1]) : null;
}

const uniqStrings = (values) => [...new Set(values.filter(Boolean).map(String))];

// #255: where a book sits in its series. Open Library's search returns `series_position` for curated
// series ("2" for The Wise Man's Fear); a title suffix like "(Mistborn, Book 2)" says it too. Edition
// `series` values ("The Mistborn Saga #3", "Mistborn -- bk. 3") are read by seriesPositionFromEditions.
// Only a plain positive number counts; "0.5" novellas and ranges are left unknown.
const POSITION_IN_VALUE = /(?:#|\b(?:book|bk|vol|volume|no|part|pt|day)\.?)\s*(\d{1,2})\b|[,:]\s*(\d{1,2})\s*$/i;
const WORD_POSITIONS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function positionNumber(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : null;
}

export function seriesPositionFromValue(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(POSITION_IN_VALUE);
  if (match) return positionNumber(match[1] ?? match[2]);
  const word = text.match(/\b(?:book|bk|vol|volume|part)\.?\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  return word ? WORD_POSITIONS[word[1].toLowerCase()] : null;
}

function seriesPositionFromTitle(title) {
  const match = String(title ?? "").match(TITLE_SERIES_SUFFIX);
  return match ? seriesPositionFromValue(match[1]) : null;
}

// Series facts from one Open Library search row (search.json with series_key/series_name/subject).
export function bookSeriesFromRow(row = {}) {
  const ids = uniqStrings([].concat(row.series_key ?? [])).slice(0, 4);
  const names = uniqStrings([
    ...[].concat(row.series_name ?? []).map(normalizeSeriesName),
    ...(row.subject ?? []).map((subject) => {
      const match = String(subject).match(SUBJECT_SERIES);
      return match ? normalizeSeriesName(match[1]) : null;
    }),
    seriesNameFromTitle(row.title)
  ]).slice(0, 6);
  const seriesPosition = positionNumber([].concat(row.series_position ?? [])[0]) ?? seriesPositionFromTitle(row.title);
  return { seriesKey: ids[0] ?? null, seriesKeys: ids, seriesNames: names, seriesPosition };
}

// A position from a work's edition list: at least two editions must agree on the same number, and it
// must be the only number with that much support. "The Mistborn Saga #3" + "Mistborn -- bk. 3" -> 3;
// "The Witcher, part 3" + "The Witcher 1" (one vote each) -> unknown.
// A number only counts next to a series name the editions themselves agree on, so a numbered
// publisher line ("Nova ciencia ficción 12") can never make a book look like a sequel.
export function seriesPositionFromEditions(entries = []) {
  const names = new Set(seriesNamesFromEditions(entries));
  if (!names.size) return null;
  const votes = new Map();
  for (const entry of entries) {
    const positions = new Set((entry?.series ?? [])
      .filter((value) => names.has(normalizeSeriesName(value)))
      .map(seriesPositionFromValue)
      .filter(Boolean));
    for (const position of positions) votes.set(position, (votes.get(position) ?? 0) + 1);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || ranked[1]?.[1] === ranked[0][1]) return null;
  return ranked[0][0];
}

// Names from a work's edition list. A name must appear on at least two editions and must not look
// like a publisher line. Real example: "Words of Radiance" editions carry "The Stormlight Archive"
// and "The Stormlight Archive, 2" (two votes for "stormlight archive"); "Never Let Me Go" carries
// one-off Spanish/Japanese imprint lines that never reach two votes or are filtered as imprints.
export function seriesNamesFromEditions(entries = []) {
  const votes = new Map();
  for (const entry of entries) {
    const names = new Set((entry?.series ?? []).map(normalizeSeriesName).filter(Boolean));
    for (const name of names) {
      if (IMPRINT_WORDS.test(name)) continue;
      votes.set(name, (votes.get(name) ?? 0) + 1);
    }
  }
  return [...votes.entries()].filter(([, count]) => count >= 2).map(([name]) => name).slice(0, 6);
}

export const isBook = (item) => item?.type === "book" || item?.provider === "openlibrary";

// Provider series ids on an item. Older Open Library items (live before #142's follow-up) stored
// `series_key` as the raw array, so `seriesKey` can be a string or an array.
export function bookSeriesIds(item) {
  const meta = item?.providerMeta ?? {};
  return uniqStrings([...[].concat(meta.seriesKey ?? []), ...[].concat(meta.seriesKeys ?? [])]);
}

export function bookSeriesPosition(item) {
  return positionNumber(item?.providerMeta?.seriesPosition) ?? seriesPositionFromTitle(item?.title);
}

// #255: a book that is not the first in its series. For a series the user has not started, the first
// book is the better recommendation; for one they have started, the novelty guard already suppresses
// sibling installments. Unknown position means "not a later entry" (fail open).
export function isLaterSeriesEntry(item) {
  return isBook(item) && (bookSeriesPosition(item) ?? 1) > 1;
}

export function bookSeriesNames(item) {
  return uniqStrings([...(item?.providerMeta?.seriesNames ?? []), seriesNameFromTitle(item?.title)]);
}

const normalizeAuthor = (name) => String(name ?? "")
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");

export function bookAuthors(item) {
  return uniqStrings(String(item?.by ?? "").split(",").map(normalizeAuthor).filter((name) => name.length >= 3));
}

export function sameBookAuthor(a, b) {
  const authors = new Set(bookAuthors(a));
  return authors.size > 0 && bookAuthors(b).some((name) => authors.has(name));
}

// Both books carry the same Open Library series name, and share an author.
export function booksShareSeriesName(a, b) {
  if (!isBook(a) || !isBook(b) || !sameBookAuthor(a, b)) return false;
  const names = new Set(bookSeriesNames(a));
  return names.size > 0 && bookSeriesNames(b).some((name) => names.has(name));
}
