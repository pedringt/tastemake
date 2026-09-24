import { state } from "../state.js";
import { dislikedItems, libraryItems } from "../model/library.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { renderTastebreakPanel } from "../components/tastebreak.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { renderArtwork } from "../components/artwork.js";

// Library: things the user has actually tried and liked, plus their Favorites.
// Everything here is derived (see model/library.js); the buttons just correct the underlying reaction.

const SOURCE_LABEL = { starter: "Favorite", loved: "Loved it", liked: "Liked it" };

function reactionButton(itemId, action, label, pressed) {
  return `
    <button class="button button-secondary library-action" type="button" data-library-item="${itemId}" data-library-action="${action}" aria-pressed="${pressed}">${label}</button>`;
}

function libraryCard(entry) {
  const { item, id, source } = entry;
  const tried = source !== "starter";

  const controls = tried
    ? `
      <div class="library-reaction-summary">
        <span>Your reaction <strong>${source === "loved" ? "Loved it" : "Liked it"}</strong></span>
        <details class="library-reaction-edit">
          <summary>Change</summary>
          <div class="library-reaction-options" role="group" aria-label="Change your reaction to ${esc(item.title)}">
            ${reactionButton(id, "loved", "Loved it", source === "loved")}
            ${reactionButton(id, "liked", "Liked it", source === "liked")}
            ${reactionButton(id, "disliked", "Didn't like it", false)}
          </div>
        </details>
      </div>
      ${source === "loved"
        ? `<div class="library-secondary"><button class="button button-quiet library-action" type="button" data-library-item="${id}" data-library-action="${entry.isFavorite ? "unfavorite" : "favorite"}">${entry.isFavorite ? "Remove from Favorites" : "Add to Favorites"}</button></div>`
        : ""}`
    : `
      <div class="library-starter-actions">
        <button class="button button-quiet" type="button" data-starter-replace="${id}">Replace</button>
        <button class="library-inline-remove" type="button" data-starter-remove="${id}">Remove</button>
      </div>`;

  return `
    <article class="library-card ${entry.isFavorite ? "is-favorite" : ""} ${item.artwork ? "has-artwork" : ""}" data-library-id="${id}">
      ${item.artwork ? renderArtwork(item, "library-artwork") : ""}
      <span class="library-tape" aria-hidden="true"></span>
      <div class="library-meta">
        <span class="library-medium">${esc(displayLabel(item))}</span>
        <span class="library-source">${entry.isFavorite && tried ? "Favorite" : SOURCE_LABEL[source]}</span>
      </div>
      <h3>${esc(item.title)}</h3>
      <p class="library-blurb">${esc(entry.blurb)}</p>
      ${controls}
      ${tried ? renderTastebreakPanel(id) : ""}
    </article>`;
}

function section(title, note, entries, emptyText) {
  return `
    <section class="library-section" aria-label="${title}">
      <div class="library-section-head">
        <h2>${title}</h2>
        <p>${note}</p>
      </div>
      <div class="library-grid">
        ${entries.length ? entries.map(libraryCard).join("") : `<div class="filter-empty library-empty">${emptyText}</div>`}
      </div>
    </section>`;
}

function dislikedBlock(items) {
  if (!items.length) return "";
  return `
    <details class="library-disliked">
      <summary>Things you didn't like (${items.length})</summary>
      <p>These stay out of your Library. Tastemake keeps them in the background so it can learn from them, and you can correct any that you got wrong.</p>
      <ul>
        ${items.map(({ id, item }) => `
          <li>
            <div class="library-disliked-row">
              <span>${esc(item.title)} <em>${esc(displayLabel(item))}</em></span>
              <span class="library-restore" role="group" aria-label="Correct ${esc(item.title)}">
                <button class="button button-quiet library-action" type="button" data-library-item="${id}" data-library-action="liked">Actually, I liked it</button>
                <button class="button button-quiet library-action" type="button" data-library-item="${id}" data-library-action="loved">Actually, I loved it</button>
              </span>
            </div>
            ${renderBlindSpotPanel(id)}
            ${renderTastebreakPanel(id)}
          </li>`).join("")}
      </ul>
    </details>`;
}

export function renderLibrary() {
  const { favorites: favoriteEntries, library: libraryEntries } = libraryItems(state);
  const shown = (entries) => entries.filter((entry) => itemMatchesDomain(entry.item, state.libraryFilter));
  const disliked = dislikedItems(state).filter((entry) => itemMatchesDomain(entry.item, state.libraryFilter));

  return `
    <section class="library-screen">
      ${renderStickerField("library")}
      <div class="library-masthead">
        <p class="kicker">Tried and liked</p>
        <h1>Your library.</h1>
        <p class="lede">Things you've actually tried and liked, plus your Favorites. It fills up as you tell Tastemake how things went. Things you have not tried yet live in Try Next.</p>
      </div>

      <div class="filter-band library-filter-band">
        <span class="filter-band-label">Show me</span>
        ${renderDomainFilter({ selected: state.libraryFilter, scope: "library", label: "Filter your library by type" })}
      </div>

      ${section("Favorites", "Things you love, including the Favorites you started with.", shown(favoriteEntries), "No favorites in this category. Try All.")}
      ${section("Library", "Everything else you've tried and liked or loved.", shown(libraryEntries),
        "Nothing here yet. When you tell Tastemake you loved or liked something you've tried, it lands here.")}
      ${dislikedBlock(disliked)}

      <div class="recommendation-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="show-recs">&larr; Recommendations</button></div>
        <span class="footer-note">tried it. told you. kept it.</span>
      </div>
    </section>`;
}
