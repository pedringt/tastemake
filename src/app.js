import { state } from "./state.js";
import { screenFromPath, writeRoute } from "./router.js";
import { bookmarkedFeedback, canKeepDiscovering, openingRecommendations } from "./model/taste.js";
import { renderFavorites } from "./screens/favorites.js";
import { renderProfile } from "./screens/profile.js";
import { renderRecommendations } from "./screens/recommendations.js";
import { renderBookmarks } from "./screens/bookmarks.js";
import { renderLibrary } from "./screens/library.js";
import { lookContinueLabel, renderLook } from "./screens/look.js";
import { renderSetup } from "./screens/setup.js";
import { renderMine } from "./screens/mine.js";
import { setStatement, toggleDomainExclusion } from "./model/statements.js";
import { isLook, lookLabel } from "./data/looks.js";
import { visibleDomains } from "./data/domains.js";
import { initSearch } from "./components/search.js";
import { AI_LOADING, cancelRequest } from "./ai/requests.js";
import { focusSelectorFor, restoreFocusIn } from "./actions/focus.js";
import { handleMineChange, handleMineClick, openMine } from "./actions/mine.js";
import { saveBlindAction } from "./actions/blindspot.js";
import { saveBookmarkAction, saveLibraryAction } from "./actions/library.js";
import { announceReaction, runKeepDiscovering, saveFeedbackDetail, saveFeedbackQuality, saveQuickFeedback, toggleExpandedFeedback } from "./actions/recommendations.js";
import { saveTastebreakAction } from "./actions/tastebreak.js";
import { setTastebreakNote } from "./model/tastebreak.js";

// app.js is orchestration only: routing between screens, rendering, focus/announce plumbing, and
// dispatching DOM events to the action modules in ./actions/ and ./model/ (#39). Product rules and
// state mutation live in those modules, not here.

const app = document.querySelector("#app");

const views = {
  favorites: renderFavorites,
  model: renderProfile,
  recommendations: renderRecommendations,
  library: renderLibrary,
  bookmarks: renderBookmarks,
  look: renderLook,
  setup: renderSetup,
  mine: renderMine
};

function hasEnoughFavorites() {
  return state.selectedFavorites.size >= 4;
}

function canAccess(screen) {
  // #29/#68: Bookmarks is a real destination even with nothing saved yet — the empty state explains how
  // to get there instead of the tab just disappearing until you happen to bookmark something.
  if (screen === "look" || screen === "setup" || screen === "mine" || screen === "bookmarks") return true;
  return screen === "favorites" || hasEnoughFavorites();
}

function render() {
  app.innerHTML = views[state.screen]();
}

