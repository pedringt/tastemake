// Correction-aware ranking eval: the prototype ranking, isolated here and never wired into production.
//
// Baseline = production's own chooseCandidates (src/ai/taste-score.js). The prototype is a copy of its
// selection step that takes a score function, so only the score changes. scripts/qa/correction-eval-tests.mjs
// checks that the copy, given production's score, returns exactly what production returns on every case
// and round, so the two cannot silently drift.
//
// How a correction changes a score (prototype only):
//   A candidate's score is the sum of contributions from the rated items most like it (top 5 positives,
//   top 3 negatives), plus a small bonus for the item it was found from (its anchor). A pattern's stored
//   supports are rated items, so a correction scales the contribution of the positive items that support
//   the corrected pattern. Negatives are never scaled. Ambiguous answers scale nothing.
// Safeguards (each can be switched on):
//   split      an item that supports k patterns passes each pattern's factor through 1/k of its weight
//              (mean of the k factors) instead of taking every factor in full (their product);
//   anchorOff  the "found from" bonus keeps its uncorrected weight;
//   floor      a correction never lowers a candidate below `floor` times its uncorrected score.
//
// Structural options (round 2, chooseWith). Both act only on rejections ("not me", an excluded area),
// through `lowered(item)`: how much a rejection cut that title's score (rejected / uncorrected, at most 1).
// A title no rejection touches has lowered = 1, so with no rejection both leave production's order exactly.
//   retrievalWeight(item)  scales the title's retrieval-order term in the fused ranking (production: 1).
//                          "local" = lowered(item); "global" = 0.5 for every title while any rejection applies.
//   yieldTurn              in "All", when a medium's next title was cut by a rejection (lowered <= 0.9), its
//                          turn goes to another medium's title that was not cut and scores at least `margin`
//                          times higher. "second": only a medium that already has a title in the six yields
//                          (every medium stays). "one-medium": a first turn may yield too, once per set.

import { closestRatings, featureRarity, featureSimilarity, isEdgeCandidate, tasteFeatures } from "../../../src/ai/taste-score.js";
import { isFranchiseContinuation } from "../../../src/catalog/novelty.mjs";

// Mirrors of taste-score.js constants (the parity test fails if they drift).
const TOP_POSITIVE = 5;
const TOP_NEGATIVE = 3;
const REASON_BOOST = 1.25;
const ANCHOR_BONUS = 0.15;
const FUSION_K = 10;
const MIXED_DOMAINS = ["movies", "tv", "read", "play"];

export const primaryDomain = (item) => MIXED_DOMAINS.find((domain) => item?.domains?.includes(domain)) ?? "other";
const experienced = (records) => (records ?? []).filter((record) => record?.class === "experienced" && record.polarity);
// Parity with taste-score.js since #322 (4dc360e): reasons boost liked/loved ratings only, never a dislike.
const reasonFactor = (record) => (record.polarity > 0 && (record.refinements ?? []).length ? REASON_BOOST : 1);
const round3 = (value) => Math.round(value * 1000) / 1000;

// ---- Stand-in retrieval anchors -----------------------------------------------------------------------
// Fixed pools carry no "found from" item. Production picks up to 8 anchors (Loved and favorites first, two
// passes over the media, plus one Liked item for Surprise Me) and every candidate comes from one of them.
// Here each candidate is given the anchor most like it, same medium first. An approximation: real
// provider "related" lookups are not feature similarity.
const anchorStrength = (record) => (record.kind === "experienced-positive" ? 1 : 3);

export function anchorSet(records) {
  const positives = experienced(records).filter((r) => r.polarity > 0);
  const byDomain = new Map(MIXED_DOMAINS.map((d) => [d, []]));
  for (const r of [...positives].sort((a, b) => anchorStrength(b) - anchorStrength(a))) byDomain.get(primaryDomain(r))?.push(r);
  const chosen = [];
  for (let depth = 0; depth < 2 && chosen.length < 8; depth += 1) {
    for (const d of MIXED_DOMAINS) {
      const r = byDomain.get(d)[depth];
      if (r && chosen.length < 8) chosen.push(r);
    }
  }
  if (!chosen.slice(0, 4).some((r) => anchorStrength(r) === 1)) {
    const domains = new Set(chosen.map(primaryDomain));
    const edge = positives.find((r) => anchorStrength(r) === 1 && !chosen.includes(r) && domains.has(primaryDomain(r)));
    if (edge) chosen.splice(Math.min(3, chosen.length), 0, edge);
  }
  return chosen;
}

