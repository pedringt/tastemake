import { state } from "../state.js";
import { blindSpotFor, removeBlindSpot, saveBlindSpot } from "../model/blindspots.js";

// Taste Blind Spot (#20) panel: a small, resumable two-question flow. Returns a sentence to
// announce, or null when nothing needs saying (a toggle mid-draft, for example).
export function saveBlindAction(itemId, action, value) {
  const feedback = state.feedbackByRecommendation[itemId];
  if (!feedback) return null;
  const draft = state.blindSpotDrafts[itemId];
  const title = feedback.item.title;
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  if (action === "start" || action === "edit") {
    const saved = blindSpotFor(state, itemId);
    state.blindSpotDrafts[itemId] = { step: 1, broken: [...(saved?.hypotheses ?? [])], none: Boolean(saved?.none), reasons: [...(saved?.reasons ?? [])] };
    state.blindSpotDismissed.delete(itemId);
    return "Question 1 of 2. Which of the reasons Tastemake picked this didn't hold up for you?";
  }
  if (action === "dismiss") { state.blindSpotDismissed.add(itemId); return `Okay. You can tell Tastemake what it got wrong about ${title} any time.`; }
  if (action === "remove") { removeBlindSpot(state, itemId); return `${title} is no longer a blind spot.`; }
  if (!draft) return null;

  if (action === "toggle-pattern") {
    if (value === "none") { draft.none = !draft.none; if (draft.none) draft.broken = []; }
    else { draft.none = false; draft.broken = toggle(draft.broken, value); }
    return null;
  }
  if (action === "toggle-reason") { draft.reasons = toggle(draft.reasons, value); return null; }
  if (action === "next") {
    if (draft.step === 1 && !draft.broken.length && !draft.none) return null;
    draft.step = Math.min(3, draft.step + 1);
    return draft.step === 2 ? "Question 2 of 2. What got in the way?" : "Does this sound right?";
  }
  if (action === "back") { draft.step = Math.max(1, draft.step - 1); return null; }
  if (action === "save") { saveBlindSpot(state, itemId, draft); return `Noted. ${title} is now a blind spot Tastemake will learn from.`; }
  if (action === "discard") { delete state.blindSpotDrafts[itemId]; return "Discarded."; }
  return null;
}
