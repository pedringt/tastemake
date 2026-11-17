import { evidenceRecords } from "./evidence.js";
import { recordRevision } from "./history.js";
import { statementFor } from "./statements.js";

// #323 phase 2 (docs/proposals/323-partly-plan.md, sections 3, 4 and 7): element-level Partly, the parts that need
// no AI. After Partly, the person can say which of a pattern's cited titles are off:
//   "Doesn't fit this description"        live. The title stops being cited by this pattern and is never cited by
//                                          it again (Decision 4): its ref goes in the pattern's `excludedRefs`, which
//                                          the refresh validator, Design A placement, corrections.js and the Taste
//                                          Profile all honor. The rating still counts everywhere else. Undo puts it back.
//   "Fits a different side of my taste"   stored only (verdict "different", one tapped reason, optional own words).
//                                          Phase 3 (live): marking it asks for up to three reasons to tap
//                                          (src/ai/partly-reasons-request.js). Nothing reads the answer yet: the
//                                          suggestion call is phase 4. Picks and patterns don't change.
//
// Stored:
//   pattern (state.modelHypotheses[i]).excludedRefs   [ref]   titles this pattern must never cite again
//   statement (state.patternStatements[i]).elements    { words, wordsAbout, titles: { [ref]: { verdict, reasons, note } }, grouped }
// `excludedRefs` lives on the pattern, so it outlasts a changed or cleared answer, and a refresh carries it to the
// pattern with the same id (or name) (Decision 7). `elements` is the person's answer, kept with their statement.

// Client flag for the "different side" choice, like PLACEMENT_REFRESH (src/ai/hypothesis-profile.js). ON since
// phase 3 (Paige, Nov 16). The reasons call also needs the server's TASTEMAKE_PARTLY_REASONS=1; without it only
// "Something else" is offered. With this flag off the choice isn't offered and nothing new is stored.
export const PARTLY_DIFFERENT_SIDE = true;

export const VERDICTS = ["doesnt-fit", "different"];
export const NOTE_MAX = 280;

const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const quoted = (title) => `“${title}”`;

export const excludedRefsOf = (pattern) => (Array.isArray(pattern?.excludedRefs) ? pattern.excludedRefs.filter((ref) => typeof ref === "string") : []);

// A pattern (stored or proposed) without the citations it must not make. `supports`/`counters` for a stored pattern,
// `evidence`/`counter` for a model proposal. Returns the same object when nothing changes.
export function withoutExcluded(pattern, refs = excludedRefsOf(pattern)) {
  if (!pattern || !refs.length) return pattern;
  const out = { ...pattern };
  let changed = false;
  for (const field of ["supports", "counters", "evidence", "counter"]) {
    if (!Array.isArray(pattern[field])) continue;
    const kept = pattern[field].filter((ref) => !refs.includes(ref));
    if (kept.length !== pattern[field].length) { out[field] = kept; changed = true; }
  }
  return changed ? out : pattern;
}

// The stored pattern a refreshed one continues: same id, or same name (how a confirmed pattern is matched elsewhere).
export function storedMatch(existing = [], pattern) {
  const label = text(pattern?.title ?? pattern?.label);
  return (existing ?? []).find((stored) => stored?.id && (stored.id === pattern?.id || (label && text(stored.title ?? stored.label) === label))) ?? null;
}

// Decision 7: the person's answers stay with the pattern. A refreshed pattern keeps the excludedRefs of the stored
// pattern it continues, and drops any citation of them. Used on the browser's full-refresh path; the server's
// validator does the same before checking (src/ai/validate.js).
export function carryExcludedRefs(next = [], existing = []) {
  return (next ?? []).map((pattern) => {
    const refs = [...new Set([...excludedRefsOf(storedMatch(existing, pattern)), ...excludedRefsOf(pattern)])];
    if (!refs.length) return pattern;
    return { ...withoutExcluded(pattern, refs), excludedRefs: refs };
  });
}

