import { state } from "../state.js";
import { dislikedItems, libraryItems } from "../model/library.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { renderStickerField } from "../components/stickers.js";

// Library: things the user has actually tried and liked, plus their starter favorites.
// Everything here is derived (see model/library.js); the buttons just correct the underlying reaction.

const SOURCE_LABEL = { starter: "Starter pick", loved: "Loved it", liked: "Liked it" };

function reactionButton(itemId, action, label, pressed) {
  return `
    <button class="button button-secondary library-action" type="button" data-library-item="${itemId}" data-library-action="${action}" aria-pressed="${pressed}">${label}</button>`;
}

function libraryCard(entry) {
  const { item, id, source } = entry;
  const tried = source !== "starter";

  const controls = tried
    ? `
      <div class="library-actions" role="group" aria-label="How did ${item.title} go?">
        <span class="library-actions-label">How did it go?</span>
        ${reactionButton(id, "loved", "Loved it", source === "loved")}
        ${reactionButton(id, "liked", "Liked it", source === "liked")}
        ${reactionButton(id, "disliked", "Didn't like it", false)}
        ${source === "loved"
          ? `<button class="button ${entry.isFavorite ? "button-quiet" : "button-primary"} library-action" type="button" data-library-item="${id}" data-library-action="${entry.isFavorite ? "unfavorite" : "favorite"}">${entry.isFavorite ? "Remove from Favorites" : "Add to Favorites"}</button>`
          : ""}
      </div>`
    : `
      <div class="library-actions">
        <button class="button button-quiet" type="button" data-action="back-favorites">Change on the Favorites page</button>
      </div>`;

  return `
    <article class="library-card ${entry.isFavorite ? "is-favorite" : ""}" data-library-id="${id}">
      <span class="library-tape" aria-hidden="true"></span>
      <div class="library-meta">
        <span class="library-medium">${item.medium}</span>
        <span class="library-source">${entry.isFavorite && tried ? "Favorite" : SOURCE_LABEL[source]}</span>
      </div>
      <h3>${item.title}</h3>
      <p class="library-blurb">${entry.blurb}</p>
      ${controls}
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
            <span>${item.title} <em>${item.medium}</em></span>
            <span class="library-restore" role="group" aria-label="Correct ${item.title}">
              <button class="button button-quiet library-action" type="button" data-library-item="${id}" data-library-action="liked">Actually, I liked it</button>
              <button class="button button-quiet library-action" type="button" data-library-item="${id}" data-library-action="loved">Actually, I loved it</button>
            </span>
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
        <p class="lede">Things you've actually tried and liked, plus your starter favorites. It fills up as you tell Tastemake how things went. Saved-for-later picks you haven't tried live in Bookmarks instead.</p>
      </div>

      <div class="filter-band library-filter-band">
        <span class="filter-band-label">Show me</span>
        ${renderDomainFilter({ selected: state.libraryFilter, scope: "library", label: "Filter your library by type" })}
      </div>

      ${section("Favorites", "Your starter picks, plus anything you loved and starred.", shown(favoriteEntries), "No favorites in this category. Try All.")}
      ${section("Library", "Everything else you've tried and liked or loved.", shown(libraryEntries),
        "Nothing here yet. When you tell Tastemake you loved or liked something you've tried, it lands here.")}
      ${dislikedBlock(disliked)}

      <div class="recommendation-footer">
        <span class="footer-note">tried it. told you. kept it.</span>
        <div class="action-group recommendation-footer-actions">
          <button class="button button-primary" type="button" data-action="show-recs">Back to discovering</button>
          <button class="button button-quiet" type="button" data-action="view-model">See my Taste Profile</button>
        </div>
      </div>
    </section>`;
}
