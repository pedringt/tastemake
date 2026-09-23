import { state } from "../state.js";
import { activeRecommendations, bookmarkedFeedback, isBookmarked, isPositiveExperience, nextRecommendations } from "../model/taste.js";
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
  const bookmarkPart = isBookmarked(feedback) ? ` ${plural(saved, "thing", "things")} bookmarked.` : "";
  const offer = isBlindSpotCandidate(feedback) && !blindSpotFor(state, itemId)
    ? " Tastemake expected you to like this. There is an option below to tell it what it got wrong."
    : "";
  announce(`${feedback.item.title}: ${reactionLabel(feedback)}.${bookmarkPart}${offer}`);
}

// Live-AI request orchestration for "Keep discovering" (#42): ask the live endpoint, fall back to
// deterministic picks on any failure, and drop a stale answer if the evidence it was computed from
// has since changed. app.js supplies render/updateStepper/announce/navigate so this module never
// needs to know about the DOM; #31 (validation) and #42 (staleness) both live below live-client.js,
// this is only the sequencing between them and the screen.
export async function runKeepDiscovering({ render, updateStepper, announce, navigate }) {
  const request = startRequest(state);
  state.aiMessage = "Tastemake is checking what you have actually tried against the next eligible picks.";
  render();
  updateStepper();
  announce("Tastemake is finding a new set.");

  let picks = null;
  let source = "deterministic";
  let message = "The live service was unavailable, so Tastemake used its deterministic fallback.";
  try {
    const result = await requestRecommendations(state, { signal: request.controller?.signal });
    if (!result.picks.length) throw new Error("no picks returned");
    picks = result.picks;
    source = result.source;
    message = result.source === "model"
      ? "Live AI chose and explained this set. Tastemake checked every pick and citation against its evidence rules before showing it."
      : "Live AI was unavailable or its answer did not pass the rules, so Tastemake used its deterministic fallback.";
  } catch { /* fall through to the deterministic picks below */ }

  // An answer computed from evidence the user has since changed is not about their current state, so it
  // is dropped whatever it says (#42). If they left the page entirely, nothing is shown at all.
  const stale = staleReason(state, request);
  if (stale === "you moved to another page while it was thinking" || (stale && request.cancelled)) {
    cancelRequest(state, stale);
    state.aiStatus = "idle";
    return;
  }
  if (stale) {
    picks = null;
    source = "deterministic";
    message = `Tastemake used its deterministic picks: ${stale}.`;
  }

  finishRequest(state, request, { source, message });
  state.recommendationSets.push(picks ?? nextRecommendations(state));
  state.recommendationFilter = "all";
  navigate("recommendations", { replace: true });
  announce(`New set: ${plural(activeRecommendations(state).length, "pick", "picks")}. ${state.aiSource === "model" ? "Live AI was used and validated." : "Deterministic fallback was used."}`);
}
