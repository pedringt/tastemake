export function mergeUniqueBrowseItems(existing = [], incoming = []) {
  const seen = new Set();
  return [...existing, ...incoming].filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

export function browseReadyForRecommendations(state) {
  return (state?.selectedFavorites?.size ?? 0) >= 4;
}
