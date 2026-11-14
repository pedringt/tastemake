// Fixed evidence fixtures for the live-AI eval suite (#32). Deterministic: the same fixture always builds
// the same state, so results are comparable across model / prompt changes.
//
// Each fixture: { id, title, purpose, build() -> state, expect: {...} }. `expect` holds rules the scorers check.

import { favorites, followUpPool, hypotheses, recommendations } from "../qa/fixtures/catalog.js";
import { typeById, visibleDomains } from "../../src/data/domains.js";
import { readFileSync } from "node:fs";
import { hydrateState } from "../../src/server/request-state.mjs";
import { evidenceRecords } from "../../src/model/evidence.js";

const catalogItems = [...recommendations, ...followUpPool];
const byId = (id) => catalogItems.find((item) => item.id === id);

export function emptyState(starterIds = favorites.filter((f) => f.selected).map((f) => f.id)) {
  const starterItems = favorites.filter((item) => starterIds.includes(item.id));
  return {
    selectedFavorites: new Set(starterIds), feedbackByRecommendation: {}, recommendationSets: [recommendations],
    libraryFavorites: new Set(),
    // Production favorites are real catalog/customItems now. Keep deterministic fixture titles only inside
    // the eval harness, but store them in the same state shape the product uses so evidenceRecords sees them.
    customItems: Object.fromEntries(starterItems.map((item) => [item.id, item])),
    blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(),
    areas: Object.fromEntries(visibleDomains().map((d) => [d.id, true])), curveball: true, patternStatements: []
  };
}

const REACTIONS = {
  loved: ["more", "loved-before"], liked: ["more", "liked-before"], disliked: ["less", "tried-disliked"],
  bookmark: ["not-tried", "bookmarked"], "not-interested": ["less", "not-interested"], more: ["more", null], less: ["less", null]
};
export function react(state, item, how) {
  const [rating, detail] = REACTIONS[how];
  state.feedbackByRecommendation[item.id] = { item, rating, detail, source: "fixture" };
  return state;
}

// Synthetic items for scale tests: realistic shape, deterministic, never shown to users.
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
export function syntheticItems(n, { domains = ["movies", "tv", "read", "play"], seedValue = 7 } = {}) {
  seed = seedValue;
  const typeFor = { movies: ["movie"], tv: ["tv"], read: ["book"], play: ["game"] };
  return Array.from({ length: n }, (_, i) => {
    const domain = domains[Math.floor(rnd() * domains.length)];
    const types = typeFor[domain];
    const pattern = hypotheses[Math.floor(rnd() * hypotheses.length)];
    return { id: `syn-${i}`, title: `Synthetic ${typeById(types[i % types.length]).label} ${i}`, type: types[i % types.length], domains: [domain], hypotheses: [pattern.id], reason: "", about: "" };
  });
}

function scaled(n, { lovedShare = 0.5, dislikedShare = 0.2, intentShare = 0.2 } = {}) {
  const s = emptyState();
  syntheticItems(n, { seedValue: n }).forEach((item, i) => {
    const x = (i * 0.618) % 1;
    const how = x < lovedShare ? (i % 2 ? "loved" : "liked") : x < lovedShare + dislikedShare ? "disliked" : x < lovedShare + dislikedShare + intentShare ? (i % 2 ? "bookmark" : "not-interested") : "more";
    react(s, item, how);
  });
  return s;
}

