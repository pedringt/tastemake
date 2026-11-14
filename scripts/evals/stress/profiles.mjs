// #28 stress eval: synthetic taste profiles at three sizes, built deterministically from REAL catalog
// items (catalog-snapshot.json, captured from production's free browse endpoint by capture-catalog.mjs).
//
// A profile is product state in the same shape the browser keeps (src/state.js / scripts/evals/fixtures.mjs):
// starter favorites in selectedFavorites + customItems, reactions in feedbackByRecommendation (Loved /
// Liked / tried-and-disliked, some with refinements, some starred into libraryFavorites), plus a little
// intent (Save / Not interested) that must never count as taste. "Size" counts EXPERIENCED items only
// (favorites + tried reactions); intent rows ride on top.
//
// Each profile also gets a fixed pool of 36 unseen candidate items. The live mode holds candidate
// retrieval fixed on purpose (production retrieval needs provider keys and drifts with the catalog), so
// differences between runs come from the reasoning, not from what retrieval happened to return.
//
// Shapes (several distinct taste shapes per size):
//   narrow    one-genre fan: every experienced item is a sci-fi film. Candidates are mostly sci-fi films,
//             plus some sci-fi TV / books / games, so a cross-domain claim is never supported by tried evidence.
//   broad     cross-domain: spread over movies, TV, books and games and many genres.
//   dislikes  many dislikes: about half of what was tried was disliked (horror / thriller heavy).
//   split     similar items, different reactions: tight clusters (fantasy books, RPGs, TV comedy, horror
//             films) where neighbours alternate Loved and disliked, with contrasting refinements.
//
// #252 part 2 (Oct 27): two more shapes for the bridge-pick before/after, chosen by name only (`--profiles
// screen,screenfew`), so `--profiles all` still means the four above:
//   screen    movies and TV only, no books at all.
//   screenfew movies and TV, plus two literary novels (few books, none on the bridge shelf).
// Their pools hold six book candidates found from one of their Loved sci-fi or horror films,
// marked the way retrieval marks a bridge candidate (bridge, relatedToId, relatedTo). Code without bridge
// picks sees them as ordinary book candidates, so the same profiles run on main as the "before".
//
// Everything is seeded (mulberry32 over a fixed seed per shape and size), so the same profile id always
// builds the same state. profiles.json is the committed, reviewable output; the unit tests check that
// rebuilding from the snapshot reproduces it exactly.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleDomains } from "../../../src/data/domains.js";
import { isLaterSeriesEntry } from "../../../src/catalog/book-series.mjs";
import { isBookCompanion } from "../../../src/catalog/book-companions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = join(here, "catalog-snapshot.json");
export const PROFILES_PATH = join(here, "profiles.json");

