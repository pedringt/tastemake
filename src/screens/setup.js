import { state } from "../state.js";
import { visibleDomains } from "../data/domains.js";
import { esc } from "../lib/html.js";

const STYLES = [
  ["safe", "Mostly safe bets", "Stay closer to the strongest matches."],
  ["balanced", "Balanced", "Mix strong fits with the occasional stretch."],
  ["adventurous", "More adventurous", "Make the exploratory pick a little bolder."]
];

function areaChoice(id, label) {
  const checked = state.setupAreas.has(id);
  return `
    <label class="setup-choice ${checked ? "is-selected" : ""}">
      <input type="checkbox" data-setup-area="${id}" ${checked ? "checked" : ""} />
      <span>${esc(label)}</span>
    </label>`;
}

export function renderSetup() {
  const editing = state.setupComplete;
  return `
    <section class="setup-screen">
      <header class="setup-head">
        <div>
          <p class="kicker">Quick setup</p>
          <h1>${editing ? "Your Tastemake setup." : "A couple basics, then the fun part."}</h1>
          <p class="lede">These settings tell Tastemake how to serve you. They do not count as taste evidence.</p>
        </div>
        <button class="button button-primary setup-next" type="button" data-action="setup-done" ${state.displayName.trim() ? "" : "disabled"}>${editing ? "Save" : "Next"}</button>
      </header>

      <div class="setup-grid">
        <section class="setup-card" aria-labelledby="setup-name-title">
          <p class="setup-step">01</p>
          <h2 id="setup-name-title">What should we call you?</h2>
          <label class="setup-field">
            <span>Display name</span>
            <input type="text" data-setup-name maxlength="40" autocomplete="name" value="${esc(state.displayName)}" placeholder="Your name" />
          </label>
        </section>

        <section class="setup-card" aria-labelledby="setup-area-title">
          <p class="setup-step">02</p>
          <h2 id="setup-area-title">What do you want recommendations for?</h2>
          <p class="setup-help">All is the default. Pick specific areas only if you want to narrow things down.</p>
          <div class="setup-choices" role="group" aria-label="Recommendation areas">
            ${areaChoice("all", "All")}
            ${visibleDomains().map((domain) => areaChoice(domain.id, domain.label)).join("")}
          </div>
        </section>

        <section class="setup-card" aria-labelledby="setup-style-title">
          <p class="setup-step">03</p>
          <h2 id="setup-style-title">How should recommendations feel?</h2>
          <div class="setup-style-list">
            ${STYLES.map(([id, label, help]) => `
              <label class="setup-style ${state.recommendationStyle === id ? "is-selected" : ""}">
                <input type="radio" name="recommendation-style" data-setup-style value="${id}" ${state.recommendationStyle === id ? "checked" : ""} />
                <span><strong>${label}</strong><small>${help}</small></span>
              </label>`).join("")}
          </div>
        </section>
      </div>

      <p class="setup-note">Next: add four things you genuinely love. Those real examples, not this setup, are what start teaching Tastemake about your taste.</p>
    </section>`;
}
