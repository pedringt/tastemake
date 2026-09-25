import { state } from "../state.js";
import { itemMatchesDomain, renderDomainFilter } from "../components/domain-filter.js";
import { activeRecommendations, bookmarkedFeedback, canKeepDiscovering, currentRoundComplete, currentRoundRatedCount, hypothesisMatches, isBookmarked, isPositiveExperience, outOfPicks, picksHiddenByAreas } from "../model/taste.js";
import { isExperiencedNegative, isStrongPositive } from "../model/evidence.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { displayLabel } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { hasSeriesSignal } from "../catalog/novelty.mjs";

export function ratingLabel(value) {
  return ({
    more: "More like this",
    less: "Less like this",
    "not-tried": "Haven't tried"
  })[value] || value;
}

export function reactionLabel(feedback) {
  if (!feedback) return "";
  if (isStrongPositive(feedback)) return "Loved it before";
  if (isPositiveExperience(feedback)) return "Liked it before";
  if (isExperiencedNegative(feedback)) return "Disliked it before";
  if (isBookmarked(feedback)) return "Saved";
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

  return [["bookmarked", "Save for later"]];
}

// #52/#53: three layers, not one block. Primary (More/Less/Not tried) is always visible. Secondary — which
// specific thing happened — appears the moment a primary reaction exists, because it's still answering the
// same question ("did this fit?"). Tertiary — discovery-quality feedback — is about the *recommendation
// strategy*, not taste, and stays collapsed by default behind "More feedback" so it never reads as competing
// with More/Less. It auto-expands once there's already an answer in it, so nothing already told to Tastemake
// is hidden. The Blind Spot panel (#20) is left alone: it already manages its own offer/quiet/draft/saved
// progression, which is its own, already-designed, form of progressive disclosure.