export function withAnchors(pool, records) {
  const anchors = anchorSet(records).map((r) => ({ r, f: tasteFeatures(r) }));
  return pool.map((item) => {
    const f = tasteFeatures(item);
    let best = null;
    let bestScore = 0;
    for (const { r, f: rf } of anchors) {
      const score = featureSimilarity(f, rf) + (primaryDomain(r) === primaryDomain(item) ? 1 : 0);
      if (score > bestScore) { best = r; bestScore = score; }
    }
    return best ? { ...item, relatedTo: best.title, relatedToId: best.itemId } : { ...item };
  });
}

// ---- Score parts ----------------------------------------------------------------------------------------
// The same arithmetic as tasteScore, kept as parts so corrections and attribution can see each item's share.
export function scoreParts(candidate, records, { cache, rarity }) {
  const features = tasteFeatures(candidate);
  const part = ({ record, similarity }) => ({ record, similarity, value: similarity * record.weight * reasonFactor(record) });
  const positives = closestRatings(candidate, records, { polarity: 1, limit: TOP_POSITIVE, features, cache, rarity }).map(part);
  const negatives = closestRatings(candidate, records, { polarity: -1, limit: TOP_NEGATIVE, features, cache, rarity }).map(part);
  const anchorRecord = candidate?.relatedToId ? experienced(records).find((r) => r.itemId === candidate.relatedToId) : null;
  const anchor = anchorRecord && anchorRecord.polarity > 0 ? { record: anchorRecord, value: ANCHOR_BONUS * anchorRecord.weight } : null;
  return { positives, negatives, anchor };
}

export const partsTotal = ({ positives, negatives, anchor }) =>
  positives.reduce((s, p) => s + p.value, 0) + negatives.reduce((s, p) => s + p.value, 0) + (anchor?.value ?? 0);

// Share of a candidate's positive score (positives + anchor bonus) that comes from items in `refs`.
export function attribution(parts, refs) {
  const total = parts.positives.reduce((s, p) => s + p.value, 0) + (parts.anchor?.value ?? 0);
  if (total <= 0 || !refs?.size) return 0;
  const from = parts.positives.filter((p) => refs.has(p.record.ref)).reduce((s, p) => s + p.value, 0)
    + (parts.anchor && refs.has(parts.anchor.record.ref) ? parts.anchor.value : 0);
  return from / total;
}

// ---- Corrections ------------------------------------------------------------------------------------------
// What each statement does to its pattern, for a candidate in `domain`. Only explicit answers act:
// "not me", "important" / "not important" (after "accurate"), and an excluded area. "Partly" with no
// excluded area, "not sure" and "depends on context" are ambiguous and return 1.
export function patternFactor(statement, domain, strength) {
  if (!statement) return 1;
  if (statement.says === "not-me") return strength.notMe;
  if (statement.says === "accurate" && statement.weight === "lot") return strength.lot;
  if (statement.says === "accurate" && statement.weight === "little") return strength.little;
  if (statement.says === "partial" && (statement.excludedDomains ?? []).includes(domain)) return strength.notMe;
  return 1;
}

// Returns score(candidate) for the prototype. `patterns` carry `supports` (stored) unless the arm asks
// for `trueSupports` (the oracle arm: what ranking would do if every support were right).
export function correctedScorer(records, patterns, statements, { strength, split = false, anchorOff = false, floor = null, supportsKey = "supports" }) {
  const byPattern = new Map(statements.map((s) => [s.hypothesisId, s]));
  const patternsOf = new Map();
  for (const p of patterns) for (const ref of p[supportsKey] ?? []) {
    if (!patternsOf.has(ref)) patternsOf.set(ref, []);
    patternsOf.get(ref).push(p.id);
  }
  const multiplier = (ref, domain) => {
    const ids = patternsOf.get(ref);
    if (!ids?.length) return 1;
    const factors = ids.map((id) => patternFactor(byPattern.get(id), domain, strength));
    return split ? factors.reduce((s, f) => s + f, 0) / factors.length : factors.reduce((s, f) => s * f, 1);
  };
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  return (candidate) => {
    const parts = scoreParts(candidate, records, { cache, rarity });
    const base = partsTotal(parts);
    if (!statements.length) return base;
    const domain = primaryDomain(candidate);
    const positives = parts.positives.reduce((s, p) => s + p.value * multiplier(p.record.ref, domain), 0);
    const negatives = parts.negatives.reduce((s, p) => s + p.value, 0);
    const anchor = parts.anchor ? parts.anchor.value * (anchorOff ? 1 : multiplier(parts.anchor.record.ref, domain)) : 0;
    let score = positives + negatives + anchor;
    if (floor != null && base > 0 && score < floor * base) score = floor * base;
    return score;
  };
}

