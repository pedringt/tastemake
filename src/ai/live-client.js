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
const MAX_WIRE_EXPERIENCED = 96;

function compactExperiencedItem(item) {
  if (!item) return item;
  return {
    id: item.id,
    title: item.title,
    type: item.type ?? null,
    domains: item.domains ?? null,
    by: item.by ?? null,
    custom: item.custom || undefined,
    provider: item.provider ?? null,
    providerId: item.providerId ?? null,
    year: item.year ?? null,
    genres: (item.genres ?? []).slice(0, 12),
    providerMeta: item.providerMeta ?? null
  };
}

function primaryDomain(feedback) {
  return feedback?.item?.domains?.[0] ?? "other";
}

export function selectExperiencedFeedbackForWire(feedbackByRecommendation = {}, limit = MAX_WIRE_EXPERIENCED) {
  const entries = Object.entries(feedbackByRecommendation).filter(([, feedback]) => isExperienced(feedback));
  if (entries.length <= limit) return entries;

  const buckets = new Map([["movies", []], ["tv", []], ["read", []], ["play", []], ["other", []]]);
  for (const entry of entries) {
    const key = buckets.has(primaryDomain(entry[1])) ? primaryDomain(entry[1]) : "other";
    buckets.get(key).push(entry);
  }
  for (const bucket of buckets.values()) bucket.reverse();

  const out = [];
  while (out.length < limit && [...buckets.values()].some((bucket) => bucket.length)) {
    for (const bucket of buckets.values()) {
      const entry = bucket.shift();
      if (entry) out.push(entry);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function compactFeedbackForWire(feedback) {
  return { ...feedback, item: compactExperiencedItem(feedback.item) };
}

function capCustomItemsForWire(customItems, feedbackByRecommendation, selectedFavorites) {
  const neededIds = new Set([
    ...(selectedFavorites ?? []),
    ...Object.keys(feedbackByRecommendation ?? {})
  ]);
  return Object.fromEntries(
    Object.entries(customItems ?? {})
      .filter(([id]) => neededIds.has(id))
      .map(([id, item]) => [id, compactExperiencedItem(item)])
  );
}

function seenItemIdsForWire(state) {
  return [...new Set([
    ...Object.keys(state.feedbackByRecommendation ?? {}),
    ...(state.recommendationSets ?? []).flat().map((item) => typeof item === "string" ? item : item?.id).filter(Boolean)
  ])];
}

export function serializeAiState(state) {
  const feedbackByRecommendation = Object.fromEntries(
    selectExperiencedFeedbackForWire(state.feedbackByRecommendation ?? {})
      .map(([id, feedback]) => [id, compactFeedbackForWire(feedback)])
  );
  const customItems = capCustomItemsForWire(state.customItems, feedbackByRecommendation, state.selectedFavorites);
  return {
    selectedFavorites: [...state.selectedFavorites],
    feedbackByRecommendation,
    seenItemIds: seenItemIdsForWire(state),
    // #120 follow-up, real bug: server-side, every historical set is only ever read for its item ids
    // (the "already shown" exclusion set in related.mjs/context.js) -- never full item data. The
    // full objects (title, artwork URL, synopsis, provider metadata, AI reasoning text) were being
    // resent on every single request, forever, growing linearly with real usage until it exceeded
    // the server's 160KB body cap and every request started failing with a silent 413 -- which reads
    // to a user as "stuck on the same recommendations," since the client keeps whatever was last
    // successfully rendered. Sending ids only cuts this payload by roughly two orders of magnitude
    // with zero behavior change server-side.
    recommendationSets: [],
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
