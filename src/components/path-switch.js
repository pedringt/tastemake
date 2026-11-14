// #336: Change can revise the first choice, not just the second step. Shown in the reaction editor only once
// a reaction is saved (before that, the card's own "Have you tried it?" rail is right there). Choosing the
// other path shows that path's answers; the saved reaction is replaced only when one of them is picked, and
// saveExperienceOutcome then clears the structured answers that no longer apply.
import { esc } from "../lib/html.js";

function pathChip(itemId, value, label, pressed) {
  return `<button class="detail-chip outcome-chip" type="button" data-feedback-item="${esc(itemId)}" data-experience-path="${value}" aria-pressed="${pressed}">${label}</button>`;
}

export function renderPathSwitch(item, path) {
  return `
    <div class="feedback-details feedback-path-switch">
      <span class="feedback-detail-prompt">Have you tried it?</span>
      <div class="detail-chip-row" role="group" aria-label="Have you tried ${esc(item.title)}?">
        ${pathChip(item.id, "tried", "Tried it", path === "tried")}
        ${pathChip(item.id, "not-tried", "Not tried", path === "not-tried")}
      </div>
    </div>`;
}