export const FIXTURES = [
  {
    id: "cold-4", title: "Cold start: four favorites, nothing else",
    purpose: "Confidence calibration with almost no evidence; nothing may be claimed above Emerging.",
    build: () => emptyState(["lotr", "circe", "portal2", "thefall"]),
    expect: { maxLevel: "emerging", maxCrossDomain: "untested" }
  },
  {
    id: "starter-6", title: "The six default favorites",
    purpose: "Typical first visit. Patterns may only cite the user's own favorites.",
    build: () => emptyState(),
    expect: { maxLevel: "emerging", maxCrossDomain: "untested" }
  },
  {
    id: "about-10", title: "About ten things: six favorites and four tried reactions",
    purpose: "First live-AI milestone size (8-12 things). Three loved things on one pattern make it Strong; nothing else may be.",
    build: () => { const s = emptyState(); ["eeaao", "barry", "wwdits"].forEach((id) => byId(id) && react(s, byId(id), "loved")); byId("fargo") && react(s, byId("fargo"), "disliked"); return s; },
    expect: { strongOnly: ["H04"] }
  },
  {
    id: "intent-heavy", title: "Lots of intent, little experience",
    purpose: "Bookmarks, More/Less on untried picks and Not interested must never be used as taste.",
    build: () => { const s = emptyState(); catalogItems.slice(0, 10).forEach((item, i) => react(s, item, ["bookmark", "not-interested", "more", "less"][i % 4])); return s; },
    expect: { maxLevel: "emerging", noIntentAsTaste: true }
  },
  {
    id: "single-miss", title: "One confident miss after support",
    purpose: "One miss must not rewrite the profile or weaken a pattern.",
    build: () => { const s = emptyState(); ["eeaao", "barry"].forEach((id) => react(s, byId(id), "loved")); react(s, byId("wwdits"), "disliked"); return s; },
    before: () => { const s = emptyState(); ["eeaao", "barry"].forEach((id) => react(s, byId(id), "loved")); return s; },
    expect: { stableAfterMiss: 0.8 }
  },
  {
    id: "recurring-miss", title: "Two misses on the same pattern",
    purpose: "Recurring misses may lower confidence; nothing may be claimed Strong.",
    build: () => { const s = emptyState(); react(s, byId("barry"), "disliked"); react(s, byId("wwdits"), "disliked"); react(s, byId("eeaao"), "liked"); return s; },
    expect: { maxLevel: "supported" }
  },
  {
    id: "cross-domain", title: "Support in two areas",
    purpose: "A pattern backed once in Watch and once in Play is at most a tentative cross-domain link.",
    build: () => {
      const s = emptyState();
      const play = catalogItems.find((i) => i.domains.includes("play") && !i.domains.includes("movies") && i.hypotheses.includes("H04"));
      const watch = catalogItems.find((i) => i.domains.includes("movies") && !i.domains.includes("play") && i.hypotheses.includes("H04"));
      react(s, watch, "loved"); if (play) react(s, play, "loved"); return s;
    },
    expect: { maxCrossDomain: "tentative" }
  },
  {
    id: "user-said-not-me", title: "The user said a pattern is not them",
    purpose: "A user-confirmed statement outranks inference: that pattern must not come back.",
    build: () => { const s = emptyState(); ["eeaao", "barry", "wwdits"].forEach((id) => react(s, byId(id), "loved")); s.patternStatements = [{ hypothesisId: "H04", label: hypotheses.find((h) => h.id === "H04").title, says: "not-me" }]; return s; },
    expect: { excluded: ["H04"] }
  },
  {
    id: "scale-50", title: "About fifty pieces of evidence (synthetic)",
    purpose: "Specificity and repetition at scale (#28).",
    build: () => scaled(50), expect: {}
  },
  {
    id: "scale-100", title: "About a hundred pieces of evidence (synthetic)",
    purpose: "Specificity and repetition at scale (#28).",
    build: () => scaled(100), expect: {}
  }
];

// Deliberately bad model answers. The validator must reject every one, for the stated reason. This is how
// "unsupported evidence refs fail the eval", "intent used as taste is caught", etc. are proven (#32).
export function badResponses(ctx) {
  const tried = ctx.evidence.find((r) => r.class === "experienced" && r.polarity > 0 && r.kind !== "starter-favorite") ?? ctx.evidence.find((r) => r.class === "experienced");
  const intent = ctx.evidence.find((r) => r.class === "intent");
  const disliked = ctx.evidence.find((r) => r.kind === "experienced-negative");
  const base = { label: "Adult treatments of myth", claim: "Mythic material lands when the treatment is serious and strange rather than cosy.", evidence: [tried?.ref], counter: [], domains: tried ? [tried.domains[0]] : [], crossDomain: "untested", level: "emerging", conditional: false, context: null };
  const cases = [
    { name: "cites evidence that does not exist", h: { ...base, evidence: ["ev:does-not-exist"] }, reason: /does not exist/ },
    { name: "no evidence at all", h: { ...base, evidence: [] }, reason: /no supporting evidence/ },
    { name: "single-identity claim", h: { ...base, claim: "Your aesthetic is dark academia, through and through, in everything." }, reason: /identity/ },
    { name: "genre-only claim", h: { ...base, claim: "Likes fantasy." }, reason: /generic/ },
    { name: "claims a domain with no evidence there", h: { ...base, domains: ["read", "movies", "play"] }, reason: /no cited support|overreach/ },
    { name: "cross-domain overreach", h: { ...base, crossDomain: "supported" }, reason: /overreach/ },
    { name: "invents a context", h: { ...base, context: "work outfits" }, reason: /context/ },
    { name: "malformed", h: { label: "x" }, reason: /missing|not a list/ }
  ];
  if (intent) cases.push({ name: "uses intent as taste", h: { ...base, evidence: [intent.ref] }, reason: /intent/ });
  if (disliked) cases.push({ name: "cites a dislike as support", h: { ...base, evidence: [disliked.ref] }, reason: /disliked/ });
  const picks = [
    { name: "invented title", p: { itemId: "not-a-real-item", why: "Tests whether dry workplace comedy lands for you.", cites: [tried?.ref], tests: null, kind: "pick" }, reason: /eligible/ },
    { name: "circular reason", p: { itemId: ctx.candidates[0]?.id, why: "You'll like this because it matches your taste.", cites: [tried?.ref], tests: null, kind: "pick" }, reason: /circular/ },
    { name: "pick with no citation", p: { itemId: ctx.candidates[0]?.id, why: "Tests whether deadpan horror works for you.", cites: [], tests: null, kind: "pick" }, reason: /no evidence/ }
  ];
  if (intent) picks.push({ name: "pick resting only on intent", p: { itemId: ctx.candidates[0]?.id, why: "Tests whether a bookmark means real interest.", cites: [intent.ref], tests: null, kind: "pick" }, reason: /intent/ });
  return { hypotheses: cases, picks };
}

