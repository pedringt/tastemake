import { state } from "./state.js";
import { favorites } from "./data/catalog.js";
import { screenFromPath, writeRoute } from "./router.js";
import { activeRecommendations, currentRoundComplete } from "./model/taste.js";
import { renderFavorites } from "./screens/favorites.js";
import { renderProfile } from "./screens/profile.js";
import { renderRecommendations } from "./screens/recommendations.js";

const app = document.querySelector("#app");

const views = {
  favorites: renderFavorites,
  model: renderProfile,
  recommendations: renderRecommendations
};

function hasEnoughFavorites() {
  return state.selectedFavorites.size >= 4;
}

function canAccess(screen) {
  return screen === "favorites" || hasEnoughFavorites();
}

function render() {
  app.innerHTML = views[state.screen]();
}

function updateStepper() {
  const order = ["favorites", "model", "recommendations"];
  const activeIndex = order.indexOf(state.screen);

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

  state.feedbackByRecommendation[itemId] = {
    item,
    rating,
    detail: null
  };

  return true;
}

function saveFeedbackDetail(itemId, detail) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  existing.detail = existing.detail === detail ? null : detail;
  return true;
}

function renderPreservingCardPosition(itemId) {
  const before = document.querySelector(`[data-rec-id="${itemId}"]`);
  const beforeTop = before?.getBoundingClientRect().top;

  render();
  updateStepper();

  if (beforeTop === undefined) return;
  const after = document.querySelector(`[data-rec-id="${itemId}"]`);
  if (!after) return;

  const afterTop = after.getBoundingClientRect().top;
  window.scrollBy({ top: afterTop - beforeTop, left: 0, behavior: "auto" });
}

app.addEventListener("click", (event) => {
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) {
    const id = favorite.dataset.favorite;
    if (state.selectedFavorites.has(id)) state.selectedFavorites.delete(id);
    else state.selectedFavorites.add(id);
    render();
    updateStepper();
    return;
  }

  const filter = event.target.closest("[data-domain-filter][data-filter-scope]");
  if (filter) {
    const scope = filter.dataset.filterScope;
    if (scope === "favorites") state.favoriteFilter = filter.dataset.domainFilter;
    if (scope === "recommendations") state.recommendationFilter = filter.dataset.domainFilter;
    render();
    return;
  }

  const rating = event.target.closest("[data-rating][data-feedback-item]");
  if (rating) {
    const itemId = rating.dataset.feedbackItem;
    if (saveQuickFeedback(itemId, rating.dataset.rating)) renderPreservingCardPosition(itemId);
    return;
  }

  const detail = event.target.closest("[data-feedback-detail][data-feedback-item]");
  if (detail) {
    const itemId = detail.dataset.feedbackItem;
    if (saveFeedbackDetail(itemId, detail.dataset.feedbackDetail)) renderPreservingCardPosition(itemId);
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "back-favorites") navigate("favorites");
  if (action === "view-model") navigate("model");
  if (action === "show-recs") navigate("recommendations");

  if (action === "refresh-recommendations" && currentRoundComplete(state) && state.recommendationRound === 1) {
    state.recommendationRound = 2;
    state.recommendationFilter = "all";
    navigate("recommendations", { replace: true });
  }
});

document.addEventListener("click", (event) => {
  const jump = event.target.closest("[data-step-jump]");
  if (!jump) return;

  const isPlainLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  if (!isPlainLeftClick) return;

  event.preventDefault();
  navigate(jump.dataset.stepJump);
});

window.addEventListener("popstate", () => {
  const next = screenFromPath();
  state.screen = canAccess(next) ? next : "favorites";
  if (state.screen !== next) writeRoute("favorites", { replace: true });
  render();
  updateStepper();
  focusApp();
});

const initialScreen = screenFromPath();
state.screen = canAccess(initialScreen) ? initialScreen : "favorites";
writeRoute(state.screen, { replace: true });
render();
updateStepper();
