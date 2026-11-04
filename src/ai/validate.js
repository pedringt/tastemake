import { CIRCULAR_PATTERNS, CONTRACT_VERSION, CROSS_DOMAIN, GENRE_ONLY, IDENTITY_PATTERNS, LEVELS } from "./contract.js";
import { allowedCrossDomain, allowedLevel, capLevel, domainScope, evidenceRows, triedRecords } from "../model/evidence-rules.js";
import { confirmationFor } from "../model/statements.js";
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

// The evidence rules (level, areas, cross-domain) live in src/model/evidence-rules.js so the browser's
// reconfirmation applies exactly the same ones; re-exported here so existing imports keep working.
export { allowedCrossDomain, allowedLevel, triedRecords };
const asRows = evidenceRows;
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
// refresh used to be free to return a whole new set, and the client kept earlier patterns only when
// something in the new answer was rejected, so one disliked item could replace every pattern on the
// profile (the eval's single-miss fixture: 0 of 4-6 kept). Software carries an earlier pattern forward
// when the model leaves it out. A carried pattern is re-checked like any proposal (its evidence must
// still exist and support it, the level is re-capped by the evidence, and a "not me" statement still
// removes it), so this never presents something the evidence or the user has since ruled out.
//
// #325: the #228 rule dropped a pattern once two dislikes merely shared one of its media, cited
// against it or not, and never looked at what the user had said. Now:
//   - a pattern the user confirmed ("accurate" or "partly") is always carried, and never trimmed by the
//     profile cap; settleConfirmedHypotheses (below) makes sure it is either accepted or reported for
//     review, never silently lost;
//   - an unconfirmed pattern is carried too. Dislikes alone never retire it: sharing a medium is not
//     contradiction, and a cited dislike is not proof either. contradictedByEvidence is where a real
//     contradiction check (#278) will plug in;
//   - areas the user excluded (#36) are taken off a carried pattern instead of failing it. A confirmed
//     pattern with every area excluded is a scope correction, not an evidence failure: it is left out of
//     the refresh entirely (not carried, not flagged, any model version of it dropped), and the client
//     keeps it exactly as stored until the user includes an area again;
//   - a confirmed pattern's identity, name and claim are frozen until the user changes or clears their
//     answer, so a confirmation never transfers to a different interpretation. A model version of it
//     (same id, or same name under a new id) is used only when it keeps the same id, name and claim,
//     which is how the prompt asks for existing patterns back; then its evidence is checked against the
//     confirmed claim like any proposal. Anything else is replaced by the stored version. There is no
//     check of meaning here (#278, #318).
export const MAX_PROFILE_HYPOTHESES = 12;

// #278 decides what genuinely contradicts a pattern. Until then nothing retires one automatically.
function contradictedByEvidence(_stored, _ctx) {
  return false;
}

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

const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const storedLabel = (stored) => text(stored?.title ?? stored?.label);
const isStoredPattern = (stored) => Boolean(stored?.id && stored.claim && (stored.title ?? stored.label));

function excludedAreas(stored, ctx) {
  const label = storedLabel(stored);
  return (ctx.statements ?? []).find((s) => (s.excludedDomains ?? []).length && (s.hypothesisId === stored.id || (s.label && text(s.label) === label)))?.excludedDomains ?? [];
}

function everyAreaExcluded(stored, ctx) {
  const domains = stored.domains ?? [];
  const excluded = excludedAreas(stored, ctx);
  return domains.length > 0 && domains.every((d) => excluded.includes(d));
}

// Nov 4 (after #325): a stored pattern keeps its own areas (still capped to what its evidence supports).
// The user's excluded areas are applied wherever the pattern is used, never written into it: removing
// them here made "include this area again" come back as untested instead of supported.
// src/model/area-scope.js restores areas already removed this way.
function carryStored(stored, ctx) {
  const [proposal] = normalizeHypothesisResponse({ hypotheses: [storedToProposal(stored)] }, ctx).hypotheses;
  return proposal;
}

// A confirmed pattern's areas come from what was stored, plus any the model's identical version adds;
// never narrowed by the user's exclusions (which the model was told about, so its copy may leave them out).
function keepStoredAreas(h, stored, ctx) {
  return { ...h, domains: [...new Set([...carryStored(stored, ctx).domains, ...(h.domains ?? [])])], carriedForward: true };
}

