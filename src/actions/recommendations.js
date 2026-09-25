import { state } from "../state.js";
import { activeRecommendations, bookmarkedFeedback, isBookmarked, isPositiveExperience } from "../model/taste.js";
import { blindSpotFor, isBlindSpotCandidate } from "../model/blindspots.js";
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

export function saveFeedbackDetail(itemId, detail) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  existing.detail = existing.detail === detail ? null : detail;
  if (existing.quality === "surprised-me" && !isPositiveExperience(existing)) existing.quality = null;
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
    : "Tastemake is checking what you have actually tried against the next real catalog matches.";
  state.recommendationExhausted = false;
  render();
  updateStepper();
  announce(initial ? "Tastemake is finding your first recommendations." : "Tastemake is finding a new set.");

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
    const message = source === "model"
      ? "Live AI ranked and explained real catalog candidates. Tastemake checked every pick and citation before showing it."
      : exhausted
        ? "Tastemake could not find another eligible catalog match from your current evidence."
        : "These are real catalog matches. Live AI is off or its answer did not pass validation, so Tastemake kept the catalog-ranked set.";

    finishRequest(state, request, { source, message });
    state.recommendationExhausted = exhausted;
    state.recommendationFilter = "all";

    if (picks.length) state.recommendationSets.push(picks);
    navigate("recommendations", { replace: true });
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
    navigate("recommendations", { replace: true });
    announce("Recommendations are temporarily unavailable.");
  }
}

export async function runInitialRecommendations(ctx) {
  return runRecommendationRequest({ ...ctx, initial: true });
}

export async function runKeepDiscovering(ctx) {
  return runRecommendationRequest({ ...ctx, initial: false });
}
