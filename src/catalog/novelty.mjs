// #92: deterministic novelty/diversity guard. Runs in the SHARED candidate-retrieval path
// (src/catalog/related.mjs), after retrieval and before the deterministic baseline or live-AI
// ranking ever see the candidates, so a direct sequel/remake of something the user already loves
// cannot occupy a primary recommendation slot in EITHER path.
//
// Product rule (#92): "what else would someone who loves this probably like?", not "what is the
// next obvious thing in the same franchise?". This is not "never recommend the same universe" —
// a related-but-distinct work (different lead title, e.g. a spin-off) stays eligible.
//
// Two signals, in priority order:
//   1. Provider metadata / normalized relationships (TMDb collection id, IGDB collection/franchise
//      id) when the provider actually returns them. This is the preferred signal per the issue.
//   2. Title heuristics, as a fallback when no provider relationship is available:
//        a. exact-ish normalized title match -> remake / re-release / near-duplicate version.
//        b. a sequel/continuation marker (numeral, roman numeral, "Part N", "Season N", ...) AND
//           at least one shared significant title word -> numbered sequel/continuation.
//        c. sharing the first two significant (non-stopword) title words -> same named franchise
//           (this is what catches "The Fellowship of the Ring" -> "The Two Towers": both share the
//           leading "The Lord of the Rings" naming even though the distinguishing words differ).
//
// Deliberately NOT triggered by: same single leading word alone (keeps "Legend of Zelda" and
// "Legend of Korra" both eligible), or same author/creator/genre with an unrelated title.

const STOPWORDS = new Set(["the", "a", "an", "of", "in", "and", "at", "to", "part", "book", "vol", "volume", "chapter", "season", "episode"]);
const SEQUEL_MARKER = /(^|\s)(part|chapter|book|volume|vol|season|episode)\s*\d+(\s|$)|\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b|\b\d+\b/i;

function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[:\-–,.'"!?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(title) {
  return normalizeTitle(title).split(" ").filter((word) => word && !STOPWORDS.has(word));
}

function titleSeriesPrefix(title) {
  const raw = String(title || "");
  if (!raw.includes(":")) return [];
  return significantWords(raw.split(":")[0]);
}

function stripSequenceTokens(words) {
  return words.filter((word) => !/^\d+$/.test(word) && !/^(ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(word));
}

// A deliberately conservative family key used only after the user explicitly tells Tastemake
// they have experienced more of a series. Provider collection/franchise metadata wins. Otherwise
// a subtitle prefix ("The Hobbit: ...") or a sequence-stripped title ("Uncharted 4") is used.
export function seriesKey(item) {
  const providerKey = item?.providerMeta?.collectionId ?? item?.providerMeta?.franchiseId ?? null;
  if (providerKey != null) return `provider:${item?.provider || "unknown"}:${providerKey}`;
  const prefix = titleSeriesPrefix(item?.title);
  if (prefix.length) return `title:${prefix.join(" ")}`;
  const words = stripSequenceTokens(significantWords(item?.title));
  return words.length && words.length < significantWords(item?.title).length ? `title:${words.join(" ")}` : null;
}

export function hasSeriesSignal(item) {
  return Boolean(seriesKey(item));
}

function shareCollection(a, b) {
  const aId = a.providerMeta?.collectionId ?? a.providerMeta?.franchiseId ?? null;
  const bId = b.providerMeta?.collectionId ?? b.providerMeta?.franchiseId ?? null;
  return Boolean(aId != null && bId != null && aId === bId);
}

function isNearDuplicateTitle(candidate, evidenceItem) {
  const a = normalizeTitle(candidate.title);
  const b = normalizeTitle(evidenceItem.title);
  return Boolean(a && b && a === b);
}

function isNumberedContinuation(candidate, evidenceItem) {
  const hasMarker = SEQUEL_MARKER.test(candidate.title) || SEQUEL_MARKER.test(evidenceItem.title);
  if (!hasMarker) return false;
  const wa = significantWords(candidate.title);
  const wb = significantWords(evidenceItem.title);
  return wa.length > 0 && wb.length > 0 && wa.some((word) => wb.includes(word));
}

function sharesFranchiseName(candidate, evidenceItem, minWords = 2) {
  const prefixA = titleSeriesPrefix(candidate.title);
  const prefixB = titleSeriesPrefix(evidenceItem.title);
  if (prefixA.length && prefixB.length && prefixA.join(" ") === prefixB.join(" ")) return true;

  const wa = significantWords(candidate.title);
  const wb = significantWords(evidenceItem.title);
  if (wa.length < minWords || wb.length < minWords) return false;
  for (let i = 0; i < minWords; i += 1) if (wa[i] !== wb[i]) return false;
  return true;
}

// Exported for eval/test coverage: whether `candidate` is an obvious sequel/prequel/same-series
// continuation or a remake/near-duplicate of `evidenceItem`, and therefore should not take a
// primary recommendation slot on that item's behalf.
export function isFranchiseContinuation(candidate, evidenceItem) {
  if (!candidate?.title || !evidenceItem?.title) return false;
  if (candidate.id === evidenceItem.id) return true;
  if (shareCollection(candidate, evidenceItem)) return true;
  if (isNearDuplicateTitle(candidate, evidenceItem)) return true;
  if (isNumberedContinuation(candidate, evidenceItem)) return true;
  if (sharesFranchiseName(candidate, evidenceItem)) return true;
  return false;
}

// Splits candidates into { primary, suppressed }. `evidenceItems` is whatever the candidate is
// `relatedTo` (or the full evidence set, for candidates without that link). Suppressed items are
// dropped from the primary pool — since retrieval fetches more candidates than are ever shown,
// the next eligible candidate already in the pool naturally replaces a suppressed one, so the
// user still gets a full set (#92 acceptance criterion). Suppressed items are still returned
// separately so a future "More from this series" treatment (explicitly out of scope here) has
// something to build on without re-deriving this rule.
export function applyNoveltyGuard(candidates, evidenceItems = []) {
  const primary = [];
  const suppressed = [];
  for (const candidate of candidates) {
    const against = candidate.relatedToId
      ? evidenceItems.filter((item) => item.id === candidate.relatedToId)
      : evidenceItems;

    // User-declared series coverage is stronger than an individual-title reaction for discovery:
    // once they say they have experienced the series, do not keep surfacing sibling installments.
    const coveredSeries = evidenceItems.some((item) => {
      if (!item.seriesExperience || item.seriesExperience === "unseen-rest") return false;
      const a = seriesKey(candidate);
      const b = seriesKey(item);
      return Boolean(a && b && a === b);
    });

    // Batch diversity: once one installment has earned a slot, obvious sibling installments do not
    // consume another slot in the same set. This is separate from evidence-based suppression.
    const duplicatesPrimary = primary.some((picked) => isFranchiseContinuation(candidate, picked));

    const continuation = coveredSeries
      || against.some((item) => isFranchiseContinuation(candidate, item))
      || duplicatesPrimary;
    (continuation ? suppressed : primary).push(candidate);
  }
  return { primary, suppressed };
}
