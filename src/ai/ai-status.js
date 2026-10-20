// Whether live AI is paused because this portfolio project's AI budget is used up (#263: the server
// marks those answers meta.budgetPaused). Session-only, never persisted: a reload starts from "Live AI"
// and the next answer sets it again. Any answer the model actually wrote clears it.
//
// Oct 20 smoke test: the server already said so on every request, but only the Taste Profile showed it.
// Recommendations read "Using catalog matches for this set.", the header still said "Live AI", and the
// empty Profile told people to rate more things, as if the missing patterns were their doing.

export const AI_PAUSED_HEADLINE = "AI picks are paused.";
export const AI_PAUSED_EXPLAINER = "Tastemake is a portfolio project that runs on a personal AI budget, and it’s used up for now.";
const BADGE_LIVE = { text: "Live AI", title: "Live AI is gated and always falls back to deterministic picks if it fails validation." };
const BADGE_PAUSED = { text: "AI paused", title: `${AI_PAUSED_EXPLAINER} Recommendations come straight from the catalog until it’s back.` };

export function noteAiAnswer(state, { budgetPaused = false, usedModel = false } = {}) {
  if (budgetPaused) state.aiPaused = true;
  else if (usedModel) state.aiPaused = false;
}

export function syncAiBadge(state, root = typeof document === "undefined" ? null : document) {
  const badge = root?.querySelector(".prototype-label");
  if (!badge) return;
  const { text, title } = state.aiPaused ? BADGE_PAUSED : BADGE_LIVE;
  badge.textContent = text;
  badge.title = title;
  badge.classList.toggle("is-paused", Boolean(state.aiPaused));
}
