import { visibleDomains } from "../data/domains.js";
import { contextQualifiedFor, excludedDomainsFor, statementFor } from "./statements.js";

// Interpretations are model-generated working hypotheses, never evidence. There is no built-in
// starting profile. User-confirmed corrections remain a stronger authority than inference.

export function domainScopeFromDomains(domains = [], excluded = []) {
  const visible = visibleDomains().map((domain) => domain.id);
  const supported = [...new Set(domains)].filter((domain) => visible.includes(domain) && !excluded.includes(domain));
  const untested = visible.filter((domain) => !supported.includes(domain) && !excluded.includes(domain));
  return { supported, contradicted: [], untested, excluded };
}

export function hypothesisRecord(state, pattern) {
  const said = statementFor(state, pattern.id);
  const excludedDomains = excludedDomainsFor(state, pattern.id);
  const scope = domainScopeFromDomains(pattern.domains ?? [], excludedDomains);
  return {
    id: pattern.id,
    title: pattern.title,
    claim: pattern.claim,
    source: "model",
    authority: said?.says === "accurate" ? "user-confirmed" : "inferred",
    userSays: said?.says ?? null,
    userWeight: said?.weight ?? null,
    excluded: said?.says === "not-me",
    evidence: pattern.supports ?? [],
    counter: pattern.counters ?? [],
    heldUp: [],
    scope,
    context: pattern.context ?? null,
    contextQualified: contextQualifiedFor(state, pattern.id),
    crossDomain: pattern.crossDomain ?? "untested",
    confidence: pattern.strength ?? "Emerging",
    conditional: pattern.status === "conditional",
    supersedes: null
  };
}

export function hypothesisRecords(state) {
  return (state.modelHypotheses ?? []).map((pattern) => hypothesisRecord(state, pattern));
}
