// One shared check for provider synopses. Every provider (TMDb movies/TV, IGDB games, Open Library
// books) builds its `about` text through sanitizeAbout() at ingestion, and every screen that shows a
// synopsis reads it through safeAbout() -- so a flagged synopsis is stopped on the server (and never
// reaches the model prompt or the wire), and again at render time for anything already saved in a
// browser from before this check existed. Dependency-free on purpose: it runs in both places.
//
// Summaries stay by default -- people need them to decide whether they might like something. Only a
// synopsis that trips one of the signals below is swapped out, and what replaces it is a short
// tagline when the provider has a clean one, otherwise the genre and year.
//
// Signals (any one flags):
//   adult        the provider's own adult flag (TMDb's `adult`)
//   certification an adults-only age rating (NC-17 / X). Pass it wherever a provider call already has
//                one; TMDb's list responses do not carry a rating, only the detail endpoint does.
//   sensitive-term a small list of terms for graphic sexual violence and abuse of minors. Deliberately
//                short and specific: broad terms (violence, death, murder) would strip ordinary horror
//                and crime summaries, which is not the goal.

const SENSITIVE_TERMS = [
  /\brap(?:e|es|ed|ing|ist|ists)\b/i,
  /\bsexual(?:ly)?\s+(?:assault|assaults|assaulted|assaulting|abuse|abused|abusing|violence|violated)\b/i,
  /\bmolest(?:s|ed|ing|ation|er|ers)?\b/i,
  /\bincest(?:uous)?\b/i,
  /\bpedophil(?:e|es|ia|ic)\b/i,
  /\bchild\s+(?:sexual|pornography)\b/i,
  /\bsex(?:ual)?\s+slave(?:s|ry)?\b/i
];

const BLOCKED_CERTIFICATIONS = new Set(["NC-17", "X", "XXX"]);

// TMDb genre ids that appear on list rows (movie and TV taxonomies together). Names only -- used for
// the genre-and-year fallback, never for filtering.
const TMDB_GENRES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-fi", 10770: "TV movie", 53: "Thriller", 10752: "War",
  37: "Western", 10759: "Action & adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-fi & fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & politics"
};

const TYPE_LABEL = { movie: "Movie", tv: "TV show", book: "Book", game: "Game" };

export function assessSynopsis({ about, adult = false, certification = null } = {}) {
  if (adult === true) return { ok: false, reason: "adult-flag" };
  const cert = String(certification ?? "").trim().toUpperCase();
  if (cert && BLOCKED_CERTIFICATIONS.has(cert)) return { ok: false, reason: "age-rating" };
  const text = String(about ?? "");
  if (SENSITIVE_TERMS.some((term) => term.test(text))) return { ok: false, reason: "sensitive-term" };
  return { ok: true, reason: null };
}

function genreNames(item) {
  return (item?.genres ?? [])
    .map((genre) => {
      const raw = String(genre ?? "").trim();
      if (!raw) return "";
      return /^\d+$/.test(raw) ? (TMDB_GENRES[Number(raw)] ?? "") : raw;
    })
    .filter(Boolean)
    .slice(0, 2);
}

// What a flagged item shows instead of its synopsis: the provider's tagline when there is one that
// passes the same check, otherwise "Genre · Year" (or the media type when there is no genre).
export function fallbackSummary(item, { tagline = null } = {}) {
  const line = String(tagline ?? "").replace(/\s+/g, " ").trim();
  if (line && assessSynopsis({ about: line }).ok) return line;
  const genres = genreNames(item);
  const lead = genres.length ? genres.join(" / ") : (TYPE_LABEL[item?.type] ?? "");
  return [lead, item?.year].filter(Boolean).join(" · ") || "No description shown.";
}

// Ingestion side: spread the result over a freshly built provider item. Returns nothing to change
// when the synopsis is fine; otherwise the replacement `about`, plus the reason as `aboutFlag` so a
// later step can try the provider's tagline without re-fetching.
export function sanitizeAbout(item, { adult = false, certification = null } = {}) {
  const verdict = assessSynopsis({ about: item?.about, adult, certification });
  if (verdict.ok) return {};
  return { about: fallbackSummary(item), aboutFlag: verdict.reason };
}

// Render side: every screen that shows a synopsis calls this, so anything persisted in a browser
// before the check existed is covered too.
export function safeAbout(item) {
  const text = item?.about;
  return assessSynopsis({ about: text }).ok ? text : fallbackSummary(item);
}

// "about, else the user's own note, else a default" -- the pattern several screens already use --
// with the synopsis check applied to the about part.
export function blurbOf(item, fallback = "") {
  if (item?.about != null) return safeAbout(item);
  return item?.note ?? fallback;
}
