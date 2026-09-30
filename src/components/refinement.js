import { isExperiencedNegative, isExperiencedPositive } from "../model/evidence.js";
import { MAX_REFINEMENTS, normalizedRefinements, refinementOptionsFor } from "../model/refinements.js";
import { esc } from "../lib/html.js";

export function renderExperienceRefinement(itemId, item, feedback, { compact = false } = {}) {
  const positive = isExperiencedPositive(feedback);
  const negative = isExperiencedNegative(feedback);
  if (!positive && !negative) return "";

  const selected = normalizedRefinements(feedback);
  const prompt = positive ? "What worked for you?" : "What didn’t work for you?";
  const summary = positive ? "Say what worked" : "Say what didn’t work";
  const options = refinementOptionsFor(item);

  return `
    <details class="experience-refinement ${compact ? "is-compact" : ""}" ${selected.length ? "open" : ""}>
      <summary>+ ${summary}${selected.length ? ` (${selected.length})` : ""}</summary>
      <div class="experience-refinement-body">
        <div class="experience-refinement-head">
          <span class="feedback-detail-prompt"><strong>${prompt}</strong> Optional.</span>
          <span class="experience-refinement-limit">${selected.length}/${MAX_REFINEMENTS}</span>
        </div>
        <div class="detail-chip-row" role="group" aria-label="${esc(prompt)}">
          ${options.map(({ id, label }) => {
            const pressed = selected.includes(id);
            const disabled = !pressed && selected.length >= MAX_REFINEMENTS;
            return `<button
              class="detail-chip refinement-chip"
              type="button"
              data-feedback-item="${itemId}"
              data-feedback-refinement="${id}"
              aria-pressed="${pressed}"
              ${disabled ? "disabled" : ""}
            >${esc(label)}</button>`;
          }).join("")}
        </div>
      </div>
    </details>`;
}
