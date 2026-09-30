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
  const favorite = state.onboarded ? state.libraryFavorites.has(item.id) : state.selectedFavorites.has(item.id);
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

        ${favorite ? `
          <p class="browse-favorite-note">This is one of your Favorites. Remove it from Favorites first if you want to change your reaction.</p>
        ` : `
          <div class="browse-reactions">
            <div class="browse-reaction-group" role="group" aria-label="I've tried ${esc(item.title)}">
              <span>I've tried it</span>
              ${actionButton(item, "loved", "Loved it", status.key === "loved")}
              ${actionButton(item, "liked", "Liked it", status.key === "liked")}
              ${actionButton(item, "disliked", "Didn't like it", status.key === "disliked")}
            </div>
            <div class="browse-reaction-group" role="group" aria-label="I haven't tried ${esc(item.title)}">
              <span>I haven't tried it</span>
              ${actionButton(item, "bookmark", "Save", status.key === "bookmarked")}
              ${actionButton(item, "not-interested", "Not interested", status.key === "not-interested")}
            </div>
          </div>
        `}

        ${loved ? `
          <div class="browse-favorite-row">
            <button type="button" class="button ${favorite ? "button-quiet" : "button-secondary"} browse-favorite" data-browse-favorite="${favorite ? "remove" : "add"}" data-browse-item="${item.id}" aria-pressed="${favorite}">
              ${favorite ? "★ Favorite" : "☆ Add to Favorites"}
            </button>
            <span>Favorites are the things you love most.</span>
          </div>` : ""}
      </div>
    </article>`;
}

export function renderBrowse() {
  const domains = BROWSE_DOMAINS;
  const genres = browseGenresFor(state.browseDomain);
  const ready = browseReadyForRecommendations(state);
  const count = state.onboarded ? state.libraryFavorites.size : state.selectedFavorites.size;

  return `
    <section class="browse-screen">
      <div class="browse-hero">
        <div>
          <p class="kicker">Browse</p>
          <h1>Need a little <span class="marker-word">inspiration?</span></h1>
          <p class="lede">Browse things you might recognize, then react when something is familiar.</p>
        </div>
        <div class="browse-progress" aria-live="polite">
          <strong>${state.onboarded ? `${count} favorites` : `${count} of 4 favorites`}</strong>
          <span>${state.onboarded ? "Your Favorites are the strongest signals in your taste profile." : (ready ? "Enough to start personalizing." : "Love something here? Add it to Favorites.")}</span>
        </div>
      </div>

      <div class="browse-search">
        <button type="button" class="browse-search-launch" data-action="open-search" aria-label="Search books, movies, shows, and games">
          <span aria-hidden="true">⌕</span>
          <span>Search books, movies, shows, and games</span>
        </button>
        <p>Know what you want? Search directly. Not sure? Browse by category below.</p>
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
        <p>Real catalog items. React only when something is familiar.</p>
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
