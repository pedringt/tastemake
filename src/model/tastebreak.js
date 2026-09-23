import { hypotheses } from "../data/catalog.js";
import { isExperienced, isExperiencedPositive } from "./evidence.js";
import { patternsFor } from "./blindspots.js";
import { recordRevision } from "./history.js";

// Tastebreak (#19), deterministic v1: for something the user actually tried and reacted to, ask which of
// its tagged patterns were really part of why it worked (or didn't), and let them add their own words.
// Deliberately not live-AI (that's #18's fuller version): this tests whether turning a reaction into a
// confirmed, specific reason produces useful signal before spending model-design effort on a generated one.
//
// A confirmed pattern here carries the same "user-confirmed outranks inference" authority as a Taste
// Profile statement, but scoped to one item's reaction rather than the whole pattern. v1 records it as a
// revision (#37) so it is visible and traceable, but does not (yet) change ranking or confidence — see
// "Later possibilities" in #19 for where that could go once this is proven useful.

export function isTastebreakCandidate(feedback) {
  return Boolean(feedback) && isExperienced(feedback) && patternsFor(feedback.item).length > 0;
}

export function tastebreakFor(state, itemId) {
  return state.tastebreaks[itemId] ?? null;
}

// Starts (or reopens, pre-filled) a draft. Returns a sentence to announce, or null if this item isn't
// eligible (nothing tagged to break down, or no reaction yet).
export function startTastebreak(state, itemId) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!isTastebreakCandidate(feedback)) return null;
  const saved = tastebreakFor(state, itemId);
  state.tastebreakDrafts[itemId] = { confirmed: [...(saved?.confirmed ?? [])], rejected: [...(saved?.rejected ?? [])], note: saved?.note ?? "" };
  return "Which of these feel like part of why it landed? Pick any that fit, or skip.";
}

// A pattern cycles undecided -> confirmed -> rejected -> undecided, so the user can say "yes", "no", or
// leave it alone rather than being forced to take a position on every tagged pattern.
export function toggleTastebreakPattern(state, itemId, patternId) {
  const draft = state.tastebreakDrafts[itemId];
  if (!draft) return;
  if (draft.confirmed.includes(patternId)) {
    draft.confirmed = draft.confirmed.filter((id) => id !== patternId);
    draft.rejected = [...draft.rejected, patternId];
  } else if (draft.rejected.includes(patternId)) {
    draft.rejected = draft.rejected.filter((id) => id !== patternId);
  } else {
    draft.confirmed = [...draft.confirmed, patternId];
  }
}

export function setTastebreakNote(state, itemId, note) {
  const draft = state.tastebreakDrafts[itemId];
  if (!draft) return;
  draft.note = note;
}

export function saveTastebreak(state, itemId) {
  const feedback = state.feedbackByRecommendation[itemId];
  const draft = state.tastebreakDrafts[itemId];
  if (!feedback || !draft) return null;
  const positive = isExperiencedPositive(feedback);
  const entry = { confirmed: [...draft.confirmed], rejected: [...draft.rejected], note: draft.note.trim(), positive, createdAt: new Date().toISOString() };
  state.tastebreaks[itemId] = entry;
  delete state.tastebreakDrafts[itemId];

  const verb = positive ? "part of why it landed" : "part of why it didn't land";
  entry.confirmed.forEach((patternId) => {
    const pattern = hypotheses.find((p) => p.id === patternId);
    if (!pattern) return;
    recordRevision(state, {
      hypothesisId: pattern.id,
      claim: pattern.claim,
      origin: "user-confirmed",
      reason: `${feedback.item.title}: confirmed as ${verb}.`
    });
  });
  return `Noted for ${feedback.item.title}.`;
}

export function discardTastebreakDraft(state, itemId) {
  delete state.tastebreakDrafts[itemId];
}

export function removeTastebreak(state, itemId) {
  delete state.tastebreaks[itemId];
  delete state.tastebreakDrafts[itemId];
}
