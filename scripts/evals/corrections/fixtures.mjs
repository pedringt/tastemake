// Correction-aware ranking eval (learning-loop review, Nov 3): deterministic fixtures. No network, no model.
//
// A case is one taste profile, its fixed candidate pool and its Taste Profile patterns. Each pattern has
// two support lists:
//   - stored: what the product has (what a ranking rule would read);
//   - true:   what actually supports it. They differ only where a support is deliberately wrong, which
//             is how a model-written pattern can cite the wrong item (#318: Resident Evil 7 under
//             "Mythic and fantastical worlds" in the Example Profile).
//
// Stress profiles (scripts/evals/stress/profiles.json) have no patterns, so patterns here are rules over
// the snapshot's browse shelves: a pattern's supports are the profile's Loved/Liked/favorite items on
// those shelves. Rules are easy to review; the items they resolve to are listed in the report.
//
// The Example Profile (data/example-profile.json) keeps its real model-written patterns. It has no fixed
// pool, so one is drawn here from the same snapshot, seeded, from shelves near its patterns.

import { readFileSync } from "node:fs";
import { CANDIDATE_POOL, OFFERED_PER_ROUND, loadProfileSpecs, loadSnapshot, mulberry32, profileState } from "../stress/profiles.mjs";
import { visibleDomains } from "../../../src/data/domains.js";
import { serializeAiState } from "../../../src/ai/live-client.js";
import { evidenceRecords } from "../../../src/model/evidence.js";
import { hydrateState } from "../../../src/server/request-state.mjs";
import { anchorSet } from "./rank.mjs";

export const ROUNDS = Math.floor(CANDIDATE_POOL / OFFERED_PER_ROUND);   // 6, as in the stress eval

// Which stress profiles, and their pattern rules. `wrong` names another shelf: the pattern also cites the
// profile's most recent positive item from it, the stress-profile version of the Resident Evil 7 /
// fantasy link. Overlaps are deliberate: "built-worlds" shares every support with two other patterns,
// and items that sit on two shelves support two patterns.
export const STRESS_PATTERNS = {
  "split-50": [
    { id: "fantasy-books", label: "Immersive fantasy reading", domains: ["read"], shelves: ["read:fantasy"], wrong: "movies:horror" },
    { id: "story-rpgs", label: "Story-heavy role-playing games", domains: ["play"], shelves: ["play:rpg"] },
    { id: "tv-comedy", label: "Character-driven TV comedy", domains: ["tv"], shelves: ["tv:comedy"] },
    { id: "horror-films", label: "Horror films", domains: ["movies"], shelves: ["movies:horror"] },
    { id: "built-worlds", label: "Deep built worlds in books and games", domains: ["read", "play"], shelves: ["read:fantasy", "play:rpg"] }
  ],
  "split-100": [
    { id: "fantasy-books", label: "Immersive fantasy reading", domains: ["read"], shelves: ["read:fantasy"], wrong: "movies:horror" },
    { id: "story-rpgs", label: "Story-heavy role-playing games", domains: ["play"], shelves: ["play:rpg"] },
    { id: "tv-comedy", label: "Character-driven TV comedy", domains: ["tv"], shelves: ["tv:comedy"] },
    { id: "horror-films", label: "Horror films", domains: ["movies"], shelves: ["movies:horror"] },
    { id: "built-worlds", label: "Deep built worlds in books and games", domains: ["read", "play"], shelves: ["read:fantasy", "play:rpg"] }
  ],
  "broad-50": [
    { id: "screen-fantasy", label: "Fantasy on screen", domains: ["movies", "tv"], shelves: ["movies:fantasy", "tv:fantasy"] },
    { id: "literary-history", label: "Literary and historical fiction", domains: ["read"], shelves: ["read:historical-fiction", "read:literary-fiction"] },
    { id: "thrillers", label: "Tense thrillers in films and books", domains: ["movies", "read"], shelves: ["movies:thriller", "read:mystery-thriller"], wrong: "tv:comedy" },
    { id: "tv-sci-fi", label: "Science fiction series", domains: ["tv"], shelves: ["tv:sci-fi"] }
  ],
  "dislikes-50": [
    { id: "horror-anywhere", label: "Horror in every medium", domains: ["movies", "tv", "read", "play"], shelves: ["movies:horror", "tv:horror", "read:horror", "play:horror"] },
    { id: "thrillers", label: "Thrillers on screen and in books", domains: ["movies", "tv", "read"], shelves: ["movies:thriller", "tv:thriller", "read:mystery-thriller"] }
  ],
  "narrow-50": [
    { id: "sci-fi-films", label: "Science fiction films", domains: ["movies"], shelves: ["movies:sci-fi"] },
    { id: "dark-genre-films", label: "Dark horror and thriller films", domains: ["movies"], shelves: ["movies:horror", "movies:thriller"] }
  ]
};

