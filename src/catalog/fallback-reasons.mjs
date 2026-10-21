// Reasons for catalog picks shown without live AI (budget paused, model error, or failed validation).
// Oct 20: with AI paused every visitor saw these, and the old templates said things like "a quantum
// theory-leaning pick" (A Darker Shade of Magic) or "shares some children's fiction territory". These name
// what the pick actually shares with the item it was found through: its provider genres or subjects, cleaned
// into readable words. Only facts from the catalog, never a claim about the user's taste, and none of the
// hedges ("may appeal") or stock verbs ("echoes") the #28 work measures.

import { TMDB_GENRES } from "./synopsis.mjs";
import { bookGenreFamilies, meaningfulBookSubjects } from "./related.mjs";

const CORE_GENRE = /\b(?:fantasy|science fiction|sci-fi|horror|mystery|thriller|romance|historical|literary|comedy|drama|crime|adventure|action|animation|documentary|role-playing|strategy|puzzle|platform|shooter)\b/i;
const BROAD_GENRE = /^(?:drama|comedy|action|adventure|action & adventure|family|animation)$/;
const NATIONALITY = /^(?:american|english|british|canadian|australian|irish|scottish|french|german|polish|japanese|russian|spanish|italian)\s+/;

// One provider genre or subject as a few readable lowercase words, or null when it isn't worth showing.
export function readableTag(value, provider) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return provider === "tmdb" && TMDB_GENRES[raw] ? TMDB_GENRES[raw].toLowerCase() : null;
  if (provider === "openlibrary" && !meaningfulBookSubjects([raw]).length) return null;
  let text = raw.replace(/^genre\s*:\s*/i, "").replace(/\([^)]*\)/g, " ").trim();
  // BISAC-style "Fiction, fantasy, epic" / "FICTION / Fantasy / Epic" -> "epic fantasy".
  const parts = text.split(/\s*[,/]\s*/).filter(Boolean);
  if (parts.length > 1) {
    const rest = parts.filter((p) => !/^(?:fiction|general|juvenile fiction|literary collections)$/i.test(p));
    if (!rest.length || rest.length > 2) return null;
    text = rest.reverse().join(" ");
  }
  // "fantasy fiction" -> "fantasy", but "science fiction" keeps its second word.
  text = text.toLowerCase().replace(/(?<!science)\s+fiction$/, "").replace(NATIONALITY, "").replace(/\s+/g, " ").trim();
  if (!text || text === "fiction" || text.length > 28 || /\d/.test(text) || text.split(" ").length > 3) return null;
  return text;
}

// Up to two readable tags the pick shares with its anchor, genre-like ones first. Falls back to a shared
// book genre family ("fantasy") when no subject matches word for word.
export function sharedTags(item, anchor) {
  if (!anchor) return [];
  const anchorTags = new Set((anchor.genres ?? []).map((g) => readableTag(g, anchor.provider)).filter(Boolean));
  const shared = [...new Set((item.genres ?? []).map((g) => readableTag(g, item.provider)).filter((t) => t && anchorTags.has(t)))];
  // "fantasy" adds nothing next to "epic fantasy".
  const tags = shared.filter((t) => !shared.some((other) => other !== t && other.includes(t)));
  // Named genres first ("epic fantasy"), broad ones after them ("drama" says less than "sci-fi": Oct 20,
  // "Another drama pick, linked to Arrival by sci-fi"), then genre markers ("magic"), then anything else.
  const rank = (t) => (CORE_GENRE.test(t) ? (BROAD_GENRE.test(t) ? 1 : 0) : bookGenreFamilies([t]).size ? 2 : 3);
  const ordered = [...tags].sort((x, y) => rank(x) - rank(y));
  if (!ordered.length && (item.provider === "openlibrary" || anchor.provider === "openlibrary")) {
    const families = bookGenreFamilies(item.genres ?? []);
    const shared = [...bookGenreFamilies(anchor.genres ?? [])].filter((f) => families.has(f));
    return shared.slice(0, 1);
  }
  return ordered.slice(0, 2);
}

const an = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const BOOK = (item) => (item.type === "book" ? "book" : item.type === "game" ? "game" : item.type === "tv" ? "show" : "film");

export function fallbackReason(item, anchor, { index = 0, curveball = false } = {}) {
  const from = item.relatedTo || anchor?.title || null;
  const [a, b] = sharedTags(item, anchor);
  if (!from) return `A catalog match Tastemake hasn't ranked yet: it's here while AI ranking is unavailable.`;
  if (!a) return `Found through ${from}; it has no tags in common with it to show yet.`;
  if (curveball) return `A wider step from ${from}, still tagged ${a}.`;
  const kind = BOOK(item);
  const reasons = [
    () => (b ? `Tagged ${a} and ${b}, like ${from}.` : `Tagged ${a}, like ${from}.`),
    () => (b ? `Shares ${a} and ${b} with ${from}.` : `Shares ${a} with ${from}.`),
    () => `From the same ${a} shelf as ${from}.`,
    () => { const lead = an(a); const cap = lead[0].toUpperCase() + lead.slice(1); return b ? `${cap} ${kind} that also touches on ${b}, found through ${from}.` : `${cap} ${kind} found through ${from}.`; },
    () => (b ? `Another ${a} pick, linked to ${from} by ${b}.` : `Another ${a} pick, found through ${from}.`)
  ];
  return reasons[index % reasons.length]();
}
