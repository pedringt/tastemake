import { CIRCULAR_PATTERNS, CONTRACT_VERSION, CROSS_DOMAIN, GENRE_ONLY, IDENTITY_PATTERNS, LEVELS } from "./contract.js";
import { domainScope } from "../model/interpretations.js";
import { isAdultTagged, triedAdultTagged } from "../catalog/adult-content.mjs";

// The product's gate on model output (#31). Pure functions: (response, context) -> accepted / rejected.
//
// Context (built by the product, never by the model):
//   evidence     evidenceRecords(state): the only refs that exist
//   candidates   eligible pick items (not reacted to, area on, in the curated pool)
//   curveball    whether a curveball pick is allowed
//   statements   user-confirmed statements about patterns: [{ hypothesisId, label, says: "accurate" | "not-me" | null, weight }]
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

// Starter favorites make a pattern plausible as a starting point, but nothing the user tried has tested
// it yet (evidence-contract.md, "Emerging"). Only Loved / Liked / disliked reactions test a pattern, so
// the level and cross-domain caps below both count through this one filter.
export const triedRecords = (records) => records.filter((r) => r.kind !== "starter-favorite");

// The strongest level the cited evidence allows (evidence-contract.md, #26; mirrors patternConfidence in
// tastemap.js): "supported" needs at least one tried thing backing it and more backing it than against;
// "strong" needs 3+ tried things backing it, two clear of what counts against it. Starter favorites may
// still be cited as support, but a pattern resting only on them stays "emerging".
export function allowedLevel(supportRecords, counterRecords) {
  const tried = triedRecords(supportRecords).length;
  const against = counterRecords.length;
  if (tried >= 3 && tried - against >= 2) return "strong";
  if (tried >= 1 && tried > against) return "supported";
  return "emerging";
}
const capLevel = (claimed, allowed) => LEVELS[Math.min(LEVELS.indexOf(claimed), LEVELS.indexOf(allowed))];

const asRows = (records) => records.map((r) => ({ item: { id: r.itemId, domains: r.domains } }));

// #228: the furthest a cross-domain link may go. Docs (evidence-contract.md): "Emerging: a starting
// pattern. Nothing the user tried has tested it yet", and cross-domain links "must be supported by
// evidence in both areas, not assumed". Starter favorites make a pattern plausible as a starting
// point but do not test a link between areas, so only things the user tried (Loved / Liked / disliked
// reactions) count here. The eval (cold-4, starter-6: at most "untested"; cross-domain: one loved
// thing in each of two areas, at most "tentative") encodes the same rule.
export function allowedCrossDomain(supportRecords, counterRecords) {
  return domainScope({ supports: asRows(triedRecords(supportRecords)), against: asRows(counterRecords), heldUp: [] }).crossDomain;
}
const hypothesisAliases = (id) => id === "H01/H07" ? ["H01", "H07", "H01/H07"] : [id];
const sameHypothesis = (a, b) => hypothesisAliases(a).some((id) => hypothesisAliases(b).includes(id));

export function normalizeHypothesisResponse(response, ctx) {
  if (!response || !Array.isArray(response.hypotheses)) return response;

  const evidence = new Map((ctx.evidence ?? []).map((row) => [row.ref, row]));
  const contexts = new Set(ctx.contexts ?? []);
  const normalized = response.hypotheses.map((proposal) => {
    if (!proposal || typeof proposal !== "object") return proposal;

    const supports = Array.isArray(proposal.evidence)
      ? proposal.evidence
        .map((ref) => evidence.get(ref))
        .filter((row) => row?.class === "experienced" && row.polarity >= 0)
      : [];
    const counters = Array.isArray(proposal.counter)
      ? proposal.counter
        .map((ref) => evidence.get(ref))
        .filter((row) => row?.class === "experienced" && row.polarity < 0)
      : [];

    const { scope } = domainScope({
      supports: asRows(supports),
      against: asRows(counters),
      heldUp: []
    });
    const crossDomain = allowedCrossDomain(supports, counters);
    const claimedDomains = Array.isArray(proposal.domains) ? proposal.domains : [];
    const safeDomains = claimedDomains.filter((domain) => scope.supported.includes(domain));
    const safeCrossDomain = CROSS_DOMAIN.includes(proposal.crossDomain)
      ? CROSS_DOMAIN[Math.min(CROSS_DOMAIN.indexOf(proposal.crossDomain), CROSS_DOMAIN.indexOf(crossDomain))]
      : "untested";

    return {
      ...proposal,
      evidence: supports.map((row) => row.ref),
      counter: counters.map((row) => row.ref),
      domains: safeDomains.length ? safeDomains : scope.supported,
      crossDomain: safeCrossDomain,
      level: LEVELS.includes(proposal.level) ? proposal.level : "emerging",
      conditional: typeof proposal.conditional === "boolean" ? proposal.conditional : false,
      context: proposal.context && contexts.has(proposal.context) ? proposal.context : null
    };
  });

  return { ...response, hypotheses: normalized };
}