export const SIZES = { 10: 10, 50: 50, 100: 120 };   // size label -> experienced items ("100+" is 120)
export const SHAPES = ["narrow", "broad", "dislikes", "split"];
export const BRIDGE_SHAPES = ["screen", "screenfew"];
export const ALL_SHAPES = [...SHAPES, ...BRIDGE_SHAPES];
export const CANDIDATE_POOL = 36;
export const OFFERED_PER_ROUND = 6;                  // production offers six (offeredCandidates in api/recommendations.mjs)

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function loadSnapshot(path = SNAPSHOT_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const strip = ({ _bucket, ...item }) => item;

// Shape specs: which shelves the experienced items come from (weights), the reaction mix, and where
// candidates come from. Shelf ids are the browse shelves in capture-catalog.mjs.
const SPECS = {
  narrow: {
    seed: 101,
    evidence: { "movies:sci-fi": 1 },
    mix: { loved: 0.5, liked: 0.35, disliked: 0.15 },
    // Mostly the same genre and domain, plus sci-fi in other domains with no tried evidence there.
    candidates: { "movies:sci-fi": 24, "tv:sci-fi": 4, "read:sci-fi": 4, "play:rpg": 2, "play:indie": 2 }
  },
  broad: {
    seed: 202,
    evidence: {
      "movies:drama": 1, "movies:comedy": 1, "movies:fantasy": 1, "movies:thriller": 1, "movies:animation": 0.5, "movies:documentary": 0.5,
      "tv:drama": 1, "tv:comedy": 1, "tv:sci-fi": 1, "tv:fantasy": 0.5,
      "read:fantasy": 1, "read:literary-fiction": 1, "read:mystery-thriller": 1, "read:historical-fiction": 0.5, "read:memoir-nonfiction": 0.5,
      "play:rpg": 1, "play:puzzle": 1, "play:narrative": 1, "play:cozy": 0.5, "play:strategy": 0.5
    },
    mix: { loved: 0.45, liked: 0.35, disliked: 0.2 },
    candidates: { "movies:drama": 3, "movies:comedy": 3, "movies:fantasy": 3, "tv:drama": 3, "tv:comedy": 3, "tv:sci-fi": 3, "read:fantasy": 3, "read:literary-fiction": 3, "read:mystery-thriller": 3, "play:rpg": 3, "play:puzzle": 3, "play:narrative": 3 }
  },
  dislikes: {
    seed: 303,
    evidence: { "movies:horror": 1, "movies:thriller": 1, "tv:horror": 1, "tv:thriller": 1, "read:horror": 1, "read:mystery-thriller": 1, "play:horror": 1 },
    mix: { loved: 0.3, liked: 0.2, disliked: 0.5 },
    candidates: { "movies:horror": 6, "movies:thriller": 6, "tv:horror": 6, "tv:thriller": 6, "read:horror": 6, "play:horror": 6 }
  },
  split: {
    seed: 404,
    evidence: { "read:fantasy": 1, "play:rpg": 1, "tv:comedy": 1, "movies:horror": 1 },
    mix: "alternate",
    candidates: { "read:fantasy": 9, "play:rpg": 9, "tv:comedy": 9, "movies:horror": 9 }
  },
  // `bridges`: six books from `shelf`, found from the first favorite (drawn from `sourceShelf` with TMDb
  // genre `tmdbGenre`), sharing `label` with it. `fixed`: experienced items drawn outside the weighted mix.
  screen: {
    seed: 505,
    evidence: { "movies:sci-fi": 1.5, "movies:thriller": 1, "tv:sci-fi": 0.5, "tv:thriller": 0.5, "tv:comedy": 0.5, "movies:drama": 0.25, "tv:drama": 0.25 },
    mix: { loved: 0.5, liked: 0.35, disliked: 0.15 },
    candidates: { "movies:sci-fi": 8, "movies:thriller": 6, "tv:sci-fi": 4, "tv:thriller": 4, "tv:comedy": 4, "tv:drama": 2, "play:narrative": 2 },
    bridges: { sourceShelf: "movies:sci-fi", shelf: "read:sci-fi", tmdbGenre: 878, label: "sci-fi", count: 6 }
  },
  screenfew: {
    seed: 606,
    // Oct 27 (#314): bridges from horror, not mystery. Mystery alone is too broad to count as a shared vibe,
    // so retrieval never offers a mystery-only bridge, and the eval shouldn't either.
    evidence: { "movies:thriller": 1, "tv:thriller": 1, "movies:horror": 0.75, "movies:sci-fi": 0.5, "tv:drama": 0.5, "tv:comedy": 0.5 },
    fixed: { "read:literary-fiction": 2 },
    mix: { loved: 0.5, liked: 0.35, disliked: 0.15 },
    candidates: { "movies:thriller": 8, "tv:thriller": 6, "movies:horror": 2, "movies:sci-fi": 2, "tv:drama": 4, "tv:comedy": 4, "read:literary-fiction": 4 },
    bridges: { sourceShelf: "movies:horror", shelf: "read:horror", tmdbGenre: 27, label: "horror", count: 6 }
  }
};

// Live bridge retrieval drops later series books found through Wikidata (src/catalog/bridge-candidates.mjs,
// #314). This generator works offline, so the books on the bridge shelves that Wikidata placed later than
// #1 (asked Oct 27, wikidataSeriesPositions over read:sci-fi and read:horror) are listed here.
const LATER_SERIES_BOOKS = new Set(["OL1963251W", "OL893515W", "OL1963279W", "OL893508W", "OL17897265W", "OL77828W"]);

const LOVED_REFS = { movie: ["characters", "visual-style"], tv: ["characters", "humor"], book: ["world-setting", "writing-prose"], game: ["exploration", "story"] };
const DISLIKED_REFS = { movie: ["pacing"], tv: ["humor"], book: ["pacing", "structure"], game: ["difficulty-challenge"] };

// Horror, sci-fi, fantasy, mystery, thriller, comedy, romance, history.
const BRIDGE_TMDB_GENRES = ["27", "878", "14", "9648", "53", "35", "10749", "36"];

function favoriteCount(size) { return size <= 10 ? 3 : size <= 50 ? 5 : 6; }

// Draws `count` items from the weighted shelves without reusing an id in `used`.
function draw(byShelf, weights, count, rnd, used) {
  const shelves = Object.entries(weights).filter(([shelf]) => byShelf[shelf]?.length);
  const total = shelves.reduce((sum, [, w]) => sum + w, 0);
  const queues = Object.fromEntries(shelves.map(([shelf]) => [shelf, shuffled(byShelf[shelf], rnd)]));
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 50) {
    guard += 1;
    let x = rnd() * total;
    let shelf = shelves[shelves.length - 1][0];
    for (const [s, w] of shelves) { if ((x -= w) <= 0) { shelf = s; break; } }
    const queue = queues[shelf];
    while (queue.length && used.has(queue[0].id)) queue.shift();
    const item = queue.shift();
    if (!item) continue;
    used.add(item.id);
    out.push(item);
  }
  if (out.length < count) throw new Error(`not enough catalog items for ${JSON.stringify(weights)} (wanted ${count}, got ${out.length})`);
  return out;
}

