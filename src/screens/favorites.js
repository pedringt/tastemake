import { state } from "../state.js";
import { starterItems } from "../model/starters.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { renderStickerField } from "../components/stickers.js";
import { renderArtwork } from "../components/artwork.js";

function starterCard(item, index) {
  const blurb = item.about ?? item.note ?? "One of the things you love.";
  return `
    <article class="starter-card ${item.artwork ? "has-artwork" : ""}" data-starter-id="${item.id}">
      ${item.artwork ? renderArtwork(item, "starter-artwork") : ""}
      <span class="starter-index">0${index + 1}</span>
      <span class="starter-medium">${esc(displayLabel(item))}</span>
      <h3>${esc(item.title)}</h3>
      <p>${esc(blurb)}</p>
      <div class="starter-actions">
        <button class="button button-quiet starter-action" type="button" data-starter-replace="${item.id}">Replace</button>
        <button class="starter-remove" type="button" data-starter-remove="${item.id}">Remove</button>
      </div>
    </article>`;
}

function placeholder(index) {
  return `
    <button class="starter-placeholder" type="button" data-action="open-search">
      <span class="starter-index">0${index + 1}</span>
      <span class="starter-plus" aria-hidden="true">+</span>
      <strong>Add something you love</strong>
      <span>Search by title</span>
    </button>`;
}

// #103 item 7: once a returning user already has favorites, this screen should read as "here's what
// you've told Tastemake represents your taste" (Your Taste Foundations), not a repeat of onboarding.
// The nav item stays labeled "Favorites"; only the in-page framing and copy change. First-run users
// (not yet onboarded, or with fewer than 4 favorites) still see the original onboarding framing,
// since they have not finished telling Tastemake anything yet.
function isReturningUser(count) {
  return state.onboarded && count >= 4;
}

export function renderFavorites() {
  const selected = starterItems(state);
  const count = selected.length;
  const returning = isReturningUser(count);
  const slots = Array.from({ length: Math.max(4, count) }, (_, index) => selected[index]
    ? starterCard(selected[index], index)
    : placeholder(index));

  const hero = returning
    ? `
      <div class="favorites-hero starter-hero foundations-hero">
        <div>
          <p class="kicker">Your Taste Foundations</p>
          <h1>What you've told Tastemake <span class="marker-word">really represents you.</span></h1>
          <p class="lede">These ${count} favorites are the strongest signal your Taste Profile is built on. Add another when something new belongs here, or remove one that no longer fits &mdash; your profile updates from what's actually here now.</p>
          <button class="button button-primary starter-search" type="button" data-action="open-search">Add another favorite</button>
        </div>
        <div class="favorites-side-note" aria-hidden="true">
          <span>your evidence,</span>
          <strong>not a quiz you already took.</strong>
          <span class="note-arrow">&#8601;</span>
        </div>
      </div>`
    : `
      <div class="favorites-hero starter-hero">
        <div>
          <p class="kicker">Choose your favorites</p>
          <h1>Start with something you <span class="marker-word">love.</span></h1>
          <p class="lede">Pick books, movies, shows, or games you've already tried and loved. Four favorites are enough for Tastemake to make its first guesses.</p>
          <button class="button button-primary starter-search" type="button" data-action="open-search">Search for something you love</button>
        </div>
        <div class="favorites-side-note" aria-hidden="true">
          <span>real examples,</span>
          <strong>not a personality quiz.</strong>
          <span class="note-arrow">&#8601;</span>
        </div>
      </div>`;

  const progress = returning
    ? `
      <div class="starter-progress" aria-live="polite">
        <strong>${count} favorite${count === 1 ? "" : "s"}</strong>
        <span>Each one still shapes your Taste Profile. <button type="button" class="button-quiet button-inline" data-action="view-model">See how, on your profile.</button></span>
      </div>`
    : `
      <div class="starter-progress" aria-live="polite">
        <strong>${count} of 4</strong>
        <span>${count >= 4 ? "Enough to start." : "Add a few favorites to teach Tastemake where to begin."}</span>
      </div>`;

  return `
    <section class="favorites-screen ${returning ? "is-foundations" : ""}">
      ${renderStickerField("favorites")}
      ${hero}
      ${progress}

      <h2 class="visually-hidden">Your favorites</h2>
      <div class="starter-grid" aria-label="Your favorites">
        ${slots.join("")}
      </div>

      <div class="favorites-footer">
        <div class="selection-counter">
          <span class="selection-number">${count}</span>
          <span>favorites<br /><small>${returning ? "manage them any time" : "4 is enough to start"}</small></span>
        </div>
        <div class="action-group">
          ${state.onboarded ? `<button class="button button-secondary" type="button" data-action="view-model" ${count < 4 ? "disabled" : ""}>See profile</button>` : ""}
          <button class="button button-primary" type="button" data-action="show-recs" ${count < 4 || state.aiStatus === "loading" ? "disabled" : ""}>${state.aiStatus === "loading" ? "Finding recommendations…" : returning ? "Recommendations" : "See recommendations"} <span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>
    </section>`;
}
