// Real production incident (2026-09-28/29): an automated PR (#162) added
// `import { inject } from "@vercel/analytics"` here. This app has no build step -- app.js loads as
// a native browser ES module, which cannot resolve a bare package-name specifier without an import
// map. Every real page load threw "Failed to resolve module specifier" synchronously, which aborted
// this entire module's evaluation before any of the app's own code ran -- the static HTML shell
// (header/nav) still rendered, but nothing else did: no routing, no recommendations, nothing. This
// was the exact cause of a live "black screen" report. If Web Analytics is wanted here, Vercel's own
// non-framework guide uses a plain `<script defer src="/_vercel/insights/script.js">` tag instead,
// which needs no module resolution. #100 does exactly that, in src/lib/vercel-insights.js (its own
// module in index.html, so it can never stop this one from running).
import { exampleBannerHtml, exampleRequestedAtBoot, forgetViewingExample, isViewingExample, loadExampleProfile } from "./example-profile.js";
import { state } from "./state.js";
import { normalizedRefinements } from "./model/refinements.js";
import { trackReasonChanged, trackReasonsOpened } from "./lib/reason-events.js";
import { screenFromPath, writeRoute } from "./router.js";
import { activeRecommendations, bookmarkedFeedback, canKeepDiscovering, isBookmarked } from "./model/taste.js";
import { libraryItemById, migrateStarterFavorites } from "./model/library.js";
import { renderFavorites } from "./screens/favorites.js";
import { favoritesDestination } from "./model/library.js";
import { renderBrowse } from "./screens/browse.js";
import { renderProfile } from "./screens/profile.js";
import { renderNewThisWeek, renderRecommendations } from "./screens/recommendations.js";
import { actOnNewRelease, maybeLoadNewReleases } from "./ai/new-releases.js";
import { detailDescription, renderDetailMeta, renderLibrary } from "./screens/library.js";
import { fetchCatalogItemDetail, resolveCustomCatalogItem } from "./catalog/client.js";
import { lookContinueLabel, renderLook } from "./screens/look.js";
import { renderSetup } from "./screens/setup.js";
import { renderMine } from "./screens/mine.js";
import { setStatement, toggleDomainExclusion } from "./model/statements.js";
import { isLook, lookLabel } from "./data/looks.js";
import { visibleDomains } from "./data/domains.js";
import { firstBrowseGenre } from "./catalog/browse-genres.js";
import { fetchBrowsePage } from "./catalog/browse-client.js";
import { fetchSimilar } from "./catalog/similar-client.js";
import { bridgeTargetNoun } from "./catalog/bridges.mjs";
import { mergeUniqueBrowseItems } from "./model/browse.js";
import { applyResolvedCatalogItem, applySearchAction, markCustomResolution } from "./model/search.js";
import { isExperienced, isStrongPositive } from "./model/evidence.js";
import { initSearch } from "./components/search.js";
import { AI_LOADING, cancelRequest } from "./ai/requests.js";
import { createCandidatePrefetcher } from "./ai/prefetch.js";
import { refreshProfileHypotheses } from "./ai/hypothesis-profile.js";
import { focusSelectorFor, restoreFocusIn } from "./actions/focus.js";
import { handleMineChange, handleMineClick, handleMineSubmit, openMine } from "./actions/mine.js";
import { saveBlindAction } from "./actions/blindspot.js";
import { finishSavedTried, keepOnSavedList, saveBookmarkAction, saveLibraryAction } from "./actions/library.js";
import { announceReaction, chooseExperiencePath, runInitialRecommendations, runKeepDiscovering, saveExperienceOutcome, saveFeedbackDetail, saveFeedbackRefinement, saveQuickFeedback, saveSeriesExperience, setRecommendationFavorite } from "./actions/recommendations.js";
import { saveTastebreakAction } from "./actions/tastebreak.js";
import { setTastebreakNote } from "./model/tastebreak.js";
import { persistState } from "./persistence.js";
import { syncAiBadge } from "./ai/ai-status.js";
import { addExclusion, dropExcludedFromActiveSet, makeExclusion } from "./model/exclusions.js";

// app.js is orchestration only: routing between screens, rendering, focus/announce plumbing, and
// dispatching DOM events to the action modules in ./actions/ and ./model/ (#39). Product rules and
// state mutation live in those modules, not here.

const app = document.querySelector("#app");

const views = {
  favorites: renderFavorites,
  browse: renderBrowse,
  model: renderProfile,
  recommendations: renderRecommendations,
  library: renderLibrary,
  look: renderLook,
  setup: renderSetup,
  mine: renderMine
};

// Library is the durable source of truth for Favorites after onboarding (#117/#118 follow-up):
// selectedFavorites is only the onboarding-selection mechanism and is cleared once its items are
// migrated into the ongoing Library model (see migrateStarterFavorites in model/library.js), so this
// can't just check its size once setup is done -- state.onboarded is the real "has enough" record.
function hasEnoughFavorites() {
  return state.onboarded || state.selectedFavorites.size >= 4;
}

function canAccess(screen) {
  // #29/#68/#94: Library (Saved + Tried) is a real destination even with nothing saved yet — its
  // empty state explains how to get there instead of the tab just disappearing until something lands.
  if (screen === "look" || screen === "setup" || screen === "mine" || screen === "library" || screen === "browse") return true;
  return screen === "favorites" || hasEnoughFavorites();
}

