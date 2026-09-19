import { state } from "../state.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { activeRecommendations, currentRoundComplete, currentRoundRatedCount } from "../model/taste.js";

export function ratingLabel(value) {
  return ({
    more: "More like this",
    less: "Less like this",
    "not-tried": "Haven't tried"
  })[value] || value;
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
      ["want-to-try", "Want to try"],
      ["surprising-fit", "Surprising fit"],
      ["exactly-my-taste", "Exactly my taste"]
    ];
  }

  if (feedback.rating === "less") {
    return [
      ["tried-disliked", "Tried it and disliked it"],
      ["not-interested", "Not interested"],
      ["wrong-vibe", "Wrong vibe"],
      ["too-obvious", "Too obvious"]
    ];
  }

  return [
    ["interested", "Interested"],
    ["maybe-interested", "Maybe"],
    ["not-interested-untried", "Not interested"]
  ];
}

function feedbackDetails(itemId, feedback) {
  if (!feedback) return "";

  const options = detailOptionsFor(feedback);
  const prompt = feedback.rating === "not-tried"
    ? "Interested in trying it? Optional."
    : "Want to add a little context? Optional.";

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
      <span class="art-kicker">${item.medium}</span>
      <span class="art-shape art-shape-a"></span>
      <span class="art-shape art-shape-b"></span>
      <span class="art-pattern"></span>
      <span class="art-title">${item.surprise ? "SURPRISE ME" : shortTitle}</span>
      <span class="art-corner">TM/${String(index + 1).padStart(2, "0")}</span>
    </div>`;
}

function recommendationCard(item, index) {
  const saved = state.feedbackByRecommendation[item.id];
  const layoutClass = item.surprise ? "rec-surprise" : `rec-layout-${(index % 4) + 1}`;

  return `
    <article class="editorial-rec ${layoutClass} ${saved ? "is-rated" : ""}" data-rec-id="${item.id}">
      ${item.surprise ? `<span class="surprise-burst" aria-hidden="true">GO<br />WEIRD</span>` : ""}

      ${mediaArt(item, index)}

      <div class="editorial-rec-body">
        <div class="editorial-rec-meta">
          <span>${item.surprise ? "Surprise Me" : `Pick ${String(index + 1).padStart(2, "0")}`}</span>
          <span>${item.medium}</span>
        </div>

        <div class="editorial-title-row">
          <h3>${item.title}</h3>
          ${saved ? `<span class="reaction-stamp reaction-${saved.rating}">&#10003; ${ratingLabel(saved.rating)}</span>` : ""}
        </div>

        <p class="editorial-about">${item.about}</p>

        <details class="editorial-why">
          <summary>Why this one?</summary>
          <p>${item.reason}</p>
        </details>

        <div class="reaction-rail" aria-label="Rate ${item.title}">
          ${ratingButton(item.id, "more", "More", "+", saved)}
          ${ratingButton(item.id, "less", "Less", "-", saved)}
          ${ratingButton(item.id, "not-tried", "Not tried", "o", saved)}
        </div>

        ${feedbackDetails(item.id, saved)}
      </div>
    </article>`;
}

function renderRoundRefresh(roundTwo) {
  if (!currentRoundComplete(state)) return "";

  if (!roundTwo) {
    return `
      <div class="refresh-banner">
        <div>
          <span class="refresh-kicker">Nice. That is enough signal.</span>
          <strong>Want a fresh set?</strong>
          <p>Your reactions can now reshape what Tastemake shows next.</p>
        </div>
        <button class="button button-primary" type="button" data-action="refresh-recommendations">Refresh recommendations</button>
      </div>`;
  }

  return `
    <div class="refresh-banner is-finished">
      <div>
        <span class="refresh-kicker">Prototype round complete</span>
        <strong>Tastemake would keep learning from here.</strong>
        <p>This prototype stops after two recommendation sets.</p>
      </div>
      <button class="button button-secondary" type="button" data-action="view-model">View Taste Profile</button>
    </div>`;
}

export function renderRecommendations() {
  const items = activeRecommendations(state);
  const rated = currentRoundRatedCount(state);
  const roundTwo = state.recommendationRound === 2;
  const segments = items.map((_, index) => `<span class="progress-segment ${index < rated ? "is-filled" : ""}"></span>`).join("");
  const visible = items.filter((item) => itemMatchesDomain(item, state.recommendationFilter));

  return `
    <section class="recommendations-screen">
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
          <div class="progress-note">${currentRoundComplete(state) ? "new set unlocked" : "teach it by using it"}</div>
        </div>
      </div>

      <div class="filter-band recommendation-filter-band">
        <span class="filter-band-label">Show me</span>
        ${renderDomainFilter({ selected: state.recommendationFilter, scope: "recommendations", label: "Filter recommendations by type" })}
        <span class="filter-context">This changes what you browse, not what Tastemake thinks you like.</span>
      </div>

      ${renderRoundRefresh(roundTwo)}

      <div class="editorial-grid">
        ${visible.length
          ? visible.map(recommendationCard).join("")
          : `<div class="filter-empty recommendation-empty">No picks in this category in the current set. Try All.</div>`}
      </div>

      <div class="recommendation-footer">
        <span class="footer-note">discover. react. repeat.</span>
        <div class="action-group">
          <button class="button button-secondary" type="button" data-action="view-model">See my Taste Profile</button>
          <button class="button button-quiet" type="button" data-action="back-favorites">Change favorites</button>
        </div>
      </div>
    </section>`;
}
