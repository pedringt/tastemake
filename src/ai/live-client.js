// Browser-side transport for the first live-AI job: choose/explain the next recommendation set.
// The browser sends product-owned state. The server rebuilds the typed model context, validates model
// output, and returns either accepted model picks or the deterministic fallback.

import { isExperienced } from "../model/evidence.js";

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

// Real bug, recurred three times now (recommendationSets ids-only, then about/artwork/sourceUrl,
// then reason/ai): trimming a fixed list of fields only raises the ceiling -- a long enough session
// still grows the payload back past it eventually. This bounds the *shape* of the by-far-largest
// group instead: intent-only reactions (bookmarks, Not interested, not-tried -- never Loved/Liked/
// Tried-disliked) vastly outnumber real taste evidence in normal use, and matter server-side for
// exactly two things: staying in the "already reacted, don't recommend again" exclusion set
// (eligibleCandidates in ai/context.js, keyed by id alone) and their evidenceKind/title/type/domains
// in evidenceRecords() (model/evidence.js's record()) -- never their provider/providerId/genres/
// providerMeta/year, which only externalEvidenceItems (catalog/related.mjs) reads, and it explicitly
// only looks at *experienced* items. So an intent-only entry's id can never be dropped (that would
// silently un-exclude an already-seen item -- the exact #152 bug class), but its item payload can
// shrink to just what record() and displayLabel() actually use, independent of how large the original
// catalog item was. Real taste evidence keeps its full (already-trimmed) item, since that's what the
// model actually reasons from and what anchor selection needs.
function stubItemForWire(item) {
  if (!item) return item;
  return { id: item.id, title: item.title, type: item.type ?? null, domains: item.domains ?? null, custom: item.custom || undefined };
}

function trimFeedbackItemForWire(feedback) {
  return { ...feedback, item: isExperienced(feedback) ? trimItemForWire(feedback.item) : stubItemForWire(feedback.item) };
}

// customItems is only ever read server-side for ids already in selectedFavorites or carrying
// experienced feedback (externalEvidenceItems, catalog/related.mjs) -- any other entry (a bookmarked
// search result never reacted to, an old blind-spot draft item, etc.) is pure dead weight on the wire.
function capCustomItemsForWire(customItems, feedbackByRecommendation, selectedFavorites) {
  const neededIds = new Set([
    ...(selectedFavorites ?? []),
    ...Object.entries(feedbackByRecommendation ?? {}).filter(([, feedback]) => isExperienced(feedback)).map(([id]) => id)
  ]);
  return Object.fromEntries(
    Object.entries(customItems ?? {}).filter(([id]) => neededIds.has(id)).map(([id, item]) => [id, trimItemForWire(item)])
  );
}

export function serializeAiState(state) {
  const feedbackByRecommendation = Object.fromEntries(
    Object.entries(state.feedbackByRecommendation ?? {}).map(([id, feedback]) => [id, trimFeedbackItemForWire(feedback)])
  );
  const customItems = capCustomItemsForWire(state.customItems, state.feedbackByRecommendation, state.selectedFavorites);
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
    // QA sweep finding (2026-09-28): blindSpots/blindSpotDrafts/blindSpotDismissed were being sent
    // whole and unbounded, the same shape that caused three real 413s elsewhere in this function --
    // confirmed by grep that neither api/recommendations.mjs nor api/hypotheses.mjs ever reads any of
    // the three once hydrated (hydrateState only defaults them; nothing downstream consumes them).
    // Server-side hydration already defaults all three when absent, so simply not sending them is a
    // zero-behavior-change, zero-information-loss cut -- unlike feedbackByRecommendation/customItems,
    // there is no real data here the server needs at all.
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
