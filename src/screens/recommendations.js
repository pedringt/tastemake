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

export function reactionLabel(feedback) {
  if (!feedback) return "";
  if (feedback.detail === "loved-before") return "Loved it before";
  if (feedback.detail === "liked-before") return "Liked it before";
  if (feedback.detail === "tried-disliked") return "Disliked it before";
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
      ["liked-before", "Liked it before"],
      ["exactly-my-taste", "Exactly my taste"],
      ["surprising-fit", "Surprising fit"]
    ];
  }

  if (feedback.rating === "less") {
    return [
      ["tried-disliked", "Tried it and disliked it"],
      ["not-interested", "Not interested"],
      ["wrong-vibe", "Wrong vibe"]
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
  const whyId = `why-${item.id}`;

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
          ${saved ? `<span class="reaction-stamp reaction-${saved.rating}">&#10003; ${reactionLabel(saved)}</span>` : ""}
        </div>

        <p class="editorial-about">${item.about}</p>

        <div class="editorial-why">
          <button
            class="why-trigger"
            type="button"
            aria-expanded="false"
            aria-controls="${whyId}"
          >Why this one?</button>
          <div class="why-popover" id="${whyId}" role="tooltip">
            <p>${item.reason}</p>
          </div>
        </div>

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
        <span class="refresh-kicker">Prototype checkpoint</span>
        <strong>Next in the real product: Keep discovering.</strong>
        <p>Another set would be shaped by everything you rated here. This prototype stops after two sets.</p>
        <span class="prototype-next-step" aria-hidden="true">Keep discovering &rarr;</span>
      </div>
      <div class="action-group recommendation-footer-actions">
        <button class="button button-secondary" type="button" data-action="view-model">See what Tastemake learned</button>
        <button class="button button-quiet" type="button" data-action="back-favorites">Change favorites</button>
      </div>
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
          <div class="progress-note">${currentRoundComplete(state) ? (roundTwo ? "prototype checkpoint" : "new set unlocked") : "teach it by using it"}</div>
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
        <div class="action-group recommendation-footer-actions">
          <button class="button button-secondary" type="button" data-action="view-model">See my Taste Profile</button>
          <button class="button button-quiet" type="button" data-action="back-favorites">Change favorites</button>
        </div>
      </div>
    </section>`;
}
