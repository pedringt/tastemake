import { state } from "./state.js";
import { screenFromPath, writeRoute } from "./router.js";
import { activeRecommendations, bookmarkedFeedback, canKeepDiscovering, isBookmarked, isPositiveExperience, nextRecommendations } from "./model/taste.js";
import { renderFavorites } from "./screens/favorites.js";
import { renderProfile } from "./screens/profile.js";
import { reactionLabel, renderRecommendations } from "./screens/recommendations.js";
import { renderBookmarks } from "./screens/bookmarks.js";
import { renderLibrary } from "./screens/library.js";
import { initSearch } from "./components/search.js";
import { blindSpotFor, isBlindSpotCandidate, removeBlindSpot, saveBlindSpot } from "./model/blindspots.js";

const app = document.querySelector("#app");

const views = {
  favorites: renderFavorites,
  model: renderProfile,
  recommendations: renderRecommendations,
  library: renderLibrary,
  bookmarks: renderBookmarks
};

function hasEnoughFavorites() {
  return state.selectedFavorites.size >= 4;
}

function canAccess(screen) {
  if (screen === "bookmarks") return bookmarkedFeedback(state).length > 0;
  return screen === "favorites" || hasEnoughFavorites();
}

function render() {
  app.innerHTML = views[state.screen]();
}

function updateStepper() {
  const order = ["favorites", "recommendations", "model", "library", "bookmarks"];
  const activeIndex = order.indexOf(state.screen);

  document.querySelectorAll("[data-step-jump]").forEach((step) => {
    const screen = step.dataset.stepJump;
    const index = order.indexOf(screen);
    const unlocked = canAccess(screen);

    // Bookmarks only shows up once there is something saved (or while the user is on that page).
    if (screen === "bookmarks") {
      const count = bookmarkedFeedback(state).length;
      step.hidden = count === 0 && state.screen !== "bookmarks";
      step.querySelector("[data-bookmark-count]").textContent = count ? String(count) : "";
    }

    step.classList.toggle("is-active", screen === state.screen);
    step.classList.toggle("is-complete", index >= 0 && index < activeIndex);
    step.classList.toggle("is-disabled", !unlocked);
    step.setAttribute("aria-disabled", String(!unlocked));

    if (screen === state.screen) step.setAttribute("aria-current", "page");
    else step.removeAttribute("aria-current");
  });
}

function focusApp() {
  window.setTimeout(() => app.focus({ preventScroll: true }), 0);
}

const live = document.querySelector("#live");

// Polite announcement for screen readers (the region lives outside #app, so re-rendering never wipes it).
function announce(message) {
  if (!live) return;
  live.textContent = "";
  window.setTimeout(() => { live.textContent = message; }, 40);
}

// Every action re-renders the screen, which would drop keyboard focus to the page. Remember which
// control had focus and put it back on the new copy (or on the page if that control is gone).
function focusSelectorFor(el) {
  const d = el?.dataset;
  if (!d) return null;
  if (d.feedbackItem && d.rating) return `[data-feedback-item="${d.feedbackItem}"][data-rating="${d.rating}"]`;
  if (d.feedbackItem && d.feedbackDetail) return `[data-feedback-item="${d.feedbackItem}"][data-feedback-detail="${d.feedbackDetail}"]`;
  if (d.feedbackItem && d.feedbackQuality) return `[data-feedback-item="${d.feedbackItem}"][data-feedback-quality="${d.feedbackQuality}"]`;
  if (d.bookmarkItem && d.bookmarkAction) return `[data-bookmark-item="${d.bookmarkItem}"][data-bookmark-action="${d.bookmarkAction}"]`;
  if (d.libraryItem && d.libraryAction) return `[data-library-item="${d.libraryItem}"][data-library-action="${d.libraryAction}"]`;
  if (d.blindItem && d.blindAction) return `[data-blind-item="${d.blindItem}"][data-blind-action="${d.blindAction}"]${d.blindValue ? `[data-blind-value="${d.blindValue}"]` : ""}`;
  if (d.favorite) return `[data-favorite="${d.favorite}"]`;
  if (d.domainFilter && d.filterScope) return `[data-domain-filter="${d.domainFilter}"][data-filter-scope="${d.filterScope}"]`;
  return null;
}

