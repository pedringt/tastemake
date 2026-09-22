import { CIRCULAR_PATTERNS, CONTRACT_VERSION, CROSS_DOMAIN, GENRE_ONLY, IDENTITY_PATTERNS, LEVELS } from "./contract.js";
import { domainScope } from "../model/interpretations.js";

// The product's gate on model output (#31). Pure functions: (response, context) -> accepted / rejected.
//
// Context (built by the product, never by the model):
//   evidence     evidenceRecords(state): the only refs that exist
//   candidates   eligible pick items (not reacted to, area on, in the curated pool)
//   curveball    whether a curveball pick is allowed
//   statements   user-confirmed statements about patterns: [{ label or hypothesisId, says: "not-me" | ... }]
//
// Everything accepted is stamped by the product: authority "inferred", source "model", the contract version,
// and a level capped at what the cited evidence allows. A model can never mark anything user-confirmed.

const isRef = (value) => typeof value === "string" && /^ev:[\w-]+$/.test(value);

function checkShape(obj, fields) {
  const problems = [];
  if (!obj || typeof obj !== "object") return ["not an object"];
  for (const [key, kind] of Object.entries(fields)) {
    const value = obj[key];
    if (kind === "string" && (typeof value !== "string" || !value.trim())) problems.push(`${key} missing`);
    if (kind === "nullable-string" && value != null && typeof value !== "string") problems.push(`${key} not a string`);
    if (kind === "boolean" && value != null && typeof value !== "boolean") problems.push(`${key} not true/false`);
    if (kind === "refs" && (!Array.isArray(value) || !value.every(isRef))) problems.push(`${key} not a list of evidence refs`);
    if (kind === "strings" && (!Array.isArray(value) || !value.every((v) => typeof v === "string"))) problems.push(`${key} not a list`);
    if (kind === "enum:level" && !LEVELS.includes(value)) problems.push(`level "${value}" not one of ${LEVELS.join("/")}`);
    if (kind === "enum:crossDomain" && !CROSS_DOMAIN.includes(value)) problems.push(`crossDomain "${value}" not one of ${CROSS_DOMAIN.join("/")}`);
    if (kind === "enum:kind" && !["pick", "curveball"].includes(value)) problems.push(`kind "${value}" not pick/curveball`);
  }
  return problems;
}

// The strongest level the cited evidence allows (mirrors patternConfidence in tastemap.js):
//   starter favorites alone never go above "emerging"; "strong" needs 3+ tried things backing it,
//   two clear of what counts against it.
export function allowedLevel(supportRecords, counterRecords) {
  const tried = supportRecords.filter((r) => r.kind !== "starter-favorite").length;
  const against = counterRecords.length;
  if (tried >= 3 && tried - against >= 2) return "strong";
  if (tried >= 1 && tried > against) return "supported";
  return "emerging";
}
const capLevel = (claimed, allowed) => LEVELS[Math.min(LEVELS.indexOf(claimed), LEVELS.indexOf(allowed))];

const asRows = (records) => records.map((r) => ({ item: { id: r.itemId, domains: r.domains } }));

