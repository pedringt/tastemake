import { state } from "../state.js";
import { BROWSE_DOMAINS, browseGenresFor } from "../catalog/browse-genres.js";
import { renderArtwork } from "../components/artwork.js";
import { displayLabel } from "../data/domains.js";
import { itemStatus } from "../model/search.js";
import { browseReadyForRecommendations } from "../model/browse.js";
import { esc } from "../lib/html.js";
import { pathForFeedback } from "../model/reaction-flow.js";

function favoriteToggle(itemId) {
  const isFavorite = state.onboarded ? state.libraryFavorites.has(itemId) : state.selectedFavorites.has(itemId);
  const label = isFavorite ? "Remove from Favorites" : "Add to Favorites";
  return `
    <button
      class="rec-favorite-star ${isFavorite ? "is-favorite" : ""}"
      type="button"
      data-rec-favorite="${itemId}"
      aria-label="${label}"
      title="${label}"
      aria-pressed="${isFavorite}"
    ><span aria-hidden="true">${isFavorite ? "★" : "☆"}</span></button>`;
}

function experienceButton(itemId, value, label, pressed) {
  return `
    <button
      class="rating-button experience-button"
      type="button"
      data-feedback-item="${itemId}"
      data-experience-path="${value}"
      aria-pressed="${pressed}"
    ><span>${label}</span></button>`;
}

function outcomeButton(itemId, value, label, pressed = false) {
  return `
    <button
      class="detail-chip outcome-chip"
      type="button"
      data-feedback-item="${itemId}"
      data-experience-outcome="${value}"
      aria-pressed="${pressed}"
    >${label}</button>`;
}

function feedbackPanel(item, feedback) {
  const path = state.recommendationExperienceChoice[item.id] ?? pathForFeedback(feedback);
  if (state.recommendationFeedbackItemId !== item.id || !path) return "";

  return `
    <div class="rec-feedback-popover browse-feedback-popover" role="dialog" aria-modal="false" aria-label="Feedback for ${esc(item.title)}">
      <div class="rec-feedback-popover-head">
        <div>
          <span class="rec-feedback-kicker">${path === "tried" ? "Tried it" : "Not tried"}</span>
          <strong>${esc(item.title)}</strong>
        </div>
        <button type="button" class="rec-feedback-close" data-feedback-close="${item.id}" aria-label="Close feedback">×</button>
      </div>
      <div class="feedback-details experience-outcomes">
        <span class="feedback-detail-prompt">${path === "tried" ? "How did it land?" : "Want to keep it around?"}</span>
        <div class="detail-chip-row" role="group" aria-label="${path === "tried" ? "How did it land?" : "What do you want to do with this untried item?"}">
          ${path === "tried"
            ? `${outcomeButton(item.id, "loved", "Loved it", feedback?.detail === "loved-before")}
               ${outcomeButton(item.id, "liked", "Liked it", feedback?.detail === "liked-before")}
               ${outcomeButton(item.id, "disliked", "Didn’t like it", feedback?.detail === "tried-disliked")}`
            : `${outcomeButton(item.id, "save", "Save", feedback?.detail === "bookmarked")}
               ${outcomeButton(item.id, "not-interested", "Not interested", feedback?.detail === "not-interested")}`}
        </div>
      </div>
    </div>`;
}

function browseCard(item) {
  const status = itemStatus(state, item);
  const feedback = state.feedbackByRecommendation[item.id];
  const starterFavorite = !state.onboarded && state.selectedFavorites.has(item.id);
  const path = state.recommendationExperienceChoice[item.id] ?? pathForFeedback(feedback);
  const meta = [displayLabel(item), item.year, item.by].filter(Boolean).join(" · ");

  return `
    <article class="browse-card ${feedback ? "is-rated" : ""}" data-browse-card="${item.id}" data-rec-id="${item.id}">
      ${renderArtwork(item, "browse-artwork")}
      <div class="browse-card-copy">
        <div class="browse-card-head">
          <div>
            <h3>${esc(item.title)}</h3>
            <p class="browse-meta">${esc(meta)}</p>
          </div>
          ${favoriteToggle(item.id)}
        </div>
        <p class="browse-about">${esc(item.about ?? "")}</p>

        ${starterFavorite ? `
          <div class="reaction-complete">
            <span>Favorite</span>
          </div>`
        : feedback ? `
          <div class="reaction-complete">
            <span>${esc(status.label)}</span>
            <button class="button button-quiet reaction-change" type="button" data-feedback-edit="${item.id}">Change</button>
          </div>`
        : `
          <div class="rec-interaction">
            <div class="reaction-question">Have you tried it?</div>
            <div class="reaction-rail reaction-rail-binary" aria-label="Have you tried ${esc(item.title)}?">
              ${experienceButton(item.id, "tried", "Tried it", path === "tried")}
              ${experienceButton(item.id, "not-tried", "Not tried", path === "not-tried")}
            </div>
          </div>`}

        ${feedbackPanel(item, feedback)}
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
