import { hypothesisMatches } from "./taste.js";
import { recordRevision } from "./history.js";
import { evidenceRecords } from "./evidence.js";
import { allowedCrossDomain, allowedLevel, capLevel, domainScope, evidenceRows } from "./evidence-rules.js";
import { CROSS_DOMAIN, LEVELS } from "../ai/contract.js";

// What the user has said about a pattern (pattern corrections). Decided Sept 22, 2026:
//   - This is its own authority, **user-confirmed**. It outranks anything Tastemake or a model inferred.
//   - It is NOT taste evidence: saying "that's me" is not an experience of anything, so it never raises a
//     confidence level (confidence is about what you tried) and it is not in evidenceRecords.
//   - Two independent answers per pattern, each reversible (choose again to clear):
//       fit     "accurate" (a "You confirmed this" badge) | "not-me" (left out of the Taste Profile; live AI is told not to use it)
//       weight  "lot" | "little" (passed to live AI as how much it matters)
//     None of these reach the shortlist or the catalog fallback: ranking doesn't read pattern answers (#334).
//   - The original pattern and its history stay visible; nothing is deleted.
// Stored as state.patternStatements = [{ hypothesisId, label, says, weight, authority }]; `says` is the fit
// answer (the name the AI validator reads).
//
// #36, expanded in the portfolio-polish pass: context refinement is separate from domain scope.
// "broad" means the user says the pattern usually holds, "some" narrows it to some contexts, and
// "unsure" records uncertainty. Only "some" caps model confidence; none of these are taste evidence.

export const FIT = { accurate: "You said this is accurate", partial: "You said this is partly accurate", "not-me": "You said this isn't you", unsure: "You said you're not sure yet" };
export const WEIGHT = { lot: "Important to your taste", little: "Nice, but not important to your taste" };
export const CONTEXT = {
  broad: "You said this usually holds",
  some: "You said this depends on context",
  unsure: "You are not sure what makes it partial yet"
};

const same = (a, b) => hypothesisMatches([a], b) || hypothesisMatches([b], a);

export function statementFor(state, hypothesisId) {
  return (state.patternStatements ?? []).find((s) => same(s.hypothesisId, hypothesisId)) ?? null;
}

// #333: the context answer to show. Answers saved before the fix can still pair Yes with the Partly-only
// "Not sure yet"; it is hidden here rather than rewritten, so the saved record and its history stay as they were.
export function shownContext(said) {
  if (said?.says === "accurate" && said.context === "unsure") return null;
  return said?.context ?? null;
}

// The same answer as the AI should read it: a copy without the hidden qualifier; the saved entry is untouched.
export function effectiveStatement(said) {
  return said && shownContext(said) !== (said.context ?? null) ? { ...said, context: shownContext(said) } : said;
}

// #358: the compact summary a pattern shows once it is answered, e.g. ["Confirmed", "Important", "Usually"].
// Only answers the person chose appear, and the context answer is the shown one (shownContext), so a hidden
// stale answer never surfaces here. Areas use the domain labels passed in.
export const SUMMARY = {
  says: { accurate: "Confirmed", partial: "Partly", "not-me": "Not me", unsure: "Not sure" },
  weight: { lot: "Important", little: "Not essential" },
  context: { broad: "Usually", some: "Depends", unsure: "Not sure why" }
};

export function statementSummary(said, areaLabel = (id) => id) {
  if (!SUMMARY.says[said?.says]) return [];
  const context = ["accurate", "partial"].includes(said.says) ? shownContext(said) : null;
  const excluded = said.says === "partial" ? (said.excludedDomains ?? []) : [];
  const also = said.says === "accurate" ? (said.alsoAppliesTo ?? []) : [];
  return [
    SUMMARY.says[said.says],
    said.says === "accurate" ? SUMMARY.weight[said.weight] : null,
    SUMMARY.context[context],
    excluded.length ? `Not for ${excluded.map(areaLabel).join(", ")}` : null,
    also.length ? `Also for ${also.map(areaLabel).join(", ")}` : null
  ].filter(Boolean);
}

