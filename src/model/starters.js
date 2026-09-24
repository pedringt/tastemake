import { searchableItems } from "./search.js";

// Resolve starter IDs against the full searchable catalog, not a hand-picked Favorites list.
// This lets onboarding start from anything the user actually loves, including a title they added.
export function starterItems(state) {
  const byId = new Map(searchableItems(state).map((item) => [item.id, item]));
  return [...state.selectedFavorites].map((id) => byId.get(id)).filter(Boolean);
}
