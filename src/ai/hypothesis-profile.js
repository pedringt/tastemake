import { serializeAiState } from "./live-client.js";
import { evidenceRecords } from "../model/evidence.js";
import { recordRevisionIfChanged } from "../model/history.js";

const slug = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export function hypothesisEvidenceKey(state) {
  const evidence = evidenceRecords(state).map(({ ref, kind, polarity, weight }) => ({ ref, kind, polarity, weight }));
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

export async function refreshProfileHypotheses(state, { onUpdate = () => {}, announce = () => {} } = {}) {
  const key = hypothesisEvidenceKey(state);
  if (state.hypothesisAiStatus === "loading" || state.hypothesisAiKey === key) return;

  state.hypothesisAiStatus = "loading";
  state.hypothesisAiMessage = "Checking what your actual experiences add up to.";
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
      state.modelHypotheses = next;
      state.hypothesisAiMessage = "Live AI refreshed these working patterns. Product rules checked every evidence citation.";
      announce("Taste Profile refreshed from your current evidence.");
    } else {
      state.hypothesisAiMessage = payload.reason || "The live profile interpreter is not enabled, so Tastemake is showing its deterministic starting patterns.";
    }
    state.hypothesisAiKey = key;
    state.hypothesisAiStatus = "ready";
  } catch {
    state.hypothesisAiStatus = "ready";
    state.hypothesisAiKey = key;
    state.hypothesisAiMessage = "The live profile interpreter was unavailable, so Tastemake kept the deterministic profile.";
  }
  onUpdate();
}