// Round 2 (extended set): the 100+ profiles of the same shapes. Larger profiles give more Surprise slots,
// more items supporting two patterns, and two more deliberately wrong supports: an "overly broad" one inside
// a single medium (narrow-100: a thriller cited for science fiction films) and a cross-medium one (broad-100).
// The six round-1 cases above are unchanged, so round-1 numbers stay comparable.
export const EXTENDED_PATTERNS = {
  "split-100": null,   // already a round-1 case
  "broad-100": [
    { id: "screen-fantasy", label: "Fantasy on screen", domains: ["movies", "tv"], shelves: ["movies:fantasy", "tv:fantasy"] },
    { id: "literary-history", label: "Literary and historical fiction", domains: ["read"], shelves: ["read:historical-fiction", "read:literary-fiction"] },
    { id: "thrillers", label: "Tense thrillers in films and books", domains: ["movies", "read"], shelves: ["movies:thriller", "read:mystery-thriller"], wrong: "tv:comedy" },
    { id: "tv-sci-fi", label: "Science fiction series", domains: ["tv"], shelves: ["tv:sci-fi"] }
  ],
  "dislikes-100": [
    { id: "horror-anywhere", label: "Horror in every medium", domains: ["movies", "tv", "read", "play"], shelves: ["movies:horror", "tv:horror", "read:horror", "play:horror"] },
    { id: "thrillers", label: "Thrillers on screen and in books", domains: ["movies", "tv", "read"], shelves: ["movies:thriller", "tv:thriller", "read:mystery-thriller"] }
  ],
  "narrow-100": [
    { id: "sci-fi-films", label: "Science fiction films", domains: ["movies"], shelves: ["movies:sci-fi"], wrong: "movies:thriller" },
    { id: "dark-genre-films", label: "Dark horror and thriller films", domains: ["movies"], shelves: ["movies:horror", "movies:thriller"] }
  ]
};

// #318: in the Example Profile, Resident Evil 7 is stored as support for "Mythic and fantastical worlds",
// which it doesn't support; it does legitimately support the exploration and horror patterns. #318's data
// fix removes it from the example file, so the fixture adds it back to the stored supports: the case is
// about what a wrong support would do to ranking, whatever the example file says.
export const EXAMPLE_WRONG_SUPPORTS = { "ai-genre-fantasy-mythic-worlds": ["ev:igdb-game-19562"] };
export const EXAMPLE_POOL_SHELVES = ["play:puzzle", "play:horror", "read:fantasy", "tv:comedy", "tv:horror", "movies:fantasy"];
export const EXAMPLE_POOL_SEED = 505;

const EXAMPLE_PATH = new URL("../../../data/example-profile.json", import.meta.url);
const POSITIVE = new Set(["loved", "liked"]);

const strip = ({ _bucket, ...item }) => item;

function shuffled(list, rnd) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function stressCase(spec, rules, snapshot, byId) {
  const shelvesOf = (id) => snapshot.byId.get(id)?._bucket ?? [];
  const positives = [...spec.favorites, ...spec.reactions.filter((r) => POSITIVE.has(r.how)).map((r) => r.id)];
  const patterns = rules.map((rule) => {
    const supports = positives.filter((id) => shelvesOf(id).some((s) => rule.shelves.includes(s))).map((id) => `ev:${id}`);
    // The most recent such item, so it is among the 96 tried items the browser sends.
    const wrongItem = rule.wrong ? positives.findLast((id) => shelvesOf(id).includes(rule.wrong) && !supports.includes(`ev:${id}`)) : null;
    const wrong = wrongItem ? [`ev:${wrongItem}`] : [];
    return { id: rule.id, label: rule.label, domains: rule.domains, supports: [...supports, ...wrong], trueSupports: supports, wrongSupports: wrong };
  });
  return {
    id: spec.id,
    kind: "stress",
    state: (round) => profileState(spec, { round, itemsById: byId }),
    pool: spec.candidates.map((id) => byId.get(id)),
    patterns,
    storedStatements: []
  };
}