const MESSAGE = {
  says: (pattern, now) => (now ? `${pattern.title}: ${FIT[now]}.` : `${pattern.title}: your answer was cleared.`),
  weight: (pattern, now) => (now ? `${pattern.title}: ${WEIGHT[now]}.` : `${pattern.title}: how much it matters was cleared.`),
  context: (pattern, now) => (now ? `${pattern.title}: ${CONTEXT[now]}.` : `${pattern.title}: the context qualifier was cleared.`)
};

// Toggle one answer. Returns a sentence for the live region.
export function setStatement(state, hypothesisId, field, value) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === hypothesisId);
  if (!pattern || !["says", "weight", "context"].includes(field)) return null;
  state.patternStatements ??= [];
  let entry = statementFor(state, hypothesisId);

  // Follow-ups are meaningful only after the matching primary fit answer.
  if (field === "weight" && entry?.says !== "accurate") return null;
  if (field === "context" && !["accurate", "partial"].includes(entry?.says)) return null;
  if (field === "context" && entry?.says === "partial" && value === "broad") return null;
  if (field === "context" && entry?.says === "accurate" && value === "unsure") return null;

  if (!entry) {
    entry = { hypothesisId, label: pattern.title, says: null, weight: null, context: null, authority: "user-confirmed" };
    state.patternStatements.push(entry);
  }

  const next = entry[field] === value ? null : value;
  entry[field] = next;

  if (field === "says") {
    // "Also true for" is a follow-up to "accurate" only, so any other answer clears it.
    if (next !== "accurate") entry.alsoAppliesTo = [];
    if (next === "not-me" || next === "unsure" || next == null) {
      entry.weight = null;
      entry.context = null;
      entry.excludedDomains = [];
    } else if (next === "partial") {
      entry.weight = null;
      if (entry.context === "broad") entry.context = null;
    } else if (next === "accurate") {
      // #333: "Not sure yet" only exists under Partly; under Yes it was hidden but still shown as a line.
      // "Depends" exists under both, so it stays (and shows as selected).
      if (entry.context === "unsure") entry.context = null;
    }
  }

  if (!entry.says && !entry.weight && !entry.context && !(entry.excludedDomains?.length)) {
    state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  }
  const message = MESSAGE[field](pattern, entry[field]);
  recordRevision(state, { hypothesisId: pattern.id, claim: pattern.claim, origin: "user-confirmed", reason: message });
  return message;
}

// #36: a lighter correction than "not really me" for the whole pattern — the user can say a pattern
// doesn't apply in one specific domain ("I like this in movies, not in interiors") without rejecting
// it everywhere else. This narrows scope; it never deletes the evidence the exclusion is based on.
export function excludedDomainsFor(state, hypothesisId) {
  return statementFor(state, hypothesisId)?.excludedDomains ?? [];
}

export function contextQualifiedFor(state, hypothesisId) {
  return statementFor(state, hypothesisId)?.context === "some";
}

export function toggleDomainExclusion(state, hypothesisId, domainId) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === hypothesisId);
  if (!pattern) return null;
  state.patternStatements ??= [];
  let entry = statementFor(state, hypothesisId);
  if (entry?.says !== "partial") return null;

  entry.excludedDomains ??= [];
  const excluding = !entry.excludedDomains.includes(domainId);
  entry.excludedDomains = excluding
    ? [...entry.excludedDomains, domainId]
    : entry.excludedDomains.filter((d) => d !== domainId);
  if (!entry.says && !entry.weight && !entry.context && !entry.excludedDomains.length) {
    state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  }
  const message = excluding
    ? `${pattern.title}: marked as not applying to ${domainId}.`
    : `${pattern.title}: ${domainId} is included again.`;
  recordRevision(state, { hypothesisId: pattern.id, claim: pattern.claim, origin: "user-confirmed", reason: message });
  return message;
}

// #252: the opposite of excludedDomains. After saying a pattern is accurate, the user can say it also holds
// in another area ("this is true of my books too"). User-confirmed, so a model may use it to connect a pick
// in that area to the pattern's cited evidence; it is NOT experience, never counts as evidence there, and
// never raises a pattern's confidence or cross-domain status.
export function alsoAppliesToFor(state, hypothesisId) {
  return statementFor(state, hypothesisId)?.alsoAppliesTo ?? [];
}

