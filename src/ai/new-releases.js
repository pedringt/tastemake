// #6: the client side of "New this week for you" (api/new-releases.mjs). Fetched once per visit, the first
// time Recommendations shows with a set, and kept in memory only. Saving or skipping a release goes through
// the same search action as anywhere else (applySearchAction), so it is intent, never taste.

import { serializeAiState } from "./live-client.js";
import { applySearchAction } from "../model/search.js";
import { viewerRegion } from "../catalog/client.js";

export function maybeLoadNewReleases(state, onUpdate, fetchImpl = fetch) {
  if (state.newReleases?.status) return;
  state.newReleases = { status: "loading", items: [] };
  fetchImpl("/api/new-releases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: serializeAiState(state), region: viewerRegion() })
  })
    .then((response) => (response.ok ? response.json() : { items: [], outcome: "unavailable" }))
    .catch(() => ({ items: [], outcome: "unavailable" }))
    .then((payload) => {
      state.newReleases = newReleasesFromPayload(payload);
      onUpdate();
    });
}

// Nov 2 (#317): keep the server's outcome so the strip can tell "nothing qualified" from "couldn't load".
// A reply without one (an older server, a broken body) is never read as "no strong matches".
const OUTCOMES = new Set(["matched", "no-strong-matches", "no-releases", "no-anchors", "unavailable"]);
export function newReleasesFromPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const outcome = OUTCOMES.has(payload?.outcome) ? payload.outcome : (items.length ? "matched" : "unavailable");
  return { status: "ready", items, outcome };
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