// Prompt-size fixture (#236 follow-up): a state shaped like a long-running production profile, for
// measuring the Taste Profile prompt offline. Not in FIXTURES (it has no behavioral expectations) and
// never sent to a model. It mirrors what the wire actually carries (src/ai/live-client.js): up to 96
// experienced reactions with provider ids, resolved facts (year, creator, up to 12 genres) and refinements,
// plus starter favorites and a full 12-pattern earlier profile citing that evidence (#228/#229).
export function productionShapedState({ favoritesCount = 8, reactions = 96, patterns = 12, seedValue = 11 } = {}) {
  seed = seedValue;
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const GENRES = {
    movie: ["Drama", "Comedy", "Science Fiction", "Thriller", "Fantasy", "Horror", "Mystery", "Animation", "Adventure", "Romance"],
    tv: ["Drama", "Comedy", "Sci-Fi & Fantasy", "Crime", "Mystery", "Animation", "Action & Adventure"],
    book: ["Fiction", "Fantasy fiction", "Fiction, fantasy, epic", "Science fiction", "Mythology, Greek", "Literary fiction", "Fiction, historical, general", "Magic", "Dragons", "Women authors", "Fiction, coming of age", "Large type books"],
    game: ["Adventure", "Puzzle", "Role-playing (RPG)", "Indie", "Shooter", "Platform", "Strategy"]
  };
  const PROVIDER = { movie: "tmdb", tv: "tmdb", book: "openlibrary", game: "igdb" };
  const DOMAIN = { movie: "movies", tv: "tv", book: "read", game: "play" };
  const REFS = { movie: ["characters", "story", "performances", "visual-style", "atmosphere-style"], tv: ["characters", "humor", "performances", "pacing"], book: ["writing-prose", "world-setting", "characters", "structure"], game: ["gameplay", "exploration", "atmosphere-style", "difficulty-challenge"] };
  const makeItem = (i, type) => {
    const provider = PROVIDER[type];
    const providerId = provider === "openlibrary" ? `/works/OL${100000 + i * 37}W` : String(20000 + i * 113);
    const id = provider === "openlibrary" ? `openlibrary-book-worksOL${100000 + i * 37}W` : provider === "tmdb" ? `tmdb-${type}-${providerId}` : `igdb-game-${providerId}`;
    const genreCount = type === "book" ? 6 + Math.floor(rnd() * 7) : 2 + Math.floor(rnd() * 2);
    const genres = [...new Set(Array.from({ length: genreCount }, () => pick(GENRES[type])))];
    return { id, title: `Production-shaped ${type} title number ${i}`, type, domains: [DOMAIN[type]], provider, providerId, year: 1975 + Math.floor(rnd() * 50), by: `Creator Name ${i % 17}`, genres };
  };
  const types = ["movie", "tv", "book", "game"];
  const favoritesList = Array.from({ length: favoritesCount }, (_, i) => makeItem(i, types[i % 4]));
  const s = emptyState([]);
  s.selectedFavorites = new Set(favoritesList.map((item) => item.id));
  s.customItems = Object.fromEntries(favoritesList.map((item) => [item.id, item]));
  const reacted = [];
  for (let i = 0; i < reactions; i += 1) {
    const item = makeItem(favoritesCount + i, types[i % 4]);
    const how = i % 5 === 4 ? "disliked" : Math.floor(i / 4) % 2 ? "loved" : "liked";
    react(s, item, how);
    if (i % 3 === 0) s.feedbackByRecommendation[item.id].refinements = REFS[item.type].slice(0, 1 + (i % 3));
    if (i % 3 === 1 && how === "loved") s.libraryFavorites.add(item.id);
    reacted.push({ item, how });
  }
  const positive = [...favoritesList.map((item) => ({ item, how: "favorite" })), ...reacted.filter((r) => r.how !== "disliked")];
  const negative = reacted.filter((r) => r.how === "disliked");
  s.modelHypotheses = Array.from({ length: patterns }, (_, p) => {
    const supports = [...new Set(Array.from({ length: 5 + (p % 5) }, () => pick(positive).item))];
    const counters = p % 3 === 0 ? [pick(negative).item] : [];
    const domains = [...new Set(supports.flatMap((item) => item.domains))];
    return {
      id: `ai-production-shaped-pattern-${p + 1}`,
      title: `Production-shaped pattern ${p + 1}`,
      claim: `Things land when they pair a specific, testable quality number ${p + 1} with deliberate pacing and a clear point of view, rather than relying on genre alone.`,
      evidence: supports.map((item) => item.title).join(", "),
      supports: supports.map((item) => `ev:${item.id}`),
      counters: counters.map((item) => `ev:${item.id}`),
      domains,
      strength: p % 4 === 0 ? "strong" : p % 2 ? "supported" : "emerging",
      status: "supported",
      crossDomain: domains.length > 1 ? "tentative" : "untested",
      context: null,
      aiGenerated: true,
      provenance: "Based on your reactions so far."
    };
  });
  s.patternStatements = [
    { hypothesisId: "ai-production-shaped-pattern-2", label: "Production-shaped pattern 2", says: "not-me", weight: null, context: null, authority: "user-confirmed" },
    { hypothesisId: "ai-production-shaped-pattern-3", label: "Production-shaped pattern 3", says: "partial", weight: null, context: "some", excludedDomains: ["play"], authority: "user-confirmed" }
  ];
  return s;
}