function reactionFor(spec, index, rnd, item, clusterIndex) {
  if (spec.mix === "alternate") return clusterIndex % 2 === 0 ? "loved" : "disliked";
  const x = rnd();
  return x < spec.mix.loved ? "loved" : x < spec.mix.loved + spec.mix.liked ? "liked" : "disliked";
}

// Builds the compact, committed description of one profile: ids and reactions only.
export function buildProfileSpec(shape, sizeLabel, snapshot = loadSnapshot()) {
  const spec = SPECS[shape];
  const size = SIZES[sizeLabel];
  if (!spec || !size) throw new Error(`unknown profile ${shape}-${sizeLabel}`);
  const rnd = mulberry32(spec.seed * 1000 + size);
  const byShelf = {};
  for (const item of snapshot.items) for (const shelf of item._bucket) (byShelf[shelf] ??= []).push(item);
  for (const list of Object.values(byShelf)) list.sort((a, b) => a.id.localeCompare(b.id));

  const used = new Set();
  // Titles that appear under two ids (a film and its remake) are kept apart: a candidate never shares
  // a title with something already in the profile.
  const fixedCount = Object.values(spec.fixed ?? {}).reduce((sum, n) => sum + n, 0);
  // A bridge shape's first favorite is the Loved item its bridge books are found from. It carries
  // `tmdbGenre` and none of the other TMDb genres a bridge can share (src/catalog/bridges.mjs on the bridge
  // branch), so what it shares with each bridge book is exactly `label`.
  const sourceFirst = spec.bridges
    ? draw({ source: byShelf[spec.bridges.sourceShelf].filter((i) => (i.genres ?? []).filter((g) => BRIDGE_TMDB_GENRES.includes(g)).join() === String(spec.bridges.tmdbGenre)) }, { source: 1 }, 1, rnd, used)
    : [];
  const evidenceItems = [...sourceFirst, ...draw(byShelf, spec.evidence, size - fixedCount - sourceFirst.length, rnd, used)];
  for (const [shelf, n] of Object.entries(spec.fixed ?? {})) evidenceItems.push(...draw(byShelf, { [shelf]: 1 }, n, rnd, used));
  const usedTitles = new Set(evidenceItems.map((i) => i.title.toLowerCase()));
  const nFav = favoriteCount(size);
  const favorites = evidenceItems.slice(0, nFav);
  const reacted = evidenceItems.slice(nFav);

  const clusterSeen = {};
  const reactions = reacted.map((item, i) => {
    const cluster = item._bucket.find((b) => spec.evidence[b]) ?? item._bucket[0];
    const clusterIndex = (clusterSeen[cluster] = (clusterSeen[cluster] ?? -1) + 1);
    const how = reactionFor(spec, i, rnd, item, clusterIndex);
    const refine = shape === "split" || i % 3 === 0;
    const refinements = !refine ? [] : how === "disliked" ? DISLIKED_REFS[item.type] ?? [] : (LOVED_REFS[item.type] ?? []).slice(0, 1 + (i % 2));
    const starred = how === "loved" && i % 4 === 1;
    return { id: item.id, how, refinements, starred };
  });

  // Intent on top of the experienced items: about 10% (at least one of each), never taste evidence.
  const intentCount = Math.max(2, Math.round(size / 10));
  const intentItems = draw(byShelf, spec.candidates, intentCount, rnd, used);
  const intent = intentItems.map((item, i) => ({ id: item.id, how: i % 2 ? "not-interested" : "bookmark" }));
  intentItems.forEach((i) => usedTitles.add(i.title.toLowerCase()));

  // Candidates: drawn per shelf, then interleaved.
  const perShelf = Object.entries(spec.candidates).map(([shelf, n]) => {
    const pool = shuffled(byShelf[shelf] ?? [], rnd).filter((it) => !used.has(it.id) && !usedTitles.has(it.title.toLowerCase()));
    const chosen = [];
    for (const it of pool) {
      if (chosen.length >= n) break;
      if (used.has(it.id) || usedTitles.has(it.title.toLowerCase())) continue;
      used.add(it.id); usedTitles.add(it.title.toLowerCase());
      chosen.push(it);
    }
    if (chosen.length < n) throw new Error(`not enough unseen candidates on ${shelf} for ${shape}-${sizeLabel}`);
    return chosen;
  });
  // Bridge books: first books of their series, no companions, one per author (as retrieval does, #314),
  // sharing the label with a Loved source.
  let bridges = [];
  if (spec.bridges) {
    const { shelf, tmdbGenre, label, count } = spec.bridges;
    const loved = new Set([...favorites.map((i) => i.id), ...reactions.filter((r) => r.how === "loved").map((r) => r.id)]);
    const source = evidenceItems.find((i) => loved.has(i.id) && i.provider === "tmdb" && (i.genres ?? []).includes(String(tmdbGenre)));
    if (!source) throw new Error(`${shape}-${sizeLabel}: no Loved item with TMDb genre ${tmdbGenre} to bridge from`);
    const pool = shuffled(byShelf[shelf] ?? [], rnd).filter((it) => !used.has(it.id) && !usedTitles.has(it.title.toLowerCase())
      && !isLaterSeriesEntry(it) && !LATER_SERIES_BOOKS.has(it.providerId) && !isBookCompanion({ title: it.title, author_name: String(it.by ?? "").split(",").map((a) => a.trim()).filter(Boolean) }));
    const authors = new Set();
    const firstAuthor = (it) => String(it.by ?? "").split(",")[0].trim().toLowerCase();
    const chosen = pool.filter((it) => !firstAuthor(it) || (!authors.has(firstAuthor(it)) && authors.add(firstAuthor(it)))).slice(0, count);
    if (chosen.length < count) throw new Error(`not enough bridge books on ${shelf} for ${shape}-${sizeLabel}`);
    chosen.forEach((it) => { used.add(it.id); usedTitles.add(it.title.toLowerCase()); });
    perShelf.push(chosen);
    bridges = chosen.map((it) => ({ id: it.id, fromId: source.id, fromDomain: source.domains[0], sharedGenres: [label] }));
  }

  // Spread each shelf evenly through the pool (item k of n sits at (k + 0.5) / n), ties broken by the
  // seeded generator, so every 6-item window mixes shelves in roughly the pool's proportions.
  const candidates = perShelf
    .flatMap((list) => list.map((it, k) => ({ id: it.id, at: (k + 0.5) / list.length, tie: rnd() })))
    .sort((a, b) => a.at - b.at || a.tie - b.tie)
    .map((x) => x.id);

  return {
    id: `${shape}-${sizeLabel}`, shape, size: sizeLabel, experienced: size, seed: spec.seed * 1000 + size,
    favorites: favorites.map((i) => i.id), reactions, intent, candidates: candidates.slice(0, CANDIDATE_POOL),
    ...(bridges.length ? { bridges } : {})
  };
}

