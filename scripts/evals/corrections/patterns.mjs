// Correction eval, round 4: what a rejected pattern *is*, from catalog labels rather than supporting items
// alone, and the conservative rules built on it. Eval-only; never wired into production.
//
// Labels are production's cross-medium labels (bridgeLabelsOf in src/catalog/bridges.mjs: horror, sci-fi,
// fantasy, mystery, thriller, comedy, romance, historical). A pattern's labels are those carried by at least
// half of its labelled supporting items. Guarded (the default):
//   - a label must be at least twice as common among those items as among the person's other positive
//     ratings (a label everyone's ratings carry says nothing about this pattern);
//   - a broad label (mystery, thriller, comedy, romance, historical) only counts next to a non-broad one,
//     the same rule as #314's meaningfulShare.
// Items with no labels (stored games carry no IGDB themes) can never be confirmed as the rejected kind.
//
// Rules ("reject the interpretation, not the favorite"):
//   kind(item)            the item's medium is one the rejection covers and its own labels match the rejected
//                         pattern's, and it doesn't also match a confirmed pattern's labels there;
//   rejectedOnly(item)    the rating supports a rejected pattern and no pattern that wasn't rejected;
//   conservativeDrop      an anchor is dropped only if it is rejectedOnly AND its own labels confirm the
//                         rejected kind (Resident Evil 7 stored under fantasy: also supports horror and
//                         exploration, and carries no fantasy label, so it stays).

import { BROAD_LABELS, bridgeLabelsOf } from "../../../src/catalog/bridges.mjs";
import { evidenceItems } from "./retrieval.mjs";
import { primaryDomain } from "./rank.mjs";

const ALL = ["movies", "tv", "read", "play"];
// TARGET_SHELF in bridges.mjs (not exported), plus the one games shelf a label maps to.
const SCREEN = { horror: ["horror"], "sci-fi": ["sci-fi"], fantasy: ["fantasy"], "sci-fi & fantasy": ["sci-fi", "fantasy"], mystery: ["thriller"], thriller: ["thriller"], comedy: ["comedy"] };
export const LABEL_SHELF = {
  read: { horror: ["horror"], "sci-fi": ["sci-fi"], fantasy: ["fantasy"], "sci-fi & fantasy": ["sci-fi", "fantasy"], mystery: ["mystery-thriller"], thriller: ["mystery-thriller"], romance: ["romance"], historical: ["historical-fiction"] },
  movies: SCREEN, tv: SCREEN, play: { horror: ["horror"] }
};

const labelCache = new Map();
export const labelsOf = (item) => {
  if (!item) return [];
  if (!labelCache.has(item.id)) labelCache.set(item.id, bridgeLabelsOf(item));
  return labelCache.get(item.id);
};
const overlap = (a, b) => a.some((x) => b.includes(x) || (x === "sci-fi & fantasy" && (b.includes("sci-fi") || b.includes("fantasy"))) || ((x === "sci-fi" || x === "fantasy") && b.includes("sci-fi & fantasy")));

export function patternLabels(pattern, items, { supportsKey = "supports", guard = true } = {}) {
  const refs = new Set(pattern[supportsKey] ?? []);
  const labelled = [...refs].map((r) => items.get(r)).filter((i) => i && labelsOf(i).length);
  if (!labelled.length) return [];
  const others = [...items.entries()].filter(([r, i]) => !refs.has(r) && labelsOf(i).length).map(([, i]) => i);
  const share = (list, l) => (list.length ? list.filter((i) => labelsOf(i).includes(l)).length / list.length : 0);
  const common = [...new Set(labelled.flatMap(labelsOf))].filter((l) => share(labelled, l) >= 0.5);
  if (!guard) return common;
  const distinct = common.filter((l) => share(labelled, l) >= 2 * share(others, l));
  return distinct.some((l) => !BROAD_LABELS.has(l)) ? distinct : [];
}

// Everything the round-4 options need for one profile and one set of statements. Null when nothing is rejected.
export function rejectionProfile(kase, state, statements, { supportsKey = "supports", guard = true } = {}) {
  const positives = evidenceItems(state);
  const items = new Map(positives.map((i) => [`ev:${i.id}`, i]));
  const byId = new Map(kase.patterns.map((p) => [p.id, p]));
  const rejected = [], endorsed = [];
  for (const s of statements) {
    const p = byId.get(s.hypothesisId);
    if (!p) continue;
    const domains = p.domains?.length ? p.domains : ALL;
    if (s.says === "not-me") rejected.push({ p, domains });
    else if (s.says === "partial" && s.excludedDomains?.length) rejected.push({ p, domains: s.excludedDomains });
    else if (s.says === "accurate" && s.weight !== "little") endorsed.push({ p, domains });
  }
  if (!rejected.length) return null;
  for (const r of [...rejected, ...endorsed]) r.labels = patternLabels(r.p, items, { supportsKey, guard });
  const rejectedIds = new Set(rejected.map((r) => r.p.id));

  const kind = (item) => {
    const d = primaryDomain(item), own = labelsOf(item);
    if (!own.length) return false;
    const hit = rejected.some((r) => r.domains.includes(d) && overlap(own, r.labels));
    return hit && !endorsed.some((e) => e.domains.includes(d) && overlap(own, e.labels));
  };
  const rejectedOnly = (item) => {
    const ref = `ev:${item.id}`, d = primaryDomain(item);
    const inRejected = rejected.some((r) => r.p[supportsKey].includes(ref) && r.domains.includes(d));
    return inRejected && !kase.patterns.some((p) => !rejectedIds.has(p.id) && p[supportsKey].includes(ref));
  };

  // Independent same-medium discovery: the person's own labels that the rejection doesn't cover, most common
  // first; non-broad labels first, broad ones only if carried by at least three positive ratings.
  const rejectedLabels = new Set(rejected.flatMap((r) => r.labels));
  const counts = new Map();
  for (const i of positives) for (const l of labelsOf(i)) if (!overlap([l], [...rejectedLabels])) counts.set(l, (counts.get(l) ?? 0) + 1);
  const ranked = [...counts.entries()].filter(([l, n]) => !BROAD_LABELS.has(l) || n >= 3)
    .sort((a, b) => (BROAD_LABELS.has(a[0]) - BROAD_LABELS.has(b[0])) || b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
  const affected = [...new Set(rejected.flatMap((r) => r.domains))];
  const discovery = new Map();
  for (const d of affected) {
    const shelves = [...new Set(ranked.flatMap((l) => LABEL_SHELF[d]?.[l] ?? []))].slice(0, 2);
    if (shelves.length) discovery.set(d, shelves);
  }

  // Surprise novelty source: production's #252 bridge from a Liked rating the rejection doesn't touch,
  // into another medium, on that rating's own non-rejected label.
  const liked = positives.filter((i) => i.anchorStrength === 1 && !rejectedOnly(i) && !kind(i));
  let bridge = null;
  for (const i of liked) {
    const own = labelsOf(i).filter((l) => !overlap([l], [...rejectedLabels]) && !BROAD_LABELS.has(l));
    for (const d of ALL.filter((x) => x !== primaryDomain(i))) {
      const shelf = own.flatMap((l) => LABEL_SHELF[d]?.[l] ?? [])[0];
      if (shelf) { bridge = { anchor: i, domain: d, shelf }; break; }
    }
    if (bridge) break;
  }

  return {
    rejected, endorsed, kind, rejectedOnly,
    conservativeDrop: (item) => rejectedOnly(item) && kind(item),
    avoid: (item) => rejectedOnly(item) || kind(item),
    discovery, bridge
  };
}