function restoreFocus(selector, fallback = app) {
  const target = (selector && app.querySelector(selector)) || fallback;
  target.focus({ preventScroll: true });
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function announceReaction(itemId) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!feedback) return;
  const saved = bookmarkedFeedback(state).length;
  const bookmarkPart = isBookmarked(feedback) ? ` ${plural(saved, "thing", "things")} bookmarked.` : "";
  const offer = isBlindSpotCandidate(feedback) && !blindSpotFor(state, itemId)
    ? " Tastemake expected you to like this. There is an option below to tell it what it got wrong."
    : "";
  announce(`${feedback.item.title}: ${reactionLabel(feedback)}.${bookmarkPart}${offer}`);
}

function navigate(screen, { replace = false, scroll = true } = {}) {
  if (!canAccess(screen)) return;

  state.screen = screen;
  writeRoute(screen, { replace });
  render();
  updateStepper();

  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  focusApp();
}

function saveQuickFeedback(itemId, rating) {
  const item = activeRecommendations(state).find((rec) => rec.id === itemId);
  if (!item) return false;

  const existing = state.feedbackByRecommendation[itemId];
  state.feedbackByRecommendation[itemId] = {
    item,
    rating,
    detail: null,
    // "Surprised me" only makes sense after Loved/Liked it before, which a fresh rating clears.
    quality: existing?.quality === "surprised-me" ? null : existing?.quality || null
  };

  return true;
}

function saveFeedbackDetail(itemId, detail) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  existing.detail = existing.detail === detail ? null : detail;
  if (existing.quality === "surprised-me" && !isPositiveExperience(existing)) existing.quality = null;
  return true;
}

function saveFeedbackQuality(itemId, quality) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  existing.quality = existing.quality === quality ? null : quality;
  return true;
}

const triedOutcomes = {
  "tried-loved": ["more", "loved-before"],
  "tried-liked": ["more", "liked-before"],
  "tried-disliked": ["less", "tried-disliked"]
};

// Trying a bookmarked item turns it into a real reaction (and only then can it teach the model).
// wasBookmarked keeps a record that it was saved first, so the pre-try bookmark can later be
// compared with how it actually went.
function saveBookmarkAction(itemId, action) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!isBookmarked(existing)) return false;

  if (action === "remove") {
    existing.detail = null;
    return true;
  }

  const outcome = triedOutcomes[action];
  if (!outcome) return false;
  const [rating, detail] = outcome;
  state.feedbackByRecommendation[itemId] = { item: existing.item, rating, detail, quality: existing.quality, wasBookmarked: true };
  return true;
}

// Library corrections change the underlying reaction, so the Library, Taste Profile and Bookmarks
// can never disagree. Starring a Favorite is only possible while the pick is still "Loved it before".
const libraryOutcomes = {
  loved: ["more", "loved-before"],
  liked: ["more", "liked-before"],
  disliked: ["less", "tried-disliked"]
};

function saveLibraryAction(itemId, action) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  if (action === "favorite") {
    if (existing.detail !== "loved-before") return false;
    state.libraryFavorites.add(itemId);
    return true;
  }
  if (action === "unfavorite") {
    state.libraryFavorites.delete(itemId);
    return true;
  }

  const outcome = libraryOutcomes[action];
  if (!outcome) return false;
  [existing.rating, existing.detail] = outcome;
  if (existing.detail !== "loved-before") state.libraryFavorites.delete(itemId);
  // "Surprised me" only makes sense after Loved / Liked it before.
  if (existing.quality === "surprised-me" && !isPositiveExperience(existing)) existing.quality = null;
  return true;
}

