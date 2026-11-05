import { contentThemesFor } from "../model/refinements.js";
import { isFranchiseContinuation } from "../catalog/novelty.mjs";
import { TMDB_GENRES } from "../catalog/synopsis.mjs";

// Oct 27 (whole-profile recommendations): every rating votes, not just the handful sent to the model.
//
// A candidate is compared with each thing the person has tried, using only catalog facts both sides
// carry: genres, Tastemake's content themes (romance, grief...) and creator. The closest matches count
// most, so one strong match to a loved item beats a faint likeness to many. Loved counts more than
// Liked, Liked still counts, and a close match to something disliked counts against. Reasons add
// weight: a rating someone explained is a clearer signal than one they didn't.
//
// Genre labels are blunt ("Comedy" can't tell a sitcom from Nathan for You), so two things temper them:
// a label shared by many of the person's ratings counts for less than a rare one, and the final order
// blends this score with the order retrieval found candidates in (which comes from "related to this
// item you rated" lookups). Only one title per franchise is offered at a time.
//
// Pure and synchronous: no network, no model. Used to choose which candidates the model (or the
// no-AI fallback) sees, and which rated items to show it as evidence for each one.

const TOP_POSITIVE = 5;     // the closest liked/loved matches that count toward a candidate's score
const TOP_NEGATIVE = 3;     // the closest dislikes that count against it
const REASON_BOOST = 1.25;  // a rating with reasons is a clearer signal
const ANCHOR_BONUS = 0.15;  // found from this rated item: a small nudge, per point of its weight
const FUSION_K = 10;        // reciprocal-rank fusion constant: how much the top few places dominate

const norm = (value) => String(value ?? "").trim().toLowerCase();

// Weighted features of an item or an evidence record (records keep genres/creator under `facts`).
export function tasteFeatures(entry) {
  const type = entry?.type ?? null;
  const genres = (entry?.facts?.genres ?? entry?.genres ?? []).slice(0, 8).map(norm).filter(Boolean);
  const creator = norm(entry?.facts?.creator ?? entry?.by);
  const features = new Map();
  for (const genre of genres) features.set(`g:${genre}`, 1);
  for (const theme of contentThemesFor({ type, genres })) features.set(`t:${theme}`, 1.5);
  if (creator) features.set(`c:${creator}`, 2);
  return features;
}

// Cosine similarity of two weighted feature sets, 0..1. With `rarity`, a feature counts for its rarity
// across the person's ratings too (see featureRarity).
export function featureSimilarity(a, b, rarity = null) {
  if (!a.size || !b.size) return 0;
  const w = (key, weight) => weight * (rarity?.get(key) ?? 1);
  let dot = 0;
  for (const [key, weight] of a) if (b.has(key)) dot += w(key, weight) * w(key, b.get(key));
  if (!dot) return 0;
  const length = (features) => Math.sqrt([...features].reduce((sum, [key, weight]) => sum + w(key, weight) ** 2, 0));
  return dot / (length(a) * length(b));
}

