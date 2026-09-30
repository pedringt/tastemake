import { resetState, restoreStateFromBackupText, state } from "../state.js";
import { applySearchAction } from "../model/search.js";
import { clearStatement } from "../model/statements.js";
import { removeBlindSpot } from "../model/blindspots.js";
import { AREAS } from "../model/taste.js";
import { backupFileName, buildBackup, buildHtmlExport, htmlFileName } from "../model/export.js";

// ---- My Tastemake (#8) ----

function downloadText(filename, type, text) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


export function openMine(navigate) {
  if (state.screen !== "mine") state.mineReturn = state.screen;
  navigate("mine");
}

export function mineRemoveFocusAfter(rowEl) {
  const next = rowEl?.nextElementSibling ?? rowEl?.previousElementSibling;
  if (next?.dataset.mineId) return `[data-mine-id="${next.dataset.mineId}"] .mine-action`;
  if (next?.dataset.mineSaid) return `[data-mine-said="${next.dataset.mineSaid}"] .mine-action`;
  if (next?.dataset.mineBlind) return `[data-mine-blind="${next.dataset.mineBlind}"] .mine-action`;
  return null;
}

// Item corrections, removing a pattern statement or blind spot, and the two-step reset
// confirmation. The caller (app.js) has already scoped this to state.screen === "mine".
export function handleMineClick(event, { render, updateStepper, restoreFocus, announce, navigate, canAccess }) {
  const button = event.target.closest("button");
  if (!button) return;

  if (button.dataset.mineExport === "html") {
    downloadText(htmlFileName(), "text/html;charset=utf-8", buildHtmlExport(state));
    announce("Downloaded a readable HTML copy of your Tastemake data.");
    return;
  }

  if (button.dataset.mineExport === "backup") {
    downloadText(backupFileName(), "application/json;charset=utf-8", JSON.stringify(buildBackup(state), null, 2));
    announce("Downloaded your Tastemake backup.");
    return;
  }

  if (button.dataset.mineRestore) {
    document.querySelector("[data-mine-restore-file]")?.click();
    return;
  }

  if (button.dataset.mineItem) {
    const id = button.dataset.mineItem;
    const item = state.feedbackByRecommendation[id]?.item;
    if (!item) return;
    const selector = button.dataset.mineAction === "remove"
      ? mineRemoveFocusAfter(button.closest(".mine-row"))
      : `[data-mine-item="${id}"][data-mine-action="${button.dataset.mineAction}"]`;
    const message = applySearchAction(state, item, button.dataset.mineAction);
    if (!message) return;
    render();
    updateStepper();
    restoreFocus(selector);
    announce(message);
    return;
  }

  if (button.dataset.mineSaidRemove) {
    const selector = mineRemoveFocusAfter(button.closest(".mine-row"));
    const message = clearStatement(state, button.dataset.mineSaidRemove);
    render();
    restoreFocus(selector);
    if (message) announce(message);
    return;
  }

  if (button.dataset.mineBlindRemove) {
    const id = button.dataset.mineBlindRemove;
    const title = state.feedbackByRecommendation[id]?.item.title ?? "That pick";
    const selector = mineRemoveFocusAfter(button.closest(".mine-row"));
    removeBlindSpot(state, id);
    render();
    restoreFocus(selector);
    announce(`${title}: what you told it it got wrong was removed.`);
    return;
  }

  if (button.dataset.mineReset) {
    const step = button.dataset.mineReset;
    if (step === "confirm") {
      resetState();
      state.resetArmed = false;
      state.setupReturn = "favorites";
      navigate("setup");
      announce("Started over. Your taste data and setup were cleared. Your look stayed the same.");
      return;
    }
    state.resetArmed = step === "arm";
    render();
    restoreFocus(step === "arm" ? '[data-mine-reset="cancel"]' : '[data-mine-reset="arm"]');
    announce(step === "arm" ? "Are you sure? This clears everything you told Tastemake." : "Nothing was cleared.");
    return;
  }

  if (button.dataset.action === "mine-back") {
    navigate(canAccess(state.mineReturn) ? state.mineReturn : "favorites");
  }
}

export async function handleMineChange(event, { render, restoreFocus, announce, updateStepper }) {
  const restoreFile = event.target.closest("[data-mine-restore-file]");
  if (restoreFile?.files?.[0]) {
    try {
      const text = await restoreFile.files[0].text();
      if (!window.confirm("Restore this Tastemake backup? This replaces your current Tastemake data.")) {
        restoreFile.value = "";
        announce("Restore cancelled.");
        return;
      }
      restoreStateFromBackupText(text);
      render();
      updateStepper?.();
      restoreFocus("[data-mine-restore]");
      announce("Your Tastemake backup was restored.");
    } catch (error) {
      restoreFile.value = "";
      announce(error?.message || "Tastemake could not restore that backup.");
    }
    return;
  }

  const area = event.target.closest("[data-mine-area]");
  if (area) {
    const id = area.dataset.mineArea;
    state.areas[id] = area.checked;
    if (!AREAS.some((a) => state.areas[a.id] !== false)) state.areas[id] = true;   // never all off
    const enabled = AREAS.filter((a) => state.areas[a.id] !== false).map((a) => a.id);
    state.setupAreas = enabled.length === AREAS.length ? new Set(["all"]) : new Set(enabled);
    const label = AREAS.find((a) => a.id === id).label;
    render();
    restoreFocus(`[data-mine-area="${id}"]`);
    announce(`${label} is ${state.areas[id] ? "on" : "off"} for new sets.`);
    return;
  }
  if (event.target.closest("[data-mine-curveball]")) {
    state.curveball = event.target.checked;
    state.recommendationStyle = state.curveball ? "balanced" : "safe";
    render();
    restoreFocus("[data-mine-curveball]");
    announce(`Curveball is ${state.curveball ? "on" : "off"} for new sets.`);
  }
}