// #120: once four favorites are chosen, warm the first set's catalog candidates server-side while the
// user is still on Favorites/Setup (see src/ai/prefetch.js). Retrieval only, never a model call.
const candidatePrefetcher = createCandidatePrefetcher({ getState: () => state });

// Paige's Example Profile: loaded on request, or from /?example=paige (linked from the portfolio case study).
// Oct 27: loadExampleProfile also sets the sessionStorage flag, so a refresh comes back here.
async function openExampleProfile() {
  try {
    await loadExampleProfile();
    writeRoute(state.screen, { replace: false });
    render();
    updateStepper();
    announce("Showing Paige's Example Profile. Nothing you change is saved.");
    window.scrollTo(0, 0);
  } catch {
    forgetViewingExample();   // Oct 27: a failed load shouldn't follow the visitor into every refresh
    announce("The example profile could not load. Please try again.");
  }
}

function render() {
  persistState(state);
  syncAiBadge(state);
  app.innerHTML = exampleBannerHtml() + views[state.screen]();
  candidatePrefetcher.schedule(state);
  // #6: fetched once per visit, after the first set exists (not for the example profile); only its own
  // slot is redrawn when it arrives.
  if (state.screen === "recommendations" && state.onboarded && !isViewingExample() && activeRecommendations(state).length) {
    maybeLoadNewReleases(state, () => {
      const slot = app.querySelector("[data-new-this-week-slot]");
      if (slot) slot.innerHTML = renderNewThisWeek();
    });
  }
}

