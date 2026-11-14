// Correction eval, round 3: a stand-in for production retrieval, so replacement retrieval can be compared
// offline. Never wired into production; no network.
//
// What is mirrored from src/catalog/related.mjs (retrieveCatalogCandidates):
//   - anchors come from favorites and Loved/Liked ratings (externalEvidenceItems / positiveAnchorStrength),
//     in a weighted random order (weightedOrder, imported; the random source is seeded here), Loved three
//     times as likely as Liked to come early, reasons add one;
//   - "All": up to 8 anchors, every medium once before any medium twice (selectAllAnchors, copied);
//   - Surprise on: a Liked anchor is moved into the first four (withEdgeAnchor, imported);
//   - a first wave of four anchors; the rest only when the pool is under 12 or a medium of the anchors is
//     missing; then one unused anchor per still-missing medium;
//   - everything already rated, saved or shown is blocked; results interleave by anchor, then by medium
//     (balanceDomains), and the first 30 are the pool.
// What is a stand-in:
//   - "related to an anchor" is the 12 snapshot titles of the anchor's medium most like it by Tastemake's own
//     features (genres, themes, creator). Open Library subject search and IGDB genre overlap work roughly
//     this way; TMDb's recommendations endpoint does not (it is behavioral), so film and TV results here are
//     an approximation;
//   - the novelty guard and series checks are skipped (selection's one-title-per-franchise rule remains);
//   - the catalog is the 1,134-title snapshot, not the providers' full catalogs.
//
// Replacement retrieval (round 3 options; both act only when a rejection applies):
//   swap  an anchor whose rating supports only rejected patterns (and no confirmed one) is not used; the next
//         rating of the same medium takes its place. If the medium has no other rating, it stays, so no
//         medium loses its anchor.
//   add   anchors stay as they are; for each such anchor, the next usable rating of the same medium is added
//         to the first wave (more provider calls, made in parallel: no extra round trip).
//   surpriseAnchor  when the Surprise anchor (Liked) supports only rejected patterns, another Liked rating
//         that doesn't is added to the first wave.
// Round 4 options (all off by default; see patterns.mjs for the rules the caller passes in):
//   avoid(item)   what a replacement anchor must not be (default: `rejected`);
//   reorder(item) titles of the rejected kind go behind the others in retrieval order (the pool keeps them);
//   discovery     Map(medium -> shelves): independent same-medium rows, one browse call per shelf, not tied
//                 to any rating (stand-in: that snapshot shelf in a fixed pseudo-random order, 12 per shelf).
//                 Supplementary: only for a medium with fewer than 3 titles left that aren't the rejected kind
//                 after the anchors' first wave, and placed after the anchors' titles (they fill gaps, they
//                 don't displace). It joins the second wave if there is one, otherwise it is an extra wave;
//   bridge        { anchor, domain, shelf }: one cross-medium row found from a Liked rating (production's #252
//                 bridge), in the first wave. Its titles are marked surpriseOnly: they can fill only the
//                 Surprise slot (chooseWith), so Surprise has a novelty source the rejection doesn't touch.

import { weightedOrder, withEdgeAnchor } from "../../../src/catalog/related.mjs";
import { featureSimilarity, tasteFeatures } from "../../../src/ai/taste-score.js";
import { mulberry32 } from "../stress/profiles.mjs";
import { primaryDomain } from "./rank.mjs";

export const RELATED_PER_ANCHOR = 12;
export const POOL_LIMIT = 30;
const FIRST_WAVE = 4;
const MIXED_DOMAINS = ["movies", "tv", "read", "play"];

const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
export const seedFor = (...parts) => hash(parts.join("|"));

function positiveAnchorStrength(feedback) {
  if (!feedback) return 0;
  if (feedback.rating === "more" && feedback.detail === "loved-before") return 3;
  if (feedback.rating === "more" && feedback.detail === "liked-before") return 1;
  return 0;
}

// externalEvidenceItems, for the state shapes the fixtures build.
export function evidenceItems(state) {
  const strength = new Map();
  for (const id of state.selectedFavorites ?? []) strength.set(id, 3);
  for (const [id, feedback] of Object.entries(state.feedbackByRecommendation ?? {})) {
    const s = positiveAnchorStrength(feedback);
    if (s > 0) strength.set(id, Math.max(strength.get(id) ?? 0, s));
  }
  const byId = new Map();
  for (const item of Object.values(state.customItems ?? {})) if (item?.provider) byId.set(item.id, item);
  for (const feedback of Object.values(state.feedbackByRecommendation ?? {})) {
    if (feedback?.item?.provider && !byId.has(feedback.item.id)) byId.set(feedback.item.id, feedback.item);
  }
  return [...strength.entries()].map(([id, anchorStrength]) => {
    const item = byId.get(id);
    return item ? { ...item, anchorStrength, hasReasons: (state.feedbackByRecommendation?.[id]?.refinements ?? []).length > 0 } : null;
  }).filter(Boolean);
}

