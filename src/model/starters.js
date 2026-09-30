// Resolve starter IDs against persistent items Tastemake already knows.
// Keep this module independent of search.js: search imports taste/evidence rules, so importing it
// back from the evidence path creates an ESM initialization cycle. searchableItems() is currently
// exactly Object.values(state.customItems), so this preserves the same product behavior without
// coupling evidence construction to the search UI/model layer.
export function starterItems(state) {
  const byId = new Map(Object.values(state?.customItems ?? {}).map((item) => [item.id, item]));
  return [...(state?.selectedFavorites ?? [])].map((id) => byId.get(id)).filter(Boolean);
}
