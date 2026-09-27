export function mergeUniqueBrowseItems(existing = [], incoming = []) {
  const seen = new Set();
  return [...existing, ...incoming].filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

// See app.js's hasEnoughFavorites for why this can't just check selectedFavorites.size once setup
// is done -- it's migrated/cleared into the ongoing Library model at that point.
export function browseReadyForRecommendations(state) {
  return Boolean(state?.onboarded) || (state?.selectedFavorites?.size ?? 0) >= 4;
}
