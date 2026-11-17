// #323 phase 3: the browser side of "What's different about it?". When a title is marked "Fits a different side
// of my taste", one request asks /api/hypotheses (reasons mode) for up to three reasons to tap. The answer is kept
// in memory for this visit only (never saved): a title whose reasons already loaded isn't asked about again. The
// person's choice is saved with their answer (src/model/partly-elements.js, chooseReason) and nothing reads it yet.
//
// No request while viewing the Example Profile. An answer that arrives after the person changed or undid their
// answer (Belongs, toggled off, left Partly, another profile) is ignored, like a stale Taste Profile refresh.

import { serializeAiState } from "./live-client.js";
import { noteAiAnswer } from "./ai-status.js";
import { storedSynopsis } from "../catalog/synopsis.mjs";
import { statementFor } from "../model/statements.js";
import { ABOUT_MAX, REASON_COUNT } from "./partly-reasons.js";

// key -> { status: "loading" | "ready" | "failed" | "off", reasons: [label], request }
const loaded = new Map();
// Keyed by profile too, so another profile (Start over, a restored backup, the Example Profile) never shows reasons
// loaded for this one, even where pattern ids and titles match.
const keyOf = (state, hypothesisId, ref) => [state.profileGeneration ?? 0, state.viewingExample ? "example" : "own", hypothesisId, ref].join("\u0000");

export const reasonsEntry = (state, hypothesisId, ref) => loaded.get(keyOf(state, hypothesisId, ref)) ?? null;
export function forgetAllReasons() { loaded.clear(); }

// The reason buttons to show: the loaded reasons, plus a saved choice that isn't among them (after a reload,
// say), so it can still be seen and cleared. Never more than REASON_COUNT loaded ones.
export function reasonOptions(answer, entry) {
  const options = entry?.status === "ready" ? entry.reasons.slice(0, REASON_COUNT) : [];
  const saved = answer?.reasons?.[0];
  return saved && !options.includes(saved) ? [...options, saved] : options;
}

function itemFor(state, ref) {
  const id = String(ref).replace(/^ev:/, "");
  return state.feedbackByRecommendation?.[id]?.item ?? state.customItems?.[id] ?? null;
}

// The request body: the usual wire state (with this pattern's titles guaranteed in it), only this pattern, and the
// flagged title's synopsis, which the wire state leaves out.
export function buildReasonsRequest(state, hypothesisId, ref) {
  const pattern = (state.modelHypotheses ?? []).find((p) => p?.id === hypothesisId);
  if (!pattern) return null;
  const about = (storedSynopsis(itemFor(state, ref)) ?? "").slice(0, ABOUT_MAX) || null;
  return {
    state: { ...serializeAiState(state, { requiredRefs: [ref, ...(pattern.supports ?? [])] }), modelHypotheses: [pattern] },
    reasons: { hypothesisId, ref, ...(about ? { about } : {}) }
  };
}

const stillDifferent = (state, hypothesisId, ref) => statementFor(state, hypothesisId)?.elements?.titles?.[ref]?.verdict === "different";

function staleFor(state, request) {
  const entry = loaded.get(request.key);
  if (entry?.request !== request) return true;
  if ((state.profileGeneration ?? 0) !== request.generation || Boolean(state.viewingExample) !== request.viewingExample) return true;
  return !stillDifferent(state, request.hypothesisId, request.ref);
}

// Ask for reasons for one flagged title. Returns what happened, for tests: "example", "cached", "not-flagged",
// "ready", "off", "failed" or "stale". onUpdate re-renders; announce speaks in the live region.
export async function loadReasons(state, hypothesisId, ref, { title = "this title", onUpdate = () => {}, announce = () => {}, fetchImpl = (...args) => fetch(...args) } = {}) {
  if (state.viewingExample) return "example";
  if (!stillDifferent(state, hypothesisId, ref)) return "not-flagged";
  const key = keyOf(state, hypothesisId, ref);
  const existing = loaded.get(key);
  if (existing && existing.status !== "failed" && existing.status !== "loading") return "cached";
  const body = buildReasonsRequest(state, hypothesisId, ref);
  if (!body) return "not-flagged";
  // A newer request for the same title (toggled off and on while loading) replaces the older one.
  const request = { key, hypothesisId, ref, generation: state.profileGeneration ?? 0, viewingExample: Boolean(state.viewingExample) };
  loaded.set(key, { status: "loading", reasons: [], request });
  onUpdate();
  let payload = null;
  try {
    const response = await fetchImpl("/api/hypotheses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    payload = await response.json().catch(() => null);
    if (!response.ok) payload = null;
  } catch {
    payload = null;
  }
  if (staleFor(state, request)) {
    if (loaded.get(key)?.request === request) loaded.delete(key);
    return "stale";
  }
  if (payload?.meta?.budgetPaused || payload?.source === "model") noteAiAnswer(state, { budgetPaused: Boolean(payload.meta?.budgetPaused), usedModel: payload.source === "model" });
  const reasons = payload?.source === "model" && Array.isArray(payload.reasons)
    ? payload.reasons.filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim()).slice(0, REASON_COUNT)
    : [];
  if (reasons.length) {
    loaded.set(key, { status: "ready", reasons, request });
    onUpdate();
    announce(`Suggested reasons for “${title}” are ready. Pick the one that fits, or say it in your own words.`);
    return "ready";
  }
  if (payload?.meta?.reasonsOff) {
    // The server's switch is off: "Something else" only, with nothing to apologize for.
    loaded.set(key, { status: "off", reasons: [], request });
    onUpdate();
    return "off";
  }
  loaded.set(key, { status: "failed", reasons: [], request });
  onUpdate();
  announce(`Tastemake couldn’t suggest reasons for “${title}”. You can still say it in your own words.`);
  return "failed";
}