export function validateHypotheses(response, ctx) {
  const evidence = new Map((ctx.evidence ?? []).map((r) => [r.ref, r]));
  const accepted = [];
  const rejected = [];
  const notes = [];

  if (!response || !Array.isArray(response.hypotheses)) {
    return { ok: false, accepted, rejected, notes: ["response is not { hypotheses: [...] }"], fallback: true };
  }
  if (response.insufficientEvidence === true && response.hypotheses.length === 0) {
    return { ok: true, accepted, rejected, notes: ["model said there is not enough evidence yet"], fallback: true };
  }

  const seenLabels = new Set();
  for (const h of response.hypotheses) {
    const reasons = checkShape(h, { label: "string", claim: "string", evidence: "refs", counter: "refs", domains: "strings", crossDomain: "enum:crossDomain", level: "enum:level", conditional: "boolean", context: "nullable-string" });
    if (reasons.length) { rejected.push({ proposal: h, reasons }); continue; }

    const supports = h.evidence.map((ref) => evidence.get(ref));
    const counters = h.counter.map((ref) => evidence.get(ref));
    if (supports.some((r) => !r) || counters.some((r) => !r)) reasons.push("cites evidence that does not exist");
    else {
      if (!supports.length) reasons.push("no supporting evidence cited");
      if (supports.some((r) => r.class !== "experienced")) reasons.push("uses intent (bookmark / untried reaction / not interested) as taste evidence");
      if (supports.some((r) => r.polarity < 0)) reasons.push("cites something the user disliked as support (contradicts explicit evidence)");
      if (counters.some((r) => r.class !== "experienced" || r.polarity >= 0)) reasons.push("counter-evidence must be things the user tried and disliked");
    }
    if (IDENTITY_PATTERNS.some((re) => re.test(`${h.label} ${h.claim}`))) reasons.push("states a single identity or aesthetic about the user");
    if (GENRE_ONLY.test(h.claim.trim()) || h.claim.trim().split(/\s+/).length < 6) reasons.push("genre-only or too generic to test");
    if (h.context && !(ctx.contexts ?? []).includes(h.context)) reasons.push("invents a context the user never gave");
    const statement = (ctx.statements ?? []).find((s) => s.says === "not-me" && (s.hypothesisId === h.id || (s.label && s.label.toLowerCase() === h.label.toLowerCase())));
    if (statement) reasons.push("the user said this pattern is not them (user-confirmed outranks inference)");
    const key = h.label.trim().toLowerCase();
    if (seenLabels.has(key)) reasons.push("duplicate of another hypothesis in this response");

    if (!reasons.length) {
      // domains claimed must each have cited support there; cross-domain status is capped by the evidence
      const { scope, crossDomain } = domainScope({ supports: asRows(supports), against: asRows(counters), heldUp: [] });
      const unsupportedDomains = h.domains.filter((d) => !scope.supported.includes(d));
      if (unsupportedDomains.length) reasons.push(`claims domains with no cited support: ${unsupportedDomains.join(", ")}`);
      if (CROSS_DOMAIN.indexOf(h.crossDomain) > CROSS_DOMAIN.indexOf(crossDomain)) reasons.push(`cross-domain overreach: claimed ${h.crossDomain}, evidence shows ${crossDomain}`);
      if (!reasons.length) {
        // the same thresholds as the Taste Profile (#26); the product owns them, not the model
        const allowed = allowedLevel(supports, counters);
        const level = capLevel(h.level, allowed);
        if (level !== h.level) notes.push(`"${h.label}": level lowered from ${h.level} to ${level} (evidence allows ${allowed})`);
        seenLabels.add(key);
        accepted.push({ ...h, level, scope, crossDomain: h.crossDomain, authority: "inferred", source: "model", contract: CONTRACT_VERSION });
        continue;
      }
    }
    rejected.push({ proposal: h, reasons });
  }
  return { ok: accepted.length > 0, accepted, rejected, notes, fallback: accepted.length === 0 };
}

export function validatePicks(response, ctx) {
  const evidence = new Map((ctx.evidence ?? []).map((r) => [r.ref, r]));
  const candidates = new Map((ctx.candidates ?? []).map((item) => [item.id, item]));
  const accepted = [];
  const rejected = [];
  if (!response || !Array.isArray(response.picks)) {
    return { ok: false, accepted, rejected, notes: ["response is not { picks: [...] }"], fallback: true };
  }
  const used = new Set();
  let curveballs = 0;
  for (const p of response.picks) {
    const reasons = checkShape(p, { itemId: "string", why: "string", cites: "refs", tests: "nullable-string", kind: "enum:kind" });
    if (!reasons.length) {
      if (!candidates.has(p.itemId)) reasons.push("not one of the eligible candidates (invented, already reacted to, or area off)");
      if (used.has(p.itemId)) reasons.push("duplicate pick");
      const cited = p.cites.map((ref) => evidence.get(ref));
      if (!cited.length) reasons.push("no evidence cited");
      else if (cited.some((r) => !r)) reasons.push("cites evidence that does not exist");
      else if (cited.every((r) => r.class !== "experienced")) reasons.push("rests only on intent, not on anything the user experienced");
      if (CIRCULAR_PATTERNS.some((re) => re.test(p.why))) reasons.push("circular reasoning");
      if (IDENTITY_PATTERNS.some((re) => re.test(p.why))) reasons.push("states a single identity or aesthetic about the user");
      if (p.kind === "curveball") {
        if (ctx.curveball === false) reasons.push("curveball is turned off");
        else if (curveballs >= 1) reasons.push("more than one curveball");
      }
    }
    if (reasons.length) { rejected.push({ proposal: p, reasons }); continue; }
    used.add(p.itemId);
    if (p.kind === "curveball") curveballs += 1;
    accepted.push({ ...p, item: candidates.get(p.itemId), authority: "inferred", source: "model", contract: CONTRACT_VERSION });
  }
  return { ok: accepted.length > 0, accepted, rejected, notes: [], fallback: accepted.length === 0 };
}

// Conservative failure: when a model call errors, times out, or too little survives validation,
// use the deterministic result and say so. `minAccepted` is how many valid items make a usable answer.
export function acceptOrFallback(result, deterministic, { minAccepted = 1, error = null } = {}) {
  if (error) return { source: "deterministic", items: deterministic, reason: `model unavailable: ${error}` };
  if (!result || result.accepted.length < minAccepted) {
    return { source: "deterministic", items: deterministic, reason: result?.notes?.[0] ?? `only ${result?.accepted.length ?? 0} valid item(s) from the model` };
  }
  return { source: "model", items: result.accepted, reason: null, rejected: result.rejected.length };
}
