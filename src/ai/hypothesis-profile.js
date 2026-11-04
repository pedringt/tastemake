import { serializeAiState } from "./live-client.js";
import { evidenceRecords } from "../model/evidence.js";
import { recordRevisionIfChanged } from "../model/history.js";
import { noteAiAnswer } from "./ai-status.js";
import { NEEDS_REVIEW, confirmationFor } from "../model/statements.js";

const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export function hypothesisEvidenceKey(state) {
  const evidence = evidenceRecords(state).map(({ ref, kind, polarity, weight, facts, refinements }) => ({ ref, kind, polarity, weight, facts, refinements }));
  const statements = (state.patternStatements ?? []).map(({ hypothesisId, says, weight, context, excludedDomains }) => ({ hypothesisId, says, weight, context, excludedDomains }));
  return JSON.stringify({ evidence, statements });
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
export function markNeedsReview(patterns = [], needsReview = []) {
  const ids = new Set(needsReview ?? []);
  if (!ids.size) return patterns;
  return patterns.map((p) => (ids.has(p?.id) ? { ...p, evidenceStatus: NEEDS_REVIEW } : p));
}

export async function refreshProfileHypotheses(state, { onUpdate = () => {}, announce = () => {}, force = false } = {}) {
  if (state.viewingExample) return;   // the example's patterns are fixed; no model calls on its behalf
  const key = hypothesisEvidenceKey(state);
  if (state.hypothesisAiStatus === "loading" || (!force && state.hypothesisAiKey === key)) return;

  state.hypothesisAiStatus = "loading";
  state.hypothesisAiMessage = (state.modelHypotheses ?? []).length
    ? "Refreshing your Taste Profile…"
    : "Building your Taste Profile…";
  onUpdate();

  try {
    const bodyState = { ...serializeAiState(state), modelHypotheses: state.modelHypotheses ?? [] };
    const response = await fetch("/api/hypotheses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: bodyState })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(payload?.error || "profile request failed");

    noteAiAnswer(state, { budgetPaused: Boolean(payload.meta?.budgetPaused), usedModel: payload.source === "model" });
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
      state.modelHypotheses = markNeedsReview(mergeHypotheses(state.modelHypotheses ?? [], next, {
        statements: state.patternStatements ?? [],
        activeLimit: 12,
        preserveExistingActive: rejected > 0
      }), payload.meta?.needsReview);
      state.hypothesisAiMessage = "Your Taste Profile is up to date.";
      state.hypothesisAiKey = key;
      announce("Taste Profile refreshed from your current evidence.");
    } else {
      // Nothing was accepted, but the check may still have found confirmed patterns it can't verify.
      if (payload.meta?.needsReview?.length) state.modelHypotheses = markNeedsReview(state.modelHypotheses ?? [], payload.meta.needsReview);
      state.hypothesisAiKey = null;
      // The full explanation sits in the empty state (or the header badge) when AI is paused; this line stays short.
      state.hypothesisAiMessage = payload.meta?.budgetPaused
        ? ((state.modelHypotheses ?? []).length ? "AI is paused, so your patterns can’t update right now. They’re still here." : "AI is paused, so patterns can’t be built right now.")
        : (state.modelHypotheses ?? []).length
        ? "Tastemake couldn’t update your profile this time. Your existing patterns are still here."
        : "Tastemake couldn’t build a trustworthy profile this time. You can try again.";
    }
    state.hypothesisAiStatus = "ready";
  } catch {
    state.hypothesisAiStatus = "ready";
    state.hypothesisAiKey = null;
    state.hypothesisAiMessage = (state.modelHypotheses ?? []).length
      ? "Tastemake couldn’t update your profile this time. Your existing patterns are unchanged."
      : "Tastemake couldn’t build your profile this time. You can try again.";
  }
  onUpdate();
}
