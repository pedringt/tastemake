import { state } from "../state.js";
import { renderDomainFilter } from "../components/domain-filter.js";
import { activeRecommendations, bookmarkedFeedback, canKeepDiscovering, currentRoundComplete, currentRoundRatedCount, hypothesisMatches, isBookmarked, isPositiveExperience, outOfPicks, picksHiddenByAreas } from "../model/taste.js";
import { isDeclined, isExperiencedNegative, isStrongPositive } from "../model/evidence.js";
import { renderStickerField } from "../components/stickers.js";
import { renderBlindSpotPanel } from "../components/blindspot.js";
import { displayLabel, domainById } from "../data/domains.js";
import { esc } from "../lib/html.js";
import { hasSeriesSignal } from "../catalog/novelty.mjs";
import { readableRecommendationCopy } from "../lib/recommendation-copy.js";
import { renderExperienceRefinement } from "../components/refinement.js";
import { pathForFeedback } from "../model/reaction-flow.js";

// #121: previously the rationale/synopsis were left full-length in the markup and clipped visually
// with CSS `-webkit-line-clamp` + `overflow:hidden`, which can cut a sentence off mid-thought (e.g.
// ending in a naked "…" partway through a word or clause) while the card's fixed text-box height left
// unused space below. Truncating the *string* here, at a sentence or word boundary, means what's
// rendered is always a complete-reading fragment — CSS is no longer responsible for hiding overflow.
// Limits are generous enough that most real rationale/synopsis copy is untouched; they exist only to
// stop one verbose card from growing enormous relative to the rest of a row (the direction explicitly
// warns against removing all limits).
const RATIONALE_MAX_CHARS = 160;
const ABOUT_MAX_CHARS = 90;

export function truncateCopy(text, maxChars) {
  const value = String(text ?? "").trim();
  if (value.length <= maxChars) return value;

  // Prefer ending at a sentence boundary within the limit; a run-on rationale/synopsis reads better
  // cut cleanly after a full sentence than mid-sentence with an ellipsis, provided that boundary isn't
  // so early it discards most of the allowed length.
  const window = value.slice(0, maxChars + 1);
  const lastSentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (lastSentenceEnd > maxChars * 0.4) return value.slice(0, lastSentenceEnd + 1).trim();

  // Otherwise fall back to the last whole word boundary before the limit, so truncation never lands
  // mid-word.
  const truncated = value.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  const clean = (lastSpace > maxChars * 0.6 ? truncated.slice(0, lastSpace) : truncated).replace(/[,;:.\-\s]+$/, "");
  return `${clean}…`;
}

export function ratingLabel(value) {
  return ({
    more: "More like this",
    less: "Less like this",
    "not-tried": "Haven't tried"
  })[value] || value;
}

export function reactionLabel(feedback) {
  if (!feedback) return "";
  if (isStrongPositive(feedback)) return "Loved it";
  if (isPositiveExperience(feedback)) return "Liked it";
  if (isExperiencedNegative(feedback)) return "Didn’t like it";
  if (isBookmarked(feedback)) return "Saved";
  if (isDeclined(feedback)) return "Not interested";
  return ratingLabel(feedback.rating);
}