export function toggleAlsoApplies(state, hypothesisId, domainId) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === hypothesisId);
  const entry = statementFor(state, hypothesisId);
  if (!pattern || entry?.says !== "accurate" || !(pattern.domains ?? []).length || pattern.domains.includes(domainId)) return null;
  entry.alsoAppliesTo ??= [];
  const adding = !entry.alsoAppliesTo.includes(domainId);
  entry.alsoAppliesTo = adding ? [...entry.alsoAppliesTo, domainId] : entry.alsoAppliesTo.filter((d) => d !== domainId);
  const message = adding
    ? `${pattern.title}: you said this is also true for ${domainId}.`
    : `${pattern.title}: no longer marked as true for ${domainId}.`;
  recordRevision(state, { hypothesisId: pattern.id, claim: pattern.claim, origin: "user-confirmed", reason: message });
  return message;
}

export function clearStatement(state, hypothesisId) {
  const entry = statementFor(state, hypothesisId);
  if (!entry) return null;
  state.patternStatements = state.patternStatements.filter((s) => s !== entry);
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === entry.hypothesisId);
  const message = `${entry.label}: what you said was removed.`;
  recordRevision(state, { hypothesisId: entry.hypothesisId, claim: pattern?.claim, origin: "user-confirmed", reason: message });
  return message;
}

// #325: "accurate" and "partly" (with or without a context answer, which needs one of them) are the user
// confirming a pattern. A refresh never removes a confirmed pattern; "unsure" is not a confirmation.
// Works on bare statement lists so the server-side validator can use it too.
export const CONFIRMING = ["accurate", "partial"];
export function confirmationFor(statements, pattern) {
  const label = String(pattern?.title ?? pattern?.label ?? "").trim().toLowerCase();
  return (statements ?? []).find((s) => CONFIRMING.includes(s?.says)
    && (s.hypothesisId === pattern?.id || (label && String(s.label ?? "").trim().toLowerCase() === label))) ?? null;
}

// #325: a confirmed pattern the evidence check can no longer verify is kept, marked with this status
// (on the stored pattern, so it is saved and exported with it). It describes evidence validity only:
// it changes nothing about picks.
export const NEEDS_REVIEW = "needs-review";
export const NEEDS_REVIEW_LABEL = "Needs another look";
export const NEEDS_REVIEW_TEXT = "Some evidence behind this pattern is no longer available. Your earlier answer is saved, but Tastemake can’t currently verify the pattern.";
export const ALL_AREAS_EXCLUDED_LABEL = "Excluded from all areas";

// #325: the one status a pattern shows on the Taste Profile, Taste Map and HTML export, so they never
// disagree. Display only: nothing stored changes. In order:
//   1. every area excluded by the user: their scope correction outranks anything else;
//   2. the saved evidence flag: the last check couldn't verify the pattern;
//   3. otherwise its confidence level (each surface keeps its own fallback wording for that).
export function patternDisplayStatus(pattern, statement) {
  const domains = pattern?.domains ?? [];
  const excluded = statement?.excludedDomains ?? [];
  if (domains.length && domains.every((d) => excluded.includes(d))) return { kind: "excluded", label: ALL_AREAS_EXCLUDED_LABEL };
  if (pattern?.evidenceStatus === NEEDS_REVIEW) return { kind: "needs-review", label: NEEDS_REVIEW_LABEL };
  return { kind: "level", label: pattern?.strength ?? null };
}

// Nov 4 (PR #328 review): a confirmed pattern flagged because a reaction it rested on was removed stays
// flagged (the removed citation is kept, so every check finds it missing) until the reaction is back and the
// check passes, or the user says the pattern still fits without it. This is that second way: it drops the
// missing citations, clears the flag and records the user's answer in the pattern's history. No model call;
// the next refresh judges the pattern on the evidence it has left. Offered only when something was removed
// and evidence is left to rest on, and only when removal is the whole problem: every supporting reaction
// still there must still be one the user tried and liked (what the validator accepts as support). If one
// became a dislike, "not interested" or a bookmark, acknowledging the removal isn't enough, so it isn't offered.
export const RECONFIRM_LABEL = "Confirm it still fits";
export const RECONFIRM_TEXT = "If it still describes you without the rating that was removed, confirm it again. Adding that rating back works too.";

