import { state } from "../state.js";
import { esc } from "../lib/html.js";
import { DISMISSAL_NOTE_MAX, dismissalNoteFor } from "../model/dismissal-notes.js";

// The optional "What put you off?" prompt under a pick just marked Not interested, or the note once sent.
// Every control carries the title's id, so prompts for several dismissed picks never cross.
export function renderDismissalNote(itemId, title) {
  const prompt = state.dismissalPrompts?.[itemId];
  const saved = dismissalNoteFor(state, itemId);
  if (!prompt) {
    return saved ? `<p class="dismiss-note-saved"><span>Your note:</span> “${esc(saved.note)}”</p>` : "";
  }
  const saving = prompt.status === "saving";
  const id = `dismiss-note-${esc(itemId)}`;
  return `
    <form class="dismiss-note" data-dismiss-note-form="${esc(itemId)}" novalidate>
      <label class="dismiss-note-label" for="${id}">What put you off? <span class="dismiss-note-optional">Optional</span></label>
      <textarea class="dismiss-note-input" id="${id}" data-dismiss-note-input="${esc(itemId)}" rows="2" maxlength="${DISMISSAL_NOTE_MAX}" aria-describedby="${id}-hint">${esc(prompt.draft ?? "")}</textarea>
      <p class="dismiss-note-hint" id="${id}-hint">${esc(title)} is already dismissed. A note is kept with it in Library; it doesn’t change your picks or Taste Profile.</p>
      ${prompt.status === "error" ? `<p class="dismiss-note-error" role="alert">Couldn’t save your note. ${esc(title)} is still dismissed. Try again, or Skip.</p>` : ""}
      <div class="dismiss-note-actions">
        <button class="button button-secondary" type="submit" data-dismiss-note-submit="${esc(itemId)}"${saving ? " disabled aria-disabled=\"true\"" : ""}>${saving ? "Saving…" : "Submit"}</button>
        <button class="button button-quiet" type="button" data-dismiss-note-skip="${esc(itemId)}">Skip</button>
      </div>
    </form>`;
}