function experiencePath(itemId, feedback) {
  const explicit = state.recommendationExperienceChoice?.[itemId];
  if (explicit) return explicit;
  return pathForFeedback(feedback);
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

function experienceChoices(itemId, feedback) {
  const path = experiencePath(itemId, feedback);
  if (!path) return "";

  if (path === "tried") {
    return `
      <div class="feedback-details experience-outcomes">
        <span class="feedback-detail-prompt">How did it land?</span>
        <div class="detail-chip-row" role="group" aria-label="How did it land?">
          ${outcomeButton(itemId, "loved", "Loved it", isStrongPositive(feedback))}
          ${outcomeButton(itemId, "liked", "Liked it", isPositiveExperience(feedback) && !isStrongPositive(feedback))}
          ${outcomeButton(itemId, "disliked", "Didn’t like it", isExperiencedNegative(feedback))}
        </div>
      </div>`;
  }

  return `
    <div class="feedback-details experience-outcomes">
      <span class="feedback-detail-prompt">Want to keep it around?</span>
      <div class="detail-chip-row" role="group" aria-label="What do you want to do with this untried recommendation?">
        ${outcomeButton(itemId, "save", "Save", isBookmarked(feedback))}
        ${outcomeButton(itemId, "not-interested", "Not interested", isDeclined(feedback))}
      </div>
      <span class="quality-note-help">Save it for later, or skip it.</span>
    </div>`;
}

// #52/#53: the primary question is now whether the user has actually experienced the item.
// Only the concrete second-step answer becomes stored feedback. This keeps intent separate from
// taste evidence while making the first interaction understandable without algorithm vocabulary.

// Discovery quality is about whether the pick was a good use of a recommendation slot, never about
// whether it fits the user's taste — kept visually and conceptually apart from More/Less/detail chips so
// the two don't read as competing negative reactions (#53).
function qualityNote(itemId, feedback) {
  return `
    <div class="recommendation-quality-note">
      <span class="feedback-detail-prompt"><strong>Was this a useful discovery?</strong> Optional.</span>
      <div class="quality-note-row">
        <button
          class="detail-chip quality-chip"
          type="button"
          data-feedback-item="${itemId}"
          data-feedback-quality="too-obvious"
          aria-pressed="${feedback.quality === "too-obvious"}"
        >Too obvious</button>
        <button
          class="detail-chip quality-chip"
          type="button"
          data-feedback-item="${itemId}"
          data-feedback-quality="surprised-me"
          aria-pressed="${feedback.quality === "surprised-me"}"
        >Great discovery</button>
        <span class="quality-note-help">This helps Tastemake balance familiar picks with more unexpected ones.</span>
      </div>
    </div>`;
}

function hasQualityNote(feedback) {
  return isPositiveExperience(feedback);
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

// Favorite is always available on a recommendation. Choosing it is shorthand for
// “I know this and love it”: the action records Tried + Loved + Favorite in one step.
function favoriteToggle(itemId) {
  const isFavorite = state.libraryFavorites.has(itemId);
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

  return `
    <div class="editorial-art art-${item.id} art-layout-${(index % 4) + 1}" aria-hidden="true">
      <span class="art-kicker">${esc(displayLabel(item))}</span>
      <span class="art-shape art-shape-a"></span>
      <span class="art-shape art-shape-b"></span>
      <span class="art-pattern"></span>
      <span class="art-title">${item.surprise ? "SURPRISE ME" : esc(item.title)}</span>
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

function feedbackPopover(item, saved) {
  const path = experiencePath(item.id, saved);
  if (state.recommendationFeedbackItemId !== item.id || !path) return "";

  const showQuality = hasQualityNote(saved);
  const expanded = showQuality && qualityExpanded(item.id, saved);
  const qualityId = `quality-${item.id}`;

  return `
    <div class="rec-feedback-popover" role="dialog" aria-modal="false" aria-label="Feedback for ${esc(item.title)}">
      <div class="rec-feedback-popover-head">
        <div>
          <span class="rec-feedback-kicker">${path === "tried" ? "Tried it" : "Not tried"}</span>
          <strong>${esc(item.title)}</strong>
        </div>
        <button type="button" class="rec-feedback-close" data-feedback-close="${item.id}" aria-label="Close feedback">×</button>
      </div>
      ${experienceChoices(item.id, saved)}
      ${saved ? renderExperienceRefinement(item.id, item, saved) : ""}
      ${saved ? seriesExperienceFeedback(item, saved) : ""}
      ${showQuality ? `
        <div class="tertiary-feedback-toggle">
          ${moreFeedbackToggle(item.id, expanded, qualityId)}
        </div>
        <div class="tertiary-feedback" id="${qualityId}" ${expanded ? "" : "hidden"}>
          ${qualityNote(item.id, saved)}
        </div>` : ""}
      ${saved ? renderBlindSpotPanel(item.id) : ""}
    </div>`;
}

function cardSizeClass() {
  return "rec-span-4";
}

function recommendationCard(item, index, total) {
  const saved = state.feedbackByRecommendation[item.id];
  const layoutClass = `${cardSizeClass()} ${item.surprise ? "rec-surprise" : ""}`;
  const whyId = `why-${item.id}`;

  return `
    <article class="editorial-rec ${layoutClass} ${saved ? "is-rated" : ""} ${state.recommendationFeedbackItemId === item.id ? "has-feedback-open" : ""}" data-rec-id="${item.id}">
      ${item.surprise ? `<span class="surprise-burst" aria-hidden="true">GO<br />WEIRD</span>` : ""}

      ${mediaArt(item, index)}

      <div class="editorial-rec-body">
        <div class="editorial-rec-meta">
          <span>${item.surprise ? "Surprise Me" : `Pick ${String(index + 1).padStart(2, "0")}`}</span>
          <span>${esc(displayLabel(item))}${item.year ? ` · ${esc(item.year)}` : ""}</span>
        </div>

        <div class="editorial-title-row">
          <h3>${esc(item.title)}</h3>
        </div>

        <div class="editorial-status-row">
          <span class="reaction-status-slot">${saved ? `<span class="reaction-stamp reaction-${saved.rating}">&#10003; ${reactionLabel(saved)}</span>` : ""}</span>
          ${favoriteToggle(item.id)}
        </div>

        <p class="editorial-rationale">${esc(truncateCopy(readableRecommendationCopy(item.reason, item), RATIONALE_MAX_CHARS))}</p>
        <p class="editorial-about">${esc(truncateCopy(item.about, ABOUT_MAX_CHARS))}</p>

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

        <div class="rec-interaction">
          ${saved ? `
            <div class="reaction-complete">
              <span>${reactionLabel(saved)}</span>
              <button class="button button-quiet reaction-change" type="button" data-feedback-edit="${item.id}">Change</button>
            </div>`
          : `
            <div class="reaction-question">Have you tried it?</div>
            <div class="reaction-rail reaction-rail-binary" aria-label="Have you tried ${esc(item.title)}?">
              ${experienceButton(item.id, "tried", "Tried it", experiencePath(item.id, saved) === "tried")}
              ${experienceButton(item.id, "not-tried", "Not tried", experiencePath(item.id, saved) === "not-tried")}
            </div>
            <p class="mobile-swipe-hint">Swipe right to Save · left for Not interested</p>`}
        </div>
      </div>

      ${feedbackPopover(item, saved)}
    </article>`;
}

// #91: a lightweight skeleton while the FIRST set is loading and there is nothing to show yet, so the
// screen never looks frozen — it deliberately mirrors the real card shape (art block, title line,
// action row) rather than a generic spinner. Once any set exists, a later loading state is already
// communicated by renderAiStatus()/renderKeepDiscoveringBar(), so no skeleton is needed to avoid a
// jarring layout jump when results replace an already-populated grid.
function skeletonCard(index) {
  return `
    <div class="editorial-rec-skeleton rec-span-4" aria-hidden="true" style="animation-delay:${index * 70}ms">
      <div class="skeleton-art"></div>
      <div class="skeleton-body">
        <span class="skeleton-line is-short"></span>
        <span class="skeleton-line is-title"></span>
        <span class="skeleton-line"></span>
        <span class="skeleton-line is-medium"></span>
        <div class="skeleton-actions"><span></span><span></span><span></span></div>
      </div>
    </div>`;
}

function renderCardArea(items) {
  if (state.aiStatus === "loading") {
    return Array.from({ length: 6 }, (_, index) => skeletonCard(index)).join("");
  }
  if (items.length) return items.map((item, index) => recommendationCard(item, index, items.length)).join("");
  return `<div class="filter-empty recommendation-empty">No real catalog recommendations are available yet. Change your favorites or try another category.</div>`;
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
          <p>${state.aiMessage || "Finding a fresh set from what you have told Tastemake so far."}</p>
        </div>
      </div>`;
  }
  if (!state.aiMessage) return "";
  if (state.aiSource === "model") return "";
  if (state.aiSource === "catalog") return `<p class="ai-inline-status">Using catalog matches for this set.</p>`;
  return `<p class="ai-inline-status"><strong>Recommendations unavailable:</strong> Tastemake could not build a trustworthy set.</p>`;
}
// #93/2026-09-28: the ongoing-loop action. Available as soon as a set exists — not gated behind
// rating any card, let alone every card, in the current set (see canKeepDiscovering).
function renderKeepDiscoveringBar() {
  if (!canKeepDiscovering(state)) return "";
  const disabled = state.aiStatus === "loading";
  return `
    <div class="keep-discovering-bar">
      <p>Ready for another set? Tastemake will use what you have told it so far and stay in the category selected above.</p>
      <button class="button button-primary" type="button" data-action="keep-discovering" ${disabled ? "disabled" : ""}>
        ${disabled ? "Finding more…" : "More recommendations"}
      </button>
    </div>`;
}

function renderNextSteps() {
  if (!currentRoundComplete(state) || !outOfPicks(state)) return "";
  const bookmarks = bookmarkedFeedback(state).length;
  const viewBookmarks = bookmarks
    ? `<button class="button button-secondary" type="button" data-action="view-bookmarks">Saved</button>`
    : "";

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

  // Real bug (2026-09-29): "no button to get new recs" -- this checkpoint replaces the entire
  // More-recommendations footer once recommendationExhausted is true (e.g. after filtering to a
  // domain with no evidence in it), and its only actions were Change favorites/See profile. If the
  // real, one-click fix was simply "switch back to All," there was no way to do that from here at
  // all -- a genuine dead end, not just a confusing one. Reuses the exact data-domain-filter/
  // data-filter-scope="recommendations" attributes the SHOW ME bar already uses, so this needs no
  // new wiring in app.js's click handler.
  const filter = state.recommendationFilter ?? "all";
  const filterLabel = domainById(filter)?.label ?? filter;
  const showAll = filter !== "all"
    ? `<button class="button button-primary" type="button" data-domain-filter="all" data-filter-scope="recommendations">Show all instead</button>`
    : "";

  return `
    <div class="refresh-banner is-finished">
      <div>
        <span class="refresh-kicker">Prototype checkpoint</span>
        <strong>No more eligible catalog matches right now${filter !== "all" ? ` for ${esc(filterLabel)}` : ""}.</strong>
        <p>${filter !== "all"
          ? `Tastemake doesn't have enough evidence in ${esc(filterLabel)} yet. Try All, or change your favorites or areas to give it a different starting point.`
          : "Change your favorites or areas to give Tastemake a different starting point."}</p>
        ${bookmarkNote(bookmarks)}
      </div>
      <div class="action-group recommendation-footer-actions">
        ${showAll}
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

  return `
    <section class="recommendations-screen">
      ${renderStickerField("recommendations")}
      <div class="recommendations-masthead">
        <div class="rec-masthead-copy">
          <p class="kicker">${roundTwo ? "Fresh picks" : "For you right now"}</p>
          <h1>${roundTwo ? "Okay, that changed things." : "Things worth your time."}</h1>
          <p class="lede">${roundTwo
            ? "A new set shaped by your recent reactions."
            : "Movies, shows, books, games, and the occasional curveball. Try the ones that interest you and react naturally."}</p>
        </div>

        <div class="rec-progress-card">
          <div class="rec-progress-top">
            <strong>${rated}/${items.length}</strong>
            <span>rated</span>
          </div>
          <div class="progress-track" aria-hidden="true">${segments}</div>
          <div class="progress-note">${currentRoundComplete(state) ? (outOfPicks(state) ? "prototype checkpoint" : "new set unlocked") : "react as you go"}</div>
        </div>
      </div>

      <div class="filter-band recommendation-filter-band">
        <span class="filter-band-label">Show me</span>
        ${renderDomainFilter({ selected: state.recommendationFilter, scope: "recommendations", label: "Generate recommendations by type" })}
        <span class="filter-context">Choose the kind of recommendation set you want next.</span>
      </div>
      <!-- #117: Browse's post-onboarding home is here, as an alternate discovery mode, not a permanent
           top-level nav item. Looking around is still never taste evidence on its own. -->
      <p class="recommendation-browse-link">
        <button class="button button-quiet" type="button" data-action="browse">Browse by genre instead &rarr;</button>
      </p>
      ${renderAiStatus()}
      ${renderNextSteps()}

      <h2 class="visually-hidden">Your picks</h2>
      <div class="editorial-grid">
        ${renderCardArea(items)}
      </div>

      ${renderKeepDiscoveringBar()}

      ${state.aiStatus === "loading" ? "" : `
      <div class="recommendation-footer page-actions">
        <div class="page-actions-left"><button class="button button-quiet" type="button" data-action="back-favorites">&larr; Change favorites</button></div>
        <span class="footer-note">discover. react. repeat.</span>
        <div class="page-actions-right"><button class="button button-primary" type="button" data-action="view-model">See profile &rarr;</button></div>
      </div>`}
    </section>`;
}
