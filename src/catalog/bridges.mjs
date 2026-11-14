// #252 part 2 (Oct 27): "with these vibes" across media, with no model call. A movie's genres are mapped
// onto Tastemake's own hand-written cross-medium shelves (BROWSE_GENRES in browse-genres.js), and those
// shelves are what get searched in the other medium. Only genres the item really carries count: no
// mapping means no button and no results, never a guess. Browser-safe and dependency-light, so Library
// can decide whether to show the button; the provider calls live in bridge-candidates.mjs.
//
// A "label" is the shared genre word a reason can name ("sci-fi", "mystery"). Each medium says which of
// its own tags carry a label, and which BROWSE_GENRES shelf a label is searched on there.
//
// TMDb TV's "Sci-Fi & Fantasy" (10765) is one genre for two shelves (Severance and Game of Thrones both get
// it). Oct 27: it stays one combined label, "sci-fi & fantasy": a show searches both book shelves, a book
// shares it when it is either, and the reason names it as TMDb does, never guessing which one the show is.
// Oct 27 refinement: when the show's own TMDb keywords clearly lean one way ("dystopia", "space" vs "magic",
// "dragon"), bridge-candidates.mjs resolves it to that one shelf (providerMeta.sciFiFantasyAs) before
// searching; unclear or unknown keywords keep the combined label.
//
// Deliberately left out:
//   - Drama, crime, literary, adventure: no matching shelf in the other medium's list.

import { browseGenreById } from "./browse-genres.js";
import { bookGenreFamilies } from "./book-genres.mjs";

export const SCIFI_FANTASY = "sci-fi & fantasy";
export const BRIDGE_LABELS = ["horror", "sci-fi", "fantasy", SCIFI_FANTASY, "mystery", "thriller", "comedy", "romance", "historical"];

// TMDb genre ids (movie and TV share these numbers).
const TMDB_LABEL = { 27: "horror", 878: "sci-fi", 14: "fantasy", 10765: SCIFI_FANTASY, 9648: "mystery", 53: "thriller", 35: "comedy", 10749: "romance", 36: "historical" };
// bookGenreFamilies() names (book-genres.mjs).
const BOOK_FAMILY_LABEL = { horror: "horror", "science fiction": "sci-fi", fantasy: "fantasy", mystery: "mystery", thriller: "thriller", humor: "comedy", romance: "romance", historical: "historical" };
// IGDB theme names (#48: IGDB keeps these as themes, not genres).
const IGDB_THEME_LABEL = { horror: "horror", "science fiction": "sci-fi", fantasy: "fantasy", mystery: "mystery", thriller: "thriller", comedy: "comedy", romance: "romance", historical: "historical" };

// Which BROWSE_GENRES shelf a label is searched on in each target medium. The book list keeps mystery and
// thriller on one shelf, and the screen lists have only Thriller, so both land there.
const TARGET_SHELF = {
  read: { horror: "horror", "sci-fi": "sci-fi", fantasy: "fantasy", [SCIFI_FANTASY]: ["sci-fi", "fantasy"], mystery: "mystery-thriller", thriller: "mystery-thriller", romance: "romance", historical: "historical-fiction" },
  movies: { horror: "horror", "sci-fi": "sci-fi", fantasy: "fantasy", mystery: "thriller", thriller: "thriller", comedy: "comedy" },
  tv: { horror: "horror", "sci-fi": "sci-fi", fantasy: "fantasy", mystery: "thriller", thriller: "thriller", comedy: "comedy" }
};

// What a result found on a shelf is known to be, because the provider filtered on it (a TMDb keyword,
// an Open Library subject). Movie shelves are TMDb genres, which the result also carries itself.
const SHELF_LABEL = {
  read: { horror: "horror", "sci-fi": "sci-fi", fantasy: "fantasy", "mystery-thriller": "mystery", romance: "romance", "historical-fiction": "historical" },
  movies: { horror: "horror", "sci-fi": "sci-fi", fantasy: "fantasy", thriller: "thriller", comedy: "comedy" },
  tv: { horror: "horror", "sci-fi": "sci-fi", fantasy: "fantasy", thriller: "thriller", comedy: "comedy" }
};

// Targets a caller may ask for. "screen" is movies and shows together.
export const BRIDGE_TARGETS = { read: ["read"], movies: ["movies"], tv: ["tv"], screen: ["movies", "tv"] };
const MAX_SHELVES_PER_DOMAIN = 2;

const DOMAIN_OF_TYPE = { movie: "movies", tv: "tv", book: "read", game: "play" };
export const domainOfItem = (item) => DOMAIN_OF_TYPE[item?.type] ?? item?.domains?.[0] ?? null;

// TMDb keyword names that point a "Sci-Fi & Fantasy" show at one half. Whole words, case-insensitive.
const SCIFI_KEYWORDS = ["science fiction", "sci-fi", "dystopia", "dystopian", "space", "outer space", "spaceship", "space travel", "space opera",
  "alien", "extraterrestrial", "time travel", "robot", "android", "artificial intelligence", "cyborg", "cyberpunk", "post-apocalyptic",
  "post-apocalyptic future", "simulation", "virtual reality", "genetic engineering", "cloning", "mad scientist", "scientific experiment",
  "human experimentation", "biotechnology", "futuristic", "near future", "dark future", "mind control", "memory manipulation"];
const FANTASY_KEYWORDS = ["fantasy", "high fantasy", "dark fantasy", "sword and sorcery", "magic", "magician", "wizard", "witch", "witchcraft",
  "sorcery", "sorcerer", "dragon", "elves", "elf", "dwarf", "mythology", "mythical creature", "fairy tale", "fairy", "medieval",
  "kingdom", "prophecy", "quest", "based on fantasy novel", "game of thrones"];
