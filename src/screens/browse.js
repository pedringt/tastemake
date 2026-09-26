import { state } from "../state.js";
import { BROWSE_DOMAINS, browseGenresFor } from "../catalog/browse-genres.js";
import { renderArtwork } from "../components/artwork.js";
import { displayLabel } from "../data/domains.js";
import { itemStatus } from "../model/search.js";
import { browseReadyForRecommendations } from "../model/browse.js";
import { esc } from "../lib/html.js";

function actionButton(item, action, label, pressed) {
  return `<button type="button" class="browse-action" data-browse-action="${action}" data-browse-item="${item.id}" aria-pressed="${pressed}">${label}</button>`;
}

function browseCard(item) {
  const status = itemStatus(state, item);
  const favorite = state.selectedFavorites.has(item.id);
  const feedback = state.feedbackByRecommendation[item.id];
  const loved = status.key === "loved" || favorite;
  const meta = [displayLabel(item), item.year, item.by].filter(Boolean).join(" · ");

  return `
    <article class="browse-card" data-browse-card="${item.id}">
      ${renderArtwork(item, "browse-artwork")}
      <div class="browse-card-copy">
        <div class="browse-card-head">
          <div>
            <h3>${esc(item.title)}</h3>
            <p class="browse-meta">${esc(meta)}</p>
          </div>
          ${status.key !== "none" ? `<span class="browse-status is-${status.key}">${esc(status.label)}</span>` : ""}
        </div>
        <p class="browse-about">${esc(item.about ?? "")}</p>

        <div class="browse-reactions">
          <div class="browse-reaction-group" role="group" aria-label="I've tried ${esc(item.title)}">
            <span>I've tried it</span>
            ${actionButton(item, "loved", "Loved it", status.key === "loved" || status.key === "starter")}
            ${actionButton(item, "liked", "Liked it", status.key === "liked")}
            ${actionButton(item, "disliked", "Didn't like it", status.key === "disliked")}
          </div>
          <div class="browse-reaction-group" role="group" aria-label="I haven't tried ${esc(item.title)}">
            <span>I haven't tried it</span>
            ${actionButton(item, "bookmark", "Save", status.key === "bookmarked")}
            ${actionButton(item, "not-interested", "Not interested", status.key === "not-interested")}
          </div>
        </div>

        ${loved ? `
          <div class="browse-favorite-row">
            <button type="button" class="button ${favorite ? "button-quiet" : "button-secondary"} browse-favorite" data-browse-favorite="${favorite ? "remove" : "add"}" data-browse-item="${item.id}" aria-pressed="${favorite}">
              ${favorite ? "★ Favorite" : "☆ Add to Favorites"}
            </button>
            <span>Favorites are the strongest starting signal.</span>
          </div>` : ""}
      </div>
    </article>`;
}

export function renderBrowse() {
  const domains = BROWSE_DOMAINS;
  const genres = browseGenresFor(state.browseDomain);
  const ready = browseReadyForRecommendations(state);
  const count = state.selectedFavorites.size;

  return `
    <section class="browse-screen">
      <div class="browse-hero">
        <div>
          <p class="kicker">Browse</p>
          <h1>Need a little <span class="marker-word">inspiration?</span></h1>
          <p class="lede">Browse things you might recognize, then tell Tastemake what you've actually tried. Looking around never counts as taste evidence.</p>
        </div>
        <div class="browse-progress" aria-live="polite">
          <strong>${count} of 4 favorites</strong>
          <span>${ready ? "Enough to start personalizing." : "Love something here? Add it to Favorites."}</span>
        </div>
      </div>

      <div class="browse-controls">
        <div class="browse-domain-tabs" role="group" aria-label="Browse category">
          ${domains.map((domain) => `
            <button type="button" class="browse-domain ${state.browseDomain === domain.id ? "is-active" : ""}" data-browse-domain="${domain.id}" aria-pressed="${state.browseDomain === domain.id}">${domain.label}</button>
          `).join("")}
        </div>
        <div class="browse-genres" role="group" aria-label="${esc(state.browseDomain)} genres">
          ${genres.map((genre) => `
            <button type="button" class="browse-genre ${state.browseGenre === genre.id ? "is-active" : ""}" data-browse-genre="${genre.id}" aria-pressed="${state.browseGenre === genre.id}">${esc(genre.label)}</button>
          `).join("")}
        </div>
      </div>

      ${ready ? `
        <div class="browse-ready" role="status">
          <div><strong>You've given Tastemake enough to start.</strong><span>You can keep browsing or see what it recommends.</span></div>
          <button class="button button-primary" type="button" data-action="show-recs">See my recommendations →</button>
        </div>` : ""}

      <div class="browse-results-head">
        <h2>${esc(genres.find((genre) => genre.id === state.browseGenre)?.label ?? "Browse")}</h2>
        <p>Real catalog items. Nothing changes until you choose an action.</p>
      </div>

      ${state.browseError && !state.browseItems.length ? `
        <div class="browse-empty" role="status">
          <strong>Couldn't load this category right now.</strong>
          <span>Try another genre or search directly.</span>
          <button class="button button-secondary" type="button" data-action="open-search">Search instead</button>
        </div>` : ""}

      ${state.browseLoading && !state.browseItems.length ? `
        <div class="browse-loading" role="status"><span class="search-spinner" aria-hidden="true"></span><strong>Finding ${esc(genres.find((genre) => genre.id === state.browseGenre)?.label ?? "")} picks…</strong></div>` : ""}

      ${!state.browseLoading && !state.browseError && !state.browseItems.length ? `
        <div class="browse-empty" role="status">
          <strong>Nothing useful showed up in this batch.</strong>
          <span>Try another genre or search for a title directly.</span>
          <button class="button button-secondary" type="button" data-action="open-search">Search instead</button>
        </div>` : ""}

      ${state.browseItems.length ? `
        <div class="browse-grid">
          ${state.browseItems.map(browseCard).join("")}
        </div>
        <div class="browse-more">
          ${state.browseHasMore ? `<button class="button button-secondary" type="button" data-browse-more ${state.browseLoading ? "disabled" : ""}>${state.browseLoading ? "Loading…" : "Show more"}</button>` : `<span>That's everything in this batch.</span>`}
        </div>` : ""}
    </section>`;
}
