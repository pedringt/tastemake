import { hypotheses } from "../data/catalog.js";
import { visibleDomains } from "../data/domains.js";
import { patternConfidence, patternEvidence } from "./tastemap.js";
import { statementFor } from "./statements.js";

// Interpretations (#35, #31): what Tastemake thinks the user's evidence may mean. They are working
// hypotheses, never facts about the user, and they are kept apart from evidence (evidence.js).
//
// Today the only interpretations are the fixed, hand-written starting patterns. A live model will add its
// own; they use the same shape, carry `source: "model"` and `authority: "inferred"`, and must cite evidence
// refs (`ev:<itemId>`) that exist. A user's own statement about a pattern outranks any inference (see
// docs/ai-readiness.md, "Pattern corrections"); that authority is `user-confirmed`.
//
// Shape (lean for v1, but it does not block anything #35 asks for):
//   id, title, claim
//   source         "starting-set" | "model"
//   authority      "inferred" | "user-confirmed"
//   evidence       refs of experienced evidence that backs it
//   counter        refs that count against it
//   heldUp         refs of misses the user said this pattern survived (Blind Spot)
//   scope          { supported: [domain], contradicted: [domain], untested: [domain] }
//   context        null until taste modes exist
//   crossDomain    "untested" | "tentative" | "supported"   (cross-domain links start as hypotheses)
//   confidence     the computed level (Emerging / Supported / Strong / Still learning / Less certain)
//   conditional    true when the pattern is known to hold only sometimes
//   supersedes     id of an earlier hypothesis this one refines, or null

const refOf = (row) => `ev:${row.item.id}`;

// Where the backing sits, by domain. Cross-domain status:
//   untested   backed in at most one domain
//   tentative  backed in two or more domains, but thinly (one item) in at least one of them
//   supported  backed by two or more items in each of two or more domains
export function domainScope(evidence) {
  const count = (rows) => {
    const byDomain = {};
    rows.forEach((row) => (row.item.domains ?? []).forEach((domain) => { byDomain[domain] = (byDomain[domain] ?? 0) + 1; }));
    return byDomain;
  };
  const pro = count(evidence.supports);
  const con = count(evidence.against);
  const all = visibleDomains().map((domain) => domain.id);
  const supported = all.filter((domain) => (pro[domain] ?? 0) > (con[domain] ?? 0));
  const contradicted = all.filter((domain) => (con[domain] ?? 0) > (pro[domain] ?? 0));
  const untested = all.filter((domain) => !pro[domain] && !con[domain]);
  const crossDomain = supported.length < 2 ? "untested" : supported.every((domain) => pro[domain] >= 2) ? "supported" : "tentative";
  return { scope: { supported, contradicted, untested }, crossDomain };
}

export function hypothesisRecord(state, pattern) {
  const evidence = patternEvidence(state, pattern);
  const { scope, crossDomain } = domainScope(evidence);
  const said = statementFor(state, pattern.id);
  return {
    id: pattern.id,
    title: pattern.title,
    claim: pattern.claim,
    source: pattern.source ?? "starting-set",
    // the user confirming it makes it user-confirmed; "not me" keeps it inferred but excluded
    authority: said?.says === "accurate" ? "user-confirmed" : pattern.authority ?? "inferred",
    userSays: said?.says ?? null,
    userWeight: said?.weight ?? null,
    excluded: said?.says === "not-me",
    evidence: evidence.supports.map(refOf),
    counter: evidence.against.map(refOf),
    heldUp: evidence.heldUp.map(refOf),
    scope,
    context: null,
    crossDomain,
    confidence: patternConfidence(state, pattern).level,
    conditional: pattern.status === "conditional",
    supersedes: null
  };
}

export function hypothesisRecords(state) {
  return hypotheses.map((pattern) => hypothesisRecord(state, pattern));
}
