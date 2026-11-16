import { BROAD_LABELS, SCIFI_FANTASY, bridgeLabelsOf } from "../catalog/bridges.mjs";
import { evidenceRecords } from "../model/evidence.js";
import { hypothesisMatches } from "../model/taste.js";
import { excludedRefsOf } from "../model/partly-elements.js";

// #334 (Nov 14): a "Not me" answer changes which titles are shortlisted, for live AI and the catalog
// fallback alike, not just what the AI is told. Paige's rules (Nov 13):
//   1. "Not me" on a pattern strongly down-ranks candidates that match that pattern (chooseCandidates in
//      taste-score.js). A down-rank, never an exclusion: "never recommend" is #48's exclusions.
//   2. "Matters a little" changes nothing here yet. Partly changes nothing either, except (Nov 15, Paige)
//      the areas it unticks: there it is a "Not me" in those areas only, and in the areas it keeps it guards
//      like a Yes. The rest of Partly waits for element-level Partly (#323), which plugs in where `rejected`
//      and `confirmed` are built below.
//   3. If every Surprise candidate conflicts with a "Not me", the set has no Surprise (chooseCandidates).
//
// What "matches the pattern" means (round 4 of the correction eval, scripts/evals/corrections/patterns.mjs):
// a pattern's supports are rated items, and supports alone are incomplete or occasionally wrong (#318), so a
// rejection is defined by catalog labels instead: the cross-medium labels (bridgeLabelsOf: horror, sci-fi,
// fantasy, mystery, thriller, comedy, romance, historical) carried by at least half of the pattern's labelled
// supports, and at least twice as common there as among the person's other liked/loved ratings. A broad
// label (mystery, thriller, comedy, romance, historical) only counts next to a specific one. A candidate
// conflicts when it is in one of the pattern's media, its own labels overlap the rejected ones, and it does
// not also overlap a pattern the person confirmed ("reject the interpretation, not the favorite").
// A candidate with no labels (games often carry none) never conflicts.

const MEDIA = ["movies", "tv", "read", "play"];
const mediumOf = (item) => MEDIA.find((domain) => item?.domains?.includes(domain)) ?? "other";

// "sci-fi & fantasy" (one TMDb TV genre) overlaps either half.
const overlaps = (a, b) => a.some((x) => b.includes(x)
  || (x === SCIFI_FANTASY && (b.includes("sci-fi") || b.includes("fantasy")))
  || ((x === "sci-fi" || x === "fantasy") && b.includes(SCIFI_FANTASY)));

// The labels that define a pattern's kind, from its supports. `labelsByRef`: every liked/loved rating's
// labels, keyed by evidence ref. Empty when the supports don't agree on a distinctive label.
export function patternLabels(supports, labelsByRef) {
  const refs = new Set(supports ?? []);
  const labelled = [...refs].map((ref) => labelsByRef.get(ref)).filter((labels) => labels?.length);
  if (!labelled.length) return [];
  const others = [...labelsByRef].filter(([ref, labels]) => !refs.has(ref) && labels.length).map(([, labels]) => labels);
  const share = (lists, label) => (lists.length ? lists.filter((labels) => labels.includes(label)).length / lists.length : 0);
  const common = [...new Set(labelled.flat())].filter((label) => share(labelled, label) >= 0.5);
  const distinct = common.filter((label) => share(labelled, label) >= 2 * share(others, label));
  return distinct.some((label) => !BROAD_LABELS.has(label)) ? distinct : [];
}

// The patterns the request knows about: the browser sends only the answered ones the shortlist reads
// (serializeAiState's correctionPatterns); the browser's own state has them all (modelHypotheses).
// #323 phase 2: a title the person said doesn't fit a pattern (its excludedRefs) is not one of its supports here,
// so it never shapes that pattern's labels, and "Not me" or an unticked area no longer reaches it through them.
function patternsOf(state) {
  const list = Array.isArray(state.correctionPatterns) ? state.correctionPatterns : (state.modelHypotheses ?? []);
  return list.filter((p) => p && typeof p.id === "string").map((p) => {
    const excluded = excludedRefsOf(p);
    return {
      id: p.id,
      domains: (Array.isArray(p.domains) && p.domains.length ? p.domains : MEDIA).filter((d) => MEDIA.includes(d)),
      supports: Array.isArray(p.supports) ? p.supports.filter((ref) => typeof ref === "string" && !excluded.includes(ref)) : []
    };
  });
}

