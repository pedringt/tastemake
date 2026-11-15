import { state } from "../state.js";
import { cleanDismissalNote, dismissalNoteFor, saveDismissalNote } from "../model/dismissal-notes.js";

// "What put you off?" (Paige, Nov 14): offered under a pick on Recommendations right after Not interested.
// The dismissal is already saved before the prompt appears; the prompt never blocks, and Skip, leaving or
// reloading keeps the title dismissed. Prompts are keyed by title id, so dismissing several picks quickly
// can't attach a note to the wrong one.

export const NOTE_OFFER = "Optional: say what put you off, below the pick.";

export function openDismissalPrompt(itemId) {
  if (state.screen !== "recommendations" || dismissalNoteFor(state, itemId)) return false;
  state.dismissalPrompts = { ...state.dismissalPrompts, [itemId]: { draft: "", status: "open" } };
  return true;
}

export function closeDismissalPrompt(itemId) {
  if (!state.dismissalPrompts?.[itemId]) return;
  const { [itemId]: _closed, ...rest } = state.dismissalPrompts;
  state.dismissalPrompts = rest;
}

// Typing goes to the draft with no render, so the cursor never jumps. Editing after a failed save clears
// the error until the next try.
export function setDismissalDraft(itemId, text) {
  const prompt = state.dismissalPrompts?.[itemId];
  if (!prompt) return;
  prompt.draft = text;
  if (prompt.status === "error") prompt.status = "open";
}

// effects: { persist() -> boolean, rerender(itemId, focusSelector), announce(message) }.
// Returns "saved", "blank", "error" or "ignored".
export function submitDismissalNote(itemId, { persist, rerender, announce }) {
  const prompt = state.dismissalPrompts?.[itemId];
  if (!prompt || prompt.status === "saving") return "ignored";   // a second press while saving, or after, does nothing
  const title = state.feedbackByRecommendation?.[itemId]?.item?.title ?? "This title";
  const changeButton = `[data-feedback-edit="${itemId}"]`;
  if (!cleanDismissalNote(prompt.draft)) {
    // Whitespace or nothing is no note: the same as Skip.
    closeDismissalPrompt(itemId);
    rerender(itemId, changeButton);
    return "blank";
  }
  prompt.status = "saving";
  const previous = state.dismissalNotes?.[itemId];
  if (!saveDismissalNote(state, itemId, prompt.draft)) {
    closeDismissalPrompt(itemId);
    rerender(itemId, changeButton);
    return "ignored";
  }
  if (!persist()) {
    // Not saved: take the note back out, keep the draft and the dismissal, and offer the retry.
    const notes = { ...state.dismissalNotes };
    if (previous) notes[itemId] = previous;
    else delete notes[itemId];
    state.dismissalNotes = notes;
    prompt.status = "error";
    rerender(itemId, `[data-dismiss-note-input="${itemId}"]`);
    announce(`Couldn’t save your note. ${title} is still dismissed.`);
    return "error";
  }
  closeDismissalPrompt(itemId);
  rerender(itemId, changeButton);
  announce(`Note saved with ${title}.`);
  return "saved";
}