// ---- #250 PR 2: do directional reasons change picks? (node scripts/evals/run.mjs --suite reasons) ----------
// Three book scenarios, each in three versions on the same fixed candidate pool: reaction only, plain
// reasons ("Pacing"), and reasons with direction ("Pacing: too slow"). Better wording alone is not an
// improvement: read whether the picks themselves move, and whether one book's reason stays item-local.
const book = (id, title, by, genres, about) => ({ id: `openlibrary-book-${id}`, provider: "openlibrary", providerId: id, title, by, type: "book", domains: ["read"], genres, about, year: "2015" });
const REASON_POOL = [
  book("RP1W", "The Quiet Archive", "Mara Lune", ["Fantasy", "Magic"], "A contemplative, slow-moving fantasy about an archivist cataloguing a dying city, told in long reflective chapters."),
  book("RP2W", "Lanterns Over Hesk", "Tobin Ree", ["Fantasy", "Magic"], "A patient, atmospheric slow burn: a mapmaker spends a winter learning a valley's old magic."),
  book("RP3W", "Sixty Hours to Varn", "Ilse Morrow", ["Fantasy", "Adventure"], "A breakneck heist across a floating city, told in short propulsive chapters with a ticking clock."),
  book("RP4W", "Knifepoint Crown", "Dace Hollin", ["Fantasy", "Adventure"], "Fast, punchy court intrigue where every chapter ends on a reversal."),
  book("RP5W", "The Salt Bride", "Wren Calloway", ["Romance", "Fantasy"], "A sea-witch and a lighthouse keeper fall slowly in love while a storm cult rises; the romance runs alongside a mystery."),
  book("RP6W", "Ember and Vow", "Sela Imre", ["Romance", "Fantasy"], "A fake-engagement fantasy romance where the courtship is the whole plot.")
];
const lovedBooks = [
  book("RL1W", "The Hollow Orchard", "Ana Petri", ["Fantasy", "Magic"], "A gentle, lyrical fantasy about a village that remembers its dead."),
  book("RL2W", "Glassmaker's Daughter", "Ines Varga", ["Fantasy", "Romance"], "A glassblower's apprentice, a slow romance, and a city made of light."),
  book("RL3W", "River of Small Gods", "Oren Taal", ["Fantasy", "Mystery fiction"], "A river priest investigates why the small gods are going quiet.")
];
const missBook = book("RM1W", "The Thousand Stairs", "Kell Arden", ["Fantasy", "Romance"], "A long, slow climb through a monastery; a love triangle takes over the second half.");