export function preserveExistingHypotheses(response, ctx, existing = []) {
  if (!response || !Array.isArray(response.hypotheses) || !Array.isArray(existing) || !existing.length) return response;
  const rejectedByUser = new Set((ctx.statements ?? []).filter((s) => s.says === "not-me").map((s) => s.hypothesisId));
  const confirmed = (h) => Boolean(confirmationFor(ctx.statements, h));
  const confirmedStored = existing.filter((stored) => isStoredPattern(stored) && confirmed(stored));
  const confirmedFor = (h) => confirmedStored.find((stored) => h?.id === stored.id || (text(h?.label) && text(h.label) === storedLabel(stored)));

  // A model version of a confirmed pattern: kept only when it is the same pattern, word for word.
  const answered = new Set();
  const proposals = [];
  for (const h of response.hypotheses) {
    const stored = h && typeof h === "object" ? confirmedFor(h) : null;
    if (!stored) { proposals.push(h); continue; }
    if (answered.has(stored.id) || everyAreaExcluded(stored, ctx)) continue;
    answered.add(stored.id);
    const same = h.id === stored.id && text(h.label) === storedLabel(stored) && text(h.claim) === text(stored.claim);
    proposals.push(same ? keepStoredAreas(h, stored, ctx) : carryStored(stored, ctx));
  }

  const proposed = proposals.filter((h) => h && typeof h === "object");
  const proposedIds = new Set(proposed.map((h) => h.id).filter(Boolean));
  const proposedLabels = new Set(proposed.map((h) => text(h.label)).filter(Boolean));
  const carried = [];
  for (const stored of existing) {
    if (!isStoredPattern(stored)) continue;
    if (proposedIds.has(stored.id) || proposedLabels.has(storedLabel(stored))) continue;
    if (rejectedByUser.has(stored.id)) continue;
    if (confirmed(stored) ? everyAreaExcluded(stored, ctx) : contradictedByEvidence(stored, ctx)) continue;
    carried.push(carryStored(stored, ctx));
  }

  // Keep the profile within its usual size. Confirmed patterns never count against the cap; the rest
  // of the room goes to earlier patterns first, then to brand-new proposals.
  const existingIds = new Set(existing.map((h) => h?.id).filter(Boolean));
  const hypotheses = [...proposals, ...carried];
  const unconfirmed = hypotheses.filter((h) => !confirmed(h));
  const room = Math.max(0, MAX_PROFILE_HYPOTHESES - (hypotheses.length - unconfirmed.length));
  const kept = new Set([...unconfirmed.filter((h) => existingIds.has(h?.id)), ...unconfirmed.filter((h) => !existingIds.has(h?.id))].slice(0, room));
  return { ...response, hypotheses: hypotheses.filter((h) => confirmed(h) || kept.has(h)) };
}

// #325: run after validateHypotheses. A pattern the user confirmed must come out of a refresh either
// accepted or listed in needsReview, never silently dropped. When the model's own version of it failed
// the check, the stored version is checked instead, so a bad revision cannot replace what the user
// confirmed. When the stored version fails too (say a reaction it rested on was removed), it is not
// presented as supported: its id goes in needsReview and the client keeps it, flagged, with the user's
// answer untouched. A confirmed pattern with every area excluded is neither: the client keeps it as stored.
//
// Nov 4 (after #325): evidence a confirmed pattern cites is in one of three states.
//   - validated: sent with this request (in ctx.evidence) and checked as usual;
//   - not checked: the client still has it but didn't send it (ctx.presentRefs, payload limit);
//   - invalid: neither, so the reaction was removed or no longer counts.
// Only validated evidence is checked or counted.
//   - Not-checked refs are kept on the pattern as they were, but never raise its level: when any are involved
//     the level is capped at the stored one. Every confirmed pattern with not-checked evidence is listed in
//     notChecked, accepted or not, and the client keeps an earlier "Needs another look" flag on it: only a
//     check of all its evidence clears one. One that can't pass on its validated evidence alone, with nothing
//     invalid, is not accepted either, so the client keeps it exactly as stored.
//   - A supporting reaction that is invalid (removed) always means needsReview, even when the rest of the
//     evidence still passes: the pattern may be accepted on what remains, but it is flagged, never silently
//     treated as the same confirmed interpretation. A removed counter-example doesn't weaken it, so it
//     doesn't count.
//   - The removed reaction stays cited on the pattern, so a later refresh still finds it missing and the flag
//     stays (Paige, PR #328 review). It clears only when the reaction is back and the check passes, or when
//     the user confirms the pattern still fits without it (reconfirmPattern, src/model/statements.js, which
//     drops the missing citation and makes no model call).
// A client that sends no presentRefs has no not-checked evidence.
function evidenceStates(stored, ctx) {
  const sent = new Set((ctx.evidence ?? []).map((row) => row.ref));
  const present = new Set(ctx.presentRefs ?? []);
  const supports = stored.supports ?? stored.evidence ?? [];
  const refs = [...supports, ...(stored.counters ?? stored.counter ?? [])];
  return {
    notChecked: refs.filter((ref) => !sent.has(ref) && present.has(ref)),
    invalid: supports.filter((ref) => !sent.has(ref) && !present.has(ref))
  };
}