function updateStepper() {
  const order = ["favorites", "recommendations", "model", "library", "bookmarks"];
  const activeIndex = order.indexOf(state.screen);

  // #59 item 4: keep the guided first-run path (Favorites -> Recommendations) visually dominant by
  // de-emphasizing secondary destinations until the first loop is done, instead of a separate onboarding
  // shell. Nothing is hidden or disabled here beyond what canAccess() already gates — just quieter.
  document.querySelector(".app-shell")?.classList.toggle("is-onboarding", !state.onboarded);

  document.querySelectorAll("[data-step-jump]").forEach((step) => {
    const screen = step.dataset.stepJump;
    const index = order.indexOf(screen);
    const unlocked = canAccess(screen);

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

function restoreFocus(selector, fallback = app) {
  restoreFocusIn(app, selector, fallback);
}

// Apply a look to the whole page right away (the picker is a live preview). Not taste evidence.
function setLook(id) {
  if (!isLook(id)) return;
  // Changing fonts/spacing between looks can trigger browser scroll anchoring by a few pixels.
  // Treat this as a presentation-only change: keep the user's viewport exactly where it was.
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const root = document.documentElement;
  const previousOverflowAnchor = root.style.overflowAnchor;
  root.style.overflowAnchor = "none";
  state.look = id;
  root.dataset.look = id;
  document.querySelectorAll(".look-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.lookChoice === id));
  const done = app.querySelector('[data-action="look-done"]');
  if (done) done.textContent = lookContinueLabel();
  const restoreViewport = () => window.scrollTo(scrollX, scrollY);
  restoreViewport();
  requestAnimationFrame(() => {
    restoreViewport();
    requestAnimationFrame(() => {
      restoreViewport();
      root.style.overflowAnchor = previousOverflowAnchor;
    });
  });
  announce(`Look: ${lookLabel(id)}.`);
}

const mineCtx = { render, updateStepper, restoreFocus, announce, navigate: (screen) => navigate(screen), canAccess };

app.addEventListener("click", (event) => {
  if (state.screen !== "mine") return;
  handleMineClick(event, mineCtx);
});

app.addEventListener("change", (event) => {
  if (state.screen === "setup") {
    const area = event.target.closest("[data-setup-area]");
    if (area) {
      const id = area.dataset.setupArea;
      if (id === "all") {
        if (area.checked) state.setupAreas = new Set(["all"]);
        else if (state.setupAreas.size === 1) state.setupAreas = new Set(["all"]);
      } else {
        const next = new Set(state.setupAreas);
        next.delete("all");
        if (area.checked) next.add(id);
        else next.delete(id);
        state.setupAreas = next.size ? next : new Set(["all"]);
      }
      render();
      restoreFocus(`[data-setup-area="${id}"]`);
      return;
    }
    const style = event.target.closest("[data-setup-style]");
    if (style) {
      state.recommendationStyle = style.value;
      render();
      restoreFocus(`[data-setup-style][value="${style.value}"]`);
      return;
    }
  }
  if (state.screen !== "mine") return;
  handleMineChange(event, mineCtx);
});

function openLookPicker() {
  if (state.screen !== "look") state.lookReturn = state.screen;
  navigate("look");
}

function finishLookPicker() {
  if (!state.setupComplete) {
    state.setupReturn = "favorites";
    navigate("setup");
    return;
  }
  navigate(canAccess(state.lookReturn) ? state.lookReturn : "favorites");
}

function applySetupPreferences() {
  const all = state.setupAreas.has("all");
  for (const domain of visibleDomains()) state.areas[domain.id] = all || state.setupAreas.has(domain.id);
  state.curveball = state.recommendationStyle !== "safe";
}

function finishSetup() {
  const name = state.displayName.trim();
  if (!name) {
    announce("Add your name to continue.");
    app.querySelector("[data-setup-name]")?.focus();
    return;
  }
  const firstSetup = !state.setupComplete;
  state.displayName = name;
  applySetupPreferences();
  if (firstSetup) state.recommendationSets = [openingRecommendations(state)];
  state.setupComplete = true;
  const target = canAccess(state.setupReturn) ? state.setupReturn : "favorites";
  state.setupReturn = "favorites";
  navigate(target);
}

// #59: reaching Recommendations at least once ends the guided first-run state (see state.js).
function markOnboarded(screen) {
  if (screen === "recommendations") state.onboarded = true;
}

function navigate(screen, { replace = false, scroll = true } = {}) {
  if (!canAccess(screen)) return;
  // Leaving the page a request was started from makes its answer irrelevant (#42).
  if (state.aiRequest && screen !== state.aiRequest.screen) cancelRequest(state, "you moved to another page while it was thinking");

  markOnboarded(screen);
  state.screen = screen;
  writeRoute(screen, { replace });
  render();
  updateStepper();

  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  focusApp();
}

function renderPreservingPosition(selector, focusSelector = null) {
  const before = document.querySelector(selector);
  const beforeTop = before?.getBoundingClientRect().top;

  render();
  updateStepper();
  restoreFocus(focusSelector);

  if (beforeTop === undefined) return;
  const after = document.querySelector(selector);
  if (!after) return;

  const afterTop = after.getBoundingClientRect().top;
  window.scrollBy({ top: afterTop - beforeTop, left: 0, behavior: "auto" });
}

function renderPreservingCardPosition(itemId, focusSelector = null) {
  renderPreservingPosition(`[data-rec-id="${itemId}"]`, focusSelector);
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

app.addEventListener("click", async (event) => {
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

  const sayButton = event.target.closest("[data-statement-pattern]");
  if (sayButton) {
    const { statementPattern, statementField, statementValue } = sayButton.dataset;
    const message = setStatement(state, statementPattern, statementField, statementValue);
    if (!message) return;
    render();
    restoreFocus(focusSelector);
    announce(message);
    return;
  }

  const scopeButton = event.target.closest("[data-scope-pattern]");
  if (scopeButton) {
    const { scopePattern, scopeDomain } = scopeButton.dataset;
    const message = toggleDomainExclusion(state, scopePattern, scopeDomain);
    if (!message) return;
    render();
    restoreFocus(focusSelector);
    announce(message);
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

  const tastebreakButton = event.target.closest("[data-tastebreak-action][data-tastebreak-item]");
  if (tastebreakButton) {
    const itemId = tastebreakButton.dataset.tastebreakItem;
    const action = tastebreakButton.dataset.tastebreakAction;
    const message = saveTastebreakAction(itemId, action, tastebreakButton.dataset.tastebreakValue);
    const keepFocus = action === "toggle-pattern" ? focusSelector : null;
    renderPreservingPosition(`[data-tastebreak-panel="${itemId}"]`, keepFocus);
    // Starting or editing lands on the question so a screen reader hears it; toggling a pattern stays put.
    if (!keepFocus && (action === "start" || action === "edit")) app.querySelector(`[data-tastebreak-focus="${itemId}"]`)?.focus({ preventScroll: true });
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
      // Favorite/Unfavorite changes the button's data-action, so target its replacement explicitly.
      // Other reactions may move the card; in that case land on the next usable Library control.
      const libraryFocus = outcome === "favorite"
        ? `[data-library-item="${itemId}"][data-library-action="unfavorite"]`
        : outcome === "unfavorite"
          ? `[data-library-item="${itemId}"][data-library-action="favorite"]`
          : focusSelector;
      restoreFocus(libraryFocus, app.querySelector(".library-reaction-edit summary") || app.querySelector(".library-action") || app);
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
      announce(`${title}: ${what}. ${left} ${left === 1 ? "thing" : "things"} left in Bookmarks.`);
    }
    return;
  }

  const rating = event.target.closest("[data-rating][data-feedback-item]");
  if (rating) {
    const itemId = rating.dataset.feedbackItem;
    if (saveQuickFeedback(itemId, rating.dataset.rating)) {
      renderPreservingCardPosition(itemId, focusSelector);
      announceReaction(itemId, announce);
    }
    return;
  }

  const detail = event.target.closest("[data-feedback-detail][data-feedback-item]");
  if (detail) {
    const itemId = detail.dataset.feedbackItem;
    if (saveFeedbackDetail(itemId, detail.dataset.feedbackDetail)) {
      renderPreservingCardPosition(itemId, focusSelector);
      announceReaction(itemId, announce);
    }
    return;
  }

  const quality = event.target.closest("[data-feedback-quality][data-feedback-item]");
  if (quality) {
    const itemId = quality.dataset.feedbackItem;
    if (saveFeedbackQuality(itemId, quality.dataset.feedbackQuality)) renderPreservingCardPosition(itemId, focusSelector);
    return;
  }

  const feedbackToggle = event.target.closest("[data-toggle-feedback]");
  if (feedbackToggle) {
    toggleExpandedFeedback(feedbackToggle.dataset.toggleFeedback);
    renderPreservingCardPosition(feedbackToggle.dataset.toggleFeedback, focusSelector);
    return;
  }

  const starterRemove = event.target.closest("[data-starter-remove]");
  if (starterRemove) {
    const id = starterRemove.dataset.starterRemove;
    state.selectedFavorites.delete(id);
    if (state.starterReplaceId === id) state.starterReplaceId = null;
    render();
    updateStepper();
    announce("Removed from your starter mix.");
    return;
  }

  const starterReplace = event.target.closest("[data-starter-replace]");
  if (starterReplace) {
    state.starterReplaceId = starterReplace.dataset.starterReplace;
    document.querySelector("#open-search")?.click();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "open-search") document.querySelector("#open-search")?.click();
  if (action === "edit-setup") {
    state.setupReturn = state.screen;
    navigate("setup");
  }
  if (action === "setup-done") finishSetup();
  if (action === "back-favorites") navigate("favorites");
  if (action === "view-model") navigate("model");
  if (action === "show-recs") navigate("recommendations");

  if (action === "view-bookmarks") navigate("bookmarks");

  if (action === "keep-discovering" && canKeepDiscovering(state) && state.aiStatus !== AI_LOADING) {
    await runKeepDiscovering({ render, updateStepper, announce, navigate });
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-look]")) { openLookPicker(); return; }
  if (event.target.closest("[data-open-mine]")) { openMine(navigate); return; }
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

// Written straight to the draft with no render, so typing never loses the cursor or scroll position.
// Saved (and shown back) only when the Tastebreak panel's Save button is pressed.
app.addEventListener("input", (event) => {
  const setupName = event.target.closest("[data-setup-name]");
  if (setupName) {
    state.displayName = setupName.value;
    const next = app.querySelector('[data-action="setup-done"]');
    if (next) next.disabled = !setupName.value.trim();
    return;
  }
  const note = event.target.closest("[data-tastebreak-note]");
  if (note) setTastebreakNote(state, note.dataset.tastebreakItem, note.value);
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
  markOnboarded(state.screen);
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

// First visit is deliberately short: choose a look -> basic setup -> build a starter mix.
// Direct links still open their requested screen when accessible.
const initialScreen = screenFromPath();
state.screen = canAccess(initialScreen) ? initialScreen : "look";
markOnboarded(state.screen);
writeRoute(state.screen, { replace: true });
render();
updateStepper();
