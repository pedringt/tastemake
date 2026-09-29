// Async state for live-AI requests (#42): one request at a time, identified, cancellable, and checked for
// staleness before anything it returns is shown.
//
// Product rule: a model response must never present itself as current if the evidence it was computed from
// has changed. The validator (#31) decides whether an answer is *allowed*; this decides whether it is *still
// about the user's current state*. They are separate gates.
//
// A request records a fingerprint of everything its answer depends on. When the answer arrives we take the
// fingerprint again: if it differs, the user reacted, changed a setting, started over or navigated in the
// meantime, so the answer is dropped and the deterministic picks are used instead.

export const AI_IDLE = "idle";
export const AI_LOADING = "loading";
export const AI_READY = "ready";

// Everything a pick request depends on. Deliberately cheap and explicit: if you add an input to the
// prompt (a new setting, a new kind of evidence), add it here too or staleness will miss it.
export function evidenceFingerprint(state) {
  const reactions = Object.entries(state.feedbackByRecommendation)
    .map(([id, feedback]) => `${id}:${feedback.rating}:${feedback.detail ?? ""}`)
    .sort()
    .join("|");
  const statements = (state.patternStatements ?? [])
    .map((s) => `${s.hypothesisId}:${s.says ?? ""}:${s.weight ?? ""}`)
    .sort()
    .join("|");
  const areas = Object.entries(state.areas ?? {}).sort().map(([id, on]) => `${id}:${on}`).join("|");
  const shown = state.recommendationSets.flat().map((item) => item.id).join("|");
  const favorites = [...state.selectedFavorites].sort().join("|");
  // QA sweep real bug: recommendationFilter was missing here even though it's a real prompt input
  // (buildContext/produceRecommendations use it to scope eligible candidates). Switching the filter
  // while a request was in flight (app.js's domain-filter handler only restarts the request when
  // aiStatus isn't already AI_LOADING, otherwise it just sets the filter and returns) went undetected
  // by staleReason, so the in-flight, old-filter response would land and render under the new filter
  // selection -- picks that don't match what's highlighted, with no indication anything was dropped.
  return [favorites, reactions, statements, areas, `curveball:${state.curveball !== false}`, `filter:${state.recommendationFilter ?? "all"}`, shown].join("//");
}

let counter = 0;

// Start a request, cancelling any in flight. Returns the handle the caller passes back later.
export function startRequest(state, { screen = state.screen } = {}) {
  cancelRequest(state, "superseded by a newer request");
  const request = {
    id: `ai-${++counter}`,
    fingerprint: evidenceFingerprint(state),
    screen,
    filter: state.recommendationFilter ?? "all",
    startedAt: Date.now(),
    controller: typeof AbortController === "function" ? new AbortController() : null
  };
  state.aiRequest = request;
  state.aiStatus = AI_LOADING;
  state.aiSource = null;
  return request;
}

export function cancelRequest(state, reason = "cancelled") {
  const request = state.aiRequest;
  if (!request) return null;
  request.cancelled = reason;
  request.controller?.abort();
  state.aiRequest = null;
  if (state.aiStatus === AI_LOADING) state.aiStatus = AI_IDLE;
  return reason;
}

// Why an answer cannot be used, or null when it can.
export function staleReason(state, request) {
  if (!request) return "no request";
  if (request.cancelled) return request.cancelled;
  if (state.aiRequest?.id !== request.id) return "a newer request replaced it";
  if (request.screen !== state.screen) return "you moved to another page while it was thinking";
  if (request.filter !== (state.recommendationFilter ?? "all")) return "you changed the filter while it was thinking";
  if (evidenceFingerprint(state) !== request.fingerprint) return "your reactions changed while it was thinking";
  return null;
}

export const isCurrent = (state, request) => staleReason(state, request) === null;

export function finishRequest(state, request, { source, message } = {}) {
  if (state.aiRequest?.id === request?.id) state.aiRequest = null;
  state.aiStatus = AI_READY;
  state.aiSource = source ?? null;
  state.aiMessage = message ?? null;
}
