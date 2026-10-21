// Paige's Example Profile (Oct 21): a real profile Paige built and corrected, so a visitor can see Tastemake
// with a lot of evidence before rating anything. It is loaded into the in-memory state only:
// state.viewingExample stops persistState (the visitor's own saved profile is never touched) and stops
// every model call (no new picks or Taste Profile refreshes on Paige's budget). "Start my own" reloads
// the page, which brings back whatever the visitor had saved before.
import { restoreStateFromBackupText, state } from "./state.js";

export const EXAMPLE_NAME = "Paige's Example Profile";
export const EXAMPLE_LOCKED_MESSAGE = `${EXAMPLE_NAME} is read-only for new AI picks. Start your own to get recommendations.`;
export const EXAMPLE_URL = "/data/example-profile.json";

export function isViewingExample(target = state) {
  return Boolean(target?.viewingExample);
}

export async function loadExampleProfile({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(EXAMPLE_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`example profile failed to load: ${response.status}`);
  restoreStateFromBackupText(await response.text());
  state.viewingExample = true;
  state.screen = "model";
  return state;
}

export function exampleBannerHtml() {
  if (!isViewingExample()) return "";
  return `<div class="example-banner" role="note"><p><strong>You're viewing ${EXAMPLE_NAME}.</strong> These are real reactions Paige gave, and the patterns Tastemake inferred from them, including two she corrected. Nothing you change here is saved.</p><button class="button button-primary" type="button" data-action="exit-example">Start my own</button></div>`;
}