// Taste Blind Spot (#20) panel: a small, resumable two-question flow. Returns a sentence to announce.
function saveBlindAction(itemId, action, value) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!feedback) return null;
  const draft = state.blindSpotDrafts[itemId];
  const title = feedback.item.title;
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (action === "start" || action === "edit") {
    const saved = blindSpotFor(state, itemId);
    state.blindSpotDrafts[itemId] = { step: 1, broken: [...(saved?.hypotheses ?? [])], none: Boolean(saved?.none), reasons: [...(saved?.reasons ?? [])] };
    state.blindSpotDismissed.delete(itemId);
    return "Question 1 of 2. Which of the reasons Tastemake picked this didn't hold up for you?";
  }
  if (action === "dismiss") { state.blindSpotDismissed.add(itemId); return `Okay. You can tell Tastemake what it got wrong about ${title} any time.`; }
  if (action === "remove") { removeBlindSpot(state, itemId); return `${title} is no longer a blind spot.`; }
  if (!draft) return null;

  if (action === "toggle-pattern") {
    if (value === "none") { draft.none = !draft.none; if (draft.none) draft.broken = []; }
    else { draft.none = false; draft.broken = toggle(draft.broken, value); }
    return null;
  }
  if (action === "toggle-reason") { draft.reasons = toggle(draft.reasons, value); return null; }
  if (action === "next") {
    if (draft.step === 1 && !draft.broken.length && !draft.none) return null;
    draft.step = Math.min(3, draft.step + 1);
    return draft.step === 2 ? "Question 2 of 2. What got in the way?" : "Does this sound right?";
  }
  if (action === "back") { draft.step = Math.max(1, draft.step - 1); return null; }
  if (action === "save") { saveBlindSpot(state, itemId, draft); return `Noted. ${title} is now a blind spot Tastemake will learn from.`; }
  if (action === "discard") { delete state.blindSpotDrafts[itemId]; return "Discarded."; }
  return null;
}

function renderPreservingCardPosition(itemId, focusSelector = null) {
  const before = document.querySelector(`[data-rec-id="${itemId}"]`);
  const beforeTop = before?.getBoundingClientRect().top;

  render();
  updateStepper();
  restoreFocus(focusSelector);

  if (beforeTop === undefined) return;
  const after = document.querySelector(`[data-rec-id="${itemId}"]`);
  if (!after) return;

  const afterTop = after.getBoundingClientRect().top;
  window.scrollBy({ top: afterTop - beforeTop, left: 0, behavior: "auto" });
}

