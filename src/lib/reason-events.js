// #250: anonymous counts for the optional "why" on a tried reaction, so we can tell whether people use
// reasons and where they stop. Same privacy line as src/lib/timing.js: only small numbers and
// low-cardinality labels go to Vercel Web Analytics, never titles, ids, or which reasons were chosen.
// On localhost, or before Web Analytics is enabled, window.va is absent or only queues, and nothing is sent.

import { directionOptionsFor, normalizedRefinements, refinablePolarity } from "../model/refinements.js";

export const REASONS_OPENED_EVENT = "Reasons opened";
export const REASON_CHANGED_EVENT = "Reason changed";

const SURFACES = new Set(["recommendations", "library", "browse"]);
const surfaceOf = (surface) => (SURFACES.has(surface) ? surface : "other");

function send(name, data, va) {
  if (typeof va !== "function") return null;
  try { va("event", { name, data }); } catch { /* analytics must never break the app */ }
  return data;
}

export function trackReasonsOpened(surface, { va = globalThis.window?.va } = {}) {
  return send(REASONS_OPENED_EVENT, { surface: surfaceOf(surface) }, va);
}

// `before` is the list of reason ids ahead of the change; `feedback` is the reaction after it.
// plainWithDirections counts chosen dimensions that offer directions where none was picked: the
// "opened a direction row and left it" signal.
export function reasonChangeSummary(before, feedback) {
  const after = normalizedRefinements(feedback);
  const polarity = refinablePolarity(feedback);
  const action = after.length > before.length ? "added" : after.length < before.length ? "removed" : "changed";
  const plainWithDirections = after
    .filter((id) => !id.includes(":") && directionOptionsFor(feedback?.item, id, polarity).length).length;
  return {
    action,
    count: after.length,
    specific: after.filter((id) => id.includes(":")).length,   // a direction or a content chip
    plainWithDirections
  };
}

export function trackReasonChanged(surface, before, feedback, { va = globalThis.window?.va } = {}) {
  return send(REASON_CHANGED_EVENT, { surface: surfaceOf(surface), ...reasonChangeSummary(before, feedback) }, va);
}
