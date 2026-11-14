import { TMDB_GENRES } from "../catalog/synopsis.mjs";

// #318 (Nov 13): a support cited under a pattern that spans several media, when it shows nothing of that
// pattern and is already explained by a pattern of its own medium. The case: "Mythic and fantastical worlds"
// (books and games) cited Resident Evil 7 and BioShock on every refresh, because its claim had widened to
// "fantasy and mythic or uncanny settings ... in both books and games". Both games are already cited by
// game-only patterns ("Atmosphere-driven horror in games", "Exploration-heavy games with puzzles"), and
// neither one's genres say anything mythic or fantastical. Two prompt changes failed to stop the model
// re-citing them (Nov 6, Nov 13), so software files them where they belong.
//
// A support is taken off pattern P only when all of these hold:
//   1. P spans two or more media, and the support is from one of them, M (a cross-media claim is the one
//      most easily widened to pick up another pattern's items);
//   2. another pattern in the same answer is about M alone, cites the support, and is about something else:
//      its label shares no content word with P's (it has a home on a different subject; Twin Peaks under both
//      "Uncanny slow-burn horror on screen" and "Uncanny mystery on television" is two related readings, kept);
//   3. the support has genres, and none of its genre words share a stem with a content word of P's label
//      (its metadata shows nothing of what P is; the label, not the claim, because the claim is what widened);
//   4. P keeps at least one other support in M (the rule only ever trims: it never takes a medium off a
//      pattern on a metadata guess, so it never narrows or removes one).
// The support stays on the other pattern, and on P everywhere else it is cited. Genres are thin for games
// (IGDB genres say "Shooter", "Puzzle", not "Horror" or "Fantasy"), which is why 2 and 4 are required too:
// the Nov 7 deterministic fit check, which used metadata alone, flagged 23-77% of fitting supports.
//
// Label words that name a medium or carry no meaning are ignored, so "games" never matches "Indie games".
const LABEL_STOPWORDS = new Set([
  "and", "with", "the", "for", "from", "into", "that", "this", "than", "over", "under", "about", "across", "both",
  "games", "game", "gaming", "video", "books", "book", "reading", "reads", "novels", "novel", "fiction", "literature",
  "literary", "screen", "film", "films", "movie", "movies", "cinema", "television", "shows", "show", "series", "media",
  "stories", "story", "worlds", "world", "things", "kinds", "kind", "style", "styles", "driven", "heavy", "based"
]);
const STEM = 4;
const words = (value) => String(value ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= STEM);
const genreName = (genre) => (/^\d+$/.test(String(genre).trim()) ? (TMDB_GENRES[Number(genre)] ?? "") : String(genre ?? ""));

export function labelStems(label) {
  return [...new Set(words(label).filter((w) => !LABEL_STOPWORDS.has(w)).map((w) => w.slice(0, STEM)))];
}

export function genreShowsLabel(row, stems) {
  const genreWords = (row?.facts?.genres ?? []).flatMap((g) => words(genreName(g)));
  return stems.some((stem) => genreWords.some((w) => w.startsWith(stem)));
}

const sharesSubject = (q, stems) => labelStems(q.label ?? q.title).some((stem) => stems.includes(stem));
const onlyMedium = (domains, medium) => (domains ?? []).length === 1 && domains[0] === medium;

// hypotheses: normalized proposals ({ id, label, domains, evidence: [ref] }). Returns the same list, with
// misfiled supports taken off, and what was moved ([{ id, label, ref }]) for reporting.
export function fileSupports(hypotheses, ctx) {
  if (!Array.isArray(hypotheses)) return { hypotheses, refiled: [] };
  const rows = new Map((ctx?.evidence ?? []).map((row) => [row.ref, row]));
  const patterns = hypotheses.filter((h) => h && typeof h === "object" && Array.isArray(h.evidence));
  const refiled = [];
  const filed = hypotheses.map((p) => {
    if (!patterns.includes(p) || (p.domains ?? []).length < 2) return p;
    const stems = labelStems(p.label ?? p.title);
    if (!stems.length) return p;
    const drop = new Set();
    for (const medium of p.domains) {
      const inMedium = p.evidence.filter((ref) => (rows.get(ref)?.domains ?? []).includes(medium));
      const misfiled = inMedium.filter((ref) => {
        const row = rows.get(ref);
        if (!row || !onlyMedium(row.domains, medium) || !(row.facts?.genres ?? []).length || genreShowsLabel(row, stems)) return false;
        return patterns.some((q) => q !== p && onlyMedium(q.domains, medium) && q.evidence.includes(ref) && !sharesSubject(q, stems));
      });
      if (misfiled.length && misfiled.length < inMedium.length) misfiled.forEach((ref) => drop.add(ref));
    }
    if (!drop.size) return p;
    drop.forEach((ref) => refiled.push({ id: p.id, label: p.label ?? p.title, ref }));
    return { ...p, evidence: p.evidence.filter((ref) => !drop.has(ref)) };
  });
  return { hypotheses: filed, refiled };
}
