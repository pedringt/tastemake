import { favorites, hypotheses } from "../data/catalog.js";
import { state } from "../state.js";
import { modelUpdateFor, untriedReactionLean } from "../model/taste.js";
import { renderStickerField } from "../components/stickers.js";

function hypothesisCard(item, index) {
  const update = modelUpdateFor(state, item);
  const confidenceLabel = update.label === item.strength ? item.strength : update.label;
  const lean = untriedReactionLean(state, item);
  const leanLine = lean.direction
    ? `<div class="signal-lean is-${lean.direction}" title="Not counted as taste until you have tried them.">
          <span aria-hidden="true">${lean.direction === "toward" ? "&nearr;" : "&searr;"}</span>
          Your reactions lean ${lean.direction === "toward" ? "toward" : "away from"} this
          <em>(from ${lean.count} ${lean.count === 1 ? "pick" : "picks"} you haven't tried)</em>
        </div>`
    : "";
  return `
    <article class="signal-row signal-row-${index + 1}">
      <div class="signal-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="signal-main">
        <div class="signal-title-row">
          <h3>${item.title}</h3>
          <span class="signal-status ${update.status}">${confidenceLabel}</span>
        </div>
        <p class="signal-claim">${item.claim}</p>
        <div class="signal-evidence"><span>shows up in</span> ${item.evidence}</div>
        ${update.note ? `<div class="signal-update"><strong>New signal:</strong> ${update.note}</div>` : ""}
        ${leanLine}
      </div>
    </article>`;
}

export function renderProfile() {
  const selectedTitles = favorites.filter((item) => state.selectedFavorites.has(item.id)).map((item) => item.title);

  return `
    <section class="profile-screen">
      ${renderStickerField("profile")}
      <div class="profile-hero">
        <div class="profile-title-block">
          <p class="kicker">Taste Profile</p>
          <h1><span class="profile-headline-lead">Less "you like fantasy."</span><br class="profile-headline-break" /><span class="profile-headline-highlight">More "this is what tends to click."</span></h1>
          <p class="lede">These are working patterns, not one fixed aesthetic. They can overlap, disagree, get stronger, or become more specific as you react.</p>
          <p class="lede profile-evidence-note">Your taste updates from things you have actually tried. Reactions to picks you have not tried only shape what comes next; they show up below as a lean, not as taste.</p>
        </div>
        <div class="profile-stamp" aria-hidden="true">
          <strong>WORKING</strong>
          <span>PROFILE</span>
        </div>
      </div>

      <div class="profile-evidence-strip">
        <span class="profile-evidence-label">Built from</span>
        <div class="profile-evidence-track">
          ${selectedTitles.map((title, index) => `<span class="profile-evidence-item evidence-${(index % 4) + 1}">${title}</span>`).join("")}
        </div>
      </div>

      <div class="profile-map">
        <aside class="profile-map-aside">
          <span class="profile-aside-number">${hypotheses.length}</span>
          <p>patterns currently shaping your recommendations</p>
          <div class="profile-aside-note">patterns, not one aesthetic &nearr;</div>
        </aside>

        <div class="signal-stack">
          ${hypotheses.map(hypothesisCard).join("")}
        </div>
      </div>

      <div class="profile-footer">
        <span class="footer-note">useful if you are curious. invisible if you are not.</span>
        <div class="action-group">
          <button class="button button-secondary" type="button" data-action="back-favorites">Edit favorites</button>
          <button class="button button-primary" type="button" data-action="show-recs">Back to recommendations <span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>
    </section>`;
}
