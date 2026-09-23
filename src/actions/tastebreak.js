import { state } from "../state.js";
import { discardTastebreakDraft, removeTastebreak, saveTastebreak, startTastebreak, toggleTastebreakPattern } from "../model/tastebreak.js";

// Returns a sentence to announce, or null when nothing needs saying (a toggle mid-draft).
export function saveTastebreakAction(itemId, action, value) {
  if (action === "start" || action === "edit") return startTastebreak(state, itemId);
  if (action === "toggle-pattern") { toggleTastebreakPattern(state, itemId, value); return null; }
  if (action === "save") return saveTastebreak(state, itemId);
  if (action === "discard") { discardTastebreakDraft(state, itemId); return "Discarded."; }
  if (action === "remove") { removeTastebreak(state, itemId); return "Removed."; }
  return null;
}
