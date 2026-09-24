import { state } from "../state.js";
import { LOOKS } from "../data/looks.js";
import { recommendations } from "../data/catalog.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";

// "Choose a starting look" (#25). Each card is a small preview drawn with that look's own styles
// (see styles/look.css), so people choose by seeing, not by reading a label. Picking one also
// applies it to the whole page straight away, so the page behind is a live preview too.

// Every preview renders the SAME real, recognizable Tastemake content (one fixed catalog item), so the
// only variable a person is comparing is the skin itself, not the example — including a "Why this one?"
// pill, since that's one of the product's own more recognizable elements.
const sample = recommendations[0];

function preview(id) {
  return `
    <span class="look-preview" data-look="${id}" aria-hidden="true">
      <span class="pv-bar"><b class="pv-brand">Tastemake</b><i class="pv-pill"></i><i class="pv-pill"></i></span>
      <span class="pv-card">
        <i class="pv-chip">${esc(displayLabel(sample))}</i>
        <b class="pv-title">${esc(sample.title)}</b>
        <i class="pv-line"></i><i class="pv-line pv-short"></i>
        <span class="pv-row">
          <i class="pv-btn pv-btn-on">More</i><i class="pv-btn">Less</i>
          <i class="pv-why">Why this one?</i>
        </span>
      </span>
      <span class="pv-deco pv-deco-a"></span><span class="pv-deco pv-deco-b"></span><span class="pv-deco pv-deco-c"></span>
    </span>`;
}

// #59 item 5: the picker is never a forced first step any more (a new visitor starts straight in the
// default look), so this is always reached as a deliberate "change my look" visit.
export function lookContinueLabel() {
  return state.setupComplete ? "Done" : "Next";
}

export function renderLook() {
  return `
    <section class="look-screen">
      <header class="look-head">
        <div>
          <p class="look-eyebrow">Look</p>
          <h1>Choose a look.</h1>
          <p class="look-lede">The same Tastemake, four ways to see it. Nothing else changes, and you can switch any time from the Look button at the top.</p>
        </div>
        <button class="button button-primary look-top-action" type="button" data-action="look-done">${lookContinueLabel()}</button>
      </header>
      <fieldset class="look-picker">
        <legend class="visually-hidden">Look</legend>
        ${LOOKS.map((look) => `
          <label class="look-card ${look.id === state.look ? "is-selected" : ""}" data-look-choice="${look.id}">
            <input class="visually-hidden" type="radio" name="look" value="${look.id}" ${look.id === state.look ? "checked" : ""} />
            ${preview(look.id)}
            <span class="look-card-name">${esc(look.label)}${look.id === "editorial" ? '<span class="look-default"> (default)</span>' : ""}</span>
            <span class="look-card-blurb">${esc(look.blurb)}</span>
          </label>`).join("")}
      </fieldset>
      <p class="look-note">Choosing a look doesn't tell Tastemake anything about your taste.</p>
    </section>`;
}
