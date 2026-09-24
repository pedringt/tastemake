import { state } from "../state.js";
import { bookmarkedFeedback } from "../model/taste.js";
import { renderStickerField } from "../components/stickers.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";

// Try Next contains untried things the user saved to act on. They are not taste evidence; only what
// the user actually tries (and reacts to) teaches Tastemake about their taste.

function bookmarkCard(feedback) {
  const { item } = feedback;
  const action = (name, label, className = "button button-secondary") => `
    <button class="${className} bookmark-action" type="button" data-bookmark-item="${item.id}" data-bookmark-action="${name}">${label}</button>`;

  return `
    <article class="bookmark-card" data-bookmark-id="${item.id}">
      <span class="bookmark-tape" aria-hidden="true"></span>
      <span class="bookmark-medium">${esc(displayLabel(item))}</span>
      <h3>${esc(item.title)}</h3>
      <p class="bookmark-about">${esc(item.about ?? item.note ?? "")}</p>
      ${item.reason ? `<p class="bookmark-why"><strong>Why it was suggested:</strong> ${esc(item.reason)}</p>` : ""}
      <div class="bookmark-actions" role="group" aria-label="Tried ${esc(item.title)}?">
        <span class="bookmark-actions-label">Tried it?</span>
        ${action("tried-loved", "Loved it")}
        ${action("tried-liked", "Liked it")}
        ${action("tried-disliked", "Didn't like it")}
        ${action("remove", "Remove", "button button-quiet")}
      </div>
    </article>`;
}

export function renderBookmarks() {
  const bookmarks = bookmarkedFeedback(state);

  return `
    <section class="bookmarks-screen">
      ${renderStickerField("bookmarks")}
      <div class="bookmarks-masthead">
        <p class="kicker">Saved for later</p>
        <h1>Try Next.</h1>
        <p class="lede">Things you might want to watch, read, or play next. Saving something here does not change your Taste Profile. Only what you actually try does.</p>
      </div>

      <h2 class="visually-hidden">Saved to try</h2>
      <div class="bookmark-grid">
        ${bookmarks.length
          ? bookmarks.map(bookmarkCard).join("")
          : `<div class="filter-empty bookmark-empty">Nothing here yet. Save an untried recommendation when you want to come back to it.</div>`}
      </div>

      <div class="recommendation-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="show-recs">&larr; Recommendations</button></div>
        <span class="footer-note">save it. try it. tell me.</span>
      </div>
    </section>`;
}
