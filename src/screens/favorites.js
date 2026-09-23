import { favorites } from "../data/catalog.js";
import { state } from "../state.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { renderStickerField } from "../components/stickers.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";

const widthClasses = ["tile-w4", "tile-w2", "tile-w3", "tile-w3", "tile-w3", "tile-w4", "tile-w2", "tile-w3"];

function favoriteCard(item, originalIndex, visibleIndex) {
  const selected = state.selectedFavorites.has(item.id);
  const widthClass = widthClasses[visibleIndex % widthClasses.length];
  const titleSafeClass = item.id === "starwars" ? "favorite-title-safe" : "";

  return `
    <button class="favorite-tile ${widthClass} favorite-tone-${originalIndex + 1} ${titleSafeClass}" type="button" data-favorite="${item.id}" aria-pressed="${selected}">
      <span class="favorite-tape" aria-hidden="true"></span>
      <div class="favorite-tile-top">
        <span class="favorite-number">${String(originalIndex + 1).padStart(2, "0")}</span>
        <span class="favorite-medium">${esc(displayLabel(item))}</span>
        <span class="favorite-check" aria-hidden="true">&#10003;</span>
      </div>
      <div class="favorite-tile-copy">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.note)}</p>
      </div>
    </button>`;
}

export function renderFavorites() {
  const count = state.selectedFavorites.size;
  const visible = favorites
    .map((item, originalIndex) => ({ item, originalIndex }))
    .filter(({ item }) => itemMatchesDomain(item, state.favoriteFilter));

  return `
    <section class="favorites-screen">
      ${renderStickerField("favorites")}
      <div class="favorites-hero">
        <div>
          <p class="kicker">Build your starter mix</p>
          <h1>Pick the things that feel the most <span class="marker-word">you.</span></h1>
          <p class="lede">${state.onboarded
            ? "No giant onboarding quiz. A handful of strong favorites is enough to start."
            : "Pick a few strong favorites so Tastemake can make its first guess about what tends to click for you."}</p>
        </div>
        <div class="favorites-side-note" aria-hidden="true">
          <span>your taste,</span>
          <strong>not a genre box.</strong>
          <span class="note-arrow">&#8601;</span>
        </div>
      </div>

      <div class="filter-band">
        <span class="filter-band-label">Browse favorites</span>
        ${renderDomainFilter({ selected: state.favoriteFilter, scope: "favorites", label: "Filter favorites by type" })}
      </div>

      <h2 class="visually-hidden">Starter favorites to choose from</h2>
      <div class="taste-board" aria-label="Starter favorites">
        ${visible.length
          ? visible.map(({ item, originalIndex }, visibleIndex) => favoriteCard(item, originalIndex, visibleIndex)).join("")
          : `<div class="filter-empty">Nothing in this category yet. Try All.</div>`}
      </div>

      <div class="favorites-footer">
        <div class="selection-counter">
          <span class="selection-number">${count}</span>
          <span>selected<br /><small>4 is enough to start</small></span>
        </div>
        <div class="action-group">
          ${state.onboarded ? `<button class="button button-secondary" type="button" data-action="view-model" ${count < 4 ? "disabled" : ""}>Peek at my taste</button>` : ""}
          <button class="button button-primary" type="button" data-action="show-recs" ${count < 4 ? "disabled" : ""}>${state.onboarded ? "Show me what I might like" : "Show me my first picks"} <span aria-hidden="true">&rarr;</span></button>
        </div>
      </div>
    </section>`;
}
