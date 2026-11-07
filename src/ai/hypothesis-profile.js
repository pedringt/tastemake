import { serializeAiState } from "./live-client.js";
import { evidenceRecords } from "../model/evidence.js";
import { recordRevisionIfChanged } from "../model/history.js";
import { noteAiAnswer } from "./ai-status.js";
import { NEEDS_REVIEW, confirmationFor } from "../model/statements.js";
import { CONTRACT_VERSION } from "./contract.js";

const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export function hypothesisEvidenceKey(state) {
  const evidence = evidenceRecords(state).map(({ ref, kind, polarity, weight, facts, refinements }) => ({ ref, kind, polarity, weight, facts, refinements }));
  const statements = (state.patternStatements ?? []).map(({ hypothesisId, says, weight, context, excludedDomains }) => ({ hypothesisId, says, weight, context, excludedDomains }));
  return JSON.stringify({ evidence, statements });
}

// #340: hypothesisAiKey isn't saved (it's about 14 KB for a real profile), so every page load used to pay for a
// refresh of evidence that had already been checked. A completed refresh now also saves a short hash of the key
// and a version. Bump PROFILE_REFRESH_VERSION when the refresh prompt or how patterns are built changes, so an
// unchanged profile is refreshed once. (A model swapped in Vercel's settings isn't visible here; that refresh
// waits for the next evidence change or a manual Refresh.)
export const PROFILE_REFRESH_VERSION = 1;
const refreshVersion = () => `${CONTRACT_VERSION}:${PROFILE_REFRESH_VERSION}`;

function hashKey(text) {
  // FNV-1a, 32-bit, plus the length: a cache check, not security.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${(hash >>> 0).toString(16)}:${text.length}`;
}

function markChecked(state, key) {
  state.hypothesisAiKey = key;
  state.hypothesisAiChecked = key ? { hash: hashKey(key), version: refreshVersion() } : null;
}

// Trust a saved check only while the profile it produced is there and usable; otherwise refresh as before.
function usableProfile(state) {
  const patterns = state.modelHypotheses;
  return Array.isArray(patterns) && patterns.length > 0
    && patterns.every((p) => p && typeof p.id === "string" && typeof p.claim === "string" && p.claim.trim());
}

export function savedCheckApplies(state, key = hypothesisEvidenceKey(state)) {
  const saved = state.hypothesisAiChecked;
  return Boolean(saved && saved.version === refreshVersion() && saved.hash === hashKey(key) && usableProfile(state));
}

// The shape a live hypothesis is stored in (state.modelHypotheses). Exported so the eval harness can
// feed a fixture's earlier profile back exactly as the client would (#228).
export function normalizeHypothesis(h, index, state) {
  const id = /^ai-[\w-]+$/.test(h.id ?? "") ? h.id : `ai-${slug(h.label) || index + 1}`;
  const evidenceMap = new Map(evidenceRecords(state).map((row) => [row.ref, row]));
  const evidenceTitles = (h.evidence ?? []).map((ref) => evidenceMap.get(ref)?.title).filter(Boolean);
  return {
    id,
    title: h.label,
    claim: h.claim,
    evidence: evidenceTitles.join(", ") || "Evidence cited by the live interpretation.",
    supports: h.evidence ?? [],
    counters: h.counter ?? [],
    domains: h.domains ?? [],
    strength: h.level ?? "Emerging",
    status: h.conditional ? "conditional" : String(h.level ?? "emerging").toLowerCase(),
    crossDomain: h.crossDomain ?? "none",
    context: h.context ?? null,
    aiGenerated: true,
    provenance: "Based on your reactions so far."
  };
}

// #325: a pattern the user confirmed ("accurate" or "partly") is always kept, whatever the refresh
// returned, and never counts against activeLimit (only the user can grow the confirmed set past it).
// The rest of the room goes to earlier patterns first, then to new ones.
export function mergeHypotheses(existing = [], incoming = [], { statements = [], activeLimit = 12, preserveExistingActive = true } = {}) {
  const correctedIds = new Set(
    (statements ?? []).filter((entry) => entry?.says === "not-me").map((entry) => entry.hypothesisId)
  );
  const corrected = [];
  const correctedSeen = new Set();
  for (const item of [...incoming, ...existing]) {
    if (!item?.id || !correctedIds.has(item.id) || correctedSeen.has(item.id)) continue;
    correctedSeen.add(item.id);
    corrected.push(item);
  }

  const confirmed = (item) => Boolean(confirmationFor(statements, item));
  const activeById = new Map();
  for (const item of incoming) if (item?.id && !correctedIds.has(item.id)) activeById.set(item.id, item);
  for (const item of existing) {
    if (!item?.id || correctedIds.has(item.id) || activeById.has(item.id)) continue;
    if (preserveExistingActive || confirmed(item)) activeById.set(item.id, item);
  }
  const active = [...activeById.values()];
  const existingIds = new Set(existing.map((item) => item?.id));
  const unconfirmed = active.filter((item) => !confirmed(item));
  const room = Math.max(0, activeLimit - (active.length - unconfirmed.length));
  const kept = new Set([...unconfirmed.filter((item) => existingIds.has(item.id)), ...unconfirmed.filter((item) => !existingIds.has(item.id))].slice(0, room));
  return active.filter((item) => confirmed(item) || kept.has(item)).concat(corrected);
}

