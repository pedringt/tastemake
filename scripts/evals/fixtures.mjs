// Fixed evidence fixtures for the live-AI eval suite (#32). Deterministic: the same fixture always builds
// the same state, so results are comparable across model / prompt changes.
//
// Each fixture: { id, title, purpose, build() -> state, expect: {...} }. `expect` holds rules the scorers check.

import { favorites, followUpPool, hypotheses, recommendations } from "../qa/fixtures/catalog.js";
import { typeById, visibleDomains } from "../../src/data/domains.js";

const catalogItems = [...recommendations, ...followUpPool];
const byId = (id) => catalogItems.find((item) => item.id === id);

export function emptyState(starterIds = favorites.filter((f) => f.selected).map((f) => f.id)) {
  return {
    selectedFavorites: new Set(starterIds), feedbackByRecommendation: {}, recommendationSets: [recommendations],
    libraryFavorites: new Set(), customItems: {}, blindSpots: {}, blindSpotDrafts: {}, blindSpotDismissed: new Set(),
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
export function syntheticItems(n, { domains = ["watch", "read", "play"], seedValue = 7 } = {}) {
  seed = seedValue;
  const typeFor = { watch: ["movie", "tv"], read: ["book"], play: ["game"] };
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
      const play = catalogItems.find((i) => i.domains.includes("play") && !i.domains.includes("watch") && i.hypotheses.includes("H04"));
      const watch = catalogItems.find((i) => i.domains.includes("watch") && !i.domains.includes("play") && i.hypotheses.includes("H04"));
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
    { name: "claims a domain with no evidence there", h: { ...base, domains: ["read", "watch", "play"] }, reason: /no cited support|overreach/ },
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