// #228: "One miss never weakens a pattern; two do" (evidence-contract.md, prototype-v1-spec.md). A
// refresh used to be free to return a whole new set, and the client keeps earlier patterns only when
// something in the new answer was rejected, so one disliked item could replace every pattern on the
// profile (the eval's single-miss fixture: 0 of 4-6 kept). Software now carries an earlier pattern
// forward when the model leaves it out and fewer than two things the user tried and disliked fall in
// that pattern's areas. A carried pattern is re-checked like any proposal (its evidence must still
// exist and support it, the level is re-capped, and a "not me" statement still removes it), so this
// never keeps something the evidence or the user has since ruled out.
export const MAX_PROFILE_HYPOTHESES = 12;
const MISSES_TO_DROP = 2;

function storedToProposal(stored) {
  const level = String(stored.strength ?? stored.level ?? "emerging").toLowerCase();
  return {
    id: stored.id,
    label: stored.title ?? stored.label,
    claim: stored.claim,
    evidence: stored.supports ?? stored.evidence ?? [],
    counter: stored.counters ?? stored.counter ?? [],
    domains: stored.domains ?? [],
    crossDomain: CROSS_DOMAIN.includes(stored.crossDomain) ? stored.crossDomain : "untested",
    level: LEVELS.includes(level) ? level : "emerging",
    conditional: stored.status === "conditional" || stored.conditional === true,
    context: stored.context ?? null,
    carriedForward: true
  };
}

export function preserveExistingHypotheses(response, ctx, existing = []) {
  if (!response || !Array.isArray(response.hypotheses) || !Array.isArray(existing) || !existing.length) return response;
  const proposed = response.hypotheses.filter((h) => h && typeof h === "object");
  const proposedIds = new Set(proposed.map((h) => h.id).filter(Boolean));
  const proposedLabels = new Set(proposed.map((h) => String(h.label ?? "").trim().toLowerCase()).filter(Boolean));
  const misses = (ctx.evidence ?? []).filter((r) => r.class === "experienced" && r.polarity < 0);
  const rejectedByUser = new Set((ctx.statements ?? []).filter((s) => s.says === "not-me").map((s) => s.hypothesisId));

  const carried = [];
  for (const stored of existing) {
    if (!stored?.id || !stored.claim || !(stored.title ?? stored.label)) continue;
    if (proposedIds.has(stored.id) || proposedLabels.has(String(stored.title ?? stored.label).trim().toLowerCase())) continue;
    if (rejectedByUser.has(stored.id)) continue;
    const domains = stored.domains ?? [];
    const missesInArea = misses.filter((r) => (r.domains ?? []).some((d) => domains.includes(d))).length;
    if (missesInArea >= MISSES_TO_DROP) continue;
    carried.push(storedToProposal(stored));
  }
  if (!carried.length) return response;

  const normalizedCarried = normalizeHypothesisResponse({ hypotheses: carried }, ctx).hypotheses;
  // Keep the profile within its usual size: brand-new proposals give way before earlier patterns do.
  const existingIds = new Set(existing.map((h) => h?.id).filter(Boolean));
  let hypotheses = [...response.hypotheses, ...normalizedCarried];
  for (let i = response.hypotheses.length - 1; hypotheses.length > MAX_PROFILE_HYPOTHESES && i >= 0; i -= 1) {
    if (!existingIds.has(response.hypotheses[i]?.id)) hypotheses = hypotheses.filter((h) => h !== response.hypotheses[i]);
  }
  return { ...response, hypotheses: hypotheses.slice(0, MAX_PROFILE_HYPOTHESES) };
}

// #256: a pattern that talks about *why* something worked or failed must use the reasons the user actually
// gave, on the items it cites, and keep each reason with its own dimension. Real case: "Characters" on one
// dislike and "Writing / prose: flat" on another became "a flat cast of characters". Terms map to the
// reason ids (src/model/refinements.js) they would have to come from.
const REASON_TERMS = [
  { re: /\bflat\b/i, ids: ["writing-prose:flat"] },
  { re: /\boverwritten\b|\bpurple prose\b/i, ids: ["writing-prose:overwritten"] },
  { re: /\btoo slow\b|\bslow[- ]paced\b|\bplodding\b/i, ids: ["pacing:too-slow"] },
  { re: /\brushed\b/i, ids: ["pacing:too-rushed"] },
  { re: /\buneven\b/i, ids: ["pacing:uneven"] },
  { re: /\bthin\b/i, ids: ["world-setting:too-thin"] },
  { re: /\bexposition\b|\binfo[- ]?dump/i, ids: ["world-setting:too-much-exposition"] },
  { re: /\bhard to follow\b|\bconfusing structure\b/i, ids: ["structure:hard-to-follow"] }
];
const DIMENSION_TERMS = [
  { dimension: "characters", re: /^(?:characters?|cast|protagonists?)$/i },
  { dimension: "writing-prose", re: /^(?:prose|writing|sentences?)$/i },
  { dimension: "pacing", re: /^pac(?:e|ing)$/i },
  { dimension: "structure", re: /^structure$/i },
  { dimension: "world-setting", re: /^(?:world|world-?building|setting|settings)$/i },
  { dimension: "story", re: /^(?:story|plot)$/i },
  { dimension: "humor", re: /^humou?r$/i }
];
// "even when other elements vary", "regardless of", "no matter": a general rule, which a couple of items
// cannot show. Not a rejection (the pattern may still be right, and the user may have confirmed it); the
// pattern is kept but marked conditional, with a note.
const OVERREACH = /\beven when\b|\bregardless of\b|\bno matter\b|\balways\b/i;