// #325: a confirmed pattern whose evidence no longer passes the check (the server lists it in
// meta.needsReview) is kept as stored, with the user's answer and history untouched, but marked so it
// is not shown as supported. The mark is cleared only when a refresh accepts the pattern again: an
// accepted pattern is rebuilt by normalizeHypothesis, which has no such field.
const UPDATED_MESSAGE = "Updated using your latest reactions.";
const CHECKED_NEEDS_REVIEW = "Tastemake checked your profile. Some patterns need another look because their evidence is no longer available.";
export function markNeedsReview(patterns = [], needsReview = []) {
  const ids = new Set(needsReview ?? []);
  if (!ids.size) return patterns;
  return patterns.map((p) => (ids.has(p?.id) ? { ...p, evidenceStatus: NEEDS_REVIEW } : p));
}

// Nov 4 (after #325): the evidence the stored patterns rest on, which a refresh must send if it still
// exists, so the server never mistakes "not sent" for "removed". Patterns the user confirmed come first,
// then the rest; supports before counters.
export function citedEvidenceRefs(state) {
  const patterns = state.modelHypotheses ?? [];
  const confirmed = (p) => Boolean(confirmationFor(state.patternStatements ?? [], p));
  const tier = (list) => [...list.flatMap((p) => p.supports ?? []), ...list.flatMap((p) => p.counters ?? [])];
  return [...new Set([...tier(patterns.filter(confirmed)), ...tier(patterns.filter((p) => !confirmed(p)))])];
}

// Nov 4 (after #325): why a profile answer no longer describes the user's current profile, or null.
// Same idea as staleReason for picks (src/ai/requests.js, #42). hypothesisEvidenceKey already covers
// every input the user can change while a refresh is in flight: their reactions and refinements, and
// their pattern answers (says, weight, context, excluded areas). If the UI ever lets people edit a
// pattern directly, add it to that key too or staleness will miss it.
export function profileRefreshStaleReason(state, request) {
  if (!request) return "no request";
  if (state.hypothesisRequest !== request) return "a newer request replaced it";
  if ((state.profileGeneration ?? 0) !== request.generation) return "the profile was replaced";
  if (Boolean(state.viewingExample) !== request.viewingExample) return "the profile was replaced";
  if (hypothesisEvidenceKey(state) !== request.key) return "your answers or reactions changed while it was checking";
  return null;
}

// A stale answer changes nothing: no patterns, history, flags, key, message or announcement. When the same
// profile changed underneath it, the status and message go back to what they were before the request, and
// onStale lets the caller ask again through its normal refresh path (which keeps the Profile-screen,
// deduplication and loading guards). A paused budget never asks again. When the profile was replaced
// (Start over, a restored backup, the Example Profile), nothing is touched and nothing is asked.
function settleStale(state, request, { payload = null, onStale, onUpdate }) {
  if (state.hypothesisRequest === request) state.hypothesisRequest = null;
  const sameProfile = (state.profileGeneration ?? 0) === request.generation && Boolean(state.viewingExample) === request.viewingExample;
  if (!sameProfile) return;
  state.hypothesisAiStatus = request.previousStatus;
  state.hypothesisAiMessage = request.previousMessage;
  onUpdate();
  if (!payload?.meta?.budgetPaused && !state.aiPaused) onStale();
}