const keywordScore = (names, terms) => names.filter((name) => terms.some((term) => new RegExp(`(^|\\W)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`, "i").test(name))).length;

// "sci-fi", "fantasy", or null when the keywords don't clearly lean one way (then both shelves are used).
export function resolveSciFiFantasy(keywordNames = []) {
  const names = keywordNames.map((name) => String(name ?? "").trim()).filter(Boolean);
  const scifi = keywordScore(names, SCIFI_KEYWORDS);
  const fantasy = keywordScore(names, FANTASY_KEYWORDS);
  if (scifi > fantasy) return "sci-fi";
  if (fantasy > scifi) return "fantasy";
  return null;
}

// The shared labels an item's own catalog tags carry, in the order the item lists them.
export function bridgeLabelsOf(item) {
  const labels = [];
  const resolved = ["sci-fi", "fantasy"].includes(item?.providerMeta?.sciFiFantasyAs) ? item.providerMeta.sciFiFantasyAs : null;
  const add = (label) => { const named = label === SCIFI_FANTASY && resolved ? resolved : label; if (named && !labels.includes(named)) labels.push(named); };
  if (item?.provider === "tmdb") {
    for (const id of [...(item.genres ?? []), ...(item.providerMeta?.genreIds ?? [])]) add(TMDB_LABEL[Number(id)]);
  } else if (item?.provider === "openlibrary" || item?.provider === "googlebooks" || item?.type === "book") {
    for (const subject of item?.genres ?? []) for (const family of bookGenreFamilies([subject])) add(BOOK_FAMILY_LABEL[family]);
  } else if (item?.provider === "igdb") {
    for (const name of [...(item.providerMeta?.themes ?? []), ...(item.genres ?? [])]) add(IGDB_THEME_LABEL[String(name ?? "").trim().toLowerCase()]);
  }
  return labels;
}

// The shelves to search for `targetDomain` ("read", "movies", "tv" or "screen"), each with the labels it
// stands for. Never the item's own medium. Empty when nothing on the item has a shelf there.
// A broad label on its own isn't a vibe (#314): mystery, thriller, comedy, romance and historical need a
// second shared label; sci-fi, fantasy and horror count by themselves. Shared with bridge-candidates.mjs.
export const BROAD_LABELS = new Set(["mystery", "thriller", "comedy", "romance", "historical"]);
export const meaningfulShare = (shared) => shared.length >= 2 || shared.some((label) => !BROAD_LABELS.has(label));

export function bridgeQueriesFor(item, targetDomain) {
  const domains = BRIDGE_TARGETS[targetDomain];
  if (!domains || !item?.type) return [];
  const own = domainOfItem(item);
  const labels = bridgeLabelsOf(item);
  const queries = [];
  for (const domain of domains) {
    if (domain === own) continue;
    const forDomain = [];
    for (const label of labels) {
      for (const genreId of [].concat(TARGET_SHELF[domain]?.[label] ?? [])) {
        if (!browseGenreById(domain, genreId)) continue;
        const existing = forDomain.find((query) => query.genreId === genreId);
        if (existing) existing.labels.push(label);
        else forDomain.push({ domain, genreId, labels: [label] });
      }
    }
    // Shelves for labels that count on their own come first, so a broad label never crowds them out.
    const specificFirst = forDomain.map((query, order) => ({ query, order, broad: query.labels.every((label) => BROAD_LABELS.has(label)) }))
      .sort((a, b) => a.broad - b.broad || a.order - b.order).map(({ query }) => query);
    queries.push(...specificFirst.slice(0, MAX_SHELVES_PER_DOMAIN));
  }
  return queries;
}

// Which labels a result really shares with the source: from its own tags, plus the shelf it was found
// on when the provider filtered on that. Only labels the source also carries.
export function sharedBridgeLabels(result, source, shelf = null) {
  const sourceLabels = new Set(bridgeLabelsOf(source));
  const found = new Set(bridgeLabelsOf(result));
  const shelfLabel = shelf ? SHELF_LABEL[shelf.domain]?.[shelf.genreId] : null;
  if (shelfLabel) found.add(shelfLabel);
  // Either half of TMDb TV's "Sci-Fi & Fantasy" shares that combined label (named as TMDb names it).
  if (found.has("sci-fi") || found.has("fantasy")) found.add(SCIFI_FANTASY);
  return BRIDGE_LABELS.filter((label) => found.has(label) && sourceLabels.has(label));
}

// Which cross-medium target a Library card offers for an item, given the areas that are on. Movies, shows
// and games bridge to books; books bridge to movies and shows. Null when nothing would bridge.
export function bridgeTargetFor(item, areas = {}) {
  if (!item?.provider || !item?.providerId) return null;
  const on = (domain) => areas?.[domain] !== false;
  let target = null;
  if (["movie", "tv", "game"].includes(item.type)) target = on("read") ? "read" : null;
  else if (item.type === "book") target = on("movies") && on("tv") ? "screen" : on("movies") ? "movies" : on("tv") ? "tv" : null;
  // Oct 27 smoke test: Severance maps only to mystery (TV's "Sci-Fi & Fantasy" isn't mapped), so its button
  // could never find anything under the broad-label rule. Offer it only when a result could qualify.
  const reachable = [...new Set(target ? bridgeQueriesFor(item, target).flatMap((query) => query.labels) : [])];
  return target && meaningfulShare(reachable) ? target : null;
}

const TARGET_NOUN = { read: "Books", movies: "Movies", tv: "Shows", screen: "Movies and shows" };
export const bridgeTargetNoun = (target) => TARGET_NOUN[target] ?? "More";
