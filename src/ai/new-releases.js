// #6: the client side of "New this week for you" (api/new-releases.mjs). Fetched once per visit, the first
// time Recommendations shows with a set, and kept in memory only. Saving or skipping a release goes through
// the same search action as anywhere else (applySearchAction), so it is intent, never taste.

import { serializeAiState } from "./live-client.js";
import { applySearchAction } from "../model/search.js";

// The browser language's country ("en-GB" -> GB); US when unknown. Movie release dates are per country.
function region() {
  const tags = typeof navigator === "undefined" ? [] : [navigator.language, ...(navigator.languages ?? [])];
  for (const tag of tags) {
    const match = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(String(tag ?? ""));
    if (match) return match[1].toUpperCase();
  }
  return "US";
}

export function maybeLoadNewReleases(state, onUpdate, fetchImpl = fetch) {
  if (state.newReleases?.status) return;
  state.newReleases = { status: "loading", items: [] };
  fetchImpl("/api/new-releases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: serializeAiState(state), region: region() })
  })
    .then((response) => (response.ok ? response.json() : { items: [] }))
    .catch(() => ({ items: [] }))
    .then((payload) => {
      state.newReleases = { status: "ready", items: Array.isArray(payload?.items) ? payload.items : [] };
      onUpdate();
    });
}

// "bookmark" (Save) or "not-interested". Returns the announcement, or null.
export function actOnNewRelease(state, itemId, action) {
  const item = (state.newReleases?.items ?? []).find((entry) => entry.id === itemId);
  if (!item || !["bookmark", "not-interested"].includes(action)) return null;
  const said = applySearchAction(state, item, action, { source: "new-this-week" });
  if (said) state.newReleases.items = state.newReleases.items.filter((entry) => entry.id !== itemId);
  return said;
}

// "Out now · Oct 18" or "Out Oct 24", from a YYYY-MM-DD date.
export function releaseLabel(date, today = new Date()) {
  const when = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(when.getTime())) return "";
  const text = when.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return when.toISOString().slice(0, 10) <= today.toISOString().slice(0, 10) ? `Out now · ${text}` : `Out ${text}`;
}
