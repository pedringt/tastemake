import { evidenceRecords } from "./evidence.js";
import { recordRevision } from "./history.js";

// Nov 4 (after #325): a pattern's `domains` is where Tastemake thinks it applies; the user's excluded areas
// (statement.excludedDomains) are applied on top, wherever the pattern is used. Before this fix, a refresh
// removed excluded areas from `domains` itself, so including an area again showed it as untested instead of
// supported. The server no longer does that (carryStored in src/ai/validate.js). This puts back an area that
// was removed that way, but only when the profile's own history shows it unambiguously:
//   1. the user excluded the area (a revision recorded by toggleDomainExclusion, src/model/statements.js);
//   2. the area is missing from the pattern now;
//   3. the last model revision before that exclusion listed the area, with the claim the pattern has now;
//   4. no model revision since has a different claim;
//   5. the pattern still cites a reaction in that area.
// Anything else is left exactly as it is. A restored area is recorded in the pattern's history. Running it
// again changes nothing (rule 2), so it is safe on every load and every restored backup.
const exclusionReason = (domainId) => `: marked as not applying to ${domainId}.`;

export function restoreNarrowedAreas(state) {
  const patterns = state.modelHypotheses ?? [];
  const history = state.hypothesisHistory ?? [];
  if (!patterns.length || !history.length) return [];
  const evidence = new Map(evidenceRecords(state).map((row) => [row.ref, row]));
  const restored = [];
  state.modelHypotheses = patterns.map((pattern) => {
    const revisions = history.filter((r) => r?.hypothesisId === pattern.id);
    const domains = [...(pattern.domains ?? [])];
    const cited = (pattern.supports ?? []).map((ref) => evidence.get(ref)).filter(Boolean);
    const candidates = [...new Set(revisions
      .filter((r) => r.origin === "user-confirmed" && typeof r.reason === "string")
      .map((r) => r.reason.match(/: marked as not applying to ([\w-]+)\.$/)?.[1])
      .filter(Boolean))];
    for (const domainId of candidates) {
      if (domains.includes(domainId)) continue;
      const lastExclusion = revisions.findLastIndex((r) => r.origin === "user-confirmed" && r.reason?.endsWith(exclusionReason(domainId)));
      const before = revisions.slice(0, lastExclusion).filter((r) => r.origin === "model").at(-1);
      if (!before || !(before.domains ?? []).includes(domainId) || before.claim !== pattern.claim) continue;
      if (revisions.slice(lastExclusion + 1).some((r) => r.origin === "model" && r.claim !== pattern.claim)) continue;
      if (!cited.some((row) => (row.domains ?? []).includes(domainId))) continue;
      domains.push(domainId);
      restored.push({ hypothesisId: pattern.id, domainId });
    }
    return domains.length === (pattern.domains ?? []).length ? pattern : { ...pattern, domains };
  });
  for (const { hypothesisId, domainId } of restored) {
    const pattern = state.modelHypotheses.find((p) => p.id === hypothesisId);
    recordRevision(state, {
      hypothesisId,
      claim: pattern.claim,
      supports: pattern.supports,
      counters: pattern.counters,
      domains: pattern.domains,
      level: pattern.strength,
      origin: "system",
      reason: `${pattern.title}: ${domainId} restored to where this pattern applies (it had been removed by mistake when you excluded it).`
    });
  }
  return restored;
}
