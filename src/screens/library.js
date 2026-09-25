import { state } from "../state.js";
import { bookmarkedFeedback } from "../model/taste.js";
import { dislikedItems, libraryItems } from "../model/library.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { renderTastebreakPanel } from "../components/tastebreak.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { renderArtwork } from "../components/artwork.js";

// #94: Library has one simple mental model — Recommendations is discovery, Library is your stuff.
// Saved = things you want to watch/read/play later (not yet tried; never taste evidence on its own).
// Tried = things you've actually watched/read/played and reacted to, including your Favorites.
// Saved is the default view because it's the actionable one; Tried is where you go to inspect or
// correct history. Moving something from Saved to Tried only happens when the user explicitly says
// they tried it (see actions/library.js saveBookmarkAction) — never automatically.

const SOURCE_LABEL = { starter: "Favorite", loved: "Loved it", liked: "Liked it" };

// #103 items 1/2/10: per-media-type detail fields, rendered only when present. `detail` comes from
// fetchCatalogItemDetail (fetched lazily on expand, see app.js) and every field is optional — sparse
// upstream data means an omitted line, never a label with nothing after it.
export function renderDetailMeta(item, detail = {}) {
  const lines = [];
  if (item.type === "book" && item.by) lines.push(["Author", item.by]);
  if (item.type === "movie") {
    if (detail.director) lines.push(["Director", detail.director]);
    if (detail.cast) lines.push(["Cast", detail.cast.join(", ")]);
  }
  if (item.type === "tv") {
    if (detail.creator) lines.push(["Creator", detail.creator]);
    if (detail.cast) lines.push(["Cast", detail.cast.join(", ")]);
  }
  if (item.type === "game") {
    if (detail.developer) lines.push(["Developer", detail.developer]);
    if (detail.publisher) lines.push(["Publisher", detail.publisher]);
    if (detail.platforms) lines.push(["Platforms", detail.platforms.join(", ")]);
  }
  if (!lines.length) return "";
  return `
    <dl class="library-detail-meta">
      ${lines.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
    </dl>`;
}

// ---- Saved (formerly the standalone "Try Next" screen) -------------------------------------

function savedCard(feedback) {
  const { item } = feedback;
  const action = (name, label, className = "button button-secondary") => `
    <button class="${className} bookmark-action" type="button" data-bookmark-item="${item.id}" data-bookmark-action="${name}">${label}</button>`;
  const info = [displayLabel(item), item.year].filter(Boolean).join(" · ");

  return `
    <details class="library-card library-card-compact ${item.artwork ? "has-artwork" : ""}" data-bookmark-id="${item.id}">
      <summary class="library-compact-summary">
        ${item.artwork ? renderArtwork(item, "library-compact-artwork") : `<span class="library-compact-artwork is-empty" aria-hidden="true"></span>`}
        <span class="library-compact-copy">
          <span class="library-compact-info">${esc(info)}</span>
          <strong>${esc(item.title)}</strong>
          <span class="library-compact-status">Saved</span>
        </span>
        <span class="library-compact-open" aria-hidden="true">+</span>
      </summary>
      <div class="library-compact-detail">
        <div class="library-detail-meta-slot" data-detail-slot="${item.id}">${renderDetailMeta(item)}</div>
        <p class="library-blurb">${esc(item.about ?? item.note ?? "")}</p>
        ${item.reason ? `<p class="bookmark-why"><strong>Why it was suggested:</strong> ${esc(item.reason)}</p>` : ""}
        <div class="bookmark-actions" role="group" aria-label="Tried ${esc(item.title)}?">
          <span class="bookmark-actions-label">Tried it?</span>
          ${action("tried-loved", "Loved it")}
          ${action("tried-liked", "Liked it")}
          ${action("tried-disliked", "Didn't like it")}
          ${action("remove", "Remove", "button button-quiet")}
        </div>
      </div>
    </details>`;
}

function renderSavedView() {
  const saved = bookmarkedFeedback(state).filter((feedback) => itemMatchesDomain(feedback.item, state.libraryFilter));

  return `
    <div class="library-view" data-library-view-panel="saved">
      <p class="library-view-lede">Things you might want to watch, read, or play next. Saving something here does not change your Taste Profile — only what you actually try does.</p>
      <h2 class="visually-hidden">Saved to try</h2>
      <div class="library-grid">
        ${saved.length
          ? saved.map(savedCard).join("")
          : `<div class="filter-empty bookmark-empty">Nothing saved yet. From Recommendations, react "Not tried" on something and choose "Save to Saved" to come back to it here.</div>`}
      </div>
    </div>`;
}

// ---- Tried (the previous Library screen content) --------------------------------------------

function reactionButton(itemId, action, label, pressed) {
  return `
    <button class="button button-secondary library-action" type="button" data-library-item="${itemId}" data-library-action="${action}" aria-pressed="${pressed}">${label}</button>`;
}