// Production's score, through the same parts (used by the parity test and as the baseline scorer).
export function productionScorer(records) {
  const cache = new Map();
  const rarity = featureRarity(records, cache);
  return (candidate) => partsTotal(scoreParts(candidate, records, { cache, rarity }));
}

// ---- Selection: a copy of chooseCandidates with the score injected ------------------------------------------
// Returns the chosen items (production's shape) and the full fused order (for rank-movement metrics).
export function chooseWith(candidates, records, score, { count = 6, mode = "all", curveball = false, retrievalWeight = null, yieldTurn = null, edgePick = null } = {}) {
  const scored = candidates.map((item, index) => ({ item, index, score: score(item) }));
  const byTaste = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  byTaste.forEach((entry, rank) => { entry.fused = 1 / (FUSION_K + rank) + (retrievalWeight ? retrievalWeight(entry.item) : 1) / (FUSION_K + entry.index); });
  const ordered = [...scored].sort((a, b) => (b.score >= 0) - (a.score >= 0) || b.fused - a.fused || a.index - b.index);

  const chosen = [];
  const sameFranchise = (entry) => chosen.some((other) => isFranchiseContinuation(entry.item, other.item) || isFranchiseContinuation(other.item, entry.item));
  const take = (entry) => { if (entry && !chosen.includes(entry) && !sameFranchise(entry)) chosen.push(entry); };

  // Round 3 only: `edgePick(ordered)` may choose the Surprise slot instead (see surpriseAlternatives below).
  const edge = curveball ? (edgePick ? edgePick(ordered) : ordered.find(({ item, score: s }) => s >= 0 && isEdgeCandidate(item, records))) : null;
  const mainCount = edge ? count - 1 : count;
  // Round 4: titles marked surpriseOnly (the Surprise bridge row) can fill only the Surprise slot.
  const pool = ordered.filter((entry) => entry !== edge && !entry.item.surpriseOnly);
  let yields = 0, firstYields = 0;

  if (mode === "all") {
    const buckets = new Map();
    for (const entry of pool) {
      const domain = primaryDomain(entry.item);
      if (!buckets.has(domain)) buckets.set(domain, []);
      buckets.get(domain).push(entry);
    }
    const turns = [...buckets.values()];
    const next = turns.map(() => 0);
    const bucketOf = new Map(turns.flatMap((bucket, i) => bucket.map((entry) => [entry, i])));
    // Round 2 only: hand this turn to a better-fitting title from another medium (see yieldTurn above).
    const yielded = (entry, i) => {
      if (!yieldTurn || chosen.includes(entry) || sameFranchise(entry) || !yieldTurn.hit(entry.item)) return false;
      const first = !chosen.some((c) => bucketOf.get(c) === i);
      if (first && !(yieldTurn.allowFirst && firstYields < 1)) return false;
      const alt = pool.find((o) => bucketOf.get(o) !== i && !chosen.includes(o) && !sameFranchise(o) && !yieldTurn.hit(o.item) && o.score >= 0 && o.score >= yieldTurn.margin * entry.score);
      if (!alt) return false;
      chosen.push(alt);
      yields += 1;
      if (first) firstYields += 1;
      return true;
    };
    while (chosen.length < mainCount && turns.some((bucket, i) => next[i] < bucket.length)) {
      turns.forEach((bucket, i) => {
        if (chosen.length >= mainCount) return;
        while (next[i] < bucket.length) {
          // A yielded title stays in its medium's queue: it can still fill a later slot if nothing better is left.
          if (yielded(bucket[next[i]], i)) break;
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
  return {
    yields, firstYields,
    chosen: chosen.map(({ item, score: s, isEdge }) => ({ ...item, tasteScore: round3(s), ...(isEdge ? { edge: true } : {}) })),
    order: ordered.map(({ item }) => item.id)
  };
}

// ---- An arm's selection -------------------------------------------------------------------------------------
const memo = (fn) => {
  const seen = new Map();
  return (item) => {
    if (!seen.has(item.id)) seen.set(item.id, fn(item));
    return seen.get(item.id);
  };
};
export const rejects = (s) => s.says === "not-me" || (s.says === "partial" && (s.excludedDomains ?? []).length > 0);
export const YIELD_MARGIN = 1.1;
export const LOWERED_HIT = 0.9;

// The arm's score, its six, and `lowered` (structural options above). Round-1 arms have no structural
// options and get exactly round 1's selection.
// `extraCut(item)` (round 4): titles the Surprise slot also skips, e.g. the rejected kind by catalog labels.
export function armSelection(records, candidates, patterns, statements, arm, { mode = "all", curveball = false, extraCut = null } = {}) {
  if (arm.select === "production") {
    const scorer = memo(productionScorer(records));
    let edgePick = null;
    if (arm.surprise && statements.some(rejects)) {
      // Production's ranking, but the Surprise slot skips titles a rejection cut (supports, as A measures it,
      // or the label rule) and falls back to the least familiar uncut title.
      const base = productionScorer(records);
      const rejectOnly = correctedScorer(records, patterns, statements, { strength: { notMe: 0.75, lot: 1, little: 1 }, split: true, anchorOff: true, supportsKey: arm.supportsKey });
      const lowered = memo((item) => { const b = base(item); return b > 0 ? Math.min(1, rejectOnly(item) / b) : 1; });
      edgePick = surpriseAlternatives(records, (item) => lowered(item) <= LOWERED_HIT || Boolean(extraCut?.(item)), { hadEdge: arm.hadEdge });
    }
    return { scorer, proto: chooseWith(candidates, records, scorer, { count: 6, mode, curveball, edgePick }), lowered: () => 1 };
  }
  const scorer = memo(correctedScorer(records, patterns, statements, arm));
  let retrievalWeight = null, yieldTurn = null, lowered = () => 1;
  if (arm.retrieval || arm.yieldTurn) {
    const base = productionScorer(records);
    const rejectOnly = correctedScorer(records, patterns, statements, { ...arm, strength: { ...arm.strength, lot: 1, little: 1 } });
    lowered = memo((item) => { const b = base(item); return b > 0 ? Math.min(1, rejectOnly(item) / b) : 1; });
    if (arm.retrieval === "local") retrievalWeight = lowered;
    if (arm.retrieval === "global" && statements.some(rejects)) retrievalWeight = () => 0.5;
    if (arm.yieldTurn) yieldTurn = { hit: (item) => lowered(item) <= LOWERED_HIT, allowFirst: arm.yieldTurn === "one-medium", margin: YIELD_MARGIN };
  }
  const edgePick = arm.surprise && statements.some(rejects) ? surpriseAlternatives(records, (item) => lowered(item) <= LOWERED_HIT || Boolean(extraCut?.(item)), { hadEdge: arm.hadEdge }) : null;
  const proto = chooseWith(candidates, records, scorer, { count: 6, mode, curveball, retrievalWeight, yieldTurn, edgePick });
  return { scorer, proto, lowered };
}

// Round 3, Surprise alternatives (only while a rejection applies): the Surprise slot skips titles a rejection
// cut (`cut(item)`: lowered <= 0.9 in round 3) and takes the next one found from a Liked rating. If none is left and production would
// have offered a Surprise (`hadEdge`), it takes the least familiar title (lowest similarity to any positive
// rating) among the upper half of the order that no rejection cut, so the slot isn't lost. No rejection: unused.
export function surpriseAlternatives(records, cut, { hadEdge = true } = {}) {
  const positives = experienced(records).filter((r) => r.polarity > 0);
  const familiarity = memo((item) => {
    const f = tasteFeatures(item);
    return Math.max(0, ...positives.map((r) => featureSimilarity(f, tasteFeatures(r))));
  });
  return (ordered) => {
    const edge = ordered.find(({ item, score }) => score >= 0 && isEdgeCandidate(item, records) && !cut(item));
    if (edge || !hadEdge) return edge ?? null;
    const upper = ordered.slice(0, Math.ceil(ordered.length / 2)).filter(({ item, score }) => score >= 0 && !cut(item));
    return upper.reduce((best, e) => (!best || familiarity(e.item) < familiarity(best.item) ? e : best), null);
  };
}