function reasonState(lovedReasons, missReasons) {
  const s = emptyState([]);
  s.recommendationSets = [];
  lovedBooks.forEach((item, i) => { react(s, item, i === 0 ? "loved" : "liked"); s.feedbackByRecommendation[item.id].refinements = lovedReasons[i] ?? []; });
  react(s, missBook, "disliked");
  s.feedbackByRecommendation[missBook.id].refinements = missReasons;
  return s;
}
const SCENARIOS = [
  { id: "pacing", title: "Too slow vs slow burn", plain: [["pacing"], [], []], plainMiss: ["pacing"], directional: [["pacing:slow-burn"], [], []], directionalMiss: ["pacing:too-slow"] },
  { id: "romance", title: "One romance-heavy miss among loved romances", plain: [[], ["story"], []], plainMiss: ["story"], directional: [[], ["romance:highlight"], []], directionalMiss: ["romance:took-over"] },
  { id: "prose", title: "Prose that worked vs prose that didn't", plain: [["writing-prose"], [], []], plainMiss: ["writing-prose"], directional: [["writing-prose:beautiful"], [], []], directionalMiss: ["writing-prose:overwritten"] }
];
export const REASON_FIXTURES = SCENARIOS.flatMap((scenario) => [
  { id: `${scenario.id}-reaction-only`, title: `${scenario.title}: reaction only`, purpose: "Baseline: no reasons at all.", candidates: REASON_POOL, build: () => reasonState([], []), expect: {} },
  { id: `${scenario.id}-plain`, title: `${scenario.title}: plain reasons`, purpose: "Reasons without a direction.", candidates: REASON_POOL, build: () => reasonState(scenario.plain, scenario.plainMiss), expect: {} },
  { id: `${scenario.id}-directional`, title: `${scenario.title}: reasons with direction`, purpose: "Reasons with a direction; picks should move with it, and one miss must not rule out a theme.", candidates: REASON_POOL, build: () => reasonState(scenario.directional, scenario.directionalMiss), expect: {} }
]);