function detailChips(itemId, feedback) {
  const options = detailOptionsFor(feedback);
  const prompt = feedback.rating === "not-tried"
    ? "Want to save it for later? Optional. Saved doesn't change your Taste Profile."
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
    </div>`;
}

// Discovery quality is about whether the pick was a good use of a recommendation slot, never about
// whether it fits the user's taste — kept visually and conceptually apart from More/Less/detail chips so
// the two don't read as competing negative reactions (#53).
function qualityNote(itemId, feedback) {
  return `
    <div class="recommendation-quality-note">
      <span class="feedback-detail-prompt">Discovery feedback. Optional.</span>
      <div class="quality-note-row">
        <button
          class="detail-chip quality-chip"
          type="button"
          data-feedback-item="${itemId}"
          data-feedback-quality="too-obvious"
          aria-pressed="${feedback.quality === "too-obvious"}"
        >Good fit, but too obvious?</button>
        ${isPositiveExperience(feedback) ? `
        <button
          class="detail-chip quality-chip"
          type="button"
          data-feedback-item="${itemId}"
          data-feedback-quality="surprised-me"
          aria-pressed="${feedback.quality === "surprised-me"}"
        >Surprised me</button>` : ""}
        <span class="quality-note-help">This changes how adventurous future picks are, not what Tastemake thinks you like.</span>
      </div>
    </div>`;
}

function hasQualityNote(feedback) {
  return Boolean(feedback) && (feedback.rating === "more" || feedback.rating === "less");
}

// Defaults to open once there is an answer in it, closed otherwise; an explicit toggle click always
// overrides that default (see toggleExpandedFeedback in actions/recommendations.js).
function qualityExpanded(itemId, feedback) {
  const override = state.expandedFeedback[itemId];
  return override !== undefined ? override : Boolean(feedback?.quality);
}

function seriesExperienceFeedback(item, feedback) {
  if (!hasSeriesSignal(item) || (!isPositiveExperience(feedback) && !isExperiencedNegative(feedback))) return "";
  const options = [
    ["loved-most", "Loved most of it"],
    ["liked-most", "Liked most of it"],
    ["mixed", "Mixed"],
    ["disliked-most", "Mostly disliked it"],
    ["unseen-rest", "Have not tried the rest"]
  ];
  return `
    <div class="series-feedback">
      <span class="feedback-detail-prompt">Seen more from this series? Optional.</span>
      <div class="detail-chip-row">
        ${options.map(([value, label]) => `
          <button
            class="detail-chip series-chip"
            type="button"
            data-series-experience="${value}"
            data-feedback-item="${item.id}"
            aria-pressed="${feedback.seriesExperience === value}"
          >${label}</button>`).join("")}
      </div>
    </div>`;
}

function moreFeedbackToggle(itemId, expanded, panelId) {
  return `
    <button
      class="detail-chip more-feedback-toggle"
      type="button"
      data-toggle-feedback="${itemId}"
      aria-expanded="${expanded}"
      aria-controls="${panelId}"
    >${expanded ? "Less feedback" : "More feedback"}</button>`;
}

function mediaArt(item, index) {
  if (item.artwork) {
    return `
      <div class="editorial-art editorial-art-real art-layout-${(index % 4) + 1}" aria-hidden="true">
        <img src="${esc(item.artwork)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        <span class="art-kicker">${esc(displayLabel(item))}</span>
        <span class="art-title">${item.surprise ? "SURPRISE ME" : esc(item.title)}</span>
        <span class="art-corner">TM/${String(index + 1).padStart(2, "0")}</span>
      </div>`;
  }

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

// #33: the "Why this one?" popover should read as a testable hypothesis, not algorithmic fine print.
// It names the pattern being tested (when there is one), is cautious when that pattern is still
// Emerging, and calls out a curveball as a deliberate break from the pattern rather than a miss.
function testedPattern(item) {
  const id = item.ai?.tests ?? null;
  if (!id) return null;
  return (state.modelHypotheses ?? []).find((p) => hypothesisMatches([p.id], id) || hypothesisMatches([id], p.id)) ?? null;
}

function whyKicker(item, pattern) {
  const isCurveball = item.surprise || item.ai?.kind === "curveball";
  if (isCurveball) return "Exploratory pick";
  if (!pattern) return "Why this one";
  const level = String(pattern.strength ?? "Emerging");
  return level === "Emerging" ? "A first test" : "Testing a pattern";
}

function whyContent(item) {
  const pattern = testedPattern(item);
  const isCurveball = item.surprise || item.ai?.kind === "curveball";
  const kicker = whyKicker(item, pattern);
  const label = pattern ? `${kicker}: ${esc(pattern.title)}` : kicker;

  // The rationale itself (item.reason) is now shown up front on the card (#95); this popover adds
  // the pattern context around it (what's being tested, and how confident that pattern is) rather
  // than repeating the same sentence.
  return `
    <span class="why-kicker">${label}</span>
    ${pattern ? `<p>This tests a pattern Tastemake is ${String(pattern.strength ?? "still forming").toLowerCase()} on: ${esc(pattern.title)}.</p>` : `<p>Tastemake does not have a named pattern behind this one yet — it is an early test.</p>`}
    ${isCurveball ? `<p class="why-caveat">This one deliberately breaks from the pattern above, to see what that tells Tastemake.</p>` : ""}`;
}

function cardSizeClass(index, total) {
  if (total === 5) return index === 0 ? "rec-span-7" : index === 1 ? "rec-span-5" : "rec-span-4";
  if (total === 4) return index < 2 ? (index === 0 ? "rec-span-7" : "rec-span-5") : "rec-span-6";
  if (total === 3) return index === 0 ? "rec-span-7" : index === 1 ? "rec-span-5" : "rec-span-12";
  if (total === 2) return index === 0 ? "rec-span-7" : "rec-span-5";
  return "rec-span-12";
}

function recommendationCard(item, index, total) {
  const saved = state.feedbackByRecommendation[item.id];
  const layoutClass = `${cardSizeClass(index, total)} ${item.surprise ? "rec-surprise" : ""}`;
  const whyId = `why-${item.id}`;
  const qualityId = `quality-${item.id}`;
  const showQuality = hasQualityNote(saved);
  const expanded = showQuality && qualityExpanded(item.id, saved);

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

        <!-- #95: rationale-first — Tastemake's "why this fits" is the primary card copy, shown
             up front rather than only behind the "Why this one?" trigger. The trigger still opens
             the fuller pattern context (curveball caveat, tested-pattern label). -->
        <p class="editorial-rationale">${esc(item.reason)}</p>
        <p class="editorial-about">${esc(item.about)}</p>

        <div class="editorial-why">
          <button
            class="why-trigger"
            type="button"
            aria-expanded="false"
            aria-controls="${whyId}"
          >More about why</button>
          <div class="why-popover" id="${whyId}" role="tooltip">
            ${whyContent(item)}
          </div>
        </div>

        <div class="reaction-rail" aria-label="Rate ${esc(item.title)}">
          ${ratingButton(item.id, "more", "More", "+", saved)}
          ${ratingButton(item.id, "less", "Less", "-", saved)}
          ${ratingButton(item.id, "not-tried", "Not tried", "o", saved)}
        </div>

        ${saved ? detailChips(item.id, saved) : ""}
        ${saved ? seriesExperienceFeedback(item, saved) : ""}
        ${showQuality ? `
          <div class="tertiary-feedback-toggle">
            ${moreFeedbackToggle(item.id, expanded, qualityId)}
          </div>
          <div class="tertiary-feedback" id="${qualityId}" ${expanded ? "" : "hidden"}>
            ${qualityNote(item.id, saved)}
          </div>` : ""}
        ${renderBlindSpotPanel(item.id)}
      </div>
    </article>`;
}

// #91: a lightweight skeleton while the FIRST set is loading and there is nothing to show yet, so the
// screen never looks frozen — it deliberately mirrors the real card shape (art block, title line,
// action row) rather than a generic spinner. Once any set exists, a later loading state is already
// communicated by renderAiStatus()/renderKeepDiscoveringBar(), so no skeleton is needed to avoid a
// jarring layout jump when results replace an already-populated grid.
function skeletonCard(index) {
  return `<div class="editorial-rec-skeleton" aria-hidden="true" style="animation-delay:${index * 70}ms"></div>`;
}

