// #120: "what Tastemake is working from", shown the moment a recommendation request starts.
//
// The wait for a set is mostly server time (provider retrieval plus the model call). Rather than a
// fake progress bar or placeholder titles, the loading banner shows something true and already
// known on the client: the user's own favorites the set starts from, how many other tried
// reactions it also uses, and the category asked for. Display only: nothing here is evidence,
// state, or sent anywhere.

import { isExperienced } from "./evidence.js";
import { domainById } from "../data/domains.js";
import { plural } from "../lib/format.js";

const MAX_TITLES = 4;

export function recommendationBasis(state) {
  const titleOf = (id) => state.feedbackByRecommendation?.[id]?.item?.title ?? state.customItems?.[id]?.title ?? null;
  // Before onboarding the starter favorites live in selectedFavorites; afterwards Library holds them.
  const starter = state.selectedFavorites?.size ? [...state.selectedFavorites] : [];
  const favoriteIds = starter.length ? starter : [...(state.libraryFavorites ?? [])];
  const favorites = favoriteIds.map(titleOf).filter(Boolean);
  const favoriteSet = new Set(favoriteIds);
  const reactions = Object.entries(state.feedbackByRecommendation ?? {})
    .filter(([id, feedback]) => !favoriteSet.has(id) && isExperienced(feedback))
    .length;
  const filter = state.recommendationFilter ?? "all";
  return { favorites, reactions, filter };
}

function listTitles(titles) {
  const shown = titles.slice(0, MAX_TITLES);
  const extra = titles.length - shown.length;
  if (extra > 0) return `${shown.join(", ")} and ${plural(extra, "other", "others")}`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

// Plain text (the caller escapes it). Empty string when there is nothing true to say.
export function basisSentence({ favorites = [], reactions = 0, filter = "all" } = {}) {
  const parts = [];
  if (favorites.length) {
    const tried = reactions ? `, plus ${plural(reactions, "other thing", "other things")} you have tried` : "";
    parts.push(`Starting from ${favorites.length === 1 ? "your favorite" : "your favorites"}: ${listTitles(favorites)}${tried}.`);
  } else if (reactions) {
    parts.push(`Starting from ${plural(reactions, "thing", "things")} you have tried.`);
  }
  if (filter !== "all") {
    const label = domainById(filter)?.label ?? filter;
    parts.push(`Looking for ${label} only.`);
  }
  return parts.join(" ");
}