function updateStepper() {
  const order = ["favorites", "recommendations", "browse", "model", "library"];
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
  persistState(state);
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

app.addEventListener("submit", (event) => {
  if (state.screen === "mine") handleMineSubmit(event, mineCtx);
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
  // The display name is optional: it is only shown back on the profile and never reaches the AI.
  state.displayName = state.displayName.trim();
  applySetupPreferences();
  state.setupComplete = true;
  const target = canAccess(state.setupReturn) ? state.setupReturn : "favorites";
  state.setupReturn = "favorites";
  navigate(target);
}

// #59: reaching Recommendations at least once ends the guided first-run state (see state.js).
// #117 follow-up: that's also the one moment starter Favorites are migrated into the ongoing
// Library model, exactly once (state.onboarded is the guard so this can't re-run on every visit).
function markOnboarded(screen) {
  if (screen === "recommendations" && !state.onboarded) {
    state.onboarded = true;
    migrateStarterFavorites(state);
  }
}

function maybeRefreshProfile({ force = false } = {}) {
  if (state.screen !== "model") return;
  void refreshProfileHypotheses(state, {
    force,
    onUpdate() { render(); updateStepper(); },
    announce
  });
}

function primeProfileInBackground() {
  if ((state.modelHypotheses ?? []).length || state.hypothesisAiStatus === "loading") return;
  const hasExperiencedReaction = Object.values(state.feedbackByRecommendation ?? {}).some(isExperienced);
  if (!hasExperiencedReaction) return;

  void refreshProfileHypotheses(state, {
    onUpdate() {
      persistState(state);
      if (state.screen === "recommendations"
        && state.hypothesisAiStatus === "ready"
        && !state.recommendationFeedbackItemId) {
        render();
        updateStepper();
      }
    },
    announce() {}
  });
}

let browseController = null;

async function loadBrowse({ reset = false, focusSelector = null } = {}) {
  if (state.screen !== "browse") return;
  const domain = state.browseDomain;
  const genre = state.browseGenre || firstBrowseGenre(domain);
  if (!genre) return;

  if (reset) {
    state.browseGenre = genre;
    state.browseItems = [];
    state.browsePage = 0;
    state.browseHasMore = true;
    state.browseError = false;
  }
  if (state.browseLoading || !state.browseHasMore) return;

  const page = state.browsePage + 1;
  browseController?.abort();
  const controller = new AbortController();
  browseController = controller;
  state.browseLoading = true;
  state.browseError = false;
  render();
  updateStepper();
  if (focusSelector) restoreFocus(focusSelector);

  try {
    const payload = await fetchBrowsePage(domain, genre, page, { signal: controller.signal });
    if (controller.signal.aborted || state.screen !== "browse" || state.browseDomain !== domain || state.browseGenre !== genre) return;
    state.browseItems = mergeUniqueBrowseItems(state.browseItems, payload.items);
    state.browsePage = page;
    state.browseHasMore = payload.hasMore && payload.items.length > 0;
    state.browseError = payload.degraded && payload.items.length === 0;
  } catch (error) {
    if (error?.name !== "AbortError") state.browseError = true;
  } finally {
    if (browseController === controller) browseController = null;
    if (!controller.signal.aborted && state.screen === "browse" && state.browseDomain === domain && state.browseGenre === genre) {
      state.browseLoading = false;
      render();
      updateStepper();
      if (focusSelector) restoreFocus(focusSelector);
    }
  }
}

// Oct 27: "See similar" shows its results on Browse, so they get the same rating buttons and reasons.
let similarController = null;

// #252 part 2: with a targetDomain it's "with these vibes" from another medium (src/catalog/bridges.mjs).
async function openSimilar(itemId, targetDomain = null) {
  const item = state.customItems?.[itemId] ?? state.feedbackByRecommendation[itemId]?.item;
  if (!item) return;
  similarController?.abort();
  browseController?.abort();
  browseController = null;
  const controller = new AbortController();
  similarController = controller;
  Object.assign(state, {
    browseSimilar: { id: item.id, title: item.title, type: item.type, targetDomain },
    browseItems: [], browsePage: 0, browseHasMore: false, browseError: false, browseLoading: true
  });
  navigate("browse");
  restoreFocus(".browse-similar-head h2", app);
  announce(targetDomain ? `Finding ${bridgeTargetNoun(targetDomain).toLowerCase()} with the vibes of ${item.title}.` : `Finding things like ${item.title}.`);
  const exclude = [...new Set([...Object.keys(state.feedbackByRecommendation), ...state.libraryFavorites, ...state.selectedFavorites])];
  try {
    const items = await fetchSimilar(item, exclude, { signal: controller.signal, targetDomain });
    if (controller.signal.aborted || state.browseSimilar?.id !== item.id) return;
    state.browseItems = items;
    state.browseError = false;
  } catch (error) {
    if (error?.name === "AbortError" || state.browseSimilar?.id !== item.id) return;
    state.browseError = true;
  }
  if (similarController === controller) similarController = null;
  state.browseLoading = false;
  if (state.screen !== "browse") return;
  render();
  updateStepper();
  if (targetDomain) announce(state.browseItems.length ? `${state.browseItems.length} with the vibes of ${item.title}.` : "Nothing close turned up for this one.");
  else announce(state.browseItems.length ? `${state.browseItems.length} like ${item.title}.` : `Nothing new turned up like ${item.title}.`);
}

function maybeLoadBrowse() {
  if (state.screen === "browse" && !state.browseItems.length && !state.browseLoading) void loadBrowse();
}

async function resolveExistingCustomItems() {
  const unresolved = Object.values(state.customItems ?? {}).filter((item) => item?.custom && !item.provider);
  if (!unresolved.length) return;
  let changed = false;
  for (const item of unresolved) {
    markCustomResolution(state, item.id, "resolving");
    const result = await resolveCustomCatalogItem(item);
    if (result.status === "resolved" && result.item) {
      changed = Boolean(applyResolvedCatalogItem(state, item.id, result.item)) || changed;
    } else {
      markCustomResolution(state, item.id, result.status === "ambiguous" ? "ambiguous" : "unresolved");
      changed = true;
    }
  }
  if (changed) {
    render();
    updateStepper();
  }
}

function navigate(screen, { replace = false, scroll = true, libraryView = "saved" } = {}) {
  // Oct 24: after onboarding, Favorites live in Library (selectedFavorites is emptied by the migration), so
  // the four-slot first-run screen always looked empty. Every route to it (finishing setup, the look
  // picker, old links) goes to Library > Tried > Favorites instead, as page loads already did (#103).
  if (screen === "favorites" && state.onboarded) {
    const destination = favoritesDestination(state);
    if (destination.libraryReactionFilter) state.libraryReactionFilter = destination.libraryReactionFilter;
    screen = destination.screen;
    libraryView = destination.libraryView ?? libraryView;
  }
  if (!canAccess(screen)) return;
  // Saved is the Library's actionable home. Re-entering Library starts there rather than
  // resurrecting whichever secondary tab happened to be open last time, unless the caller is
  // deliberately opening another view (Change favorites opens Tried > Favorites).
  if (screen === "library" && state.screen !== "library") state.libraryView = libraryView;
  // Things just rated from Saved settle into Tried once you leave; Browse's "rated this visit" starts over.
  if (screen !== state.screen) {
    state.savedJustTried = [];
    if (screen === "browse") state.browseRatedThisVisit = [];
  }
  // Leaving the page a request was started from makes its answer irrelevant (#42).
  if (state.aiRequest && screen !== state.aiRequest.screen) cancelRequest(state, "you moved to another page while it was thinking");
  if (screen !== "browse") {
    browseController?.abort();
    browseController = null;
    similarController?.abort();
    similarController = null;
    state.browseLoading = false;
    // Leaving Browse ends a "More like…" view; coming back shows genres again.
    if (state.browseSimilar) {
      state.browseSimilar = null;
      state.browseItems = [];
      state.browsePage = 0;
      state.browseHasMore = true;
    }
  }

  markOnboarded(screen);
  state.screen = screen;
  writeRoute(screen, { replace });
  render();
  updateStepper();

  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  focusApp();
  maybeRefreshProfile();
  maybeLoadBrowse();
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

function renderPreservingPatternPosition(patternId, focusSelector = null) {
  const selector = `[data-profile-pattern="${patternId}"]`;
  const before = document.querySelector(selector);
  const beforeTop = before?.getBoundingClientRect().top;
  const next = before?.closest(".signal-row")?.nextElementSibling;
  const nextId = next?.dataset?.profilePattern;
  const nextTop = next?.getBoundingClientRect().top;

  render();
  updateStepper();

  const same = document.querySelector(selector);
  if (same?.classList.contains("signal-row") && beforeTop !== undefined) {
    const afterTop = same.getBoundingClientRect().top;
    window.scrollBy({ top: afterTop - beforeTop, left: 0, behavior: "auto" });
    restoreFocus(focusSelector, same.querySelector("button") || same);
    return;
  }

  if (nextId && nextTop !== undefined) {
    const afterNext = document.querySelector(`[data-profile-pattern="${nextId}"]`);
    if (afterNext) {
      const afterTop = afterNext.getBoundingClientRect().top;
      window.scrollBy({ top: afterTop - nextTop, left: 0, behavior: "auto" });
      restoreFocus(null, afterNext.querySelector("button") || afterNext);
      return;
    }
  }

  restoreFocus(".corrected-patterns summary", app);
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
  // Closing must hide it now, even though the pointer and focus are still on the trigger.
  wrapper.classList.toggle("is-dismissed", !shouldPin);
  trigger.setAttribute("aria-expanded", String(shouldPin));
}

// A dismissed popover may preview again once the pointer leaves it, or focus comes back from elsewhere.
app.addEventListener("mouseleave", (event) => {
  if (event.target.classList?.contains("editorial-why")) event.target.classList.remove("is-dismissed");
}, true);
app.addEventListener("focusin", (event) => {
  const wrapper = event.target.closest?.(".editorial-why");
  if (wrapper && !wrapper.contains(event.relatedTarget)) wrapper.classList.remove("is-dismissed");
});

let recommendationSwipe = null;

app.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  if (event.target.closest("button,a,summary,input,textarea,select")) return;
  const card = event.target.closest("[data-rec-id]");
  if (!card) return;
  // Once the anchored feedback editor is open, gestures belong to the editor/card content.
  // Do not let an incidental horizontal move silently Save / Not interested the same pick.
  if (state.recommendationFeedbackItemId === card.dataset.recId || event.target.closest(".rec-feedback-popover")) return;
  recommendationSwipe = {
    itemId: card.dataset.recId,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
});

app.addEventListener("pointercancel", () => { recommendationSwipe = null; });

app.addEventListener("pointerup", (event) => {
  const swipe = recommendationSwipe;
  recommendationSwipe = null;
  if (!swipe || swipe.pointerId !== event.pointerId) return;
  if (state.recommendationFeedbackItemId === swipe.itemId) return;

  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.4) return;

  const existing = state.feedbackByRecommendation[swipe.itemId];
  if (isExperienced(existing)) return;
  const outcome = dx > 0 ? "save" : "not-interested";
  if (!saveExperienceOutcome(swipe.itemId, outcome)) return;
  renderPreservingCardPosition(swipe.itemId);
  announceReaction(swipe.itemId, announce);
});

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
    if (scope === "recommendations") {
      const nextMode = filter.dataset.domainFilter;
      if (state.recommendationFilter === nextMode) {
        restoreFocus(focusSelector);
        return;
      }
      state.recommendationFilter = nextMode;
      state.recommendationMediumFilter = "all";
      // Real root cause (2026-09-29), found from production logs: real requests routinely take
      // 11-20+ seconds (candidate retrieval + the live model call). This handler used to skip
      // re-fetching whenever `aiStatus === AI_LOADING` -- meaning any filter click made while a
      // previous request was still in flight (trivially easy given how slow requests are) silently
      // updated only the selected pill, fired no request at all, and left whatever was on screen
      // unchanged. The in-flight request, once it finally resolved, WAS correctly caught as stale by
      // staleReason's filter check (QA sweep, #167) and discarded with a "try again" message -- but
      // that only undid the confusion one click later, and did nothing for the filter actually
      // clicked, which never got a request of its own. This read exactly like "movies/tv/books/games
      // don't work at all" for anyone who clicked through filters at a normal pace rather than
      // waiting out a 20-second load each time. startRequest() (src/ai/requests.js) already cancels
      // any in-flight request safely before starting a new one, so gating on AI_LOADING here was not
      // just unnecessary but actively wrong -- always retry on a genuine mode change.
      await runKeepDiscovering({ render, updateStepper, announce, navigate });
      return;
    }
    if (scope === "library") state.libraryFilter = filter.dataset.domainFilter;
    if (scope === "map") state.mapFilter = filter.dataset.domainFilter;
    render();
    restoreFocus(focusSelector);
    return;
  }

  const mediumFilter = event.target.closest("[data-recommendation-medium]");
  if (mediumFilter) {
    state.recommendationMediumFilter = mediumFilter.dataset.recommendationMedium;
    render();
    restoreFocus(focusSelector);
    return;
  }

  const sayButton = event.target.closest("[data-statement-pattern]");
  if (sayButton) {
    const { statementPattern, statementField, statementValue } = sayButton.dataset;
    const message = setStatement(state, statementPattern, statementField, statementValue);
    if (!message) return;
    renderPreservingPatternPosition(statementPattern, focusSelector);
    announce(message);
    return;
  }

  const scopeButton = event.target.closest("[data-scope-pattern]");
  if (scopeButton) {
    const { scopePattern, scopeDomain } = scopeButton.dataset;
    const message = toggleDomainExclusion(state, scopePattern, scopeDomain);
    if (!message) return;
    renderPreservingPatternPosition(scopePattern, focusSelector);
    announce(message);
    return;
  }

  const viewButton = event.target.closest("[data-profile-view]");
  if (viewButton) {
    state.profileView = viewButton.dataset.profileView;
    render();
    restoreFocus(focusSelector);
    const viewLabel = state.profileView === "map" ? "Taste Map" : state.profileView === "full" ? "full Taste Profile" : "Taste Profile overview";
    announce(`Showing your ${viewLabel}.`);
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
    const fromSaved = isBookmarked(state.feedbackByRecommendation[itemId]);
    if (saveLibraryAction(itemId, outcome)) {
      // Starring something in Saved marks it loved: keep it there, open to its reasons, like a rating.
      if (fromSaved && outcome === "favorite") keepOnSavedList(itemId);
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
        favorite: `${title} added to Favorites and marked Loved it.`,
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
      if (outcome === "remove") {
        // The card leaves the list; land on the next card's first action, or on the page if none is left.
        restoreFocus(focusSelector, app.querySelector(".bookmark-action") || app);
        const left = bookmarkedFeedback(state).length;
        announce(`${title}: removed from Saved. ${left} ${left === 1 ? "thing" : "things"} left in Saved.`);
      } else {
        // The card stays, open to its reasons (Oct 27): land on the first reason chip.
        restoreFocus(`[data-bookmark-id="${itemId}"] .refinement-chip`, app.querySelector(`[data-saved-done="${itemId}"]`) || app);
        const what = ({ "tried-loved": "Loved it", "tried-liked": "Liked it", "tried-disliked": "Didn't like it" })[outcome];
        announce(`${title}: marked ${what}. Pick what worked, if you like, then choose Done.`);
      }
    }
    return;
  }

  const savedDone = event.target.closest("[data-saved-done]");
  if (savedDone) {
    const itemId = savedDone.dataset.savedDone;
    const title = state.feedbackByRecommendation[itemId]?.item.title;
    finishSavedTried(itemId);
    render();
    updateStepper();
    restoreFocus(".bookmark-action", app.querySelector("[data-library-tab=\"saved\"]") || app);
    announce(`${title} moved to Tried.`);
    return;
  }

  const recommendationFavorite = event.target.closest("[data-rec-favorite]");
  if (recommendationFavorite) {
    const itemId = recommendationFavorite.dataset.recFavorite;
    const makeFavorite = recommendationFavorite.getAttribute("aria-pressed") !== "true";
    const title = state.feedbackByRecommendation[itemId]?.item?.title
      ?? activeRecommendations(state).find((item) => item.id === itemId)?.title
      ?? state.browseItems.find((item) => item.id === itemId)?.title
      ?? "Item";
    if (setRecommendationFavorite(itemId, makeFavorite)) {
      state.recommendationFeedbackItemId = null;
      // Starring after setup rates it Loved, so Browse counts it like any other rating (Oct 27).
      if (makeFavorite && state.onboarded && state.screen === "browse" && !state.browseRatedThisVisit.includes(itemId)) state.browseRatedThisVisit.push(itemId);
      renderPreservingCardPosition(itemId, `[data-rec-favorite="${itemId}"]`);
      announce(makeFavorite
        ? (state.onboarded
          ? `${title} added to Favorites and marked Tried · Loved.`
          : `${title} added to Favorites. ${state.selectedFavorites.size} of 4 selected.`)
        : (state.onboarded
          ? `${title} removed from Favorites. Your Loved reaction stays.`
          : `${title} removed from Favorites. ${state.selectedFavorites.size} of 4 selected.`));
      if (makeFavorite && state.onboarded) primeProfileInBackground();
    }
    return;
  }

  const newRelease = event.target.closest("[data-new-release-action]");
  if (newRelease) {
    const said = actOnNewRelease(state, newRelease.dataset.newReleaseItem, newRelease.dataset.newReleaseAction);
    if (said) {
      persistState(state);
      const slot = app.querySelector("[data-new-this-week-slot]");
      if (slot) slot.innerHTML = renderNewThisWeek();
      restoreFocus(".new-release button", app);   // next release, or the page when none are left
      announce(said);
    }
    return;
  }

  const exclude = event.target.closest("[data-exclude-kind]");
  if (exclude) {
    const item = activeRecommendations(state).find((rec) => rec.id === exclude.dataset.excludeItem);
    const exclusion = item ? makeExclusion(exclude.dataset.excludeKind, exclude.dataset.excludeKey, item) : null;
    if (exclusion && addExclusion(state, exclusion)) {
      const index = activeRecommendations(state).findIndex((rec) => rec.id === item.id);
      const removed = dropExcludedFromActiveSet(state, exclusion);
      render();
      const cards = [...app.querySelectorAll(".editorial-rec")];
      restoreFocus(null, cards[Math.min(index, cards.length - 1)]?.querySelector("button") || app.querySelector('[data-action="keep-discovering"]') || app);
      announce(`Tastemake won’t recommend ${exclusion.kind === "genre" ? exclusion.label.toLowerCase() : exclusion.kind === "creator" ? `anything by ${exclusion.label}` : `the ${exclusion.label}`}. ${removed === 1 ? "1 pick" : `${removed} picks`} removed from this set. Undo it anytime in My Tastemake.`);
    }
    return;
  }

  const feedbackEdit = event.target.closest("[data-feedback-edit]");
  if (feedbackEdit) {
    const itemId = feedbackEdit.dataset.feedbackEdit;
    state.recommendationFeedbackItemId = itemId;
    renderPreservingCardPosition(itemId, `[data-feedback-close="${itemId}"]`);
    return;
  }

  const feedbackClose = event.target.closest("[data-feedback-close]");
  if (feedbackClose) {
    const itemId = feedbackClose.dataset.feedbackClose;
    state.recommendationFeedbackItemId = null;
    renderPreservingCardPosition(itemId, state.feedbackByRecommendation[itemId]
      ? `[data-feedback-edit="${itemId}"]`
      : `[data-feedback-item="${itemId}"][data-experience-path]`);
    return;
  }

  const experiencePath = event.target.closest("[data-experience-path][data-feedback-item]");
  if (experiencePath) {
    const itemId = experiencePath.dataset.feedbackItem;
    if (chooseExperiencePath(itemId, experiencePath.dataset.experiencePath)) {
      state.recommendationFeedbackItemId = itemId;
      renderPreservingCardPosition(itemId, `[data-feedback-item="${itemId}"][data-experience-outcome]`);
      announce(experiencePath.dataset.experiencePath === "tried"
        ? "Tried it selected. Choose how it landed."
        : "Not tried selected. Choose Save or Not interested.");
    }
    return;
  }

  const experienceOutcome = event.target.closest("[data-experience-outcome][data-feedback-item]");
  if (experienceOutcome) {
    const itemId = experienceOutcome.dataset.feedbackItem;
    const outcome = experienceOutcome.dataset.experienceOutcome;
    if (saveExperienceOutcome(itemId, outcome)) {
      const rated = ["loved", "liked", "disliked"].includes(outcome);
      // Counted before the render, so Browse's "rated this visit" shows it straight away (Oct 27).
      if (rated && state.screen === "browse" && !state.browseRatedThisVisit.includes(itemId)) state.browseRatedThisVisit.push(itemId);
      // Untried intent has no deeper taste questions, so finish the small editor after Save/Not interested.
      // Tried reactions keep it open so optional refinement/series/discovery feedback is available.
      if (outcome === "save" || outcome === "not-interested") state.recommendationFeedbackItemId = null;
      renderPreservingCardPosition(itemId, outcome === "save" || outcome === "not-interested"
        ? `[data-feedback-item="${itemId}"][data-experience-path="not-tried"]`
        : focusSelector);
      announceReaction(itemId, announce);
      if (rated) primeProfileInBackground();
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

  const refinement = event.target.closest("[data-feedback-refinement][data-feedback-item]");
  if (refinement) {
    const itemId = refinement.dataset.feedbackItem;
    const before = normalizedRefinements(state.feedbackByRecommendation[itemId]);
    if (saveFeedbackRefinement(itemId, refinement.dataset.feedbackRefinement)) {
      trackReasonChanged(reasonSurface(refinement), before, state.feedbackByRecommendation[itemId]);
      renderPreservingCardPosition(itemId, focusSelector);
      announce("Taste detail updated.");
    }
    return;
  }

  const series = event.target.closest("[data-series-experience][data-feedback-item]");
  if (series) {
    const itemId = series.dataset.feedbackItem;
    if (saveSeriesExperience(itemId, series.dataset.seriesExperience)) {
      renderPreservingCardPosition(itemId, focusSelector);
      announce("Series experience updated. Future recommendations will avoid treating covered installments as new discoveries.");
    }
    return;
  }

  const starterRemove = event.target.closest("[data-starter-remove]");
  if (starterRemove) {
    const id = starterRemove.dataset.starterRemove;
    state.selectedFavorites.delete(id);
    if (state.starterReplaceId === id) state.starterReplaceId = null;
    render();
    updateStepper();
    announce("Removed from Favorites.");
    return;
  }

  const starterReplace = event.target.closest("[data-starter-replace]");
  if (starterReplace) {
    state.starterReplaceId = starterReplace.dataset.starterReplace;
    document.querySelector("#open-search")?.click();
    return;
  }

  const browseDomain = event.target.closest("[data-browse-domain]");
  if (browseDomain) {
    state.browseSimilar = null;
    state.browseDomain = browseDomain.dataset.browseDomain;
    state.browseGenre = firstBrowseGenre(state.browseDomain);
    state.browseItems = [];
    state.browsePage = 0;
    state.browseHasMore = true;
    state.browseError = false;
    void loadBrowse({ focusSelector: `[data-browse-domain="${state.browseDomain}"]` });
    return;
  }

  const browseGenre = event.target.closest("[data-browse-genre]");
  if (browseGenre) {
    state.browseSimilar = null;
    state.browseGenre = browseGenre.dataset.browseGenre;
    state.browseItems = [];
    state.browsePage = 0;
    state.browseHasMore = true;
    state.browseError = false;
    void loadBrowse({ focusSelector: `[data-browse-genre="${state.browseGenre}"]` });
    return;
  }

  const seeSimilar = event.target.closest("[data-see-similar]");
  if (seeSimilar) {
    void openSimilar(seeSimilar.dataset.seeSimilar, seeSimilar.dataset.similarTarget || null);
    return;
  }

  const similarClose = event.target.closest("[data-browse-similar-close]");
  if (similarClose) {
    similarController?.abort();
    state.browseSimilar = null;
    state.browseItems = [];
    state.browsePage = 0;
    state.browseHasMore = true;
    state.browseError = false;
    state.browseLoading = false;
    void loadBrowse({ focusSelector: `[data-browse-genre="${state.browseGenre}"]` });
    return;
  }

  const browseMore = event.target.closest("[data-browse-more]");
  if (browseMore) {
    void loadBrowse({ focusSelector: "[data-browse-more]" });
    return;
  }

  const browseAction = event.target.closest("[data-browse-action][data-browse-item]");
  if (browseAction) {
    const itemId = browseAction.dataset.browseItem;
    const item = state.browseItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const message = applySearchAction(state, item, browseAction.dataset.browseAction, { source: "browse" });
    if (!message) return;
    render();
    updateStepper();
    restoreFocus(`[data-browse-action="${browseAction.dataset.browseAction}"][data-browse-item="${itemId}"]`, app.querySelector(`[data-browse-card="${itemId}"]`) || app);
    announce(message);
    return;
  }

  const browseFavorite = event.target.closest("[data-browse-favorite][data-browse-item]");
  if (browseFavorite) {
    const itemId = browseFavorite.dataset.browseItem;
    const item = state.browseItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (browseFavorite.dataset.browseFavorite === "add") {
      const feedback = state.feedbackByRecommendation[itemId];
      if (!isStrongPositive(feedback)) return;
      state.customItems[item.id] = item;
      if (state.onboarded) {
        state.libraryFavorites.add(itemId);
        announce(`${item.title} added to Favorites.`);
      } else {
        state.selectedFavorites.add(itemId);
        announce(`${item.title} added to Favorites. ${state.selectedFavorites.size} of 4 selected.`);
      }
    } else {
      if (state.onboarded) state.libraryFavorites.delete(itemId);
      else state.selectedFavorites.delete(itemId);
      announce(`${item.title} removed from Favorites.`);
    }
    render();
    updateStepper();
    restoreFocus(`[data-browse-favorite][data-browse-item="${itemId}"]`, app.querySelector(`[data-browse-card="${itemId}"]`) || app);
    return;
  }

  const libraryReactionFilter = event.target.closest("[data-library-reaction-filter]");
  if (libraryReactionFilter) {
    state.libraryReactionFilter = libraryReactionFilter.dataset.libraryReactionFilter || "all";
    render();
    updateStepper();
    restoreFocus(`[data-library-reaction-filter="${state.libraryReactionFilter}"]`);
    announce(`Showing ${libraryReactionFilter.textContent.trim()} in Tried.`);
    return;
  }

  const showAll = event.target.closest("[data-library-show-all]");
  if (showAll) {
    const key = showAll.dataset.libraryShowAll;
    const grids = [...app.querySelectorAll(".library-grid")];
    const gridIndex = grids.indexOf(showAll.closest(".library-grid"));
    const firstHidden = grids[gridIndex]?.querySelectorAll(":scope > .library-card").length ?? 0;
    (state.libraryExpanded ??= new Set()).add(key);
    render();
    // Land on the first card that was just revealed, so keyboard users continue where the list was cut.
    const revealed = app.querySelectorAll(".library-grid")[gridIndex]?.querySelectorAll(":scope > .library-card")[firstHidden]?.querySelector("summary");
    restoreFocus(null, revealed ?? app);
    announce("Showing all of them.");
    return;
  }

  const libraryTab = event.target.closest("[data-library-tab]");
  if (libraryTab) {
    state.libraryView = libraryTab.dataset.libraryTab === "tried" ? "tried" : "saved";
    state.savedJustTried = [];
    render();
    updateStepper();
    restoreFocus(`[data-library-tab="${state.libraryView}"]`);
    announce(state.libraryView === "tried" ? "Showing Tried." : "Showing Saved.");
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "view-example") { void openExampleProfile(); return; }
  // "Start my own" is this button. Oct 27: drop the flag first so the reload boots the visitor's own profile.
  if (action === "exit-example") { forgetViewingExample(); window.location.assign("/"); return; }
  if (action === "open-search") document.querySelector("#open-search")?.click();
  if (action === "browse") navigate("browse");
  if (action === "edit-setup") {
    state.setupReturn = state.screen;
    navigate("setup");
  }
  if (action === "setup-done") finishSetup();
  if (action === "back-favorites") {
    const destination = favoritesDestination(state);
    if (destination.libraryReactionFilter) state.libraryReactionFilter = destination.libraryReactionFilter;
    navigate(destination.screen, destination.libraryView ? { libraryView: destination.libraryView } : {});
  }
  if (action === "view-model") navigate("model");
  if (action === "retry-profile") maybeRefreshProfile({ force: true });
  if (action === "show-recs") {
    if (state.recommendationSets.length) navigate("recommendations");
    else if (state.aiStatus !== AI_LOADING) await runInitialRecommendations({ render, updateStepper, announce, navigate, prefetch: candidatePrefetcher });
  }

  if (action === "view-bookmarks") {
    state.libraryView = "saved";
    navigate("library");
  }

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
  if (jump.dataset.stepJump === "recommendations" && !state.recommendationSets.length && state.aiStatus !== AI_LOADING) {
    void runInitialRecommendations({ render, updateStepper, announce, navigate, prefetch: candidatePrefetcher });
    return;
  }
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
    return;
  }
  const note = event.target.closest("[data-tastebreak-note]");
  if (note) setTastebreakNote(state, note.dataset.tastebreakItem, note.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (state.recommendationFeedbackItemId) {
    const itemId = state.recommendationFeedbackItemId;
    state.recommendationFeedbackItemId = null;
    renderPreservingCardPosition(itemId, `[data-feedback-item="${itemId}"][data-experience-path]`);
    return;
  }
  const open = document.querySelector(".editorial-why.is-pinned") ?? document.activeElement?.closest?.(".editorial-why");
  const trigger = open?.querySelector(".why-trigger");
  if (!trigger) return;
  closeWhyPopovers();
  open.classList.add("is-dismissed");
  trigger.focus({ preventScroll: true });
});