function renderCardArea(visible, items) {
  if (state.aiStatus === "loading" && items.length === 0) {
    return Array.from({ length: 5 }, (_, index) => skeletonCard(index)).join("");
  }
  if (visible.length) return visible.map((item, index) => recommendationCard(item, index, visible.length)).join("");
  return `<div class="filter-empty recommendation-empty">${items.length ? "No picks in this category in the current set. Try All." : "No real catalog recommendations are available yet. Change your favorites or try again."}</div>`;
}

function bookmarkNote(count) {
  return count ? `<p class="bookmark-note">${count} ${count === 1 ? "thing" : "things"} in Saved.</p>` : "";
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
  const cls = state.aiSource === "model" ? "is-live" : "is-fallback";
  const kicker = state.aiSource === "model" ? "Live AI + product rules" : state.aiSource === "catalog" ? "Real catalog fallback" : "Unavailable";
  const strong = state.aiSource === "model" ? "This set passed Tastemake's checks." : state.aiSource === "catalog" ? "These picks came from the real catalog." : "Tastemake did not substitute demo picks.";
  return `
    <div class="refresh-banner ${cls}">
      <div>
        <span class="refresh-kicker">${kicker}</span>
        <strong>${strong}</strong>
        <p>${state.aiMessage}</p>
      </div>
    </div>`;
}

// #93: the ongoing-loop action. Deliberately available the moment there is at least one reaction
// (canKeepDiscovering), not gated behind rating every card in the current set — the issue is explicit
// that a user should not have to react to every card before requesting another batch.
function renderKeepDiscoveringBar() {
  if (!canKeepDiscovering(state)) return "";
  const disabled = state.aiStatus === "loading";
  return `
    <div class="keep-discovering-bar">
      <p>Reacted to a few? You can ask for another set whenever you want — it uses what you have told Tastemake so far.</p>
      <button class="button button-primary" type="button" data-action="keep-discovering" ${disabled ? "disabled" : ""}>
        ${disabled ? "Finding more…" : "More recommendations"}
      </button>
    </div>`;
}

// #93: an optional, easy-to-ignore nudge once the current set is fully rated. It never blocks or
// forces a return to onboarding — "Keep browsing" (i.e. just asking for more, or leaving it alone)
// is always the default path.
function renderTasteInputPrompt() {
  if (!currentRoundComplete(state)) return "";
  return `
    <div class="taste-input-prompt">
      <p><strong>Want better recommendations?</strong> Optional — Tastemake works fine either way.</p>
      <div class="taste-input-prompt-actions">
        <button class="button button-secondary" type="button" data-action="back-favorites">Pick a few more favorites</button>
        <button class="button button-quiet" type="button" data-action="keep-discovering">Just keep browsing</button>
      </div>
    </div>`;
}

function renderNextSteps() {
  if (!currentRoundComplete(state)) return "";
  const bookmarks = bookmarkedFeedback(state).length;
  const viewBookmarks = bookmarks
    ? `<button class="button button-secondary" type="button" data-action="view-bookmarks">Saved</button>`
    : "";

  if (!outOfPicks(state)) {
    return `
      <div class="refresh-banner">
        <div>
          <span class="refresh-kicker">Nice. That is enough signal.</span>
          <strong>See what Tastemake learned.</strong>
          <p>Check the working profile, then use it to keep discovering.</p>
          ${bookmarkNote(bookmarks)}
        </div>
        <div class="action-group recommendation-footer-actions">
          <button class="button button-primary" type="button" data-action="view-model">See profile &rarr;</button>
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
        <strong>No more eligible catalog matches right now.</strong>
        <p>Tastemake did not fall back to a seeded demo list. Change your favorites or areas to give it a different starting point.</p>
        ${bookmarkNote(bookmarks)}
      </div>
      <div class="action-group recommendation-footer-actions">
        ${viewBookmarks}
        <button class="button button-secondary" type="button" data-action="view-model">See profile</button>
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
            ? "A new set shaped by what you just told Tastemake. Each pick is still a test, including the misses."
            : "Movies, shows, books, games, and the occasional curveball — Tastemake's current best guesses at what fits, and a way to test them. React in one tap; a miss teaches it as much as a hit."}</p>
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
      ${renderKeepDiscoveringBar()}
      ${renderNextSteps()}
      ${renderTasteInputPrompt()}

      <h2 class="visually-hidden">Your picks</h2>
      <div class="editorial-grid">
        ${renderCardArea(visible, items)}
      </div>

      <div class="recommendation-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="back-favorites">&larr; Change favorites</button></div>
        <span class="footer-note">discover. react. repeat.</span>
        <div class="page-actions-right"><button class="button button-primary" type="button" data-action="view-model">See profile &rarr;</button></div>
      </div>
    </section>`;
}