const samePattern = (a, b) => hypothesisMatches([a], b) || hypothesisMatches([b], a);

// The areas a Partly answer unticked (its excludedDomains), as media. Empty for every other answer.
export function partlyExcludedMedia(statement) {
  if (statement?.says !== "partial" || !Array.isArray(statement.excludedDomains)) return [];
  return statement.excludedDomains.filter((domain) => MEDIA.includes(domain));
}

// Whether a statement takes titles out of the running somewhere: a "Not me", or a Partly with unticked areas.
export const rejectsSomewhere = (statement) => statement?.says === "not-me" || partlyExcludedMedia(statement).length > 0;

// Which kinds the person rejected and confirmed: { rejected: [{ id, domains, labels }], confirmed: [...] },
// or null when nothing is rejected (then the shortlist is exactly what it was before #334).
export function correctionKinds(state) {
  const statements = state.patternStatements ?? [];
  if (!statements.some(rejectsSomewhere)) return null;
  const patterns = patternsOf(state);
  // Each answered pattern, narrowed to the media the answer is about. Only "not me" and a Partly's unticked
  // areas reject; only a Yes and a Partly's kept areas guard. Not sure and how much a pattern matters are not read.
  const rejectedPatterns = [];
  const confirmedPatterns = [];
  for (const statement of statements) {
    const pattern = patterns.find((p) => samePattern(p.id, statement?.hypothesisId));
    if (!pattern) continue;
    const unticked = partlyExcludedMedia(statement);
    const within = (keep) => ({ ...pattern, domains: pattern.domains.filter(keep) });
    if (statement.says === "not-me") rejectedPatterns.push(pattern);
    else if (statement.says === "accurate") confirmedPatterns.push(pattern);
    else if (statement.says === "partial") {
      if (unticked.length) rejectedPatterns.push(within((d) => unticked.includes(d)));
      confirmedPatterns.push(within((d) => !unticked.includes(d)));
    }
  }
  const narrowed = (list) => list.filter((p) => p.domains.length);
  if (!narrowed(rejectedPatterns).length) return null;

  const labelsByRef = new Map();
  for (const record of evidenceRecords(state)) {
    if (record.class !== "experienced" || !(record.polarity > 0)) continue;
    const item = state.customItems?.[record.itemId] ?? state.feedbackByRecommendation?.[record.itemId]?.item;
    if (item) labelsByRef.set(record.ref, bridgeLabelsOf(item));
  }
  const withLabels = (p) => ({ id: p.id, domains: p.domains, labels: patternLabels(p.supports, labelsByRef) });
  const rejected = narrowed(rejectedPatterns).map(withLabels).filter((p) => p.labels.length);
  if (!rejected.length) return null;
  return { rejected, confirmed: narrowed(confirmedPatterns).map(withLabels).filter((p) => p.labels.length) };
}

// Whether a Partly answer's unticked areas actually reach the shortlist: false when the pattern's kind can't
// be read from its supports' labels (e.g. only a broad label like comedy), so the page promises nothing then.
export function partlyAreasReachPicks(state, hypothesisId) {
  const kinds = correctionKinds(state);
  return Boolean(kinds?.rejected.some((p) => samePattern(p.id, hypothesisId)));
}

// item -> true when it matches a pattern the person said is not them. Null when nothing can conflict.
export function notMeConflict(state) {
  const kinds = correctionKinds(state);
  if (!kinds) return null;
  return (item) => {
    const own = bridgeLabelsOf(item);
    if (!own.length) return false;
    const medium = mediumOf(item);
    const hit = (p) => p.domains.includes(medium) && overlaps(own, p.labels);
    return kinds.rejected.some(hit) && !kinds.confirmed.some(hit);
  };
}