const patternById = (state, id) => (state.modelHypotheses ?? []).find((p) => p?.id === id) ?? null;
const titleOf = (state, ref) => evidenceRecords(state).find((row) => row.ref === ref)?.title ?? "This title";

function evidenceText(state, supports, fallback) {
  const titles = new Map(evidenceRecords(state).map((row) => [row.ref, row.title]));
  return supports.map((ref) => titles.get(ref)).filter(Boolean).join(", ") || fallback;
}

function setTitleAnswer(entry, ref, answer) {
  if (!entry) return;
  const elements = { words: [], wordsAbout: null, titles: {}, grouped: null, ...(entry.elements ?? {}) };
  const titles = { ...(elements.titles ?? {}) };
  if (answer) titles[ref] = answer;
  else delete titles[ref];
  elements.titles = titles;
  entry.elements = elements;
}

export const titleAnswer = (state, hypothesisId, ref) => statementFor(state, hypothesisId)?.elements?.titles?.[ref] ?? null;

// Whether "Doesn't fit this description" can be offered for this title: it is cited as support, the person said
// Partly, and it isn't the last title the pattern rests on (removing that leaves nothing to check the pattern
// against; "No" is the answer for that).
export function canMarkDoesntFit(state, hypothesisId, ref) {
  const pattern = patternById(state, hypothesisId);
  if (!pattern || statementFor(state, hypothesisId)?.says !== "partial") return false;
  const supports = pattern.supports ?? [];
  return supports.includes(ref) && supports.length > 1;
}

// "Doesn't fit this description": the title stops being cited by this pattern, for good. The wording stays; the
// level and areas are left to the next refresh's check. Returns a sentence for the live region, or null.
export function markDoesntFit(state, hypothesisId, ref) {
  if (!canMarkDoesntFit(state, hypothesisId, ref)) return null;
  const pattern = patternById(state, hypothesisId);
  const excludedRefs = [...new Set([...excludedRefsOf(pattern), ref])];
  const next = withoutExcluded({ ...pattern, excludedRefs }, excludedRefs);
  next.evidence = evidenceText(state, next.supports ?? [], pattern.evidence);
  state.modelHypotheses = state.modelHypotheses.map((p) => (p === pattern ? next : p));
  setTitleAnswer(statementFor(state, hypothesisId), ref, { verdict: "doesnt-fit", reasons: [], note: null });
  const message = `${pattern.title}: ${quoted(titleOf(state, ref))} is no longer cited by this pattern, because you said it doesn’t fit this description.`;
  recordRevision(state, { hypothesisId: pattern.id, claim: next.claim, supports: next.supports, counters: next.counters, domains: next.domains, level: next.strength, origin: "user-confirmed", reason: message });
  return message;
}

// Undo: the title may be cited by this pattern again. It goes back on the pattern's supports when it is still a
// title the person tried and liked (what the validator accepts as support); otherwise the next refresh decides.
export function undoDoesntFit(state, hypothesisId, ref) {
  const pattern = patternById(state, hypothesisId);
  if (!pattern || !excludedRefsOf(pattern).includes(ref)) return null;
  const row = evidenceRecords(state).find((r) => r.ref === ref);
  const restore = row?.class === "experienced" && row.polarity > 0 && !(pattern.supports ?? []).includes(ref);
  const excludedRefs = excludedRefsOf(pattern).filter((r) => r !== ref);
  const { excludedRefs: _old, ...rest } = pattern;
  const next = { ...rest, ...(excludedRefs.length ? { excludedRefs } : {}), supports: restore ? [...(pattern.supports ?? []), ref] : (pattern.supports ?? []) };
  next.evidence = evidenceText(state, next.supports, pattern.evidence);
  state.modelHypotheses = state.modelHypotheses.map((p) => (p === pattern ? next : p));
  const entry = statementFor(state, hypothesisId);
  if (entry?.elements?.titles?.[ref]?.verdict === "doesnt-fit") setTitleAnswer(entry, ref, null);
  const message = `${pattern.title}: you undid “Doesn’t fit this description”, so ${quoted(row?.title ?? "this title")} can be cited by this pattern again.`;
  recordRevision(state, { hypothesisId: pattern.id, claim: next.claim, supports: next.supports, counters: next.counters, domains: next.domains, level: next.strength, origin: "user-confirmed", reason: message });
  return message;
}