// ---- #318: does each cited support fit its pattern? (node scripts/evals/run.mjs --suite support) -----------
// Paige's Example Profile (data/example-profile.json, her real and confirmed reactions) listed Resident Evil 7
// under "Mythic and fantastical worlds". The validator checks a citation's structure (it exists, was tried,
// was liked, sits in a claimed area), not whether the item shows the pattern, so this is measured here.
// Two fixtures, one Taste Profile call each, no picks: a refresh that carries the stored patterns (as
// production sends them), and a fresh profile from the same evidence (does the model attach it on its own?).
// Labels: `fits: false` only where Paige reported it (#318); the positives are the item's own metadata and
// reasons. Pairs nobody has judged (BioShock or Return of the Obra Dinn under the same pattern) are not
// labelled.
const exampleBackup = JSON.parse(readFileSync(new URL("../../data/example-profile.json", import.meta.url), "utf8")).state;
const RE7 = "ev:igdb-game-19562";
const BIOSHOCK = "ev:igdb-game-20";
// Nov 6: the Example Profile itself no longer cites RE7 or BioShock under "Mythic and fantastical worlds"
// (2cdd9fc, 5cb61a7). Production profiles refreshed before that can still carry such supports, so the refresh
// fixture restores the uncorrected supports to test whether a refresh keeps them.
const MYTHIC = "ai-genre-fantasy-mythic-worlds";
const uncorrected = (patterns) => patterns.map((p) => (p.id === MYTHIC ? { ...p, supports: [...new Set([...p.supports, RE7, BIOSHOCK])] } : p));
const exampleState = ({ keepPatterns }) => ({ ...hydrateState(exampleBackup), recommendationSets: [], modelHypotheses: keepPatterns ? uncorrected(exampleBackup.modelHypotheses) : [] });
const confirmedState = ({ says, context = null, excludedDomains = [] }) => {
  const state = exampleState({ keepPatterns: true });
  const mythic = state.modelHypotheses.find((p) => p.id === MYTHIC);
  return { ...state, patternStatements: [{ hypothesisId: MYTHIC, label: mythic.title, says, weight: null, context, authority: "user-confirmed", excludedDomains }] };
};
export const SUPPORT_FIT = [
  { name: "Resident Evil 7 is not support for a mythic / fantasy pattern", pattern: /myth|fantas/i, ref: RE7, fits: false, basis: "#318: Paige; IGDB genres Shooter, Puzzle, Adventure; her reasons are atmosphere and exploration" },
  { name: "Resident Evil 7 still supports an atmosphere / horror pattern", pattern: /atmospher|horror/i, ref: RE7, fits: true, basis: "her reason atmosphere-style" },
  { name: "Resident Evil 7 still supports an exploration pattern", pattern: /explor/i, ref: RE7, fits: true, basis: "her reason exploration" },
  { name: "BioShock is not support for a mythic / fantasy pattern", pattern: /myth|fantas/i, ref: BIOSHOCK, fits: false, basis: "Paige, Nov 6; IGDB genres Shooter, Puzzle, RPG, Adventure; a horror-themed shooter in a steampunk underwater dystopia" },
  { name: "BioShock still supports an exploration pattern", pattern: /explor/i, ref: BIOSHOCK, fits: true, basis: "her reason exploration; Exploration-heavy games with puzzles cites it" },
  { name: "Circe still supports a mythic / fantasy pattern", pattern: /myth|fantas/i, ref: "ev:openlibrary-book-OL18012166W", fits: true, basis: "Open Library subjects Fantasy, Mythology, Retellings" }
];
export const SUPPORT_FIXTURES = [
  { id: "example-refresh", title: "Example Profile, refreshed with its stored patterns", purpose: "Does a refresh keep a support that doesn't fit its pattern, and keep the ones that do?", candidates: [], build: () => exampleState({ keepPatterns: true }), expect: { supportFit: SUPPORT_FIT } },
  { id: "example-fresh", title: "Example Profile evidence, no earlier patterns", purpose: "Does the model attach an unfitting support on its own?", candidates: [], build: () => exampleState({ keepPatterns: false }), expect: { supportFit: SUPPORT_FIT } },
  // Nov 6 (#318 before/after): the same refresh with the mythic pattern confirmed. Its wording, the user's
  // answer and the pattern itself must survive whatever happens to its evidence.
  { id: "example-refresh-confirmed", title: "Example Profile refresh, mythic pattern confirmed (Yes)", purpose: "Do unfitting supports leave a confirmed pattern while it, its wording and the answer stay?", candidates: [], build: () => confirmedState({ says: "accurate" }), expect: { supportFit: SUPPORT_FIT, keepsConfirmed: [MYTHIC] } },
  { id: "example-refresh-partly", title: "Example Profile refresh, mythic pattern Partly, depends on context, not in games", purpose: "Same, with Partly, a context answer and an excluded area", candidates: [], build: () => confirmedState({ says: "partial", context: "some", excludedDomains: ["play"] }), expect: { supportFit: SUPPORT_FIT, keepsConfirmed: [MYTHIC] } }
];


// #335 before/after (Nov 11): Paige disliked Friends because its style of humor isn't hers. Her Example Profile
// (loved Detroiters, Nathan for You, The Rehearsal; liked The Office, Curb) plus Friends as a dislike, fresh (no
// earlier patterns, so a refresh can't just repeat them). The arms differ only in Friends' reason: the plain
// "Humor" today's vocabulary allows, or the new direction "Humor: not my style of humor". Five runs each.
const FRIENDS = {
  id: "tmdb-tv-1668", provider: "tmdb", providerId: "1668", title: "Friends", type: "tv", domains: ["tv"], year: "1994", genres: ["35"],
  about: "Six young people from New York City, on their own and struggling to survive in the real world, find the companionship, comfort and support they get from each other to be the perfect antidote to the pressures of life.",
  providerMeta: { genreIds: [35], collectionId: null }, sourceUrl: "https://www.themoviedb.org/tv/1668"
};
const friendsState = (refinements) => {
  const state = exampleState({ keepPatterns: false });
  state.feedbackByRecommendation = { ...state.feedbackByRecommendation, [FRIENDS.id]: { item: FRIENDS, rating: "less", detail: "tried-disliked", quality: null, source: "search", refinements } };
  return state;
};
export const DISLIKE_DIRECTION_FIXTURES = [1, 2, 3, 4, 5].flatMap((n) => [
  { id: `friends-plain-${n}`, arm: "plain", title: `Friends disliked for "Humor" (run ${n})`, purpose: "Today's vocabulary", candidates: [], build: () => friendsState(["humor"]), expect: { friendsScope: true } },
  { id: `friends-direction-${n}`, arm: "direction", title: `Friends disliked for "Humor: not my style of humor" (run ${n})`, purpose: "The #335 direction", candidates: [], build: () => friendsState(["humor:not-my-style"]), expect: { friendsScope: true } }
]);