function triedCard(entry) {
  const { item, id, source } = entry;
  const tried = source !== "starter";
  const info = [displayLabel(item), item.year].filter(Boolean).join(" · ");
  const status = entry.isFavorite ? "Favorite" : SOURCE_LABEL[source];

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
    <details class="library-card library-card-compact ${entry.isFavorite ? "is-favorite" : ""} ${item.artwork ? "has-artwork" : ""}" data-library-id="${id}">
      <summary class="library-compact-summary">
        ${item.artwork ? renderArtwork(item, "library-compact-artwork") : `<span class="library-compact-artwork is-empty" aria-hidden="true"></span>`}
        <span class="library-compact-copy">
          <span class="library-compact-info">${esc(info)}</span>
          <strong>${esc(item.title)}</strong>
          <span class="library-compact-status">${esc(status)}</span>
        </span>
        <span class="library-compact-open" aria-hidden="true">+</span>
      </summary>
      <div class="library-compact-detail">
        <div class="library-detail-meta-slot" data-detail-slot="${item.id}">${renderDetailMeta(item)}</div>
        <p class="library-blurb">${esc(entry.blurb)}</p>
        ${controls}
        ${tried ? renderTastebreakPanel(id) : ""}
      </div>
    </details>`;
}

function section(title, note, entries, emptyText) {
  return `
    <section class="library-section" aria-label="${title}">
      <div class="library-section-head">
        <h2>${title}</h2>
        <p>${note}</p>
      </div>
      <div class="library-grid">
        ${entries.length ? entries.map(triedCard).join("") : `<div class="filter-empty library-empty">${emptyText}</div>`}
      </div>
    </section>`;
}

function dislikedBlock(items) {
  if (!items.length) return "";
  return `
    <details class="library-disliked">
      <summary>Things you didn't like (${items.length})</summary>
      <p>These stay out of your Tried list. Tastemake keeps them in the background so it can learn from them, and you can correct any that you got wrong.</p>
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

function renderTriedView() {
  const { favorites: favoriteEntries, library: libraryEntries } = libraryItems(state);
  const shown = (entries) => entries.filter((entry) => itemMatchesDomain(entry.item, state.libraryFilter));
  const disliked = dislikedItems(state).filter((entry) => itemMatchesDomain(entry.item, state.libraryFilter));

  return `
    <div class="library-view" data-library-view-panel="tried">
      <p class="library-view-lede">Things you've actually tried and reacted to, plus your Favorites. This is where you go to revisit or correct a reaction.</p>
      ${section("Favorites", "Things you love, including the Favorites you started with.", shown(favoriteEntries), "No favorites in this category. Try All.")}
      ${section("Tried", "Everything else you've tried and liked or loved.", shown(libraryEntries),
        "Nothing here yet. When you tell Tastemake you loved or liked something you've tried, it lands here.")}
      ${dislikedBlock(disliked)}
    </div>`;
}

// ---- shell: tabs + shared filter band --------------------------------------------------------

function libraryTab(id, label, count) {
  const active = state.libraryView === id;
  return `
    <button
      class="library-tab"
      type="button"
      id="library-tab-${id}"
      data-library-tab="${id}"
      role="tab"
      aria-selected="${active}"
      aria-controls="library-panel-${id}"
    >${label}${count != null ? ` <span class="library-tab-count">${count}</span>` : ""}</button>`;
}

export function renderLibrary() {
  const view = state.libraryView === "tried" ? "tried" : "saved";
  const savedCount = bookmarkedFeedback(state).length;

  return `
    <section class="library-screen">
      ${renderStickerField("library")}
      <div class="library-masthead">
        <p class="kicker">Your stuff</p>
        <h1>Library.</h1>
        <p class="lede">Discovery happens in Recommendations. This is what you've kept: things saved for later, and things you've already tried.</p>
      </div>

      <div class="library-tabs" role="tablist" aria-label="Library view">
        ${libraryTab("saved", "Saved", savedCount)}
        ${libraryTab("tried", "Tried")}
      </div>

      <div class="filter-band library-filter-band">
        <span class="filter-band-label">Show me</span>
        ${renderDomainFilter({ selected: state.libraryFilter, scope: "library", label: "Filter your library by type" })}
      </div>

      <div id="library-panel-saved" role="tabpanel" aria-labelledby="library-tab-saved" ${view === "saved" ? "" : "hidden"}>
        ${renderSavedView()}
      </div>
      <div id="library-panel-tried" role="tabpanel" aria-labelledby="library-tab-tried" ${view === "tried" ? "" : "hidden"}>
        ${renderTriedView()}
      </div>

      <div class="recommendation-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="show-recs">&larr; Recommendations</button></div>
        <span class="footer-note">save it. try it. tell me.</span>
      </div>
    </section>`;
}