// "Fits a different side of my taste": saved with the person's answer, used by nothing yet (phase 3). Toggling it
// again, or choosing "Belongs", clears it. Only while PARTLY_DIFFERENT_SIDE is on.
export function markDifferentSide(state, hypothesisId, ref, { enabled = PARTLY_DIFFERENT_SIDE } = {}) {
  const pattern = patternById(state, hypothesisId);
  const entry = statementFor(state, hypothesisId);
  if (!enabled || !pattern || entry?.says !== "partial" || !(pattern.supports ?? []).includes(ref)) return null;
  const clearing = entry.elements?.titles?.[ref]?.verdict === "different";
  setTitleAnswer(entry, ref, clearing ? null : { verdict: "different", reasons: [], note: null });
  return clearing
    ? `${pattern.title}: ${quoted(titleOf(state, ref))} is no longer marked as a different side of your taste.`
    : `${pattern.title}: saved that ${quoted(titleOf(state, ref))} fits a different side of your taste.`;
}

export function setDifferentSideNote(state, hypothesisId, ref, note) {
  const entry = statementFor(state, hypothesisId);
  const answer = entry?.elements?.titles?.[ref];
  if (answer?.verdict !== "different") return null;
  const clean = String(note ?? "").trim().slice(0, NOTE_MAX);
  setTitleAnswer(entry, ref, { ...answer, note: clean || null });
  const pattern = patternById(state, hypothesisId);
  return clean ? `${pattern?.title ?? entry.label}: your note about ${quoted(titleOf(state, ref))} was saved.` : `${pattern?.title ?? entry.label}: your note about ${quoted(titleOf(state, ref))} was cleared.`;
}

// #323 phase 3: tapping one of the suggested reasons saves it as the answer's one reason; tapping the same one
// again clears it. The own-words note is kept either way. Saved for a later step; nothing reads it yet.
export function chooseReason(state, hypothesisId, ref, label) {
  const entry = statementFor(state, hypothesisId);
  const answer = entry?.elements?.titles?.[ref];
  const reason = String(label ?? "").trim().replace(/\s+/g, " ").slice(0, NOTE_MAX);
  if (answer?.verdict !== "different" || !reason) return null;
  const clearing = (answer.reasons ?? [])[0] === reason;
  setTitleAnswer(entry, ref, { ...answer, reasons: clearing ? [] : [reason] });
  const name = patternById(state, hypothesisId)?.title ?? entry.label;
  return clearing
    ? `${name}: cleared your reason for ${quoted(titleOf(state, ref))}.`
    : `${name}: saved “${reason}” as what’s different about ${quoted(titleOf(state, ref))}. It’s kept for a later step and changes nothing yet.`;
}

// "Belongs" (the default): clears a "different side" answer. A "doesn't fit" is undone with Undo, which says so.
export function markBelongs(state, hypothesisId, ref) {
  const entry = statementFor(state, hypothesisId);
  if (entry?.elements?.titles?.[ref]?.verdict !== "different") return null;
  setTitleAnswer(entry, ref, null);
  const pattern = patternById(state, hypothesisId);
  return `${pattern?.title ?? entry.label}: ${quoted(titleOf(state, ref))} is marked as belonging again.`;
}

// The copy of a statement that leaves the browser or reaches a prompt: without `elements`, which nothing on the
// server reads yet (phases 3-4 will send them on purpose). Keeps the picks prompt exactly as it was.
export function withoutElements(statement) {
  if (!statement || typeof statement !== "object" || !("elements" in statement)) return statement;
  const { elements, ...rest } = statement;
  return rest;
}
