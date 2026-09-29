// Browser-side transport for the first live-AI job: choose/explain the next recommendation set.
// The browser sends product-owned state. The server rebuilds the typed model context, validates model
// output, and returns either accepted model picks or the deterministic fallback.

// #120 follow-up, QA sweep real bug: feedbackByRecommendation and customItems have the exact same
// unbounded-growth shape that made recommendationSets 413 -- a full item object (about/artwork are
// the biggest fields: full synopsis text, image URLs) stored forever per reaction/search/favorite,
// resent on every request. Unlike recommendationSets, server-side code genuinely needs real item
// data from these two (evidence records need title/type/domains; anchor selection needs
// provider/providerId/genres/providerMeta) -- confirmed by grep that .about/.artwork/.sourceUrl are
// never read anywhere server-side (src/ai/context.js, src/model/evidence.js, src/catalog/related.mjs,
// api/recommendations.mjs), so those three purely-display fields are the ones worth dropping.
//
// Real recurrence (2026-09-28): a live production request 413'd again despite the above trim --
// "getting the same 3 recs no matter the filter" is exactly this failure mode (the client keeps
// whatever was last successfully rendered; every subsequent request, including a filter change,
// which also re-POSTs via runKeepDiscovering, throws before ever reaching the model). `reason`
// (the AI's full rationale sentence, e.g. "Because you loved similar things...") and `ai`
// (cites/tests/kind/contract -- validation/UI-popover metadata) are the same kind of pure display
// field as about/artwork/sourceUrl and were never dropped: confirmed by grep that neither is read
// anywhere server-side once an item comes back through feedbackByRecommendation/customItems on a
// later request. Over a long session with many reacted-to picks, these two fields alone are enough
// to grow the payload back past the body cap.
function trimItemForWire(item) {
  if (!item) return item;
  const { about, artwork, sourceUrl, reason, ai, ...rest } = item;
  return rest;
}

export function serializeAiState(state) {
  const feedbackByRecommendation = Object.fromEntries(
    Object.entries(state.feedbackByRecommendation ?? {}).map(([id, feedback]) => [id, { ...feedback, item: trimItemForWire(feedback.item) }])
  );
  const customItems = Object.fromEntries(
    Object.entries(state.customItems ?? {}).map(([id, item]) => [id, trimItemForWire(item)])
  );
  return {
    selectedFavorites: [...state.selectedFavorites],
    feedbackByRecommendation,
    // #120 follow-up, real bug: server-side, every historical set is only ever read for its item ids
    // (the "already shown" exclusion set in related.mjs/context.js) -- never full item data. The
    // full objects (title, artwork URL, synopsis, provider metadata, AI reasoning text) were being
    // resent on every single request, forever, growing linearly with real usage until it exceeded
    // the server's 160KB body cap and every request started failing with a silent 413 -- which reads
    // to a user as "stuck on the same recommendations," since the client keeps whatever was last
    // successfully rendered. Sending ids only cuts this payload by roughly two orders of magnitude
    // with zero behavior change server-side.
    recommendationSets: state.recommendationSets.map((set) => set.map((item) => item.id)),
    libraryFavorites: [...(state.libraryFavorites ?? [])],
    customItems,
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
