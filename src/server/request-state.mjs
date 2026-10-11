// Shared by api/recommendations.mjs and api/hypotheses.mjs instead of each endpoint keeping its own
// hand-copied version (QA sweep finding: the two had already drifted -- hypotheses.mjs's copy was
// missing blindSpots, blindSpotDrafts, and recommendationFilter, silently defaulting them wherever a
// reader happened to tolerate a missing field instead of visibly breaking). Moved here from
// api/recommendations.mjs in #220 so neither Vercel handler imports from the other.
export function hydrateState(raw = {}) {
  return {
    ...raw,
    selectedFavorites: new Set(raw.selectedFavorites ?? []),
    libraryFavorites: new Set(raw.libraryFavorites ?? []),
    blindSpotDismissed: new Set(raw.blindSpotDismissed ?? []),
    feedbackByRecommendation: raw.feedbackByRecommendation ?? {},
    recommendationSets: Array.isArray(raw.recommendationSets) ? raw.recommendationSets : [],
    seenItemIds: Array.isArray(raw.seenItemIds) ? raw.seenItemIds : [],
    customItems: raw.customItems ?? {},
    blindSpots: raw.blindSpots ?? {},
    blindSpotDrafts: raw.blindSpotDrafts ?? {},
    patternStatements: raw.patternStatements ?? [],
    areas: raw.areas ?? {},
    curveball: raw.curveball !== false,
    recommendationFilter: raw.recommendationFilter ?? "all"
  };
}