export async function refreshProfileHypotheses(state, { onUpdate = () => {}, announce = () => {}, onStale = () => {}, force = false } = {}) {
  if (state.viewingExample) return;   // the example's patterns are fixed; no model calls on its behalf
  const key = hypothesisEvidenceKey(state);
  if (state.hypothesisAiStatus === "loading" || (!force && state.hypothesisAiKey === key)) return;
  if (!force && savedCheckApplies(state, key)) {
    // #340: this evidence was already checked before the page loaded. Show the result, keep Refresh, don't call.
    state.hypothesisAiKey = key;
    state.hypothesisAiStatus = "ready";
    state.hypothesisAiMessage = state.modelHypotheses.some((p) => p?.evidenceStatus === NEEDS_REVIEW) ? CHECKED_NEEDS_REVIEW : UPDATED_MESSAGE;
    onUpdate();
    return;
  }

  const request = {
    key,
    generation: state.profileGeneration ?? 0,
    viewingExample: Boolean(state.viewingExample),
    previousStatus: state.hypothesisAiStatus,
    previousMessage: state.hypothesisAiMessage ?? null,
    controller: typeof AbortController === "function" ? new AbortController() : null
  };
  state.hypothesisRequest = request;
  state.hypothesisAiStatus = "loading";
  state.hypothesisAiMessage = (state.modelHypotheses ?? []).length
    ? "Refreshing your Taste Profile…"
    : "Building your Taste Profile…";
  onUpdate();

  try {
    const bodyState = { ...serializeAiState(state, { requiredRefs: citedEvidenceRefs(state) }), modelHypotheses: state.modelHypotheses ?? [] };
    const response = await fetch("/api/hypotheses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: bodyState }),
      ...(request.controller ? { signal: request.controller.signal } : {})
    });
    const payload = await response.json().catch(() => null);
    if (profileRefreshStaleReason(state, request)) return settleStale(state, request, { payload, onStale, onUpdate });
    if (!response.ok || !payload) throw new Error(payload?.error || "profile request failed");

    request.settled = true;
    state.hypothesisRequest = null;
    noteAiAnswer(state, { budgetPaused: Boolean(payload.meta?.budgetPaused), usedModel: payload.source === "model" });
    const needsReview = Array.isArray(payload.meta?.needsReview) ? payload.meta.needsReview : [];
    if (payload.source === "model" && Array.isArray(payload.hypotheses) && payload.hypotheses.length) {
      const next = payload.hypotheses.map((h, index) => normalizeHypothesis(h, index, state));
      for (const h of next) {
        recordRevisionIfChanged(state, {
          hypothesisId: h.id,
          claim: h.claim,
          supports: h.supports,
          counters: h.counters,
          domains: h.domains,
          level: h.strength,
          origin: "model",
          reason: "Live Taste Profile refresh"
        });
      }
      const rejected = Number(payload.meta?.rejected ?? 0);
      // Nov 4 (after #325): a pattern accepted while some of its evidence went unchecked (meta.notChecked)
      // keeps an earlier "Needs another look" flag; rebuilding it must not clear one.
      const notChecked = new Set(Array.isArray(payload.meta?.notChecked) ? payload.meta.notChecked : []);
      const stillFlagged = (state.modelHypotheses ?? []).filter((p) => p?.evidenceStatus === NEEDS_REVIEW && notChecked.has(p.id)).map((p) => p.id);
      state.modelHypotheses = markNeedsReview(mergeHypotheses(state.modelHypotheses ?? [], next, {
        statements: state.patternStatements ?? [],
        activeLimit: 12,
        preserveExistingActive: rejected > 0
      }), [...needsReview, ...stillFlagged]);
      state.hypothesisAiMessage = needsReview.length ? CHECKED_NEEDS_REVIEW : UPDATED_MESSAGE;
      markChecked(state, key);
      announce("Taste Profile refreshed from your current evidence.");
    } else if (needsReview.length) {
      // #325: nothing new was accepted, but the evidence check itself completed and found confirmed
      // patterns it can't verify. That is a result, not a failed refresh: record it, say what changed,
      // and don't ask again until the evidence changes.
      state.modelHypotheses = markNeedsReview(state.modelHypotheses ?? [], needsReview);
      state.hypothesisAiMessage = CHECKED_NEEDS_REVIEW;
      markChecked(state, key);
      announce(CHECKED_NEEDS_REVIEW);
    } else {
      // A failed, paused or empty answer leaves the saved profile exactly as it was.
      markChecked(state, null);
      // The full explanation sits in the empty state (or the header badge) when AI is paused; this line stays short.
      state.hypothesisAiMessage = payload.meta?.budgetPaused
        ? ((state.modelHypotheses ?? []).length ? "AI is paused, so your patterns can’t update right now. They’re still here." : "AI is paused, so patterns can’t be built right now.")
        : (state.modelHypotheses ?? []).length
        ? "Tastemake couldn’t update your profile this time. Your existing patterns are still here."
        : "Tastemake couldn’t build a trustworthy profile this time. You can try again.";
    }
    state.hypothesisAiStatus = "ready";
  } catch {
    // An aborted or failed request for a profile that has since changed or been replaced is stale too.
    // (Not one this request already accepted: an error after that point is an ordinary failure.)
    if (!request.settled && profileRefreshStaleReason(state, request)) return settleStale(state, request, { onStale, onUpdate });
    if (state.hypothesisRequest === request) state.hypothesisRequest = null;
    state.hypothesisAiStatus = "ready";
    markChecked(state, null);
    state.hypothesisAiMessage = (state.modelHypotheses ?? []).length
      ? "Tastemake couldn’t update your profile this time. Your existing patterns are unchanged."
      : "Tastemake couldn’t build your profile this time. You can try again.";
  }
  onUpdate();
}