export function buildAllProfileSpecs(snapshot = loadSnapshot()) {
  const out = [];
  for (const sizeLabel of Object.keys(SIZES)) for (const shape of SHAPES) out.push(buildProfileSpec(shape, sizeLabel, snapshot));
  // #252 part 2: after the original twelve, so those stay byte-for-byte where they were.
  for (const sizeLabel of Object.keys(SIZES)) for (const shape of BRIDGE_SHAPES) out.push(buildProfileSpec(shape, sizeLabel, snapshot));
  return out;
}

export function loadProfileSpecs(path = PROFILES_PATH) {
  return JSON.parse(readFileSync(path, "utf8")).profiles;
}

const REACTIONS = {
  loved: ["more", "loved-before"], liked: ["more", "liked-before"], disliked: ["less", "tried-disliked"],
  bookmark: ["not-tried", "bookmarked"], "not-interested": ["less", "not-interested"]
};

// Product state for one round. Round r has the r earlier 6-item windows already shown (production
// excludes shown items and offers the next 6), cycling once the pool is used up. evidenceRotation in
// buildContext moves with seenItemIds the same way it does for a real visitor.
export function profileState(spec, { round = 0, snapshot = loadSnapshot(), itemsById = null } = {}) {
  const items = itemsById ?? new Map(snapshot.items.map((i) => [i.id, strip(i)]));
  const get = (id) => { const it = items.get(id); if (!it) throw new Error(`profile ${spec.id}: ${id} is not in the snapshot`); return it; };
  const favorites = spec.favorites.map(get);
  const state = {
    selectedFavorites: new Set(spec.favorites),
    customItems: Object.fromEntries(favorites.map((it) => [it.id, it])),
    feedbackByRecommendation: {},
    libraryFavorites: new Set(),
    recommendationSets: [],
    blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(),
    areas: Object.fromEntries(visibleDomains().map((d) => [d.id, true])),
    curveball: true, patternStatements: [], recommendationFilter: "all"
  };
  for (const r of spec.reactions) {
    const [rating, detail] = REACTIONS[r.how];
    state.feedbackByRecommendation[r.id] = { item: get(r.id), rating, detail, source: "recommendations", refinements: r.refinements ?? [] };
    if (r.starred) state.libraryFavorites.add(r.id);
  }
  for (const r of spec.intent) {
    const [rating, detail] = REACTIONS[r.how];
    state.feedbackByRecommendation[r.id] = { item: get(r.id), rating, detail, source: "browse" };
  }
  const windows = Math.floor(spec.candidates.length / OFFERED_PER_ROUND);
  const shown = round % windows;
  for (let w = 0; w < shown; w += 1) state.recommendationSets.push(spec.candidates.slice(w * OFFERED_PER_ROUND, (w + 1) * OFFERED_PER_ROUND));
  return state;
}

