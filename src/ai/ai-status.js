// What the header badge and the Recommendations status line may claim about AI.
//
// aiPaused: live AI is paused because this portfolio project's AI budget is used up (#263: the server
// marks those answers meta.budgetPaused). aiLive: the model actually wrote an answer this session.
// Both are session-only and never persisted (persistence.js saves a fixed list of fields).
//
// Oct 20 smoke test: the server already said so on every request, but only the Taste Profile showed it.
// Recommendations read "Using catalog matches for this set.", the header still said "Live AI", and the
// empty Profile told people to rate more things, as if the missing patterns were their doing.
//
// Nov 3, 2026 (T2): after a reload both flags start false, so nothing is known about AI yet. The badge
// used to start at "Live AI" anyway, even over a saved set of catalog picks. Now:
//   - The badge is neutral ("AI picks") until an answer this session establishes the AI state, and it
//     never says "Live AI" while the set on screen is catalog picks.
//   - Whether a saved set came from the catalog is read from the set itself: every catalog pick is saved
//     with ai: null, every validated model pick with its ai object (api/recommendations.mjs). Why a set
//     was catalog (paused budget, failed validation, AI off) is not saved, so after a reload Tastemake
//     says only that the picks came from the catalog, never why.

export const AI_PAUSED_HEADLINE = "AI picks are paused.";
export const AI_PAUSED_EXPLAINER = "Tastemake is a portfolio project that runs on a personal AI budget, and it’s used up for now.";
export const CATALOG_SET_LINE = "These picks came from the catalog, not AI.";
const BADGE_LIVE = { text: "Live AI", title: "Live AI is gated and always falls back to deterministic picks if it fails validation." };
const BADGE_PAUSED = { text: "AI paused", title: `${AI_PAUSED_EXPLAINER} Recommendations come straight from the catalog until it’s back.` };
const BADGE_NEUTRAL = { text: "AI picks", title: "Tastemake’s AI orders and explains picks when it’s available. Otherwise picks come straight from the catalog." };

export function noteAiAnswer(state, { budgetPaused = false, usedModel = false } = {}) {
  if (budgetPaused) {
    state.aiPaused = true;
    state.aiLive = false;
  } else if (usedModel) {
    state.aiPaused = false;
    state.aiLive = true;
  }
}

// "catalog" when every pick in the set was saved without AI, "model" when every pick carries the AI's
// answer, null when the set is empty or mixed (not a shape the server produces).
export function setSource(items) {
  if (!Array.isArray(items) || !items.length) return null;
  if (items.every((item) => item && item.ai == null)) return "catalog";
  if (items.every((item) => item && item.ai && typeof item.ai === "object")) return "model";
  return null;
}

function latestSet(state) {
  const sets = state.recommendationSets ?? [];
  return sets.length ? sets[sets.length - 1] : [];
}

export function badgeFor(state) {
  if (state.aiPaused) return BADGE_PAUSED;
  if (setSource(latestSet(state)) === "catalog") return BADGE_NEUTRAL;
  return state.aiLive ? BADGE_LIVE : BADGE_NEUTRAL;
}

export function syncAiBadge(state, root = typeof document === "undefined" ? null : document) {
  const badge = root?.querySelector(".prototype-label");
  if (!badge) return;
  const { text, title } = badgeFor(state);
  badge.textContent = text;
  badge.title = title;
  badge.classList.toggle("is-paused", Boolean(state.aiPaused));
}
