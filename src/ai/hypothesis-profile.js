import { serializeAiState } from "./live-client.js";
import { evidenceRecords } from "../model/evidence.js";
import { recordRevisionIfChanged } from "../model/history.js";

const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export function hypothesisEvidenceKey(state) {
  const evidence = evidenceRecords(state).map(({ ref, kind, polarity, weight, facts }) => ({ ref, kind, polarity, weight, facts }));
  const statements = (state.patternStatements ?? []).map(({ hypothesisId, says, weight, context, excludedDomains }) => ({ hypothesisId, says, weight, context, excludedDomains }));
  return JSON.stringify({ evidence, statements });
}

function normalizeHypothesis(h, index, state) {
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
    provenance: "Live AI interpretation, validated against your experienced evidence."
  };
}

export function mergeHypotheses(existing = [], incoming = [], { statements = [], activeLimit = 6, preserveExistingActive = true } = {}) {
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

  const activeById = new Map();
  for (const item of incoming) if (item?.id && !correctedIds.has(item.id)) activeById.set(item.id, item);
  if (preserveExistingActive) {
    for (const item of existing) {
      if (!item?.id || correctedIds.has(item.id) || activeById.has(item.id)) continue;
      activeById.set(item.id, item);
    }
  }
  return [...activeById.values()].slice(0, activeLimit).concat(corrected);
}

export async function refreshProfileHypotheses(state, { onUpdate = () => {}, announce = () => {}, force = false } = {}) {
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
      state.modelHypotheses = mergeHypotheses(state.modelHypotheses ?? [], next, {
        statements: state.patternStatements ?? [],
        activeLimit: 6,
        preserveExistingActive: rejected > 0
      });
      state.hypothesisAiMessage = "Your Taste Profile is up to date.";
      state.hypothesisAiKey = key;
      announce("Taste Profile refreshed from your current evidence.");
    } else {
      state.hypothesisAiKey = null;
      state.hypothesisAiMessage = (state.modelHypotheses ?? []).length
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
