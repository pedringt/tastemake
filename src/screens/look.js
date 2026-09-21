import { state } from "../state.js";
import { LOOKS, lookLabel } from "../data/looks.js";

// "Choose a starting look" (#25). Each card is a small preview drawn with that look's own styles
// (see styles/look.css), so people choose by seeing, not by reading a label. Picking one also
// applies it to the whole page straight away, so the page behind is a live preview too.

function preview(id) {
  return `
    <span class="look-preview" data-look="${id}" aria-hidden="true">
      <span class="pv-bar"><b class="pv-brand">Tastemake</b><i class="pv-pill"></i><i class="pv-pill"></i></span>
      <span class="pv-card">
        <i class="pv-chip">Movie</i>
        <b class="pv-title">Pick the things that feel like you.</b>
        <i class="pv-line"></i><i class="pv-line pv-short"></i>
        <span class="pv-row"><i class="pv-btn pv-btn-on">More</i><i class="pv-btn">Less</i></span>
      </span>
      <span class="pv-deco pv-deco-a"></span><span class="pv-deco pv-deco-b"></span><span class="pv-deco pv-deco-c"></span>
    </span>`;
}

export function lookContinueLabel() {
  return state.lookOnboarding ? `Continue with ${lookLabel(state.look)}` : "Done";
}

export function renderLook() {
  return `
    <section class="look-screen">
      <p class="look-eyebrow">Before we start</p>
      <h1>Choose a starting look.</h1>
      <p class="look-lede">The same Tastemake, four ways to see it. Nothing else changes, and you can switch any time from the Look button at the top.</p>
      <fieldset class="look-picker">
        <legend class="visually-hidden">Look</legend>
        ${LOOKS.map((look) => `
          <label class="look-card ${look.id === state.look ? "is-selected" : ""}" data-look-choice="${look.id}">
            <input class="visually-hidden" type="radio" name="look" value="${look.id}" ${look.id === state.look ? "checked" : ""} />
            ${preview(look.id)}
            <span class="look-card-name">${look.label}${look.id === "editorial" ? '<span class="look-default"> (starting point)</span>' : ""}</span>
            <span class="look-card-blurb">${look.blurb}</span>
          </label>`).join("")}
      </fieldset>
      <p class="look-note">Choosing a look doesn't tell Tastemake anything about your taste.</p>
      <div class="look-actions">
        <button class="button button-primary" type="button" data-action="look-done">${lookContinueLabel()}</button>
      </div>
    </section>`;
}
