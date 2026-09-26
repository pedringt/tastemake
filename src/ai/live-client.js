// Browser-side transport for the first live-AI job: choose/explain the next recommendation set.
// The browser sends product-owned state. The server rebuilds the typed model context, validates model
// output, and returns either accepted model picks or the deterministic fallback.

export function serializeAiState(state) {
  return {
    selectedFavorites: [...state.selectedFavorites],
    feedbackByRecommendation: state.feedbackByRecommendation,
    recommendationSets: state.recommendationSets,
    libraryFavorites: [...(state.libraryFavorites ?? [])],
    customItems: state.customItems ?? {},
    blindSpots: state.blindSpots ?? {},
    blindSpotDrafts: state.blindSpotDrafts ?? {},
    blindSpotDismissed: [...(state.blindSpotDismissed ?? [])],
    patternStatements: state.patternStatements ?? [],
    areas: state.areas ?? {},
    curveball: state.curveball !== false,
    recommendationStyle: state.recommendationStyle ?? (state.curveball === false ? "safe" : "balanced"),
    recommendationFilter: state.recommendationFilter ?? "all"
  };
}

export async function requestRecommendations(state, { signal } = {}) {
  const response = await fetch("/api/recommendations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: serializeAiState(state) }),
    signal
  });

  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok) throw new Error(payload?.error || `recommendation request failed (${response.status})`);
  if (!payload || !Array.isArray(payload.picks)) throw new Error("recommendation response was missing picks");
  return payload;
}