// ---- #278: does each counter-example contradict its pattern? (node scripts/evals/run.mjs --suite counter) -------
// Eleven Taste Profile calls, no picks: the default fixtures with real titles (the synthetic scale fixtures are left
// out, since a grader can't judge "Synthetic Movie 12"), plus Paige's Example Profile fresh and refreshed. Every
// counter item on every kept pattern is then graded (scripts/evals/counter-grader.mjs).
export const COUNTER_FIXTURES = [
  ...FIXTURES.filter((f) => !f.id.startsWith("scale-")).map((f) => ({ ...f, candidates: [] })),
  ...SUPPORT_FIXTURES.filter((f) => f.id === "example-refresh" || f.id === "example-fresh")
];

// The Example Profile's stored patterns are real model output, so their counters are graded too (no profile call).
// Paige judged one (Nov 6, #278): It Ends With Us, a contemporary romance, isn't evidence against mythic worlds.
const IT_ENDS_WITH_US = "ev:openlibrary-book-OL18020194W";
export function exampleProfileCounters() {
  const state = hydrateState(exampleBackup);
  return {
    source: "Example Profile (stored)",
    evidence: evidenceRecords(state),
    hypotheses: exampleBackup.modelHypotheses.map((p) => ({ ...p, label: p.title, known: p.id === MYTHIC ? { [IT_ENDS_WITH_US]: "not-defensible" } : null }))
  };
}

// Calibration: cases with a known answer, graded every run and reported apart from the share. The Mr. Mercedes
// case is reconstructed from the #278 write-up (its claim and genres are approximations); the Stoner case is a
// constructed clear pass, a dislike for exactly the pacing the pattern says the person enjoys.
const calibrationRecord = (id, title, type, by, genres, kind, reasons = []) => ({
  ref: `ev:cal-${id}`, itemId: `cal-${id}`, title, type, kind, facts: { creator: by, genres },
  refinements: reasons.map(([dimension, direction]) => ({ dimension, direction: direction ?? null }))
});
export function counterCalibration() {
  const evidence = [
    calibrationRecord("piranesi", "Piranesi", "book", "Susanna Clarke", ["Fantasy", "Mystery"], "experienced-strong-positive"),
    calibrationRecord("arrival", "Arrival", "movie", null, ["Science Fiction", "Drama", "Mystery"], "experienced-strong-positive"),
    calibrationRecord("solaris", "Solaris", "book", "Stanisław Lem", ["Science fiction"], "experienced-positive"),
    calibrationRecord("moon", "Moon", "movie", null, ["Science Fiction", "Drama"], "experienced-positive"),
    calibrationRecord("mr-mercedes", "Mr. Mercedes", "tv", null, ["Crime", "Drama", "Mystery"], "experienced-negative", [["Pacing"]]),
    calibrationRecord("gilead", "Gilead", "book", "Marilynne Robinson", ["Literary fiction"], "experienced-strong-positive", [["Pacing", "Slow burn"]]),
    calibrationRecord("remains", "The Remains of the Day", "book", "Kazuo Ishiguro", ["Literary fiction"], "experienced-strong-positive"),
    calibrationRecord("stoner", "Stoner", "book", "John Williams", ["Literary fiction", "Academia"], "experienced-negative", [["Pacing", "Too slow"]])
  ];
  return {
    source: "calibration",
    evidence,
    hypotheses: [
      { label: "Cerebral speculative worlds with mystery at the core", claim: "Drawn to speculative stories built around a central mystery that rewards close attention.", evidence: ["ev:cal-piranesi", "ev:cal-arrival", "ev:cal-solaris", "ev:cal-moon"], counter: ["ev:cal-mr-mercedes"], known: { "ev:cal-mr-mercedes": "not-defensible" } },
      { label: "Quiet, patiently paced literary novels", claim: "Enjoys quiet literary novels that take their time with an inner life.", evidence: ["ev:cal-gilead", "ev:cal-remains"], counter: ["ev:cal-stoner"], known: { "ev:cal-stoner": "defensible" } }
    ]
  };
}

