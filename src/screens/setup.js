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

function setupSummary() {
  const scope = state.setupAreas.has("all")
    ? "Movies, TV, books, and games"
    : visibleDomains().filter((domain) => state.setupAreas.has(domain.id)).map((domain) => domain.label).join(", ");
  const style = STYLES.find(([id]) => id === state.recommendationStyle) ?? STYLES[1];

  return `
    <aside class="setup-support" aria-label="Setup summary">
      <div class="setup-support-card">
        <p class="setup-support-kicker">What this affects</p>
        <h2>Your first recommendations start here.</h2>
        <p>Tastemake uses these settings to decide what kinds of things to offer and how far it should stretch from obvious matches.</p>
      </div>
      <div class="setup-preview">
        <p class="setup-support-kicker">Current setup</p>
        <dl>
          <div><dt>Name</dt><dd>${esc(state.displayName.trim() || "Not set yet")}</dd></div>
          <div><dt>Scope</dt><dd>${esc(scope || "All")}</dd></div>
          <div><dt>Feel</dt><dd>${esc(style[1])}</dd></div>
        </dl>
      </div>
      <p class="setup-support-note">Favorites and ratings teach Tastemake what actually fits. Setup only controls the starting lane.</p>
    </aside>`;
}

export function renderSetup() {
  const editing = state.setupComplete;
  const settingsCards = `
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
        </section>`;

  return `
    <section class="setup-screen">
      <header class="setup-head">
        <div>
          <p class="kicker">${editing ? "Settings" : "Quick setup"}</p>
          <h1>${editing ? "Your Tastemake setup." : "What should Tastemake call you?"}</h1>
          <p class="lede">${editing ? "Adjust what Tastemake recommends and how adventurous it gets." : "Then jump straight into a few things you love."}</p>
        </div>
      </header>

      <div class="setup-layout">
        <div class="setup-main">
          <div class="setup-grid ${editing ? "" : "is-first-run"}">
            <section class="setup-card" aria-labelledby="setup-name-title">
              <p class="setup-step">01</p>
              <h2 id="setup-name-title">Your name <span class="setup-optional">(optional)</span></h2>
              <label class="setup-field">
                <span>Display name (optional)</span>
                <input type="text" data-setup-name maxlength="40" autocomplete="name" value="${esc(state.displayName)}" placeholder="Your name" />
              </label>
            </section>
            ${settingsCards}
          </div>
          <div class="setup-form-actions">
            <p class="setup-note">${editing ? "These settings change what Tastemake serves you, not what it thinks you like." : "Next: choose four favorites and get your first recommendations."}</p>
            <button class="button button-primary setup-next" type="button" data-action="setup-done">${editing ? "Save" : "Next"}</button>
          </div>
        </div>
        ${setupSummary()}
      </div>
    </section>`;
}
