import { isDeclined } from "./evidence.js";

// Free-text "What put you off?" after Not interested (Paige, Nov 14). The note is its own piece of feedback,
// stored apart from the dismissal (state.dismissalNotes, one per title), so a later rewrite of the feedback
// entry never drops it and it never rides along to a prompt with tried-item feedback. It is the person's
// words, kept as written: not taste evidence, not an exclusion, and read by nothing that ranks or explains
// picks. Whether and how it should ever teach Tastemake is a separate decision.

export const DISMISSAL_NOTE_MAX = 500;

// Trimmed and capped; whitespace-only is no note.
export function cleanDismissalNote(text) {
  return String(text ?? "").trim().slice(0, DISMISSAL_NOTE_MAX);
}

// The note for a title, shown only while the title is still dismissed.
export function dismissalNoteFor(state, itemId) {
  if (!isDeclined(state.feedbackByRecommendation?.[itemId])) return null;
  return state.dismissalNotes?.[itemId] ?? null;
}

// Stores the note against a dismissed title. One per title, so a second submit replaces rather than adds.
// Returns the stored note, or null when there is nothing to store (blank, or the title isn't dismissed).
// `setIndex` and `why` record which set the pick was in and the reason it was shown with, so a note about
// the explanation can later be told apart from one about the title.
export function saveDismissalNote(state, itemId, text, { now = new Date().toISOString() } = {}) {
  const note = cleanDismissalNote(text);
  const feedback = state.feedbackByRecommendation?.[itemId];
  if (!note || !isDeclined(feedback)) return null;
  const sets = state.recommendationSets ?? [];
  let setIndex = null;
  for (let i = sets.length - 1; i >= 0 && setIndex === null; i -= 1) if (sets[i]?.some?.((pick) => pick?.id === itemId)) setIndex = i;
  const why = setIndex === null ? null : sets[setIndex].find((pick) => pick?.id === itemId)?.reason ?? null;
  const entry = { note, createdAt: now, title: feedback.item?.title ?? null, setIndex, why };
  state.dismissalNotes = { ...(state.dismissalNotes ?? {}), [itemId]: entry };
  return entry;
}

export function removeDismissalNote(state, itemId) {
  if (!state.dismissalNotes?.[itemId]) return;
  const { [itemId]: _gone, ...rest } = state.dismissalNotes;
  state.dismissalNotes = rest;
}
