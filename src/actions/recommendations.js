import { state } from "../state.js";
import { activeRecommendations, bookmarkedFeedback, isBookmarked, isPositiveExperience } from "../model/taste.js";
import { blindSpotFor, isBlindSpotCandidate } from "../model/blindspots.js";
import { isExperiencedNegative, isStrongPositive } from "../model/evidence.js";
import { clearInvalidRefinements, refinablePolarity, toggleRefinement } from "../model/refinements.js";
import { pathForFeedback, storedReactionForOutcome } from "../model/reaction-flow.js";
import { reactionLabel } from "../screens/recommendations.js";
import { requestRecommendations } from "../ai/live-client.js";
import { cancelRequest, finishRequest, staleReason, startRequest } from "../ai/requests.js";
import { plural } from "../lib/format.js";

// #52: the discovery-quality note defaults to open once answered, closed otherwise (see qualityExpanded
// in screens/recommendations.js); an explicit toggle always overrides that default, in either direction —
// a display preference, never taste evidence.
export function toggleExpandedFeedback(itemId) {
  const feedback = state.feedbackByRecommendation[itemId];
  const current = state.expandedFeedback[itemId] ?? Boolean(feedback?.quality);
  state.expandedFeedback[itemId] = !current;
}

export function saveQuickFeedback(itemId, rating) {
  const item = activeRecommendations(state).find((rec) => rec.id === itemId)
    ?? state.browseItems.find((candidate) => candidate.id === itemId);
  if (!item) return false;

  const existing = state.feedbackByRecommendation[itemId];
  state.feedbackByRecommendation[itemId] = {
    item,
    rating,
    detail: null,
    refinements: [],
    // "Surprised me" only makes sense after Loved/Liked it before, which a fresh rating clears.
    quality: existing?.quality === "surprised-me" ? null : existing?.quality || null,
    seriesExperience: rating === "not-tried" ? null : existing?.seriesExperience ?? null
  };
  // QA sweep real bug: unlike src/actions/library.js's saveLibraryAction and src/model/search.js's
  // applySearchAction, this never cleared libraryFavorites when a reaction moved away from strong-
  // positive. A card can be reacted to here, favorited over in Library, then re-reacted to here (the
  // round is still active and its chips stay editable) -- without this, the stale Favorite would
  // silently survive a "Less" reaction and could resurrect itself with no explicit favorite action if
  // the user later flipped back to "Loved it before".
  if (!isStrongPositive(state.feedbackByRecommendation[itemId])) state.libraryFavorites.delete(itemId);

  return true;
}

export function chooseExperiencePath(itemId, path) {
  if (!["tried", "not-tried"].includes(path)) return false;
  const item = activeRecommendations(state).find((rec) => rec.id === itemId)
    ?? state.browseItems.find((candidate) => candidate.id === itemId)
    ?? state.feedbackByRecommendation[itemId]?.item;
  if (!item) return false;
  state.recommendationExperienceChoice[itemId] = path;
  return true;
}

export function setRecommendationFavorite(itemId, makeFavorite) {
  const browseItem = state.browseItems.find((candidate) => candidate.id === itemId);
  const item = activeRecommendations(state).find((rec) => rec.id === itemId)
    ?? browseItem
    ?? state.feedbackByRecommendation[itemId]?.item;
  if (!item) return false;

  if (!state.onboarded && browseItem) {
    if (makeFavorite) {
      if (item.custom || item.provider) state.customItems[item.id] = item;
      state.selectedFavorites.add(itemId);
      state.recommendationExperienceChoice[itemId] = "tried";
    } else {
      state.selectedFavorites.delete(itemId);
    }
    return true;
  }

  if (!makeFavorite) {
    state.libraryFavorites.delete(itemId);
    return true;
  }

  const existing = state.feedbackByRecommendation[itemId];
  const previousPolarity = refinablePolarity(existing);
  state.feedbackByRecommendation[itemId] = {
    item,
    rating: "more",
    detail: "loved-before",
    refinements: existing?.refinements ?? [],
    quality: existing?.quality ?? null,
    seriesExperience: existing?.seriesExperience ?? null,
    wasBookmarked: Boolean(existing?.wasBookmarked || isBookmarked(existing))
  };
  clearInvalidRefinements(state.feedbackByRecommendation[itemId], previousPolarity);
  state.libraryFavorites.add(itemId);
  state.recommendationExperienceChoice[itemId] = "tried";
  return true;
}

