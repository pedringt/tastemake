import { isExperiencedNegative, isExperiencedPositive } from "../model/evidence.js";
import { MAX_REFINEMENTS, contentOptionsFor, dimensionOf, directionOptionsFor, normalizedRefinements, refinementOptionsFor, refinementRecords } from "../model/refinements.js";
import { esc } from "../lib/html.js";

function chip(itemId, id, label, { pressed, disabled, extraClass = "" }) {
  return `<button
    class="detail-chip refinement-chip ${extraClass}"
    type="button"
    data-feedback-item="${itemId}"
    data-feedback-refinement="${esc(id)}"
    aria-pressed="${pressed}"
    ${disabled ? "disabled" : ""}
  >${esc(label)}</button>`;
}

export function renderExperienceRefinement(itemId, item, feedback, { compact = false } = {}) {
  const positive = isExperiencedPositive(feedback);
  const negative = isExperiencedNegative(feedback);
  if (!positive && !negative) return "";

  const polarity = positive ? "positive" : "negative";
  const selected = normalizedRefinements(feedback);
  const selectedByDimension = new Map(selected.map((id) => [dimensionOf(id), id]));
  const full = selected.length >= MAX_REFINEMENTS;
  const prompt = positive ? "What worked for you?" : "What didn’t work for you?";
  const summary = positive ? "What worked?" : "What didn’t work?";
  const options = refinementOptionsFor(item);
  // A content chip chosen earlier stays visible (and removable) even if the item's subjects changed since.
  const offered = contentOptionsFor(item, polarity);
  const plainIds = new Set(options.map(({ id }) => id));
  const kept = refinementRecords(feedback)
    .filter(({ id }) => !plainIds.has(dimensionOf(id)) && !offered.some((option) => option.id === id));
  const content = [...offered, ...kept];

  // #250: a selected dimension with directions opens a row of them underneath. Picking one is optional;
  // the plain dimension still counts, and a direction never uses up another of the five.
  const directionRows = options
    .filter(({ id }) => selectedByDimension.has(id) && directionOptionsFor(item, id, polarity).length)
    .map(({ id, label }) => {
      const current = selectedByDimension.get(id);
      return `
        <div class="refinement-direction-row" role="group" aria-label="${esc(label)}: how? (optional)">
          <span class="refinement-direction-label">${esc(label)}<span class="refinement-direction-optional">: how? (optional)</span></span>
          ${directionOptionsFor(item, id, polarity).map((direction) => chip(itemId, `${id}:${direction.id}`, direction.label, {
            pressed: current === `${id}:${direction.id}`,
            disabled: false,
            extraClass: "refinement-direction-chip"
          })).join("")}
        </div>`;
    }).join("");

  return `
    <details class="experience-refinement ${compact ? "is-compact" : ""}" ${selected.length ? "open" : ""} data-refinement-item="${itemId}">
      <summary>
        <span class="experience-refinement-invite">${compact ? summary : "Want to get more specific?"}</span>
        <span class="experience-refinement-action">${compact ? "" : summary}${selected.length ? ` (${selected.length})` : ""}</span>
      </summary>
      <div class="experience-refinement-body">
        <div class="experience-refinement-head">
          <span class="feedback-detail-prompt"><strong>${prompt}</strong> Pick any that mattered, up to ${MAX_REFINEMENTS}.</span>
          <span class="experience-refinement-limit">${selected.length}/${MAX_REFINEMENTS}</span>
        </div>
        ${compact ? "" : `<p class="experience-refinement-help">Optional. This helps Tastemake understand your taste more precisely.</p>`}
        <div class="detail-chip-row" role="group" aria-label="${esc(prompt)}">
          ${content.map(({ id, label }) => {
            const pressed = selected.includes(id);
            return chip(itemId, id, label, { pressed, disabled: !pressed && full, extraClass: "refinement-content-chip" });
          }).join("")}
          ${options.map(({ id, label }) => {
            const pressed = selectedByDimension.has(id);
            return chip(itemId, id, label, { pressed, disabled: !pressed && full });
          }).join("")}
        </div>
        ${directionRows}
      </div>
    </details>`;
}