// How rare each feature is across someone's ratings (inverse document frequency): "Comedy" on 20 of
// their shows says less about a candidate than "Mystery" on 3.
export function featureRarity(records, cache) {
  const rated = experienced(records);
  const counts = new Map();
  for (const record of rated) for (const key of featuresOf(record, cache).keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  const rarity = new Map();
  for (const [key, count] of counts) rarity.set(key, Math.log(1 + rated.length / count));
  return rarity;
}

const experienced = (records) => (records ?? []).filter((record) => record?.class === "experienced" && record.polarity);

// The rated items most like this candidate, closest first: [{ record, similarity }].
export function closestRatings(candidate, records, { polarity = 1, limit = 3, features = tasteFeatures(candidate), cache, rarity = null } = {}) {
  return experienced(records)
    .filter((record) => Math.sign(record.polarity) === Math.sign(polarity))
    .map((record) => ({ record, similarity: featureSimilarity(features, featuresOf(record, cache), rarity) }))
    .filter(({ similarity }) => similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || Math.abs(b.record.weight) - Math.abs(a.record.weight))
    .slice(0, limit);
}

function featuresOf(record, cache) {
  if (!cache) return tasteFeatures(record);
  if (!cache.has(record.ref)) cache.set(record.ref, tasteFeatures(record));
  return cache.get(record.ref);
}

const reasonFactor = (record) => ((record.refinements ?? []).length ? REASON_BOOST : 1);

// How well a candidate fits everything the person has rated. Higher is better; below zero means it
// mostly resembles things they disliked.
export function tasteScore(candidate, records, { cache, rarity = null } = {}) {
  return sumMatches(closestMatches(candidate, records, { cache, rarity }));
}

// The same score with the ratings that produced it (#1a candidate trace): the closest liked/loved and
// disliked matches, each with its similarity and contribution, and the found-from bonus. Built only when
// tracing; `score` is the same sum tasteScore returns.
export function tasteScoreParts(candidate, records, { cache, rarity = null } = {}) {
  const matches = closestMatches(candidate, records, { cache, rarity });
  const part = (match) => ({ ref: match.record.ref, itemId: match.record.itemId, title: match.record.title ?? null, similarity: match.similarity, weight: match.record.weight, contribution: contribution(match) });
  return { score: sumMatches(matches), positives: matches.positives.map(part), negatives: matches.negatives.map(part), anchorBonus: matches.anchorBonus };
}

// #1b explanation provenance (diagnostic only; used by the request trace, never by the prompt, the
// validator or the shortlist): the ratings that decided why this candidate was offered, and honest labels
// when that basis is weak. Blind testing (Nov 4) found that making the model cite this basis made
// explanations worse under genre scoring, so it is measured, not enforced.
// - Basis: the rating it was found from (when liked/loved), plus the smallest set of top positive
//   contributors that make up at least half its positive score, each with the catalog facts the two share.
// - weakBasis: every label that applies (diagnostic only; nothing is rejected or hidden for it, and a
//   citation never clears it). found-from-only and broad-only exclude each other by definition, and
//   no-positive-basis excludes both; contested can accompany any of them. positiveTotal and againstTotal
//   are returned so a label is never the only record.
//     no-positive-basis  no found-from rating and no positive match at all
//     found-from-only    found from a rated item, but nothing they rated scores it positively
//     broad-only         the deciding matches share only genre labels: the evidence supports a broad
//                        relationship, which says nothing about whether the pick is good
//     contested          dislikes weigh at least half as much as the positives, or weigh against it at
//                        all when nothing positive does (people can still enjoy such titles; it is a
//                        threshold for evaluation, not a verdict)
export function selectionBasis(candidate, records, { cache, rarity = null } = {}) {
  const features = tasteFeatures(candidate);
  const { positives, negatives } = closestMatches(candidate, records, { cache, rarity });
  const anchor = candidate?.relatedToId ? experienced(records).find((record) => record.itemId === candidate.relatedToId && record.polarity > 0) : null;
  const shares = (record) => [...features.keys()].filter((key) => featuresOf(record, cache).has(key)).map(factLabel);
  const positiveTotal = positives.reduce((sum, match) => sum + contribution(match), 0);
  const decisive = [];
  let covered = 0;
  for (const match of [...positives].sort((a, b) => contribution(b) - contribution(a))) {
    if (covered >= positiveTotal / 2) break;
    decisive.push(match.record);
    covered += contribution(match);
  }
  const rows = [
    ...(anchor ? [{ ref: anchor.ref, title: anchor.title ?? null, role: "found-from", shares: shares(anchor) }] : []),
    ...decisive.filter((record) => record !== anchor).map((record) => ({ ref: record.ref, title: record.title ?? null, role: "scored", shares: shares(record) }))
  ];
  const againstTotal = -negatives.reduce((sum, match) => sum + contribution(match), 0);
  const contested = againstTotal > 0 && againstTotal >= positiveTotal / 2;
  const scoredKeys = decisive.flatMap((record) => [...features.keys()].filter((key) => featuresOf(record, cache).has(key)));
  const weakBasis = [
    ...(!rows.length ? ["no-positive-basis"] : []),
    ...(anchor && !decisive.length ? ["found-from-only"] : []),
    ...(!anchor && decisive.length && scoredKeys.every((key) => key.startsWith("g:")) ? ["broad-only"] : []),
    ...(contested ? ["contested"] : [])
  ];
  return {
    refs: rows.map((row) => row.ref),
    rows,
    against: negatives.map((match) => ({ ref: match.record.ref, title: match.record.title ?? null })),
    contested,
    weakBasis,
    positiveTotal,
    againstTotal
  };
}

// A shared feature as a reader would name it: TMDb genre ids become names ("27" -> "Horror").
function factLabel(key) {
  const [kind, value] = [key.slice(0, 1), key.slice(2)];
  if (kind === "g") return TMDB_GENRES[value] ?? value;
  return value;
}

const contribution = ({ record, similarity }) => similarity * record.weight * reasonFactor(record);

function closestMatches(candidate, records, { cache, rarity }) {
  const features = tasteFeatures(candidate);
  const positives = closestRatings(candidate, records, { polarity: 1, limit: TOP_POSITIVE, features, cache, rarity });
  const negatives = closestRatings(candidate, records, { polarity: -1, limit: TOP_NEGATIVE, features, cache, rarity });
  const anchor = candidate?.relatedToId ? experienced(records).find((record) => record.itemId === candidate.relatedToId) : null;
  return { positives, negatives, anchorBonus: anchor && anchor.polarity > 0 ? ANCHOR_BONUS * anchor.weight : 0 };
}

const sumMatches = ({ positives, negatives, anchorBonus }) => positives.reduce((sum, match) => sum + contribution(match), 0)
  + negatives.reduce((sum, match) => sum + contribution(match), 0)
  + anchorBonus;

const MIXED_DOMAINS = ["movies", "tv", "read", "play"];
const primaryDomain = (item) => MIXED_DOMAINS.find((domain) => item?.domains?.includes(domain)) ?? "other";

// Was this candidate found from something the person Liked (not Loved)? Those are the edges of their
// taste, where a good surprise comes from.
export function isEdgeCandidate(candidate, records) {
  const anchor = candidate?.relatedToId ? experienced(records).find((record) => record.itemId === candidate.relatedToId) : null;
  return anchor?.kind === "experienced-positive";
}

// Choose `count` candidates by taste instead of taking the first ones retrieval returned.
// - Order: reciprocal-rank fusion of the taste score's rank and retrieval's own order, so a strong
//   "related to something you rated" result isn't overruled by a blunt genre match, and vice versa.
//   Anything that mostly resembles dislikes (score below zero) goes last.
// - "All": types take turns (in the order of their best candidate), keeping the set mixed.
// - One title per franchise.
// - With a surprise slot, the last place goes to the best candidate found from a Liked item, if any,
//   and it is marked `edge: true`.
// - With `trace` (an object, eval/dev only), trace.candidates gets one entry per candidate: its score
//   parts, ranks and outcome (chosen, edge, same-franchise, count-reached, scored-below-zero). The
//   return value is the same either way.
export function chooseCandidates(candidates, records, { count = 6, mode = "all", curveball = false, trace = null } = {}) {
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  const scored = candidates.map((item, index) => {
    if (!trace) return { item, index, score: tasteScore(item, records, { cache, rarity }) };
    const parts = tasteScoreParts(item, records, { cache, rarity });
    return { item, index, score: parts.score, parts };
  });
  const byTaste = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  byTaste.forEach((entry, rank) => { entry.fused = 1 / (FUSION_K + rank) + 1 / (FUSION_K + entry.index); });
  const ordered = [...scored].sort((a, b) => (b.score >= 0) - (a.score >= 0) || b.fused - a.fused || a.index - b.index);

  const chosen = [];
  const blocked = new Set();
  const sameFranchise = (entry) => chosen.some((other) => isFranchiseContinuation(entry.item, other.item) || isFranchiseContinuation(other.item, entry.item));
  const take = (entry) => {
    if (!entry || chosen.includes(entry)) return;
    if (sameFranchise(entry)) blocked.add(entry);
    else chosen.push(entry);
  };

  const edge = curveball ? ordered.find(({ item, score }) => score >= 0 && isEdgeCandidate(item, records)) : null;
  const mainCount = edge ? count - 1 : count;
  const pool = ordered.filter((entry) => entry !== edge);

  if (mode === "all") {
    const buckets = new Map();
    for (const entry of pool) {
      const domain = primaryDomain(entry.item);
      if (!buckets.has(domain)) buckets.set(domain, []);
      buckets.get(domain).push(entry);
    }
    const turns = [...buckets.values()];   // already in order of each type's best candidate
    const next = turns.map(() => 0);
    while (chosen.length < mainCount && turns.some((bucket, i) => next[i] < bucket.length)) {
      turns.forEach((bucket, i) => {
        if (chosen.length >= mainCount) return;
        while (next[i] < bucket.length) {
          const entry = bucket[next[i]++];
          const before = chosen.length;
          take(entry);
          if (chosen.length > before) break;
        }
      });
    }
  } else {
    for (const entry of pool) { if (chosen.length >= mainCount) break; take(entry); }
  }
  const edgeTaken = Boolean(edge && !sameFranchise(edge));
  if (edge && !edgeTaken) blocked.add(edge);
  if (edgeTaken) chosen.push({ ...edge, isEdge: true });
  if (trace) trace.candidates = traceCandidates({ scored, ordered, chosen, blocked, edge: edgeTaken ? edge : null });
  return chosen.map(({ item, score, isEdge }) => ({ ...item, tasteScore: round(score), ...(isEdge ? { edge: true } : {}) }));
}

// One trace entry per candidate, in retrieval order. Outcomes:
//   chosen / edge         offered (edge = the surprise slot)
//   same-franchise        reached, but another title from its franchise was already offered
//   scored-below-zero     not reached; mostly resembles dislikes, so it was ordered last
//   count-reached         not reached before the set was full
function traceCandidates({ scored, ordered, chosen, blocked, edge }) {
  const chosenIndex = new Set(chosen.filter((entry) => !entry.isEdge).map((entry) => entry.index));
  const tasteRank = new Map([...scored].sort((a, b) => b.score - a.score || a.index - b.index).map((entry, rank) => [entry.index, rank]));
  const orderRank = new Map(ordered.map((entry, rank) => [entry.index, rank]));
  const outcome = (entry) => (edge && entry.index === edge.index ? "edge"
    : chosenIndex.has(entry.index) ? "chosen"
      : blocked.has(entry) ? "same-franchise"
        : entry.score < 0 ? "scored-below-zero" : "count-reached");
  return scored.map((entry) => ({
    itemId: entry.item.id,
    title: entry.item.title ?? null,
    medium: primaryDomain(entry.item),
    provider: String(entry.item.id ?? "").split("-")[0] || null,
    retrievalIndex: entry.index,
    relatedToId: entry.item.relatedToId ?? null,
    relatedTo: entry.item.relatedTo ?? null,
    score: entry.score,
    tasteRank: tasteRank.get(entry.index),
    fused: entry.fused,
    order: orderRank.get(entry.index),
    positives: entry.parts.positives,
    negatives: entry.parts.negatives,
    anchorBonus: entry.parts.anchorBonus,
    outcome: outcome(entry)
  }));
}

const round = (value) => Math.round(value * 1000) / 1000;
