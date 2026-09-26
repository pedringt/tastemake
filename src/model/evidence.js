import { starterItems } from "./starters.js";
import { displayLabel, domainsOf } from "../data/domains.js";

// Evidence (#35, #27): what the user actually did or explicitly said about an item.
//
// Three different things are kept apart:
//   item            what the thing is (catalog / search / added by the user)
//   evidence        what the user did or said about it (this file)            -> authority: the user
//   interpretation  what Tastemake (or a model) thinks it means (interpretations.js) -> authority: inferred
// An interpretation is never stored as evidence, and never overwrites it.
//
// Evidence kinds are generic on purpose: UI copy can say "Loved it before" for a film or "Wore it a lot"
// for a jacket, but internally both are an experienced strong positive. Weights live here and nowhere else.
// See docs/evidence-contract.md for the full table and the rules around it.

export const EVIDENCE_KINDS = {
  "experienced-strong-positive": { class: "experienced", polarity: 1, taste: 2 },
  "experienced-positive": { class: "experienced", polarity: 1, taste: 1.25 },
  "experienced-negative": { class: "experienced", polarity: -1, taste: -2 },
  "starter-favorite": { class: "experienced", polarity: 1, taste: 2 },   // choosing a Favorite means the user already tried and loved it
  "intent-positive": { class: "intent", polarity: 1, taste: 0 },
  "intent-negative": { class: "intent", polarity: -1, taste: 0 },
  "intent-declined": { class: "intent", polarity: -1, taste: 0 },          // "Not interested": not a dislike
  saved: { class: "intent", polarity: 1, taste: 0 },                       // bookmark
  neutral: { class: "neutral", polarity: 0, taste: 0 },
  unknown: { class: "neutral", polarity: 0, taste: 0 }
};

// The one mapping from a stored reaction to a kind. Reactions are stored as { rating, detail } (UI vocabulary).
export function evidenceKind(feedback) {
  if (!feedback) return "unknown";
  const { rating, detail } = feedback;
  if (rating === "more") {
    if (detail === "loved-before") return "experienced-strong-positive";
    if (detail === "liked-before") return "experienced-positive";
    return "intent-positive";
  }
  if (rating === "less") {
    if (detail === "tried-disliked") return "experienced-negative";
    if (detail === "not-interested") return "intent-declined";
    return "intent-negative";
  }
  if (rating === "not-tried") return detail === "bookmarked" ? "saved" : "neutral";
  return "unknown";
}

export const tasteWeight = (feedback) => EVIDENCE_KINDS[evidenceKind(feedback)].taste;
export const isExperiencedKind = (kind) => EVIDENCE_KINDS[kind]?.class === "experienced";

// ---- Predicates (#40): the canonical way to ask what a reaction means. -----------------------------
// Everything downstream (Library, My Tastemake, Taste Map, Search, Blind Spots, Recommendations) should
// ask evidence.js rather than re-decode `feedback.rating` / `feedback.detail` itself. UI copy (which exact
// words a screen shows) can still live in that screen; which *bucket* a reaction falls into should not.
//
// These take a stored reaction ({ rating, detail, ... }), not a starter favorite (starters have no
// feedback object; they are "experienced" only as an evidenceRecords() kind, see countsAsTasteRecord).
const kindOf = (feedback) => evidenceKind(feedback);
const classOf = (feedback) => EVIDENCE_KINDS[kindOf(feedback)].class;

export const isExperienced = (feedback) => classOf(feedback) === "experienced";
export const isIntentOnly = (feedback) => classOf(feedback) === "intent";

export const isStrongPositive = (feedback) => kindOf(feedback) === "experienced-strong-positive";        // Loved it before
export const isExperiencedPositive = (feedback) => isStrongPositive(feedback) || kindOf(feedback) === "experienced-positive";   // Loved or Liked it before
export const isExperiencedNegative = (feedback) => kindOf(feedback) === "experienced-negative";           // Tried it and disliked it

export const isSaved = (feedback) => kindOf(feedback) === "saved";                 // bookmarked, still untried
export const isDeclined = (feedback) => kindOf(feedback) === "intent-declined";    // "Not interested": intent, not a dislike

// Whether a reaction counts as taste evidence at all (the #27 rule, in one place).
export const countsAsTaste = (feedback) => tasteWeight(feedback) !== 0;
// A record from evidenceRecords() additionally has a "starter-favorite" kind, which is experienced
// (the user told Tastemake this) but never counts as taste by itself (weight 0). Records already carry
// `countsAsTaste`/`class`; this predicate is for records, mirroring the feedback-level one above.
export const recordCountsAsTaste = (record) => record.weight !== 0;

function sourceOf(feedback) {
  if (feedback.item.custom) return "added";
  if (feedback.source === "search") return "search";
  if (feedback.source === "browse") return "browse";
  return "recommendations";
}

// Every piece of evidence as a typed record. This is what a live model is handed (not a prose summary),
// and what its citations must point at: `ref` is the stable id to cite.
export function evidenceRecords(state) {
  const starters = starterItems(state)
    .map((item) => record(item, "starter-favorite", { source: "favorites" }));
  const reactions = Object.values(state.feedbackByRecommendation)
    .filter((feedback) => !state.selectedFavorites.has(feedback.item.id))
    .map((feedback) => record(feedback.item, evidenceKind(feedback), {
      source: sourceOf(feedback),
      wasSaved: Boolean(feedback.wasBookmarked),
      note: feedback.quality ?? null   // discovery notes (Too predictable / Surprised me): never taste
    }));
  return [...starters, ...reactions];
}

function record(item, kind, extra) {
  const info = EVIDENCE_KINDS[kind];
  return {
    ref: `ev:${item.id}`,
    itemId: item.id,
    title: item.title,
    type: item.type ?? null,
    displayLabel: displayLabel(item),
    domains: domainsOf(item),
    kind,
    class: info.class,
    polarity: info.polarity,
    countsAsTaste: info.class === "experienced",   // taste evidence (starter favorites included)
    weight: info.taste,                           // how much it moves a pattern
    authority: "user",          // evidence is always something the user did or said
    context: null,              // e.g. "family movie night"; not collected yet (#8 taste modes)
    ...extra
  };
}