function selectAllAnchors(items, max = 8) {
  const buckets = new Map(MIXED_DOMAINS.map((d) => [d, []]));
  for (const item of items) if (buckets.has(primaryDomain(item))) buckets.get(primaryDomain(item)).push(item);
  const selected = [];
  for (let depth = 0; depth < 2 && selected.length < max; depth += 1) {
    for (const d of MIXED_DOMAINS) {
      const item = buckets.get(d)?.[depth];
      if (item) selected.push(item);
      if (selected.length >= max) break;
    }
  }
  return selected;
}

function interleave(rows) {
  const out = [];
  const depth = Math.max(0, ...rows.map((r) => r.length));
  for (let i = 0; i < depth; i += 1) for (const r of rows) if (r[i]) out.push(r[i]);
  return out;
}

const balanceDomains = (items) => {
  const buckets = new Map([...MIXED_DOMAINS, "other"].map((d) => [d, []]));
  for (const item of items) buckets.get(primaryDomain(item)).push(item);
  return interleave([...buckets.values()].filter((b) => b.length));
};

// The catalog the stand-in searches: snapshot items by medium, features computed once.
export function catalogIndex(snapshotItems) {
  const byDomain = new Map(MIXED_DOMAINS.map((d) => [d, []]));
  const byShelf = new Map();
  for (const item of snapshotItems) {
    const { _bucket, ...clean } = item;
    byDomain.get(primaryDomain(clean))?.push({ item: clean, features: tasteFeatures(clean) });
    for (const shelf of _bucket ?? []) {
      if (!byShelf.has(shelf)) byShelf.set(shelf, []);
      byShelf.get(shelf).push(clean);
    }
  }
  for (const [shelf, list] of byShelf) list.sort((a, b) => hash(`${shelf}|${a.id}`) - hash(`${shelf}|${b.id}`));
  return { byDomain, byShelf, related: new Map() };
}