function reconfirmation(state, hypothesisId) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p.id === hypothesisId);
  if (!pattern || pattern.evidenceStatus !== NEEDS_REVIEW || !confirmationFor(state.patternStatements, pattern)) return null;
  const present = new Map(evidenceRecords(state).map((row) => [row.ref, row]));
  const supports = (pattern.supports ?? []).filter((ref) => present.has(ref));
  const removed = (pattern.supports ?? []).length - supports.length;
  if (!removed || !supports.length) return null;
  if (!supports.every((ref) => present.get(ref).class === "experienced" && present.get(ref).polarity > 0)) return null;
  return { pattern, present, supports, removed };
}

export const canReconfirm = (state, hypothesisId) => Boolean(reconfirmation(state, hypothesisId));

// Nov 4 (after #328): the user confirming the claim still fits doesn't vouch for how much evidence is left.
// What the remaining evidence allows is recomputed with the validator's own rules (src/model/evidence-rules.js):
// the level, never higher than before (and no higher than Supported when the user said it only applies in
// some contexts); the areas, keeping only earlier ones a remaining supporting rating is in (the user's
// excluded areas are a separate setting and stay as they are); never a new area, even when none of the earlier
// ones is left (the scope is then empty, shown as "still finding where this shows up"); the cross-domain
// reach, never further than before. Conditional stays Conditional. The next refresh can reconsider all of it
// by the normal rules.
function recomputedFromEvidence(state, pattern, supportRows, counterRows) {
  const storedLevel = String(pattern.strength ?? "emerging").toLowerCase();
  let strength = capLevel(LEVELS.includes(storedLevel) ? storedLevel : "emerging", allowedLevel(supportRows, counterRows));
  if (contextQualifiedFor(state, pattern.id)) strength = capLevel(strength, "supported");
  const supported = domainScope({ supports: evidenceRows(supportRows), against: evidenceRows(counterRows), heldUp: [] }).scope.supported;
  const kept = (pattern.domains ?? []).filter((domain) => supported.includes(domain));
  const storedReach = CROSS_DOMAIN.includes(pattern.crossDomain) ? pattern.crossDomain : "untested";
  const reach = allowedCrossDomain(supportRows, counterRows);
  return {
    strength,
    status: pattern.status === "conditional" ? "conditional" : strength,
    domains: kept,
    crossDomain: CROSS_DOMAIN[Math.min(CROSS_DOMAIN.indexOf(storedReach), CROSS_DOMAIN.indexOf(reach))]
  };
}

export function reconfirmPattern(state, hypothesisId) {
  const found = reconfirmation(state, hypothesisId);
  if (!found) return null;
  const { pattern, present, supports, removed } = found;
  const { evidenceStatus, ...rest } = pattern;
  const counters = (pattern.counters ?? []).filter((ref) => present.has(ref));
  const next = {
    ...rest,
    supports,
    counters,
    evidence: supports.map((ref) => present.get(ref).title).join(", "),
    ...recomputedFromEvidence(state, pattern, supports.map((ref) => present.get(ref)), counters.map((ref) => present.get(ref)))
  };
  state.modelHypotheses = state.modelHypotheses.map((p) => (p.id === hypothesisId ? next : p));
  const message = `${pattern.title}: you confirmed it still fits without the ${removed === 1 ? "rating" : `${removed} ratings`} that ${removed === 1 ? "was" : "were"} removed.`;
  recordRevision(state, { hypothesisId, claim: next.claim, supports: next.supports, counters: next.counters, domains: next.domains, level: next.strength, origin: "user-confirmed", reason: message });
  return message;
}

export function activeStatements(state) {
  return (state.patternStatements ?? []).filter((s) => s.says || s.weight || s.context || s.excludedDomains?.length || s.alsoAppliesTo?.length);
}
