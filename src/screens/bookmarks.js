import { state } from "../state.js";
import { bookmarkedFeedback } from "../model/taste.js";
import { renderStickerField } from "../components/stickers.js";

// Bookmarks are untried things the user saved to act on. They are not taste evidence; only what
// the user actually tries (and reacts to) teaches Tastemake about their taste.

function bookmarkCard(feedback) {
  const { item } = feedback;
  const action = (name, label, className = "button button-secondary") => `
    <button class="${className} bookmark-action" type="button" data-bookmark-item="${item.id}" data-bookmark-action="${name}">${label}</button>`;

  return `
    <article class="bookmark-card" data-bookmark-id="${item.id}">
      <span class="bookmark-tape" aria-hidden="true"></span>
      <span class="bookmark-medium">${item.medium}</span>
      <h3>${item.title}</h3>
      <p class="bookmark-about">${item.about ?? item.note ?? ""}</p>
      ${item.reason ? `<p class="bookmark-why"><strong>Why it was suggested:</strong> ${item.reason}</p>` : ""}
      <div class="bookmark-actions" role="group" aria-label="Tried ${item.title}?">
        <span class="bookmark-actions-label">Tried it?</span>
        ${action("tried-loved", "Loved it")}
        ${action("tried-liked", "Liked it")}
        ${action("tried-disliked", "Didn't like it")}
        ${action("remove", "Remove bookmark", "button button-quiet")}
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
        <h1>Your bookmarks.</h1>
        <p class="lede">Things you haven't tried yet but want to. Bookmarks don't change your taste profile. Only what you actually try does, so come back and tell Tastemake how it went.</p>
      </div>

      <h2 class="visually-hidden">Saved to try</h2>
      <div class="bookmark-grid">
        ${bookmarks.length
          ? bookmarks.map(bookmarkCard).join("")
          : `<div class="filter-empty bookmark-empty">Nothing bookmarked right now. On a recommendation you haven't tried, choose Not tried, then Bookmark it.</div>`}
      </div>

      <div class="recommendation-footer">
        <span class="footer-note">save it. try it. tell me.</span>
        <div class="action-group recommendation-footer-actions">
          <button class="button button-primary" type="button" data-action="show-recs">Back to discovering</button>
          <button class="button button-quiet" type="button" data-action="view-model">See my Taste Profile</button>
        </div>
      </div>
    </section>`;
}