export function saveExperienceOutcome(itemId, outcome) {
  const item = activeRecommendations(state).find((rec) => rec.id === itemId)
    ?? state.browseItems.find((candidate) => candidate.id === itemId)
    ?? state.feedbackByRecommendation[itemId]?.item;
  if (!item) return false;

  const next = storedReactionForOutcome(outcome);
  if (!next) return false;

  const existing = state.feedbackByRecommendation[itemId];
  const previousPolarity = refinablePolarity(existing);
  const { rating, detail } = next;
  state.feedbackByRecommendation[itemId] = {
    item,
    rating,
    detail,
    refinements: existing?.refinements ?? [],
    quality: existing?.quality ?? null,
    seriesExperience: existing?.seriesExperience ?? null,
    wasBookmarked: Boolean(existing?.wasBookmarked || isBookmarked(existing))
  };

  const feedback = state.feedbackByRecommendation[itemId];
  clearInvalidRefinements(feedback, previousPolarity);
  if (feedback.quality === "surprised-me" && !isPositiveExperience(feedback)) feedback.quality = null;
  if (!isPositiveExperience(feedback) && !isExperiencedNegative(feedback)) feedback.seriesExperience = null;
  if (!isStrongPositive(feedback)) state.libraryFavorites.delete(itemId);

  state.recommendationExperienceChoice[itemId] = pathForFeedback(feedback);
  return true;
}

export function saveFeedbackDetail(itemId, detail) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  const previousPolarity = refinablePolarity(existing);
  existing.detail = existing.detail === detail ? null : detail;
  clearInvalidRefinements(existing, previousPolarity);
  if (existing.quality === "surprised-me" && !isPositiveExperience(existing)) existing.quality = null;
  if (!isPositiveExperience(existing) && !isExperiencedNegative(existing)) existing.seriesExperience = null;
  // Same Favorite<->reaction invariant as saveQuickFeedback above -- the detail chip (e.g. "Loved it
  // before" -> "Liked it before") can move a reaction away from strong-positive just as much as the
  // primary rating can.
  if (!isStrongPositive(existing)) state.libraryFavorites.delete(itemId);
  return true;
}

export function saveFeedbackRefinement(itemId, refinementId) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;
  return toggleRefinement(existing, refinementId);
}

export function saveSeriesExperience(itemId, value) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing || (!isPositiveExperience(existing) && !isExperiencedNegative(existing))) return false;
  const allowed = new Set(["loved-most", "liked-most", "mixed", "disliked-most", "unseen-rest"]);
  if (!allowed.has(value)) return false;
  existing.seriesExperience = existing.seriesExperience === value ? null : value;
  return true;
}

export function saveFeedbackQuality(itemId, quality) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  existing.quality = existing.quality === quality ? null : quality;
  return true;
}

export function announceReaction(itemId, announce) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!feedback) return;
  const saved = bookmarkedFeedback(state).length;
  const bookmarkPart = isBookmarked(feedback) ? ` ${plural(saved, "thing", "things")} in Saved.` : "";
  const offer = isBlindSpotCandidate(feedback, state) && !blindSpotFor(state, itemId)
    ? " Tastemake expected you to like this. There is an option below to tell it what it got wrong."
    : "";
  announce(`${feedback.item.title}: ${reactionLabel(feedback)}.${bookmarkPart}${offer}`);
}

// #120: perceived latency. Real production timing shows the live-AI call commonly runs 8-16s
// (dominated by output-token generation time, not prompt size -- see #120). The skeleton/banner
// already rule out a blank/frozen page, but one unchanging message across that whole span can
// itself start reading as "stuck" well before the request actually fails or times out. Staging the
// message forward twice, only while this exact request is still the current, non-stale one, keeps
// showing new true-progress language instead of one static sentence -- no change to actual latency,
// just to how the wait reads.
const LOADING_STAGE_DELAYS_MS = [3000, 7000];
const LOADING_STAGE_MESSAGES = [
  "Checking real catalog candidates against what you have actually tried.",
  "Ranking picks and double-checking each one against your evidence."
];

