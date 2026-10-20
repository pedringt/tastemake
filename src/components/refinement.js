import { isExperiencedNegative, isExperiencedPositive } from "../model/evidence.js";
import { MAX_REFINEMENTS, contentOptionsFor, dimensionOf, directionOptionsFor, normalizedRefinements, refinementOptionsFor, refinementRecords } from "../model/refinements.js";
import { esc } from "../lib/html.js";

// Design pass (Oct 20): one quiet line until opened; chips are neutral until chosen, and a chosen chip is
// filled with a check, so color never means anything else. A chosen dimension's directions open directly
// under that chip (not below the whole grid), so with two open it stays clear which row is which.
function chip(itemId, id, label, { pressed, disabled, extraClass = "" }) {
  return `<button
    class="detail-chip refinement-chip ${extraClass}"
    type="button"
    data-feedback-item="${itemId}"
    data-feedback-refinement="${esc(id)}"
    aria-pressed="${pressed}"
    ${disabled ? "disabled" : ""}
  >${pressed ? `<span class="refinement-check" aria-hidden="true">✓</span>` : ""}${esc(label)}</button>`;
}

export function renderExperienceRefinement(itemId, item, feedback, { compact = false } = {}) {
  const positive = isExperiencedPositive(feedback);
  const negative = isExperiencedNegative(feedback);
  if (!positive && !negative) return "";

  const polarity = positive ? "positive" : "negative";
  const selected = normalizedRefinements(feedback);
  const selectedByDimension = new Map(selected.map((id) => [dimensionOf(id), id]));
  const full = selected.length >= MAX_REFINEMENTS;
  const question = positive ? "What worked for you?" : "What didn’t work for you?";
  const options = refinementOptionsFor(item);

  // A content chip chosen earlier stays visible (and removable) even if the item's subjects changed since.
  const offered = contentOptionsFor(item, polarity);
  const plainIds = new Set(options.map(({ id }) => id));
  const kept = refinementRecords(feedback)
    .filter(({ id }) => !plainIds.has(dimensionOf(id)) && !offered.some((option) => option.id === id));
  const content = [...offered, ...kept];

  // Directions for a chosen dimension, placed right after its chip. Optional: the plain dimension still
  // counts, and a direction never uses up another of the five.
  const directionsFor = (id, label) => {
    const directions = directionOptionsFor(item, id, polarity);
    if (!selectedByDimension.has(id) || !directions.length) return "";
    const current = selectedByDimension.get(id);
    return `
          <span class="refinement-directions" role="group" aria-label="${esc(label)}: how? Optional.">
            <span class="refinement-directions-label" aria-hidden="true">How?</span>
            ${directions.map((direction) => chip(itemId, `${id}:${direction.id}`, direction.label, {
              pressed: current === `${id}:${direction.id}`,
              disabled: false,
              extraClass: "refinement-direction-chip"
            })).join("")}
          </span>`;
  };

  return `
    <details class="experience-refinement ${compact ? "is-compact" : ""}" ${selected.length ? "open" : ""} data-refinement-item="${itemId}">
      <summary>
        <span class="experience-refinement-invite">${question}</span>
        <span class="experience-refinement-meta">${selected.length ? `${selected.length} of ${MAX_REFINEMENTS}` : "Optional"}</span>
      </summary>
      <div class="experience-refinement-body">
        <div class="detail-chip-row refinement-chip-row" role="group" aria-label="${esc(question)} Pick up to ${MAX_REFINEMENTS}.">
          ${content.map(({ id, label }) => {
            const pressed = selected.includes(id);
            return chip(itemId, id, label, { pressed, disabled: !pressed && full, extraClass: "refinement-content-chip" });
          }).join("")}
          ${options.map(({ id, label }) => {
            const pressed = selectedByDimension.has(id);
            return chip(itemId, id, label, { pressed, disabled: !pressed && full }) + directionsFor(id, label);
          }).join("")}
        </div>
      </div>
    </details>`;
}