// Puts back on an accepted confirmed pattern what the check couldn't use: not-checked refs, and removed
// supporting reactions (so the flag holds). Neither counts toward its level, which is capped at the stored one.
function keepStoredEvidence(h, stored, ctx) {
  const { notChecked, invalid } = evidenceStates(stored, ctx);
  const kept = [...notChecked, ...invalid];
  if (!kept.length) return h;
  const storedSupports = new Set(stored.supports ?? stored.evidence ?? []);
  const add = (list, wanted) => [...list, ...kept.filter((ref) => wanted(ref) && !list.includes(ref))];
  const storedLevel = String(stored.strength ?? stored.level ?? "emerging").toLowerCase();
  return {
    ...h,
    evidence: add(h.evidence ?? [], (ref) => storedSupports.has(ref)),
    counter: add(h.counter ?? [], (ref) => !storedSupports.has(ref)),
    level: LEVELS.includes(storedLevel) ? capLevel(h.level, storedLevel) : h.level
  };
}

export function settleConfirmedHypotheses(validated, ctx, existing = []) {
  if (!validated || !Array.isArray(existing) || !existing.length) return { ...validated, needsReview: [], notChecked: [] };
  const accepted = [...(validated.accepted ?? [])];
  const needsReview = [];
  const notChecked = [];
  for (const stored of existing) {
    if (!isStoredPattern(stored) || !confirmationFor(ctx.statements, stored) || everyAreaExcluded(stored, ctx)) continue;
    const states = evidenceStates(stored, ctx);
    if (states.notChecked.length) notChecked.push(stored.id);
    if (states.invalid.length) needsReview.push(stored.id);
    const at = accepted.findIndex((h) => h.id === stored.id || text(h.label) === storedLabel(stored));
    if (at >= 0) { accepted[at] = keepStoredEvidence(accepted[at], stored, ctx); continue; }
    const retry = validateHypotheses({ hypotheses: [carryStored(stored, ctx)] }, ctx);
    if (retry.accepted.length) accepted.push(...retry.accepted.map((h) => keepStoredEvidence(h, stored, ctx)));
    else if (!states.invalid.length && !states.notChecked.length) needsReview.push(stored.id);
  }
  return { ...validated, accepted, ok: accepted.length > 0, fallback: accepted.length === 0, needsReview, notChecked };
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
    // A pattern carried forward from what was stored keeps its own areas; the exclusion is applied where it
    // is used (Nov 4, carryStored). A new claim from the model still may not claim an excluded area.
    const excludedDomainsClaimed = scopedStatement && !h.carriedForward ? h.domains.filter((d) => scopedStatement.excludedDomains.includes(d)) : [];
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
      // #1b: when software knows which ratings decided this candidate (ctx.basis, from selectionBasis),
      // the reason must cite at least one of them. A candidate with no basis is not rejected for this;
      // its weakness is reported in the trace instead.
      const decidedBy = ctx.basis?.get?.(p.itemId)?.refs ?? [];
      if (candidate && decidedBy.length && !p.cites.some((ref) => decidedBy.includes(ref))) reasons.push("cites none of the ratings that decided this pick");
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