function scheduleLoadingStages(request, { render }) {
  const timers = LOADING_STAGE_DELAYS_MS.map((delay, index) => setTimeout(() => {
    if (state.aiRequest?.id !== request.id || state.aiStatus !== "loading") return;
    state.aiMessage = LOADING_STAGE_MESSAGES[index];
    render();
  }, delay));
  return () => timers.forEach(clearTimeout);
}

// Recommendation request orchestration. Both the first set and later sets now come from the
// real catalog pipeline; there is no local hand-written fallback.
async function runRecommendationRequest({ render, updateStepper, announce, navigate, initial = false }) {
  // #91: transition to the Recommendations surface immediately, before the request even starts, so
  // the Continue/More-recommendations click gets visible acknowledgement right away. navigate() first
  // (so state.screen is already "recommendations" when startRequest fingerprints the request's
  // screen) then startRequest, so pending-state skeletons (screens/recommendations.js) render on this
  // same paint because state.aiStatus is already "loading".
  navigate("recommendations", { replace: true });
  const request = startRequest(state);
  state.aiMessage = initial
    ? "Tastemake is finding real catalog matches from the favorites you chose."
    : `Tastemake is finding another ${state.recommendationFilter === "all" ? "mixed" : state.recommendationFilter} set from what you have told it.`;
  state.recommendationExhausted = false;
  render();
  updateStepper();
  announce(initial ? "Tastemake is finding your first recommendations." : "Tastemake is finding a new set.");

  const clearLoadingStages = scheduleLoadingStages(request, { render });

  try {
    const result = await requestRecommendations(state, { signal: request.controller?.signal });
    const stale = staleReason(state, request);
    if (stale === "you moved to another page while it was thinking" || (stale && request.cancelled)) {
      cancelRequest(state, stale);
      state.aiStatus = "idle";
      return;
    }
    if (stale) {
      cancelRequest(state, stale);
      state.aiStatus = "idle";
      state.aiMessage = `That request was discarded because ${stale}. Try again.`;
      render();
      updateStepper();
      return;
    }

    const picks = result.picks ?? [];
    const source = result.source ?? "catalog";
    const exhausted = Boolean(result.meta?.exhausted) || picks.length === 0;
    // Real bug (2026-09-29): the exhausted case always showed this one generic sentence, ignoring
    // result.reason entirely -- so a domain-filter dead end (e.g. filtering to TV with zero TV
    // evidence, api/recommendations.mjs) looked identical to genuine exhaustion, with no path forward
    // shown. Prefer the server's specific reason when it gave one.
    const message = source === "model"
      ? "Live AI ranked and explained real catalog candidates. Tastemake checked every pick and citation before showing it."
      : exhausted
        ? (result.reason || "Tastemake could not find another eligible catalog match from your current evidence.")
        : "These are real catalog matches. Live AI is off or its answer did not pass validation, so Tastemake kept the catalog-ranked set.";

    finishRequest(state, request, { source, message });
    state.recommendationExhausted = exhausted;
    state.recommendationMediumFilter = "all";

    if (picks.length) state.recommendationSets.push(picks);
    navigate("recommendations", { replace: true, scroll: false });
    announce(picks.length
      ? `New set: ${plural(picks.length, "pick", "picks")}. ${source === "model" ? "Live AI was used and validated." : "Real catalog fallback was used."}`
      : "No more eligible catalog picks were found.");
  } catch {
    const stale = staleReason(state, request);
    if (stale) {
      cancelRequest(state, stale);
      state.aiStatus = "idle";
      return;
    }
    finishRequest(state, request, {
      source: "error",
      message: "Recommendations are temporarily unavailable. Tastemake did not substitute seeded demo picks."
    });
    state.recommendationExhausted = false;
    navigate("recommendations", { replace: true, scroll: false });
    announce("Recommendations are temporarily unavailable.");
  } finally {
    clearLoadingStages();
  }
}

export async function runInitialRecommendations(ctx) {
  return runRecommendationRequest({ ...ctx, initial: true });
}

export async function runKeepDiscovering(ctx) {
  return runRecommendationRequest({ ...ctx, initial: false });
}
