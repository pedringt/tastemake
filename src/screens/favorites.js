import { state } from "../state.js";
import { starterItems } from "../model/starters.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { renderStickerField } from "../components/stickers.js";

function starterCard(item, index) {
  const blurb = item.about ?? item.note ?? "One of the things you love.";
  return `
    <article class="starter-card" data-starter-id="${item.id}">
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

export function renderFavorites() {
  const selected = starterItems(state);
  const count = selected.length;
  const slots = Array.from({ length: Math.max(4, count) }, (_, index) => selected[index]
    ? starterCard(selected[index], index)
    : placeholder(index));

  return `
    <section class="favorites-screen">
      ${renderStickerField("favorites")}
      <div class="favorites-hero starter-hero">
        <div>
          <p class="kicker">Build your starter mix</p>
          <h1>Start with something you <span class="marker-word">love.</span></h1>
          <p class="lede">Search for books, movies, shows, or games that feel especially you. Four strong examples are enough for Tastemake to make its first guesses.</p>
          <button class="button button-primary starter-search" type="button" data-action="open-search">Search for something you love</button>
        </div>
        <div class="favorites-side-note" aria-hidden="true">
          <span>real examples,</span>
          <strong>not a personality quiz.</strong>
          <span class="note-arrow">&#8601;</span>
        </div>
      </div>

      <div class="starter-progress" aria-live="polite">
        <strong>${count} of 4</strong>
        <span>${count >= 4 ? "Enough to start." : "Add a few favorites to teach Tastemake where to begin."}</span>
      </div>

      <h2 class="visually-hidden">Your starter mix</h2>
      <div class="starter-grid" aria-label="Your starter mix">
        ${slots.join("")}
      </div>

      <div class="favorites-footer">
        <div class="selection-counter">
          <span class="selection-number">${count}</span>
          <span>in your starter mix<br /><small>4 is enough to start</small></span>
        </div>
        <div class="action-group">
          ${state.onboarded ? `<button class="button button-secondary" type="button" data-action="view-model" ${count < 4 ? "disabled" : ""}>Peek at my taste</button>` : ""}
          <button class="button button-primary" type="button" data-action="show-recs" ${count < 4 ? "disabled" : ""}>${state.onboarded ? "Show me what I might like" : "Show me my first picks"} <span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>
    </section>`;
}