function reasonProblems(h, cited) {
  const problems = [];
  const given = new Set(cited.flatMap((row) => (row.refinements ?? []).map((r) => (typeof r === "string" ? r : r?.id))));
  const tokens = h.claim.split(/\s+/).map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""));
  for (const term of REASON_TERMS) {
    const match = h.claim.match(term.re);
    if (!match) continue;
    if (!term.ids.some((id) => given.has(id))) {
      problems.push(`describes a reason ("${match[0]}") that no cited item carries`);
      continue;
    }
    // The dimension word nearest the reason word (within five words) must be that reason's own dimension.
    const at = h.claim.slice(0, match.index).split(/\s+/).length - 1;
    let nearest = null;
    tokens.forEach((token, index) => {
      const hit = DIMENSION_TERMS.find((d) => d.re.test(token));
      const distance = Math.abs(index - at);
      if (hit && distance <= 5 && (!nearest || distance < nearest.distance)) nearest = { dimension: hit.dimension, distance };
    });
    const own = term.ids.map((id) => id.split(":")[0]);
    if (nearest && !own.includes(nearest.dimension)) problems.push(`pairs "${match[0]}" with ${nearest.dimension}, but the user said it about ${own.join(" / ")}`);
  }
  return problems;
}

const overreaches = (h) => OVERREACH.test(h.claim) && (h.evidence?.length ?? 0) < 3;

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
      reasons.push(...reasonProblems(h, [...supports, ...counters]));
    }
    if (IDENTITY_PATTERNS.some((re) => re.test(`${h.label} ${h.claim}`))) reasons.push("states a single identity or aesthetic about the user");
    if (GENRE_ONLY.test(h.claim.trim()) || h.claim.trim().split(/\s+/).length < 6) reasons.push("genre-only or too generic to test");
    if (h.context && !(ctx.contexts ?? []).includes(h.context)) reasons.push("invents a context the user never gave");
    const statement = (ctx.statements ?? []).find((s) => s.says === "not-me" && (s.hypothesisId === h.id || (s.label && s.label.toLowerCase() === h.label.toLowerCase())));
    if (statement) reasons.push("the user said this pattern is not them (user-confirmed outranks inference)");
    // #36: a narrower "not in {domain}" correction outranks inference the same way a full "not me" does,
    // just scoped to that one domain rather than the whole pattern.
    const scopedStatement = (ctx.statements ?? []).find((s) => (s.excludedDomains ?? []).length && (s.hypothesisId === h.id || (s.label && s.label.toLowerCase() === h.label.toLowerCase())));
    const excludedDomainsClaimed = scopedStatement ? h.domains.filter((d) => scopedStatement.excludedDomains.includes(d)) : [];
    if (excludedDomainsClaimed.length) reasons.push(`claims domains the user said this pattern is not them in: ${excludedDomainsClaimed.join(", ")}`);
    // #36 v1: "only applies in some contexts" caps confidence the same way the product caps it from
    // evidence alone (below) — the model cannot claim Strong for a pattern the user says isn't universal.
    const contextQualified = (ctx.statements ?? []).some((s) => s.context === "some" && (s.hypothesisId === h.id || (s.label && s.label.toLowerCase() === h.label.toLowerCase())));
    const key = h.label.trim().toLowerCase();
    if (seenLabels.has(key)) reasons.push("duplicate of another hypothesis in this response");

    if (!reasons.length) {
      // domains claimed must each have cited support there; cross-domain status is capped by the evidence
      const { scope } = domainScope({ supports: asRows(supports), against: asRows(counters), heldUp: [] });
      const crossDomain = allowedCrossDomain(supports, counters);
      const unsupportedDomains = h.domains.filter((d) => !scope.supported.includes(d));
      if (unsupportedDomains.length) reasons.push(`claims domains with no cited support: ${unsupportedDomains.join(", ")}`);
      if (CROSS_DOMAIN.indexOf(h.crossDomain) > CROSS_DOMAIN.indexOf(crossDomain)) reasons.push(`cross-domain overreach: claimed ${h.crossDomain}, evidence shows ${crossDomain}`);
      if (!reasons.length) {
        // the same thresholds as the Taste Profile (#26); the product owns them, not the model
        const evidenceAllows = allowedLevel(supports, counters);
        const allowed = contextQualified ? capLevel(evidenceAllows, "supported") : evidenceAllows;
        const level = capLevel(h.level, allowed);
        if (level !== h.level) {
          const why = contextQualified && allowed !== evidenceAllows ? "the user said this only applies in some contexts" : `evidence allows ${allowed}`;
          notes.push(`"${h.label}": level lowered from ${h.level} to ${level} (${why})`);
        }
        const conditional = h.conditional || overreaches(h);
        if (conditional && !h.conditional) notes.push(`"${h.label}": marked conditional (states a general rule, "${h.claim.match(OVERREACH)[0]}", from fewer than three items)`);
        seenLabels.add(key);
        accepted.push({ ...h, level, conditional, scope, crossDomain: h.crossDomain, authority: "inferred", source: "model", contract: CONTRACT_VERSION });
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
  const evidenceUse = new Map();
  let curveballs = 0;
  for (const p of response.picks) {
    const reasons = checkShape(p, { itemId: "string", why: "string", cites: "refs", tests: "nullable-string", kind: "enum:kind" });
    if (!reasons.length) {
      if (!candidates.has(p.itemId)) reasons.push("not one of the eligible candidates (invented, already reacted to, or area off)");
      if (used.has(p.itemId)) reasons.push("duplicate pick");
      const candidate = candidates.get(p.itemId);
      if (candidate && p.tests && !(candidate.hypotheses ?? []).some((id) => sameHypothesis(id, p.tests))) reasons.push("tests a pattern that is not attached to this candidate");
      const rejectedStatement = p.tests && (ctx.statements ?? []).find((x) => x.says === "not-me" && sameHypothesis(x.hypothesisId, p.tests));
      if (rejectedStatement) reasons.push("tests a pattern the user said is not them (user-confirmed outranks inference)");
      const cited = p.cites.map((ref) => evidence.get(ref));
      if (!cited.length) reasons.push("no evidence cited");
      else if (cited.some((r) => !r)) reasons.push("cites evidence that does not exist");
      // Real bug (QA sweep, 2026-09-28): this used .every(), so a pick citing one experienced item
      // plus one intent-only item (a bookmark, an untried reaction) still passed -- the ai-contract
      // rule ("Support cites intent -> Rejected: interest is not experience") is an outright ban on
      // citing intent as support, not a majority-vote. validateHypotheses already gets this right
      // with .some() at line 73; this brings picks in line with the same rule.
      else if (cited.some((r) => r.class !== "experienced")) reasons.push("cites intent (not something experienced), which can never count as support");
      else if (!cited.some((r) => r.polarity > 0)) reasons.push("cites no positive experienced evidence; dislikes can only be contrast, not the reason a pick fits");
      else {
        const negativeTitles = cited.filter((r) => r.polarity < 0).map((r) => String(r.title ?? "").trim()).filter(Boolean);
        const mentionsNegativeTitle = negativeTitles.some((title) => p.why.toLowerCase().includes(title.toLowerCase()));
        if (mentionsNegativeTitle && !/\b(despite|unlike|contrast|rather than|while|although|but)\b/i.test(p.why)) {
          reasons.push("uses a disliked item as the positive rationale instead of explicit contrast");
        }
        for (const ref of new Set(p.cites)) {
          const record = evidence.get(ref);
          if (record?.polarity < 0 && (evidenceUse.get(ref) ?? 0) >= 1) {
            reasons.push("reuses the same disliked item across multiple picks");
          }
        }
      }
      if (CIRCULAR_PATTERNS.some((re) => re.test(p.why))) reasons.push("circular reasoning");
      if (IDENTITY_PATTERNS.some((re) => re.test(p.why))) reasons.push("states a single identity or aesthetic about the user");
      if (p.kind === "curveball") {
        if (ctx.curveball === false) reasons.push("curveball is turned off");
        else if (curveballs >= 1) reasons.push("more than one curveball");
        else if (isAdultTagged(candidate) && !triedAdultTagged(ctx.evidence)) reasons.push("curveball into explicitly adult-tagged content the user has not tried (#257)");
      }
    }
    if (reasons.length) { rejected.push({ proposal: p, reasons }); continue; }
    used.add(p.itemId);
    for (const ref of new Set(p.cites)) evidenceUse.set(ref, (evidenceUse.get(ref) ?? 0) + 1);
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
