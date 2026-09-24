import { state } from "../state.js";
import { patternsFor } from "../model/blindspots.js";
import { isTastebreakCandidate, tastebreakFor } from "../model/tastebreak.js";
import { isExperiencedPositive } from "../model/evidence.js";
import { esc } from "../lib/html.js";

// The Tastebreak panel (#19 v1): offered on anything the user has actually tried and reacted to, with a
// tagged pattern to ask about. Three states: offer, draft (in progress), saved.

function control(itemId, action, label, className = "button button-secondary") {
  return `<button class="${className} tastebreak-button" type="button" data-tastebreak-item="${itemId}" data-tastebreak-action="${action}">${label}</button>`;
}

function patternChip(itemId, pattern, status) {
  const pressed = status === "confirmed";
  const rejected = status === "rejected" ? " is-rejected" : "";
  return `<button class="detail-chip tastebreak-chip${rejected}" type="button" data-tastebreak-item="${itemId}" data-tastebreak-action="toggle-pattern" data-tastebreak-value="${pattern.id}" aria-pressed="${pressed}">${status === "rejected" ? "✕ " : ""}${esc(pattern.title)}</button>`;
}

export function renderTastebreakPanel(itemId) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!isTastebreakCandidate(feedback, state)) return "";
  const { item } = feedback;
  const positive = isExperiencedPositive(feedback);
  const verb = positive ? "landed" : "didn't land";
  const patterns = patternsFor(item, state);
  const draft = state.tastebreakDrafts[itemId];
  const saved = tastebreakFor(state, itemId);

  if (draft) {
    return `
      <div class="tastebreak-panel" data-tastebreak-panel="${itemId}" role="group" aria-label="Break down why ${esc(item.title)} ${verb}">
        <p class="tastebreak-title" tabindex="-1" data-tastebreak-focus="${itemId}">Which of these feel like part of why it ${verb}?</p>
        <div class="detail-chip-row">
          ${patterns.map((pattern) => patternChip(itemId, pattern, draft.confirmed.includes(pattern.id) ? "confirmed" : draft.rejected.includes(pattern.id) ? "rejected" : null)).join("")}
        </div>
        <label class="tastebreak-note-label" for="tastebreak-note-${itemId}">In your own words (optional)</label>
        <textarea class="tastebreak-note" id="tastebreak-note-${itemId}" data-tastebreak-item="${itemId}" data-tastebreak-note rows="2" placeholder="What actually pulled you in, or pushed you away?">${esc(draft.note)}</textarea>
        <p class="tastebreak-help">Tap once for "yes, that's part of it", twice for "no, not really". Confirmed patterns outrank Tastemake's own guess about why it picked this.</p>
        <div class="tastebreak-actions">
          ${control(itemId, "save", "Save", "button button-primary")}
          ${control(itemId, "discard", "Cancel", "button button-quiet")}
        </div>
      </div>`;
  }

  if (saved) {
    const confirmedNames = patterns.filter((p) => saved.confirmed.includes(p.id)).map((p) => `“${esc(p.title)}”`);
    const summary = confirmedNames.length
      ? `You said ${confirmedNames.join(" and ")} was part of why it ${verb}.`
      : "None of Tastemake's guesses felt right — it was something else.";
    return `
      <div class="tastebreak-panel is-saved" data-tastebreak-panel="${itemId}">
        <p class="tastebreak-title">Broken down.</p>
        <p class="tastebreak-summary">${summary}${saved.note ? ` “${esc(saved.note)}”` : ""}</p>
        <div class="tastebreak-actions">
          ${control(itemId, "edit", "Change my answers")}
          ${control(itemId, "remove", "Remove", "button button-quiet")}
        </div>
      </div>`;
  }

  return `
    <div class="tastebreak-panel is-offer" data-tastebreak-panel="${itemId}">
      ${control(itemId, "start", `Break down why it ${verb}`, "button button-quiet")}
    </div>`;
}
