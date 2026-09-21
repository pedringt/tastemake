import { resetState, state } from "./state.js";
import { screenFromPath, writeRoute } from "./router.js";
import { activeRecommendations, bookmarkedFeedback, canKeepDiscovering, isBookmarked, isPositiveExperience, nextRecommendations } from "./model/taste.js";
import { renderFavorites } from "./screens/favorites.js";
import { renderProfile } from "./screens/profile.js";
import { reactionLabel, renderRecommendations } from "./screens/recommendations.js";
import { renderBookmarks } from "./screens/bookmarks.js";
import { renderLibrary } from "./screens/library.js";
import { lookContinueLabel, renderLook } from "./screens/look.js";
import { renderMine } from "./screens/mine.js";
import { applySearchAction } from "./model/search.js";
import { AREAS } from "./model/taste.js";
import { isLook, lookLabel } from "./data/looks.js";
import { initSearch } from "./components/search.js";
import { blindSpotFor, isBlindSpotCandidate, removeBlindSpot, saveBlindSpot } from "./model/blindspots.js";

const app = document.querySelector("#app");

const views = {
  favorites: renderFavorites,
  model: renderProfile,
  recommendations: renderRecommendations,
  library: renderLibrary,
  bookmarks: renderBookmarks,
  look: renderLook,
  mine: renderMine
};

function hasEnoughFavorites() {
  return state.selectedFavorites.size >= 4;
}

function canAccess(screen) {
  if (screen === "look" || screen === "mine") return true;
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

// Apply a look to the whole page right away (the picker is a live preview). Not taste evidence.
function setLook(id) {
  if (!isLook(id)) return;
  state.look = id;
  state.lookChosen = true;
  document.documentElement.dataset.look = id;
  document.querySelectorAll(".look-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.lookChoice === id));
  const done = app.querySelector('[data-action="look-done"]');
  if (done) done.textContent = lookContinueLabel();
  announce(`Look: ${lookLabel(id)}.`);
}

// ---- My Tastemake (#8) ----
function openMine() {
  if (state.screen !== "mine") state.mineReturn = state.screen;
  navigate("mine");
}

function mineRemoveFocusAfter(rowEl) {
  const next = rowEl?.nextElementSibling ?? rowEl?.previousElementSibling;
  if (next?.dataset.mineId) return `[data-mine-id="${next.dataset.mineId}"] .mine-action`;
  if (next?.dataset.mineBlind) return `[data-mine-blind="${next.dataset.mineBlind}"] .mine-action`;
  return null;
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || state.screen !== "mine") return;

  if (button.dataset.mineItem) {
    const id = button.dataset.mineItem;
    const item = state.feedbackByRecommendation[id]?.item;
    if (!item) return;
    const selector = button.dataset.mineAction === "remove"
      ? mineRemoveFocusAfter(button.closest(".mine-row"))
      : `[data-mine-item="${id}"][data-mine-action="${button.dataset.mineAction}"]`;
    const message = applySearchAction(state, item, button.dataset.mineAction);
    if (!message) return;
    render();
    updateStepper();
    restoreFocus(selector);
    announce(message);
    return;
  }

  if (button.dataset.mineBlindRemove) {
    const id = button.dataset.mineBlindRemove;
    const title = state.feedbackByRecommendation[id]?.item.title ?? "That pick";
    const selector = mineRemoveFocusAfter(button.closest(".mine-row"));
    removeBlindSpot(state, id);
    render();
    restoreFocus(selector);
    announce(`${title}: what you told it it got wrong was removed.`);
    return;
  }

  if (button.dataset.mineReset) {
    const step = button.dataset.mineReset;
    if (step === "confirm") {
      resetState();
      state.resetArmed = false;
      navigate("favorites");
      announce("Started over. Everything you told Tastemake in this visit is cleared.");
      return;
    }
    state.resetArmed = step === "arm";
    render();
    restoreFocus(step === "arm" ? '[data-mine-reset="cancel"]' : '[data-mine-reset="arm"]');
    announce(step === "arm" ? "Are you sure? This clears everything you told Tastemake." : "Nothing was cleared.");
    return;
  }

  if (button.dataset.action === "mine-back") {
    navigate(canAccess(state.mineReturn) ? state.mineReturn : "favorites");
  }
});