// #103 (Paige, Oct 12): a returning user who opens /favorites directly lands on their Favorites
// in the Library (as "Change favorites" does), not on the first-run "0 of 4" setup step.
function redirectReturningFavorites() {
  if (!state.onboarded || state.screen !== "favorites") return false;
  const destination = favoritesDestination(state);
  state.screen = destination.screen;
  state.libraryView = destination.libraryView;
  state.libraryReactionFilter = destination.libraryReactionFilter;
  return true;
}

window.addEventListener("popstate", () => {
  const next = screenFromPath(undefined, { onboarded: state.onboarded });
  const fallback = state.onboarded ? "recommendations" : "favorites";
  state.screen = canAccess(next) ? next : fallback;
  if (state.screen === "library") state.libraryView = "saved";
  redirectReturningFavorites();
  markOnboarded(state.screen);
  if (state.screen !== next) writeRoute(state.screen, { replace: true });
  render();
  updateStepper();
  focusApp();
  maybeRefreshProfile();
  maybeLoadBrowse();
});

// #103 items 1/2: per-media-type detail (director/cast/runtime, creator/cast/years, author/pages/
// description, developer/publisher/platforms) is fetched lazily when a Library card is expanded, never
// during bulk render, so it never adds latency to Recommendations/search. Injected directly into the
// placeholder slot so a slow/failed fetch cannot blank out the rest of an already-open card.
// fetchCatalogItemDetail caches per item, so re-opening a card after a re-render refills it without
// another request. libraryItemById finds reacted-to items too, not only added/search ones.
// #250: anonymous count of people opening the optional reasons section (never what they pick).
const reasonSurface = (el) => (el.closest("[data-browse-card]") ? "browse" : el.closest("[data-rec-id]") ? "recommendations" : state.screen === "library" ? "library" : "other");
app.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!details?.matches?.(".experience-refinement[open]")) return;
  // Re-renders recreate an already-open section with `open` set; only count a fresh, user-initiated open.
  if (details.dataset.refinementCounted) return;
  details.dataset.refinementCounted = "1";
  if (!normalizedRefinements(state.feedbackByRecommendation[details.dataset.refinementItem]).length) trackReasonsOpened(reasonSurface(details));
}, true);