// ---- #326 + #318: what a refresh does with new evidence (node scripts/evals/run.mjs --suite refresh) --------
// The Example Profile's stored patterns (as corrected in #332), plus ratings made since its last refresh. Two
// cases from #326's acceptance criteria, and the three #318 refresh fixtures above:
//   - refresh-new-preference: four heist and con films, liked or loved, which no stored pattern covers, and one
//     disliked slow-burn horror film, which pulls against "Uncanny slow-burn horror on screen" (#278: same kind
//     of thing, tried and disliked). A refresh should find the new preference and attach the counter.
//   - refresh-nothing-new: three ratings that each fit a stored pattern. A refresh should cite them there and
//     add no pattern for them ("nothing new" is a valid outcome).
// Titles, years and genres are real; the provider ids are fixture-only ("fx-"), so nothing is looked up.
const fxItem = (id, title, type, domains, year, genres, provider) => ({ id: `${provider}-${type === "movie" ? "movie" : type}-fx-${id}`, provider, providerId: `fx-${id}`, title, type, domains, year, genres, about: "", providerMeta: {}, sourceUrl: null });
const fxMovie = (id, title, year, genreIds) => fxItem(id, title, "movie", ["movies"], year, genreIds.map(String), "tmdb");
export const NEW_PREFERENCE = [
  { item: fxMovie("oceans-eleven", "Ocean's Eleven", "2001", [80, 53]), rating: "more", detail: "loved-before" },
  { item: fxMovie("the-sting", "The Sting", "1973", [35, 80, 18]), rating: "more", detail: "loved-before" },
  { item: fxMovie("inside-man", "Inside Man", "2006", [80, 18, 53]), rating: "more", detail: "liked-before" },
  { item: fxMovie("logan-lucky", "Logan Lucky", "2017", [28, 35, 80]), rating: "more", detail: "liked-before" }
];
export const NEW_COUNTER = { item: fxMovie("it-comes-at-night", "It Comes at Night", "2017", [27, 9648]), rating: "less", detail: "tried-disliked" };
export const FITS_EXISTING = [
  { item: fxItem("amnesia", "Amnesia: The Dark Descent", "game", ["play"], "2010", ["Puzzle", "Adventure", "Indie"], "igdb"), rating: "more", detail: "liked-before", refinements: ["atmosphere-style"], pattern: /horror/i },
  { item: fxMovie("the-babadook", "The Babadook", "2014", [27, 18]), rating: "more", detail: "loved-before", pattern: /horror/i },
  { item: { ...fxItem("the-penelopiad", "The Penelopiad", "book", ["read"], "2005", ["Mythology", "Retellings", "Fiction"], "openlibrary"), by: "Margaret Atwood" }, rating: "more", detail: "liked-before", pattern: /myth|fantas/i }
];
const refOf = (entry) => `ev:${entry.item.id}`;
const withRatings = (entries) => {
  const state = { ...hydrateState(exampleBackup), recommendationSets: [], modelHypotheses: exampleBackup.modelHypotheses };
  const added = Object.fromEntries(entries.map(({ item, rating, detail, refinements = [] }) => [item.id, { item, rating, detail, quality: null, source: "search", refinements }]));
  return { ...state, feedbackByRecommendation: { ...state.feedbackByRecommendation, ...added } };
};
const STORED_CONFIRMED = exampleBackup.patternStatements.filter((s) => s.says === "accurate" || s.says === "partial").map((s) => s.hypothesisId);
export const REFRESH_FIXTURES = [
  ...SUPPORT_FIXTURES.filter((f) => f.id !== "example-fresh"),
  { id: "refresh-new-preference", title: "Refresh after a new, distinct preference and a counter", purpose: "#326: does a refresh find a preference no stored pattern covers, and attach a genuine counter, without rewording what the user confirmed?", candidates: [], build: () => withRatings([...NEW_PREFERENCE, NEW_COUNTER]),
    expect: { refresh: { newPreference: NEW_PREFERENCE.map(refOf), counter: { ref: refOf(NEW_COUNTER), pattern: /slow-burn|dread/i } }, keepsConfirmed: STORED_CONFIRMED } },
  { id: "refresh-nothing-new", title: "Refresh after ratings that fit stored patterns", purpose: "#326 control: are new ratings cited by the patterns they fit, with no new pattern made for them?", candidates: [], build: () => withRatings(FITS_EXISTING),
    expect: { refresh: { fitsExisting: FITS_EXISTING.map((entry) => ({ ref: refOf(entry), title: entry.item.title, pattern: entry.pattern })) }, keepsConfirmed: STORED_CONFIRMED } }
];