// Bridge books carry the marks retrieval gives them (src/catalog/bridge-candidates.mjs): found from the
// Loved source, with the genres both share.
export function candidateItems(spec, { snapshot = loadSnapshot(), itemsById = null } = {}) {
  const items = itemsById ?? new Map(snapshot.items.map((i) => [i.id, strip(i)]));
  const marks = new Map((spec.bridges ?? []).map((b) => [b.id, b]));
  return spec.candidates.map((id) => {
    const item = items.get(id);
    const mark = marks.get(id);
    if (!mark) return item;
    return { ...item, relatedTo: items.get(mark.fromId)?.title ?? null, relatedToId: mark.fromId, bridge: { fromId: mark.fromId, fromDomain: mark.fromDomain, sharedGenres: mark.sharedGenres } };
  });
}

export function itemsIndex(snapshot = loadSnapshot()) {
  return new Map(snapshot.items.map((i) => [i.id, strip(i)]));
}

// `node scripts/evals/stress/profiles.mjs --write` regenerates profiles.json from the snapshot.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--write")) {
  const { writeFileSync } = await import("node:fs");
  const snapshot = loadSnapshot();
  const profiles = buildAllProfileSpecs(snapshot);
  writeFileSync(PROFILES_PATH, JSON.stringify({ snapshot: { capturedFrom: snapshot.capturedFrom, capturedAt: snapshot.capturedAt, items: snapshot.items.length }, profiles }, null, 1) + "\n");
  for (const p of profiles) {
    const counts = p.reactions.reduce((c, r) => ({ ...c, [r.how]: (c[r.how] ?? 0) + 1 }), {});
    console.log(`${p.id}: ${p.favorites.length} favorites, reactions ${JSON.stringify(counts)}, intent ${p.intent.length}, candidates ${p.candidates.length}`);
  }
}