app.addEventListener("change", (event) => {
  if (state.screen !== "mine") return;
  const area = event.target.closest("[data-mine-area]");
  if (area) {
    const id = area.dataset.mineArea;
    state.areas[id] = area.checked;
    if (!AREAS.some((a) => state.areas[a.id] !== false)) state.areas[id] = true;   // never all off
    const label = AREAS.find((a) => a.id === id).label;
    render();
    restoreFocus(`[data-mine-area="${id}"]`);
    announce(`${label} is ${state.areas[id] ? "on" : "off"} for new sets.`);
    return;
  }
  if (event.target.closest("[data-mine-curveball]")) {
    state.curveball = event.target.checked;
    render();
    restoreFocus("[data-mine-curveball]");
    announce(`Curveball is ${state.curveball ? "on" : "off"} for new sets.`);
  }
});

function openLookPicker() {
  if (state.screen !== "look") state.lookReturn = state.screen;
  state.lookOnboarding = false;
  navigate("look");
}

function finishLookPicker() {
  state.lookChosen = true;
  const wasOnboarding = state.lookOnboarding;
  state.lookOnboarding = false;
  const target = wasOnboarding ? "favorites" : state.lookReturn;
  navigate(canAccess(target) ? target : "favorites");
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
  if (d.mineItem && d.mineAction) return `[data-mine-item="${d.mineItem}"][data-mine-action="${d.mineAction}"]`;
  if (d.mineBlindRemove) return `[data-mine-blind-remove="${d.mineBlindRemove}"]`;
  if (d.mineReset) return `[data-mine-reset="${d.mineReset === "arm" ? "cancel" : "arm"}"]`;
  if (d.profileView) return `[data-profile-view="${d.profileView}"]`;
  if (d.mapPattern) return `[data-map-pattern="${d.mapPattern}"]`;
  if (d.mapItem) return `[data-map-item="${d.mapItem}"]`;
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
    if (scope === "map") state.mapFilter = filter.dataset.domainFilter;
    render();
    restoreFocus(focusSelector);
    return;
  }

  const viewButton = event.target.closest("[data-profile-view]");
  if (viewButton) {
    state.profileView = viewButton.dataset.profileView;
    render();
    restoreFocus(focusSelector);
    announce(state.profileView === "map" ? "Showing your Taste Profile as a map." : "Showing your Taste Profile as a list.");
    return;
  }

  const mapPattern = event.target.closest("[data-map-pattern]");
  if (mapPattern) {
    const id = mapPattern.dataset.mapPattern;
    // Tapping the selected pattern again clears it; picking a pattern from an evidence chip keeps that pick.
    state.mapPattern = state.mapPattern === id && mapPattern.classList.contains("taste-map-node") ? null : id;
    render();
    const heading = app.querySelector("[data-map-focus]");
    if (heading) heading.focus({ preventScroll: false });
    else restoreFocus(focusSelector);
    const shown = state.mapPattern ? document.querySelector(`[data-map-pattern="${state.mapPattern}"] b`)?.textContent : null;
    announce(shown ? `${shown} selected. Its evidence is below the map.` : "Pattern cleared.");
    return;
  }

  const mapItem = event.target.closest("[data-map-item]");
  if (mapItem) {
    const id = mapItem.dataset.mapItem;
    state.mapItem = state.mapItem === id ? null : id;
    render();
    restoreFocus(focusSelector);
    const shownItem = state.feedbackByRecommendation[state.mapItem]?.item.title;
    announce(shownItem ? `${shownItem}: the patterns it leans on are highlighted on the map.` : "Pick cleared.");
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
  if (event.target.closest("[data-open-look]")) { openLookPicker(); return; }
  if (event.target.closest("[data-open-mine]")) { openMine(); return; }
  if (event.target.closest('[data-action="look-done"]')) { finishLookPicker(); return; }
  if (!event.target.closest(".editorial-why")) closeWhyPopovers();

  const jump = event.target.closest("[data-step-jump]");
  if (!jump) return;

  const isPlainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  if (!isPlainLeftClick) return;

  event.preventDefault();
  navigate(jump.dataset.stepJump);
});

document.addEventListener("change", (event) => {
  const radio = event.target.closest('input[name="look"]');
  if (radio) setLook(radio.value);
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

// First visit at the bare address shows "Choose a starting look" before Favorites. A deep link
// (/library, ...) or a ?look=... link goes straight to the page, using that look.
const atRoot = (window.location.pathname.replace(/\/$/, "") || "/") === "/";
if (new URLSearchParams(window.location.search).has("look")) state.lookChosen = true;
const initialScreen = screenFromPath();
if (atRoot && !state.lookChosen) {
  state.screen = "look";
  state.lookOnboarding = true;
} else {
  state.screen = canAccess(initialScreen) ? initialScreen : "favorites";
}
writeRoute(state.screen, { replace: true });
render();
updateStepper();
