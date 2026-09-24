import { favorites, followUpPool, recommendations } from "../data/catalog.js";
import { isBookmarked, isPositiveExperience } from "./taste.js";
import { isDeclined, isExperiencedNegative, isExperiencedPositive, isStrongPositive } from "./evidence.js";
import { addableTypes, displayLabel } from "../data/domains.js";

// Search and "add something" (#13).
//
// UX principle: searching is not evidence. Typing, browsing results and opening an item never touch
// state. Only an explicit action (applySearchAction) does, and it writes the same feedback the
// Recommendations screen writes, so the Library, Bookmarks and Taste Profile all follow.

// What a user can add by hand, from the domain registry (only types in visible domains).
export const MEDIA = Object.fromEntries(addableTypes().map((type) => [type.id, { label: type.label, domains: [type.domain] }]));

export function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const words = (text) => normalize(text).split(" ").filter(Boolean);

// "The Lord of the Rings" -> TLOTR and LOTR; "Everything Everywhere All at Once" -> EEAAO.
function acronyms(title) {
  const all = words(title);
  const out = new Set();
  if (all.length >= 3) {
    out.add(all.map((word) => word[0]).join(""));
    const noArticle = all[0] === "the" ? all.slice(1) : all;
    if (noArticle.length >= 3) out.add(noArticle.map((word) => word[0]).join(""));
  }
  return [...out];
}

// Edit distance where swapping two neighbouring letters ("fagro" for "fargo") counts as one slip.
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Everything the user can search: the hand-written catalog plus anything they added themselves.
export function searchableItems(state) {
  const seen = new Set();
  const out = [];
  for (const item of [...favorites, ...recommendations, ...followUpPool, ...Object.values(state?.customItems ?? {})]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function scoreItem(item, query) {
  const q = normalize(query);
  if (!q) return 0;
  const title = normalize(item.title);
  const titleWords = title.split(" ");
  const qWords = q.split(" ");
  const compact = q.replace(/ /g, "");

  if (title === q) return 100;
  if (acronyms(item.title).includes(compact)) return 90;
  if (title.startsWith(q)) return 80;
  if (qWords.every((w) => titleWords.some((t) => t.startsWith(w)))) return 70;
  if (title.includes(q)) return 50;
  // Typo tolerance: every query word is within one (short) or two (long) slips of some title word,
  // or is a slightly mistyped start of one ("fagr" for "fargo").
  const fuzzy = qWords.every((w) => titleWords.some((t) => {
    if (w.length < 3) return t.startsWith(w);
    const allowed = w.length <= 5 ? 1 : 2;
    return editDistance(w, t) <= allowed || (w.length >= 4 && editDistance(w, t.slice(0, w.length)) <= 1);
  }));
  if (fuzzy) return 30;
  const other = normalize(`${displayLabel(item)} ${item.by ?? ""} ${item.note ?? ""}`);
  if (qWords.every((w) => other.includes(w))) return 15;
  return 0;
}

export function searchItems(state, query, domain = "all") {
  return searchableItems(state)
    .filter((item) => domain === "all" || item.domains?.includes(domain))
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, 8)
    .map((hit) => hit.item);
}

// Avoid duplicate evidence: if the typed title is already here (in any medium), point at that item.
export function findExisting(state, title) {
  const wanted = normalize(title);
  if (!wanted) return null;
  return searchableItems(state).find((item) => normalize(item.title) === wanted) ?? null;
}

const slug = (text) => normalize(text).replace(/ /g, "-").slice(0, 60);

export function makeCustomItem(title, mediumKey) {
  const medium = MEDIA[mediumKey] ?? MEDIA.movie;
  const clean = String(title).trim().replace(/\s+/g, " ").slice(0, 80);
  return {
    id: `custom-${slug(clean)}-${mediumKey}`,
    title: clean,
    type: MEDIA[mediumKey] ? mediumKey : "movie",
    domains: medium.domains,
    about: "Added by you.",
    custom: true
  };
}

// Where this item stands in Tastemake right now (shown in results and in the action sheet).
export function itemStatus(state, item) {
  if (state.selectedFavorites.has(item.id)) return { key: "starter", label: "Favorite" };
  const feedback = state.feedbackByRecommendation[item.id];
  if (!feedback) return { key: "none", label: "Not in your Tastemake yet" };
  if (isBookmarked(feedback)) return { key: "bookmarked", label: "Try Next" };
  if (isStrongPositive(feedback)) return { key: "loved", label: state.libraryFavorites.has(item.id) ? "Loved it (a Favorite)" : "Loved it" };
  if (isExperiencedPositive(feedback)) return { key: "liked", label: "Liked it" };
  if (isExperiencedNegative(feedback)) return { key: "disliked", label: "Didn't like it" };
  if (isDeclined(feedback)) return { key: "not-interested", label: "Not interested" };
  return { key: "other", label: "Reacted to" };
}

const OUTCOMES = {
  loved: { rating: "more", detail: "loved-before", said: "marked Loved it before" },
  liked: { rating: "more", detail: "liked-before", said: "marked Liked it before" },
  disliked: { rating: "less", detail: "tried-disliked", said: "marked Tried it and disliked it" },
  bookmark: { rating: "not-tried", detail: "bookmarked", said: "saved to Try Next" },
  "not-interested": { rating: "less", detail: "not-interested", said: "marked Not interested" }
};

// The only way search changes anything. Returns a sentence for the live region, or null if nothing changed.
export function applySearchAction(state, item, action) {
  if (state.selectedFavorites.has(item.id)) return null;   // Favorites are managed on the Favorites page
  const existing = state.feedbackByRecommendation[item.id];

  if (action === "remove") {
    if (!existing) return null;
    delete state.feedbackByRecommendation[item.id];
    state.libraryFavorites.delete(item.id);
    if (item.custom) delete state.customItems[item.id];
    return `${item.title} removed from Tastemake.`;
  }

  if (action === "favorite" || action === "unfavorite") {
    if (!existing) return null;
    if (action === "favorite") {
      if (!isStrongPositive(existing)) return null;   // only a loved pick can be a Favorite
      state.libraryFavorites.add(item.id);
      return `${item.title} added to Favorites.`;
    }
    state.libraryFavorites.delete(item.id);
    return `${item.title} removed from Favorites. It stays in your Library.`;
  }

  const outcome = OUTCOMES[action];
  if (!outcome) return null;

  if (item.custom || item.provider) state.customItems[item.id] = item;   // an added item only exists once the user acts on it
  const entry = {
    item,
    rating: outcome.rating,
    detail: outcome.detail,
    quality: existing?.quality ?? null,
    source: "search"
  };
  if (existing?.wasBookmarked || (existing && isBookmarked(existing) && action !== "bookmark")) entry.wasBookmarked = true;
  // "Surprised me" only makes sense after Loved / Liked it before.
  if (entry.quality === "surprised-me" && !isPositiveExperience(entry)) entry.quality = null;
  if (action !== "loved") state.libraryFavorites.delete(item.id);
  state.feedbackByRecommendation[item.id] = entry;
  return `${item.title}: ${outcome.said}.`;
}