function relatedTo(anchor, index) {
  if (!index.related.has(anchor.id)) {
    const f = tasteFeatures(anchor);
    const list = (index.byDomain.get(primaryDomain(anchor)) ?? [])
      .filter(({ item }) => item.id !== anchor.id && item.title.toLowerCase() !== String(anchor.title).toLowerCase())
      .map(({ item, features }) => ({ item, s: featureSimilarity(f, features), tie: hash(`${anchor.id}|${item.id}`) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s || a.tie - b.tie)
      .map(({ item }) => item);
    index.related.set(anchor.id, list);
  }
  return index.related.get(anchor.id);
}

// The stand-in's "related" list for one anchor (the live check compares it with the real provider's).
export const standInRelated = (anchor, index, n = RELATED_PER_ANCHOR) => relatedTo(anchor, index).slice(0, n);

// The pool for one request. `rejected(item)` is true for an evidence item whose rating supports only
// rejected patterns (computed by the caller from the scenario's statements); it is never called when
// no rejection applies, so every option is then exactly the current retrieval.
export function retrieve(state, index, { seed, mode = "current", surpriseAnchor = false, rejected = null, avoid = null, reorder = null, discovery = null, bridge = null } = {}) {
  const blockedIds = new Set([
    ...Object.keys(state.feedbackByRecommendation ?? {}), ...(state.selectedFavorites ?? []), ...(state.libraryFavorites ?? []),
    ...Object.keys(state.customItems ?? {}), ...(state.recommendationSets ?? []).flat().map((e) => (typeof e === "string" ? e : e?.id))
  ]);
  const all = weightedOrder(evidenceItems(state), (item) => (item.anchorStrength ?? 0) + (item.hasReasons ? 1 : 0), mulberry32(seed));
  const blockedTitles = new Set(all.map((i) => String(i.title).toLowerCase()));
  const acting = Boolean(rejected) && (mode !== "current" || surpriseAnchor);
  const isRejected = (item) => Boolean(rejected) && rejected(item);
  const unusable = (o) => (avoid ? avoid(o) : isRejected(o));
  const sameMediumUsable = (item, exclude) => all.find((o) => o !== item && !exclude.has(o.id) && !unusable(o) && primaryDomain(o) === primaryDomain(item));

  let usable = all;
  if (acting && mode === "swap" && !avoid) usable = all.filter((item) => !isRejected(item) || !sameMediumUsable(item, new Set()));
  // Round 4 (with `avoid`): a dropped anchor's place goes to the first rating of the same medium that isn't to
  // be avoided, not simply to the next rating in order (which may be the rejected kind too).
  if (acting && mode === "swap" && avoid) {
    usable = [];
    const used = new Set();
    for (const item of all) {
      if (used.has(item.id)) continue;
      const replacement = isRejected(item) ? sameMediumUsable(item, used) : null;
      const chosen = replacement ?? item;
      usable.push(chosen);
      used.add(chosen.id);
      if (replacement) used.add(item.id);
    }
  }
  let anchors = selectAllAnchors(usable);
  if (state.curveball !== false) anchors = withEdgeAnchor(anchors, usable);
  const extras = [];
  const taken = () => new Set([...anchors, ...extras].map((a) => a.id));
  if (acting && mode === "add") {
    for (const a of anchors) {
      if (!isRejected(a)) continue;
      const next = sameMediumUsable(a, taken());
      if (next) extras.push(next);
    }
  }
  if (acting && surpriseAnchor) {
    const edge = anchors.find((a) => a.anchorStrength === 1);
    if (edge && isRejected(edge)) {
      const alt = all.find((o) => o.anchorStrength === 1 && !isRejected(o) && !taken().has(o.id) && primaryDomain(o) === primaryDomain(edge))
        ?? all.find((o) => o.anchorStrength === 1 && !isRejected(o) && !taken().has(o.id));
      if (alt) extras.push(alt);
    }
  }

  const open = (item) => !blockedIds.has(item.id) && !blockedTitles.has(item.title.toLowerCase());
  const query = (list) => list.map((anchor) => relatedTo(anchor, index)
    .filter(open)
    .slice(0, RELATED_PER_ANCHOR)
    .map((item) => ({ ...item, relatedTo: anchor.title, relatedToId: anchor.id })));
  // Round 4: rows that don't come from an anchor's "related" lookup (one provider call each).
  const shelf = (d, id) => (index.byShelf.get(`${d}:${id}`) ?? []).filter(open).slice(0, RELATED_PER_ANCHOR);
  const bridgeRow = bridge ? shelf(bridge.domain, bridge.shelf).map((item) => ({ ...item, relatedTo: bridge.anchor.title, relatedToId: bridge.anchor.id, surpriseOnly: true })) : null;
  let supplementary = [];
  let shelfCalls = bridgeRow ? 1 : 0;
  const eligibleOf = (rows) => {
    const seen = new Set();
    return interleave(rows).filter((item) => !seen.has(item.id) && seen.add(item.id));
  };
  const domainsOf = (items) => new Set(items.map(primaryDomain));

  const firstWave = [...anchors.slice(0, FIRST_WAVE), ...extras];
  const laterWave = anchors.slice(FIRST_WAVE);
  let queried = [...firstWave];
  const rows = query(firstWave);
  let waves = 1;
  let eligible = eligibleOf(rows);
  const needDiscovery = () => (discovery ? [...discovery].filter(([d]) => eligible.filter((i) => primaryDomain(i) === d && !reorder?.(i)).length < 3) : []);
  const wanted = needDiscovery();
  const desired = domainsOf(anchors);
  const missing = () => [...desired].filter((d) => !domainsOf(eligible).has(d));
  const secondWave = (eligible.length < Math.min(12, POOL_LIMIT) || missing().length) && laterWave.length;
  if (secondWave) {
    rows.push(...query(laterWave));
    queried = [...queried, ...laterWave];
    waves += 1;
    eligible = eligibleOf(rows);
  }
  if (wanted.length) {
    for (const [d, shelves] of wanted) for (const id of shelves) { supplementary.push(...shelf(d, id)); shelfCalls += 1; }
    if (!secondWave) waves += 1;
  }
  const stillMissing = missing();
  if (stillMissing.length) {
    const used = new Set(queried.map((a) => a.id));
    const fallback = stillMissing.map((d) => usable.find((i) => !used.has(i.id) && primaryDomain(i) === d)).filter(Boolean);
    if (fallback.length) {
      rows.push(...query(fallback));
      queried = [...queried, ...fallback];
      waves += 1;
      eligible = eligibleOf(rows);
    }
  }
  const seen = new Set(eligible.map((i) => i.id));
  const extra = supplementary.filter((i) => !seen.has(i.id) && seen.add(i.id));
  let pool = balanceDomains([...eligible, ...extra]).slice(0, POOL_LIMIT);
  if (reorder) pool = [...pool.filter((i) => !reorder(i)), ...pool.filter((i) => reorder(i))];
  if (bridgeRow) pool = [...pool, ...bridgeRow.filter((i) => !pool.some((o) => o.id === i.id))];
  return { pool, calls: queried.length + shelfCalls, waves, anchors: queried.map((a) => a.id), shelfCalls };
}
