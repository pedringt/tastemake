import { contentThemesFor } from "../model/refinements.js";
import { isFranchiseContinuation } from "../catalog/novelty.mjs";

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
  const features = tasteFeatures(candidate);
  const contribution = ({ record, similarity }) => similarity * record.weight * reasonFactor(record);
  const positives = closestRatings(candidate, records, { polarity: 1, limit: TOP_POSITIVE, features, cache, rarity });
  const negatives = closestRatings(candidate, records, { polarity: -1, limit: TOP_NEGATIVE, features, cache, rarity });
  const anchor = candidate?.relatedToId ? experienced(records).find((record) => record.itemId === candidate.relatedToId) : null;
  return positives.reduce((sum, match) => sum + contribution(match), 0)
    + negatives.reduce((sum, match) => sum + contribution(match), 0)
    + (anchor && anchor.polarity > 0 ? ANCHOR_BONUS * anchor.weight : 0);
}

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
export function chooseCandidates(candidates, records, { count = 6, mode = "all", curveball = false } = {}) {
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  const scored = candidates.map((item, index) => ({ item, index, score: tasteScore(item, records, { cache, rarity }) }));
  const byTaste = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  byTaste.forEach((entry, rank) => { entry.fused = 1 / (FUSION_K + rank) + 1 / (FUSION_K + entry.index); });
  const ordered = [...scored].sort((a, b) => (b.score >= 0) - (a.score >= 0) || b.fused - a.fused || a.index - b.index);

  const chosen = [];
  const sameFranchise = (entry) => chosen.some((other) => isFranchiseContinuation(entry.item, other.item) || isFranchiseContinuation(other.item, entry.item));
  const take = (entry) => { if (entry && !chosen.includes(entry) && !sameFranchise(entry)) chosen.push(entry); };

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
  if (edge && !sameFranchise(edge)) chosen.push({ ...edge, isEdge: true });
  return chosen.map(({ item, score, isEdge }) => ({ ...item, tasteScore: round(score), ...(isEdge ? { edge: true } : {}) }));
}

const round = (value) => Math.round(value * 1000) / 1000;
