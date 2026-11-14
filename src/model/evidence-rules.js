import { visibleDomains } from "../data/domains.js";
import { LEVELS } from "../ai/contract.js";

// What cited evidence allows a Taste Profile pattern to claim: its level, the areas it is supported in and
// how far a cross-domain link may go. One copy, shared by the server's validator (src/ai/validate.js, which
// re-exports these) and the browser's "Confirm it still fits" (reconfirmPattern, src/model/statements.js),
// so the two can never disagree. Moved here unchanged from validate.js and interpretations.js (Nov 4, after
// #328) because statements.js can't import validate.js without a circular import.

// Compute supported/contradicted domains from explicit evidence rows. Used by the validator to
// cap model scope without relying on any seeded profile.
export function domainScope(evidence) {
  const count = (rows) => {
    const byDomain = {};
    for (const row of rows ?? []) {
      for (const domain of row.item?.domains ?? []) byDomain[domain] = (byDomain[domain] ?? 0) + 1;
    }
    return byDomain;
  };
  const pro = count(evidence?.supports);
  const con = count(evidence?.against);
  const all = visibleDomains().map((domain) => domain.id);
  const supported = all.filter((domain) => (pro[domain] ?? 0) > (con[domain] ?? 0));
  const contradicted = all.filter((domain) => (con[domain] ?? 0) > (pro[domain] ?? 0));
  const untested = all.filter((domain) => !pro[domain] && !con[domain]);
  const crossDomain = supported.length < 2
    ? "untested"
    : supported.every((domain) => pro[domain] >= 2) ? "supported" : "tentative";
  return { scope: { supported, contradicted, untested }, crossDomain };
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
export const capLevel = (claimed, allowed) => LEVELS[Math.min(LEVELS.indexOf(claimed), LEVELS.indexOf(allowed))];

export const evidenceRows = (records) => records.map((r) => ({ item: { id: r.itemId, domains: r.domains } }));

// #228: the furthest a cross-domain link may go. Docs (evidence-contract.md): "Emerging: a starting
// pattern. Nothing the user tried has tested it yet", and cross-domain links "must be supported by
// evidence in both areas, not assumed". Starter favorites make a pattern plausible as a starting
// point but do not test a link between areas, so only things the user tried (Loved / Liked / disliked
// reactions) count here. The eval (cold-4, starter-6: at most "untested"; cross-domain: one loved
// thing in each of two areas, at most "tentative") encodes the same rule.
export function allowedCrossDomain(supportRecords, counterRecords) {
  return domainScope({ supports: evidenceRows(triedRecords(supportRecords)), against: evidenceRows(counterRecords), heldUp: [] }).crossDomain;
}