function closeWhyPopovers(except = null) {
  document.querySelectorAll(".editorial-why.is-pinned").forEach((popover) => {
    if (popover === except) return;
    popover.classList.remove("is-pinned");
    popover.querySelector(".why-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function toggleWhyPopover(trigger) {
  const wrapper = trigger.closest(".editorial-why");
  if (!wrapper) return;

  const shouldPin = !wrapper.classList.contains("is-pinned");
  closeWhyPopovers(wrapper);
  wrapper.classList.toggle("is-pinned", shouldPin);
  trigger.setAttribute("aria-expanded", String(shouldPin));
}

app.addEventListener("click", (event) => {
  const focusSelector = focusSelectorFor(event.target.closest("button"));

  const whyTrigger = event.target.closest(".why-trigger");
  if (whyTrigger) {
    toggleWhyPopover(whyTrigger);
    return;
  }

  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = favorite.dataset.favorite;
    if (state.selectedFavorites.has(id)) state.selectedFavorites.delete(id);
    else state.selectedFavorites.add(id);
    render();
    updateStepper();
    restoreFocus(focusSelector);
    return;
  }

  const filter = event.target.closest("[data-domain-filter][data-filter-scope]");
  if (filter) {
    const scope = filter.dataset.filterScope;
    if (scope === "favorites") state.favoriteFilter = filter.dataset.domainFilter;
    if (scope === "recommendations") state.recommendationFilter = filter.dataset.domainFilter;
    if (scope === "library") state.libraryFilter = filter.dataset.domainFilter;
    render();
    restoreFocus(focusSelector);
    return;
  }

  const blindButton = event.target.closest("[data-blind-action][data-blind-item]");
  if (blindButton) {
    const itemId = blindButton.dataset.blindItem;
    const action = blindButton.dataset.blindAction;
    const message = saveBlindAction(itemId, action, blindButton.dataset.blindValue);
    const keepFocus = action.startsWith("toggle-") ? focusSelector : null;
    renderPreservingCardPosition(itemId, keepFocus);
    // Moving between steps: land on the new step's question so a screen reader hears it.
    if (!keepFocus) app.querySelector(`[data-blind-focus="${itemId}"]`)?.focus({ preventScroll: true });
    if (message) announce(message);
    return;
  }

  const libraryAction = event.target.closest("[data-library-action][data-library-item]");
  if (libraryAction) {
    const itemId = libraryAction.dataset.libraryItem;
    const outcome = libraryAction.dataset.libraryAction;
    const title = state.feedbackByRecommendation[itemId]?.item.title;
    if (saveLibraryAction(itemId, outcome)) {
      render();
      updateStepper();
      // A card can leave the list (e.g. Didn't like it); land on the next action, or on the page if none is left.
      restoreFocus(focusSelector, app.querySelector(".library-action") || app);
      announce(({
        favorite: `${title} added to Favorites.`,
        unfavorite: `${title} removed from Favorites. It stays in your Library.`,
        loved: `${title}: marked Loved it before.`,
        liked: `${title}: marked Liked it before.`,
        disliked: `${title}: marked Tried it and disliked it. It has left your Library.`
      })[outcome]);
    }
    return;
  }

  const bookmarkAction = event.target.closest("[data-bookmark-action][data-bookmark-item]");
  if (bookmarkAction) {
    const itemId = bookmarkAction.dataset.bookmarkItem;
    const outcome = bookmarkAction.dataset.bookmarkAction;
    const title = state.feedbackByRecommendation[itemId]?.item.title;
    if (saveBookmarkAction(itemId, outcome)) {
      render();
      updateStepper();
      // The card usually leaves the list; land on the next card's first action, or on the page if none is left.
      restoreFocus(focusSelector, app.querySelector(".bookmark-action") || app);
      const left = bookmarkedFeedback(state).length;
      const what = ({ "tried-loved": "marked Loved it before", "tried-liked": "marked Liked it before", "tried-disliked": "marked Tried it and disliked it", remove: "bookmark removed" })[outcome];
      announce(`${title}: ${what}. ${plural(left, "thing", "things")} left in Bookmarks.`);
    }
    return;
  }

  const rating = event.target.closest("[data-rating][data-feedback-item]");
  if (rating) {
    const itemId = rating.dataset.feedbackItem;
    if (saveQuickFeedback(itemId, rating.dataset.rating)) {
      renderPreservingCardPosition(itemId, focusSelector);
      announceReaction(itemId);
    }
    return;
  }

  const detail = event.target.closest("[data-feedback-detail][data-feedback-item]");
  if (detail) {
    const itemId = detail.dataset.feedbackItem;
    if (saveFeedbackDetail(itemId, detail.dataset.feedbackDetail)) {
      renderPreservingCardPosition(itemId, focusSelector);
      announceReaction(itemId);
    }
    return;
  }

  const quality = event.target.closest("[data-feedback-quality][data-feedback-item]");
  if (quality) {
    const itemId = quality.dataset.feedbackItem;
    if (saveFeedbackQuality(itemId, quality.dataset.feedbackQuality)) renderPreservingCardPosition(itemId, focusSelector);
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "back-favorites") navigate("favorites");
  if (action === "view-model") navigate("model");
  if (action === "show-recs") navigate("recommendations");

  if (action === "view-bookmarks") navigate("bookmarks");

  if (action === "keep-discovering" && canKeepDiscovering(state)) {
    state.recommendationSets.push(nextRecommendations(state));
    state.recommendationFilter = "all";
    navigate("recommendations", { replace: true });
    announce(`New set: ${plural(activeRecommendations(state).length, "pick", "picks")}.`);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".editorial-why")) closeWhyPopovers();

  const jump = event.target.closest("[data-step-jump]");
  if (!jump) return;

  const isPlainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  if (!isPlainLeftClick) return;

  event.preventDefault();
  navigate(jump.dataset.stepJump);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const trigger = document.querySelector(".editorial-why.is-pinned .why-trigger");
  if (!trigger) return;
  closeWhyPopovers();
  trigger.focus({ preventScroll: true });
});

window.addEventListener("popstate", () => {
  const next = screenFromPath();
  state.screen = canAccess(next) ? next : "favorites";
  if (state.screen !== next) writeRoute("favorites", { replace: true });
  render();
  updateStepper();
  focusApp();
});

initSearch({
  // an explicit action in the search dialog changed state: refresh whatever screen is behind it
  onChange(message) {
    render();
    updateStepper();
    announce(message);
  },
  announce,
  goTo(screen) { navigate(screen); }
});

const initialScreen = screenFromPath();
state.screen = canAccess(initialScreen) ? initialScreen : "favorites";
writeRoute(state.screen, { replace: true });
render();
updateStepper();
