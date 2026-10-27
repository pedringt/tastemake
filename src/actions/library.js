import { state } from "../state.js";
import { isBookmarked } from "../model/taste.js";
import { isStrongPositive } from "../model/evidence.js";
import { clearInvalidRefinements, refinablePolarity } from "../model/refinements.js";

// Trying a bookmarked item turns it into a real reaction (and only then can it teach the model).
// wasBookmarked keeps a record that it was saved first, so the pre-try bookmark can later be
// compared with how it actually went.
export const triedOutcomes = {
  "tried-loved": ["more", "loved-before"],
  "tried-liked": ["more", "liked-before"],
  "tried-disliked": ["less", "tried-disliked"]
};

// Oct 27: rating something in Saved used to move it to Tried at once, so its reasons were never asked
// for. It now stays on the Saved list, open to "What worked for you?", until Done or leaving Library.
export function keepOnSavedList(itemId) {
  if (!state.savedJustTried.includes(itemId)) state.savedJustTried.push(itemId);
}

export function finishSavedTried(itemId) {
  state.savedJustTried = state.savedJustTried.filter((id) => id !== itemId);
}

export function saveBookmarkAction(itemId, action) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!isBookmarked(existing)) return false;

  if (action === "remove") {
    delete state.feedbackByRecommendation[itemId];
    state.libraryFavorites.delete(itemId);
    delete state.customItems?.[itemId];
    return true;
  }

  const outcome = triedOutcomes[action];
  if (!outcome) return false;
  const [rating, detail] = outcome;
  state.feedbackByRecommendation[itemId] = { item: existing.item, rating, detail, refinements: [], wasBookmarked: true };
  keepOnSavedList(itemId);
  return true;
}

// Library corrections change the underlying reaction, so the Library, Taste Profile and Bookmarks
// can never disagree. Starring a Favorite is only possible while the pick is still "Loved it before".
const libraryOutcomes = {
  loved: ["more", "loved-before"],
  liked: ["more", "liked-before"],
  disliked: ["less", "tried-disliked"]
};

export function saveLibraryAction(itemId, action) {
  const existing = state.feedbackByRecommendation[itemId];
  if (!existing) return false;

  if (action === "favorite") {
    const previousPolarity = refinablePolarity(existing);
    const wasBookmarked = isBookmarked(existing);
    existing.rating = "more";
    existing.detail = "loved-before";
    existing.wasBookmarked = Boolean(existing.wasBookmarked || wasBookmarked);
    clearInvalidRefinements(existing, previousPolarity);
    state.libraryFavorites.add(itemId);
    return true;
  }
  if (action === "unfavorite") {
    state.libraryFavorites.delete(itemId);
    return true;
  }

  const outcome = libraryOutcomes[action];
  if (!outcome) return false;
  const previousPolarity = refinablePolarity(existing);
  [existing.rating, existing.detail] = outcome;
  clearInvalidRefinements(existing, previousPolarity);
  if (!isStrongPositive(existing)) state.libraryFavorites.delete(itemId);
  // "Surprised me" only makes sense after Loved / Liked it before.
  return true;
}
