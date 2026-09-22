import { state } from "../state.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { activeRecommendations, bookmarkedFeedback, canKeepDiscovering, currentRoundComplete, currentRoundRatedCount, isPositiveExperience, outOfPicks, picksHiddenByAreas } from "../model/taste.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";

export function ratingLabel(value) {
  return ({
    more: "More like this",
    less: "Less like this",
    "not-tried": "Haven't tried"
  })[value] || value;
}

export function reactionLabel(feedback) {
  if (!feedback) return "";
  if (feedback.detail === "loved-before") return "Loved it before";
  if (feedback.detail === "liked-before") return "Liked it before";
  if (feedback.detail === "tried-disliked") return "Disliked it before";
  if (feedback.rating === "not-tried" && feedback.detail === "bookmarked") return "Bookmarked";
  return ratingLabel(feedback.rating);
}

function ratingButton(itemId, value, label, icon, saved) {
  const pressed = saved?.rating === value;
  return `
    <button
      class="rating-button"
      type="button"
      data-feedback-item="${itemId}"
      data-rating="${value}"
      aria-pressed="${pressed}"
    ><span aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

function detailOptionsFor(feedback) {
  if (!feedback) return [];

  if (feedback.rating === "more") {
    return [
      ["loved-before", "Loved it before"],
      ["liked-before", "Liked it before"]
    ];
  }

  if (feedback.rating === "less") {
    return [
      ["tried-disliked", "Tried it and disliked it"],
      ["not-interested", "Not interested"]
    ];
  }

  return [["bookmarked", "Bookmark it"]];
}

function feedbackDetails(itemId, feedback) {
  if (!feedback) return "";

  const options = detailOptionsFor(feedback);
  const prompt = feedback.rating === "not-tried"
    ? "Want to save it for later? Optional. Bookmarks don't change your taste profile."
    : feedback.rating === "more"
      ? "Already tried it? Tell us how it went. Optional."
      : "Tried it, or just not for you? Optional.";

  return `
    <div class="feedback-details">
      <span class="feedback-detail-prompt">${prompt}</span>
      <div class="detail-chip-row">
        ${options.map(([value, label]) => `
          <button
            class="detail-chip"
            type="button"
            data-feedback-item="${itemId}"
            data-feedback-detail="${value}"
            aria-pressed="${feedback.detail === value}"
          >${label}</button>
        `).join("")}
      </div>
      <div class="recommendation-quality-note">
        <span class="feedback-detail-prompt">Discovery note. Optional.</span>
        <div class="quality-note-row">
          <button
            class="detail-chip quality-chip"
            type="button"
            data-feedback-item="${itemId}"
            data-feedback-quality="too-obvious"
            aria-pressed="${feedback.quality === "too-obvious"}"
          >Too predictable</button>
          ${isPositiveExperience(feedback) ? `
          <button
            class="detail-chip quality-chip"
            type="button"
            data-feedback-item="${itemId}"
            data-feedback-quality="surprised-me"
            aria-pressed="${feedback.quality === "surprised-me"}"
          >Surprised me</button>` : ""}
          <span class="quality-note-help">This can still be a great taste match. It only tells Tastemake to make future picks less obvious.</span>
        </div>
      </div>
    </div>`;
}

function mediaArt(item, index) {
  const shortTitle = item.title
    .replace(/\b(the|a|an|of|in|and|at|to)\b/gi, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");

  return `
    <div class="editorial-art art-${item.id} art-layout-${(index % 4) + 1}" aria-hidden="true">
      <span class="art-kicker">${esc(displayLabel(item))}</span>
      <span class="art-shape art-shape-a"></span>
      <span class="art-shape art-shape-b"></span>
      <span class="art-pattern"></span>
      <span class="art-title">${item.surprise ? "SURPRISE ME" : esc(shortTitle)}</span>
      <span class="art-corner">TM/${String(index + 1).padStart(2, "0")}</span>
    </div>`;
}

function recommendationCard(item, index) {
  const saved = state.feedbackByRecommendation[item.id];
  const layoutClass = item.surprise ? "rec-surprise" : `rec-layout-${(index % 4) + 1}`;
  const whyId = `why-${item.id}`;

  return `
    <article class="editorial-rec ${layoutClass} ${saved ? "is-rated" : ""}" data-rec-id="${item.id}">
      ${item.surprise ? `<span class="surprise-burst" aria-hidden="true">GO<br />WEIRD</span>` : ""}

      ${mediaArt(item, index)}

      <div class="editorial-rec-body">
        <div class="editorial-rec-meta">
          <span>${item.surprise ? "Surprise Me" : `Pick ${String(index + 1).padStart(2, "0")}`}</span>
          <span>${esc(displayLabel(item))}</span>
        </div>

        <div class="editorial-title-row">
          <h3>${esc(item.title)}</h3>
          ${saved ? `<span class="reaction-stamp reaction-${saved.rating}">&#10003; ${reactionLabel(saved)}</span>` : ""}
        </div>

        <p class="editorial-about">${esc(item.about)}</p>

        <div class="editorial-why">
          <button
            class="why-trigger"
            type="button"
            aria-expanded="false"
            aria-controls="${whyId}"
          >Why this one?</button>
          <div class="why-popover" id="${whyId}" role="tooltip">
            <p>${esc(item.reason)}</p>
          </div>
        </div>

        <div class="reaction-rail" aria-label="Rate ${esc(item.title)}">
          ${ratingButton(item.id, "more", "More", "+", saved)}
          ${ratingButton(item.id, "less", "Less", "-", saved)}
          ${ratingButton(item.id, "not-tried", "Not tried", "o", saved)}
        </div>

        ${feedbackDetails(item.id, saved)}
        ${renderBlindSpotPanel(item.id)}
      </div>
    </article>`;
}

function bookmarkNote(count) {
  return count ? `<p class="bookmark-note">${count} ${count === 1 ? "thing" : "things"} bookmarked.</p>` : "";
}

function renderAiStatus() {
  if (state.aiStatus === "loading") {
    return `
      <div class="refresh-banner" role="status" aria-live="polite" aria-busy="true">
        <div>
          <span class="refresh-kicker">Checking the evidence</span>
          <strong>Tastemake is building the next set.</strong>
          <p>${state.aiMessage || "Looking at what you have actually tried, not just what caught your eye."}</p>
        </div>
      </div>`;
  }
  if (!state.aiMessage) return "";
  return `
    <div class="refresh-banner ${state.aiSource === "deterministic" ? "is-fallback" : "is-live"}">
      <div>
        <span class="refresh-kicker">${state.aiSource === "model" ? "Live AI + product rules" : "Safe fallback"}</span>
        <strong>${state.aiSource === "model" ? "This set passed Tastemake's checks." : "The deterministic version took over."}</strong>
        <p>${state.aiMessage}</p>
      </div>
    </div>`;
}

function renderNextSteps() {
  if (!currentRoundComplete(state)) return "";
  const bookmarks = bookmarkedFeedback(state).length;
  const viewBookmarks = bookmarks
    ? `<button class="button button-secondary" type="button" data-action="view-bookmarks">View Bookmarks</button>`
    : "";

  if (!outOfPicks(state)) {
    const loading = state.aiStatus === "loading";
    return `
      <div class="refresh-banner">
        <div>
          <span class="refresh-kicker">Nice. That is enough signal.</span>
          <strong>Want a fresh set?</strong>
          <p>Your reactions can now reshape what Tastemake shows next.</p>
          <p class="quality-note-help">When live AI is enabled, Tastemake sends this visit\'s typed taste evidence and eligible picks to Anthropic to choose and explain the next set. No name or contact details are included.</p>
          ${bookmarkNote(bookmarks)}
        </div>
        <div class="action-group recommendation-footer-actions">
          <button class="button button-primary" type="button" data-action="keep-discovering" ${loading ? "disabled aria-busy=\"true\"" : ""}>${loading ? "Finding a set…" : "Keep discovering &rarr;"}</button>
          ${viewBookmarks}
        </div>
      </div>`;
  }

  if (picksHiddenByAreas(state)) {
    return `
      <div class="refresh-banner is-finished">
        <div>
          <span class="refresh-kicker">Nothing left in your areas</span>
          <strong>No more picks in the areas you have turned on.</strong>
          <p>There are still picks in areas you turned off. You can turn them back on in My Tastemake.</p>
          ${bookmarkNote(bookmarks)}
        </div>
        <div class="action-group recommendation-footer-actions">
          <button class="button button-primary" type="button" data-open-mine>Open My Tastemake</button>
          ${viewBookmarks}
        </div>
      </div>`;
  }

  return `
    <div class="refresh-banner is-finished">
      <div>
        <span class="refresh-kicker">Prototype checkpoint</span>
        <strong>That is every pick this demo has.</strong>
        <p>A real Tastemake would keep going, shaped by everything you reacted to. This prototype only has a small set of hand-written picks, and you have seen them all.</p>
        ${bookmarkNote(bookmarks)}
      </div>
      <div class="action-group recommendation-footer-actions">
        ${viewBookmarks}
        <button class="button button-secondary" type="button" data-action="view-model">See what Tastemake learned</button>
        <button class="button button-quiet" type="button" data-action="back-favorites">Change favorites</button>
      </div>
    </div>`;
}

export function renderRecommendations() {
  const items = activeRecommendations(state);
  const rated = currentRoundRatedCount(state);
  const roundTwo = state.recommendationSets.length > 1;
  const segments = items.map((_, index) => `<span class="progress-segment ${index < rated ? "is-filled" : ""}"></span>`).join("");
  const visible = items.filter((item) => itemMatchesDomain(item, state.recommendationFilter));

  return `
    <section class="recommendations-screen">
      ${renderStickerField("recommendations")}
      <div class="recommendations-masthead">
        <div class="rec-masthead-copy">
          <p class="kicker">${roundTwo ? "Fresh picks" : "For you right now"}</p>
          <h1>${roundTwo ? "Okay, that changed things." : "Things worth your time."}</h1>
          <p class="lede">${roundTwo
            ? "A new set shaped by what you just told Tastemake."
            : "Movies, shows, books, games, and the occasional curveball. React in one tap and keep moving."}</p>
        </div>

        <div class="rec-progress-card">
          <div class="rec-progress-top">
            <strong>${rated}/${items.length}</strong>
            <span>rated</span>
          </div>
          <div class="progress-track" aria-hidden="true">${segments}</div>
          <div class="progress-note">${currentRoundComplete(state) ? (outOfPicks(state) ? "prototype checkpoint" : "new set unlocked") : "teach it by using it"}</div>
        </div>
      </div>

      <div class="filter-band recommendation-filter-band">
        <span class="filter-band-label">Show me</span>
        ${renderDomainFilter({ selected: state.recommendationFilter, scope: "recommendations", label: "Filter recommendations by type" })}
        <span class="filter-context">This changes what you browse, not what Tastemake thinks you like.</span>
      </div>

      ${renderAiStatus()}
      ${renderNextSteps()}

      <h2 class="visually-hidden">Your picks</h2>
      <div class="editorial-grid">
        ${visible.length
          ? visible.map(recommendationCard).join("")
          : `<div class="filter-empty recommendation-empty">No picks in this category in the current set. Try All.</div>`}
      </div>

      <div class="recommendation-footer">
        <span class="footer-note">discover. react. repeat.</span>
        <div class="action-group recommendation-footer-actions">
          ${canKeepDiscovering(state) && !currentRoundComplete(state)
            ? `<button class="button button-primary" type="button" data-action="keep-discovering">Keep discovering &rarr;</button>`
            : ""}
          <button class="button button-secondary" type="button" data-action="view-model">See my Taste Profile</button>
          <button class="button button-quiet" type="button" data-action="back-favorites">Change favorites</button>
        </div>
      </div>
    </section>`;
}