app.addEventListener("toggle", async (event) => {
  const card = event.target.closest?.(".library-card-compact[open]");
  if (!card || event.target !== card) return;
  const itemId = card.dataset.libraryId || card.dataset.bookmarkId;
  if (!itemId) return;
  const item = libraryItemById(state, itemId);
  if (!item) return;
  const detail = await fetchCatalogItemDetail(item);
  const slot = card.querySelector(`[data-detail-slot="${CSS.escape(itemId)}"]`);
  if (slot) slot.innerHTML = renderDetailMeta(item, detail);
  const description = detailDescription(item, detail);
  const blurb = card.querySelector(".library-blurb");
  if (description && blurb) blurb.textContent = description;
}, true);

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

// First visit is deliberately short: name -> Favorites -> Recommendations.
// Look stays available as an optional preference instead of competing with the taste-learning path.
// Direct links still open their requested screen when accessible. #117: a returning user hitting
// "/" (or an unrecognized path) lands in the ongoing product, not back through first-run setup.
// Read before writeRoute below replaces the address (it drops the query string).
// Oct 27: the sessionStorage flag counts too, so a refresh while viewing stays in the example.
const wantsExampleProfile = exampleRequestedAtBoot(window.location.search);
const initialScreen = screenFromPath(undefined, { onboarded: state.onboarded });
state.screen = canAccess(initialScreen) ? initialScreen : (state.onboarded ? "recommendations" : "setup");
if (state.screen === "library") state.libraryView = "saved";
redirectReturningFavorites();
markOnboarded(state.screen);
writeRoute(state.screen, { replace: true });
render();
updateStepper();
// Oct 27: booting into the example skips the visitor's own profile refresh (a model call) and custom item
// lookups. Their results would land after the example replaced the in-memory state.
if (!wantsExampleProfile) {
  maybeRefreshProfile();
  void resolveExistingCustomItems();
}
maybeLoadBrowse();
if (wantsExampleProfile) void openExampleProfile();