function exampleCase(snapshot, byId) {
  const raw = JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
  const st = raw.state ?? raw;
  const ratedIds = new Set([...Object.keys(st.feedbackByRecommendation ?? {}), ...(st.selectedFavorites ?? [])]);
  const ratedTitles = new Set(Object.values(st.feedbackByRecommendation ?? {}).map((f) => String(f.item?.title ?? "").toLowerCase()));
  const rnd = mulberry32(EXAMPLE_POOL_SEED);
  const used = new Set();
  const perShelf = EXAMPLE_POOL_SHELVES.map((shelf) => {
    const items = snapshot.items.filter((i) => i._bucket.includes(shelf)).sort((a, b) => a.id.localeCompare(b.id));
    const chosen = [];
    for (const item of shuffled(items, rnd)) {
      if (chosen.length >= CANDIDATE_POOL / EXAMPLE_POOL_SHELVES.length) break;
      const title = item.title.toLowerCase();
      if (ratedIds.has(item.id) || ratedTitles.has(title) || used.has(item.id) || used.has(title)) continue;
      used.add(item.id); used.add(title);
      chosen.push(item.id);
    }
    return chosen;
  });
  const pool = perShelf
    .flatMap((ids) => ids.map((id, k) => ({ id, at: (k + 0.5) / ids.length, tie: rnd() })))
    .sort((a, b) => a.at - b.at || a.tie - b.tie)
    .map(({ id }) => byId.get(id));

  const patterns = (st.modelHypotheses ?? []).map((h) => {
    const wrong = EXAMPLE_WRONG_SUPPORTS[h.id] ?? [];
    return { id: h.id, label: h.title, domains: h.domains ?? [], supports: [...new Set([...h.supports, ...wrong])], trueSupports: h.supports.filter((r) => !wrong.includes(r)), wrongSupports: wrong };
  });

  const state = (round) => {
    const s = {
      selectedFavorites: new Set(st.selectedFavorites ?? []),
      libraryFavorites: new Set(st.libraryFavorites ?? []),
      customItems: structuredClone(st.customItems ?? {}),
      feedbackByRecommendation: structuredClone(st.feedbackByRecommendation ?? {}),
      recommendationSets: [],
      blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(),
      areas: Object.fromEntries(visibleDomains().map((d) => [d.id, true])),
      curveball: true, patternStatements: [], recommendationFilter: "all"
    };
    for (let w = 0; w < round % ROUNDS; w += 1) s.recommendationSets.push(pool.slice(w * OFFERED_PER_ROUND, (w + 1) * OFFERED_PER_ROUND).map((i) => i.id));
    return s;
  };
  return { id: "example-paige", kind: "example", state, pool, patterns, storedStatements: st.patternStatements ?? [] };
}

// The evidence the server would see for this state: the browser's wire payload (at most 96 tried items),
// hydrated the way api/recommendations.mjs does.
export function wireRecords(state) {
  return evidenceRecords(hydrateState(JSON.parse(JSON.stringify(serializeAiState(state)))));
}

// The rated items the stand-in retrieval uses as Surprise anchors (Liked, not Loved): what a correction
// has to reach to change a Surprise slot.
function withEdgeAnchors(kase) {
  kase.edgeAnchorRefs = anchorSet(wireRecords(kase.state(0))).filter((r) => r.kind === "experienced-positive").map((r) => r.ref);
  return kase;
}

// Every case, in a fixed order: the six round-1 cases, then (unless `extended: false`) the round-2 ones,
// marked `extended: true`.
export function loadCases({ snapshot = loadSnapshot(), extended = true } = {}) {
  snapshot.byId ??= new Map(snapshot.items.map((i) => [i.id, i]));
  const byId = new Map(snapshot.items.map((i) => [i.id, strip(i)]));
  const specs = new Map(loadProfileSpecs().map((s) => [s.id, s]));
  const cases = Object.entries(STRESS_PATTERNS).map(([id, rules]) => stressCase(specs.get(id), rules, snapshot, byId));
  cases.push(exampleCase(snapshot, byId));
  if (extended) for (const [id, rules] of Object.entries(EXTENDED_PATTERNS)) {
    if (rules) cases.push({ ...stressCase(specs.get(id), rules, snapshot, byId), extended: true });
  }
  return cases.map(withEdgeAnchors);
}
